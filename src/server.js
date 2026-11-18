process.env.TZ = process.env.TZ || 'America/Sao_Paulo';

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, getSettings, setSetting, nowLocal } from './db.js';
import {
  hashPassword, checkPassword, createSession, destroySession, userFromToken, ensureAdmin,
  loginBlocked, loginFailed, loginOk,
} from './auth.js';
import { lookupCep, geocode, providerName, providerBackup } from './maps.js';
import { planRoute, chooseOrder, MAX_STOPS } from './planner.js';
import { summary, reportXlsx, reportCsv } from './report.js';
import { CATALOG } from './catalog.js';
import { routeSheetHtml } from './print.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, '..', 'public');
const PORT = +process.env.PORT || 3000;

ensureAdmin();

/* ---------------- utilitários ---------------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => new HttpError(400, msg);

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted; }
function setCookie(res, req, name, value, maxAge) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
}
function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const data = isBuf || typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': headers['Content-Type'] || (isBuf ? 'application/octet-stream' : typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8'),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(data);
}
async function readJson(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return {};
  if (!String(req.headers['content-type'] || '').includes('application/json')) throw bad('Envie JSON');
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1e6) throw bad('Dados grandes demais'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw bad('JSON inválido'); }
}
const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const requireAdmin = (u) => { if (u.role !== 'admin') throw new HttpError(403, 'Apenas administradores'); };
const today = () => nowLocal().slice(0, 10);
const thisMonth = () => nowLocal().slice(0, 7);

function publicSettings() {
  const s = getSettings();
  return {
    company: s.company, base_address: s.base_address, city_hint: s.city_hint,
    kwh_price: +s.kwh_price, fuel_price: +s.fuel_price, charge_eff: +s.charge_eff,
    stop_minutes: +s.stop_minutes, ref_km_l: +s.ref_km_l, return_default: s.return_default === '1', maps_mode: s.maps_mode,
    provider: providerName(), provider_backup: providerBackup(), max_stops: MAX_STOPS,
    embed_key: process.env.GOOGLE_MAPS_EMBED_KEY || '',
  };
}
function vehicleRow(v) {
  return v && { ...v, active: !!v.active, battery_kwh: v.battery_v && v.battery_ah ? (v.battery_v * v.battery_ah) / 1000 : null };
}
function routeRow(r) {
  return { ...r, stops: JSON.parse(r.stops), origin: JSON.parse(r.origin), end_point: JSON.parse(r.end_point) };
}

// Planos calculados ficam guardados por 6 h até serem salvos (evita salvar valores alterados no navegador)
const plans = new Map();
function keepPlan(p, meta) {
  plans.set(p.id, { plan: p, meta, at: Date.now() });
  for (const [k, v] of plans) if (Date.now() - v.at > 6 * 3600e3) plans.delete(k);
}

/* ---------------- API ---------------- */
const routes = [];
const on = (method, pattern, handler, opts = {}) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, open: !!opts.open });
};

on('POST', '/api/login', async (req, res, { body }) => {
  const username = str(body.username, 60), password = String(body.password || '');
  const key = `${req.socket.remoteAddress}|${username.toLowerCase()}`;
  if (loginBlocked(key)) throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos.');
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u || !u.active || !checkPassword(password, u.pass)) { loginFailed(key); throw new HttpError(401, 'Usuário ou senha incorretos'); }
  loginOk(key);
  const s = createSession(u.id);
  setCookie(res, req, 'sid', s.token, s.maxAge);
  return { ok: true };
}, { open: true });

on('POST', '/api/logout', async (req, res) => {
  destroySession(cookies(req).sid);
  setCookie(res, req, 'sid', '', 0);
  return { ok: true };
}, { open: true });

on('GET', '/api/me', async (req, res, { user }) => ({ user, settings: publicSettings() }));

on('PUT', '/api/me/password', async (req, res, { user, body }) => {
  const row = db.prepare('SELECT pass FROM users WHERE id = ?').get(user.id);
  if (!checkPassword(body.current || '', row.pass)) throw bad('Senha atual incorreta');
  if (String(body.password || '').length < 6) throw bad('A nova senha precisa ter pelo menos 6 caracteres');
  db.prepare('UPDATE users SET pass = ?, must_change = 0 WHERE id = ?').run(hashPassword(body.password), user.id);
  return { ok: true };
});

/* configurações */
on('GET', '/api/settings', async () => publicSettings());
on('PUT', '/api/settings', async (req, res, { user, body }) => {
  requireAdmin(user);
  const map = { company: str, base_address: str, city_hint: str, maps_mode: (v) => (v === 'two-wheeler' ? 'two-wheeler' : 'driving') };
  for (const [k, f] of Object.entries(map)) if (k in body) setSetting(k, f(body[k]));
  for (const k of ['kwh_price', 'fuel_price', 'charge_eff', 'stop_minutes', 'ref_km_l']) if (k in body) {
    const n = num(body[k]); if (n == null || n < 0) throw bad(`Valor inválido em ${k}`); setSetting(k, n);
  }
  if ('return_default' in body) setSetting('return_default', body.return_default ? '1' : '0');
  if (body.base_address) { try { await geocode(body.base_address, getSettings().city_hint); } catch (e) { throw bad('Não encontrei o endereço da base: ' + e.message); } }
  return publicSettings();
});

/* catálogo e veículos */
on('GET', '/api/catalog', async () => CATALOG);

on('GET', '/api/vehicles', async () => db.prepare('SELECT * FROM vehicles ORDER BY active DESC, name').all().map(vehicleRow));
function vehicleFromBody(b) {
  const v = {
    name: str(b.name, 80), type: 'combustao', model_key: null, plate: str(b.plate, 20) || null,
    battery_v: null, battery_ah: null, range_km: null, km_per_l: num(b.km_per_l),
    avg_speed: num(b.avg_speed) || 30,
  };
  if (!v.name) throw bad('Dê um nome ao veículo');
  if (!(v.km_per_l > 0)) throw bad('Informe a média de km por litro do veículo');
  return v;
}
on('POST', '/api/vehicles', async (req, res, { user, body }) => {
  requireAdmin(user);
  const v = vehicleFromBody(body);
  const r = db.prepare(`INSERT INTO vehicles(name, type, model_key, plate, battery_v, battery_ah, range_km, km_per_l, avg_speed, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(v.name, v.type, v.model_key, v.plate, v.battery_v, v.battery_ah, v.range_km, v.km_per_l, v.avg_speed, nowLocal());
  return vehicleRow(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(r.lastInsertRowid));
});
on('PUT', '/api/vehicles/:id', async (req, res, { user, body, params }) => {
  requireAdmin(user);
  if (Object.keys(body).length === 1 && 'active' in body) {
    db.prepare('UPDATE vehicles SET active = ? WHERE id = ?').run(body.active ? 1 : 0, +params.id);
  } else {
    const v = vehicleFromBody(body);
    db.prepare(`UPDATE vehicles SET name=?, type=?, model_key=?, plate=?, battery_v=?, battery_ah=?, range_km=?, km_per_l=?, avg_speed=? WHERE id=?`)
      .run(v.name, v.type, v.model_key, v.plate, v.battery_v, v.battery_ah, v.range_km, v.km_per_l, v.avg_speed, +params.id);
  }
  return vehicleRow(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(+params.id));
});

/* usuários */
on('GET', '/api/users', async (req, res, { user }) => {
  if (user.role !== 'admin') return db.prepare("SELECT id, name, role FROM users WHERE id = ?").all(user.id);
  return db.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY active DESC, name').all();
});
on('POST', '/api/users', async (req, res, { user, body }) => {
  requireAdmin(user);
  const username = str(body.username, 40).toLowerCase(), name = str(body.name, 80);
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw bad('Usuário: use de 3 a 40 letras minúsculas, números, ponto ou traço');
  if (!name) throw bad('Informe o nome');
  if (String(body.password || '').length < 6) throw bad('A senha precisa ter pelo menos 6 caracteres');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw bad('Esse usuário já existe');
  const role = body.role === 'admin' ? 'admin' : 'entregador';
  db.prepare('INSERT INTO users(username, name, pass, role, created_at) VALUES (?, ?, ?, ?, ?)').run(username, name, hashPassword(body.password), role, nowLocal());
  return { ok: true };
});
on('PUT', '/api/users/:id', async (req, res, { user, body, params }) => {
  requireAdmin(user);
  const id = +params.id;
  if (id === user.id && (body.active === false || body.role === 'entregador')) throw bad('Você não pode desativar nem rebaixar a si mesmo');
  if ('name' in body && str(body.name)) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(str(body.name, 80), id);
  if ('role' in body) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(body.role === 'admin' ? 'admin' : 'entregador', id);
  if ('active' in body) { db.prepare('UPDATE users SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id); if (!body.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); }
  if (body.password) {
    if (String(body.password).length < 6) throw bad('A senha precisa ter pelo menos 6 caracteres');
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(body.password), id);
  }
  return { ok: true };
});

/* CEP */
on('GET', '/api/cep/:cep', async (req, res, { params }) => {
  try { return await lookupCep(params.cep); } catch (e) { throw bad(e.message); }
});

/* planejamento */
on('POST', '/api/plan', async (req, res, { user, body }) => {
  requireAdmin(user);
  const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ? AND active = 1').get(+body.vehicle_id);
  if (!vehicle) throw bad('Escolha o veículo');
  const stops = (Array.isArray(body.stops) ? body.stops : []).map((s) => ({
    address: str(s.address), cliente: str(s.cliente, 80), telefone: str(s.telefone, 30), obs: str(s.obs, 200), urgent: !!s.urgent, produto: str(s.produto, 80),
  }));
  const settings = getSettings();
  const fp = num(body.fuel_price);
  if (fp != null) { if (!(fp > 0 && fp < 50)) throw bad('Preço do combustível inválido'); settings.fuel_price = fp; }
  const origin = { address: str(body.origin?.address) || settings.base_address };
  const end = { mode: body.end?.mode === 'outro' ? 'outro' : 'base', address: str(body.end?.address) };
  let plan;
  let ctx;
  try { ({ plan, ctx } = await planRoute({ origin, stops, end, vehicle, settings })); } catch (e) { throw bad(e.message); }
  keepPlan(plan, { vehicle, ctx, tolls: { [plan.toll.order]: plan.toll } });
  return plan;
});

// Quem planeja escolhe outra ordem das entregas
on('POST', '/api/plan/:id/order', async (req, res, { user, body, params }) => {
  requireAdmin(user);
  const kept = plans.get(params.id);
  if (!kept) throw bad('Esse cálculo expirou. Calcule a rota de novo.');
  const key = (body.order || []).map(Number).join(',');
  let plan;
  try { plan = await chooseOrder(kept.meta.ctx, params.id, body.order, kept.meta.tolls[key]); } catch (e) { throw bad(e.message); }
  kept.meta.tolls[plan.toll.order] = plan.toll;
  kept.plan = plan; kept.at = Date.now();
  return plan;
});

/* rotas salvas */
on('POST', '/api/routes', async (req, res, { user, body }) => {
  requireAdmin(user);
  const kept = plans.get(body.plan_id);
  if (!kept) throw bad('Esse cálculo expirou. Calcule a rota de novo.');
  const p = kept.plan, v = kept.meta.vehicle;
  const driver = body.driver_id ? db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(+body.driver_id) : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(body.route_date || '') ? body.route_date : today();
  const tollIn = num(body.toll_cost);
  if (tollIn != null && !(tollIn >= 0 && tollIn < 5000)) throw bad('Valor de pedágio inválido');
  const toll = tollIn != null ? tollIn : (p.toll?.value || 0);
  const r = db.prepare(`INSERT INTO routes(created_at, route_date, created_by, driver_id, vehicle_id, vehicle_name, vehicle_type, status,
      origin, end_point, stops, deliveries, total_km, total_min, energy_kwh, fuel_l, unit_price, cost, battery_pct, saved_km, maps_link, notes,
      toll_cost, toll_status, manual_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'planejada', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    nowLocal(), date, user.id, driver?.id ?? null, v.id, v.name, v.type,
    JSON.stringify(p.origin), JSON.stringify({ ...p.end, round_trip: p.round_trip, last_leg_km: p.last_leg_km }), JSON.stringify(p.stops),
    p.stops.length, p.total_km, p.total_min, p.energy_kwh, p.fuel_l, p.unit_price, p.cost, p.battery_pct, p.saved_km, p.maps_link, str(body.notes, 500) || null,
    toll, tollIn != null && tollIn !== (p.toll?.value || 0) ? 'manual' : (p.toll?.status || null), p.manual ? 1 : 0,
  );
  plans.delete(body.plan_id);
  if (p.unit_price > 0) setSetting('fuel_price', p.unit_price); // próximo cálculo já vem com o último preço usado
  return routeRow(db.prepare('SELECT * FROM routes WHERE id = ?').get(r.lastInsertRowid));
});

on('GET', '/api/routes', async (req, res, { user, query }) => {
  const month = /^\d{4}-\d{2}$/.test(query.get('month') || '') ? query.get('month') : thisMonth();
  let sql = `SELECT r.*, u.name AS driver_name FROM routes r LEFT JOIN users u ON u.id = r.driver_id WHERE substr(r.route_date,1,7) = ?`;
  const args = [month];
  if (user.role !== 'admin') { sql += ' AND r.driver_id = ?'; args.push(user.id); }
  else if (query.get('driver')) { sql += ' AND r.driver_id = ?'; args.push(+query.get('driver')); }
  if (query.get('status')) { sql += ' AND r.status = ?'; args.push(query.get('status')); }
  sql += ' ORDER BY r.route_date DESC, r.id DESC';
  return db.prepare(sql).all(...args).map(routeRow);
});

on('PATCH', '/api/routes/:id', async (req, res, { user, body, params }) => {
  const r = db.prepare('SELECT * FROM routes WHERE id = ?').get(+params.id);
  if (!r) throw new HttpError(404, 'Rota não encontrada');
  if (user.role !== 'admin' && r.driver_id !== user.id) throw new HttpError(403, 'Essa rota não é sua');
  const allowed = user.role === 'admin' ? ['planejada', 'em_rota', 'concluida', 'cancelada'] : ['em_rota', 'concluida'];
  if (body.status) {
    if (!allowed.includes(body.status)) throw bad('Status inválido');
    db.prepare('UPDATE routes SET status = ?, completed_at = ? WHERE id = ?').run(body.status, body.status === 'concluida' ? nowLocal() : null, r.id);
  }
  if (user.role === 'admin') {
    if ('driver_id' in body) db.prepare('UPDATE routes SET driver_id = ? WHERE id = ?').run(body.driver_id ? +body.driver_id : null, r.id);
    if ('notes' in body) db.prepare('UPDATE routes SET notes = ? WHERE id = ?').run(str(body.notes, 500) || null, r.id);
    if (/^\d{4}-\d{2}-\d{2}$/.test(body.route_date || '')) db.prepare('UPDATE routes SET route_date = ? WHERE id = ?').run(body.route_date, r.id);
    if ('toll_cost' in body) {
      const tv = num(body.toll_cost);
      if (!(tv >= 0 && tv < 5000)) throw bad('Valor de pedágio inválido');
      db.prepare("UPDATE routes SET toll_cost = ?, toll_status = 'manual' WHERE id = ?").run(tv, r.id);
    }
    if ('fuel_price' in body) {
      const fp = num(body.fuel_price);
      if (!(fp > 0 && fp < 50)) throw bad('Preço do combustível inválido');
      if (r.fuel_l != null) db.prepare('UPDATE routes SET unit_price = ?, cost = ? WHERE id = ?').run(fp, r.fuel_l * fp, r.id);
    }
  }
  return routeRow(db.prepare('SELECT * FROM routes WHERE id = ?').get(r.id));
});

on('DELETE', '/api/routes/:id', async (req, res, { user, params }) => {
  requireAdmin(user);
  db.prepare('DELETE FROM routes WHERE id = ?').run(+params.id);
  return { ok: true };
});

/* relatórios */
const monthOf = (q) => (/^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : thisMonth());
const driverOf = (q, user) => (user.role === 'admin' ? (+q.get('driver') || null) : user.id);
on('GET', '/api/report', async (req, res, { user, query }) => {
  const s = summary(monthOf(query), driverOf(query, user));
  delete s.routes;
  return s;
});
on('GET', '/api/report.xlsx', async (req, res, { user, query }) => {
  const m = monthOf(query);
  const { buffer } = reportXlsx(m, driverOf(query, user));
  send(res, 200, buffer, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="relatorio-entregas-${m}.xlsx"`,
  });
});
on('GET', '/api/report.csv', async (req, res, { user, query }) => {
  const m = monthOf(query);
  send(res, 200, reportCsv(m, driverOf(query, user)), {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="relatorio-entregas-${m}.csv"`,
  });
});

/* ---------------- arquivos estáticos ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, pathname) {
  let p = pathname === '/' ? '/app.html' : pathname === '/login' ? '/login.html' : pathname;
  const file = path.resolve(PUBLIC, '.' + path.posix.normalize(p));
  if (!file.startsWith(PUBLIC)) return send(res, 404, 'Não encontrado');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Não encontrado');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    res.end(data);
  });
}

/* ---------------- servidor ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = url.pathname;
  try {
    const pm = pathname.match(/^\/rota\/(\d+)\/imprimir$/);
    if (pm) {
      const u = userFromToken(cookies(req).sid);
      if (!u) { res.writeHead(302, { Location: '/login' }); return res.end(); }
      const row = db.prepare('SELECT r.*, u.name AS driver_name FROM routes r LEFT JOIN users u ON u.id = r.driver_id WHERE r.id = ?').get(+pm[1]);
      if (!row || (u.role !== 'admin' && row.driver_id !== u.id)) return send(res, 404, 'Rota não encontrada');
      return send(res, 200, routeSheetHtml(routeRow(row), getSettings().company), { 'Content-Type': 'text/html; charset=utf-8' });
    }
    if (!pathname.startsWith('/api/')) {
      if (pathname === '/' || pathname === '/app.html') {
        if (!userFromToken(cookies(req).sid)) { res.writeHead(302, { Location: '/login' }); return res.end(); }
      }
      return serveStatic(req, res, pathname);
    }
    const route = routes.find((r) => r.method === req.method && r.re.test(pathname));
    if (!route) throw new HttpError(404, 'Rota da API não encontrada');
    const m = pathname.match(route.re);
    const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const user = userFromToken(cookies(req).sid);
    if (!route.open && !user) throw new HttpError(401, 'Faça login');
    const body = await readJson(req);
    const out = await route.handler(req, res, { user, body, params, query: url.searchParams });
    if (!res.headersSent && out !== undefined) send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Erro interno. Tente de novo.' : e.message });
  }
});

server.listen(PORT, () => {
  console.log(`Rotas de entrega rodando na porta ${PORT} — mapas: ${providerName()}${providerBackup() ? ' (reserva: ' + providerBackup() + ')' : ''}`);
});
