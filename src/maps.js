// Serviços de mapa: CEP (ViaCEP), geocodificação e matriz de distâncias pelas ruas.
// Provedores, escolhidos pelas variáveis de ambiente (o primeiro disponível é o principal;
// se ele falhar, o sistema usa o próximo automaticamente):
//   GOOGLE_MAPS_API_KEY   -> Google oficial (Geocoding API + Routes API, com faturamento)
//   GOOGLE_MAPS_DEMO_KEY  -> Google Maps Demo Key (sem cartão; Geocoding v4 + Compute Routes)
//   ORS_API_KEY           -> OpenRouteService (gratuito) — reserva
//   nenhuma               -> modo demonstração (distâncias aproximadas, só para testar)
import { db, nowLocal } from './db.js';

const GKEY = process.env.GOOGLE_MAPS_API_KEY || '';
const GDEMO = process.env.GOOGLE_MAPS_DEMO_KEY || '';
const ORSKEY = process.env.ORS_API_KEY || '';
const DEMO = process.env.DEMO === '1';

export const PROVIDER_LABEL = {
  google: 'Google Maps', 'google-demo': 'Google Maps (chave de demonstração)',
  openrouteservice: 'OpenRouteService', demo: 'modo demonstração', cache: 'endereço já salvo',
};

function chain() {
  const c = [];
  if (GKEY) c.push('google');
  else if (GDEMO) c.push('google-demo');
  if (ORSKEY) c.push('openrouteservice');
  if (!c.length) c.push('demo');
  return c;
}
export function providerName() { return chain()[0]; }
export function providerBackup() { return chain()[1] || null; }

async function getJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    if (!r.ok) {
      const msg = data?.error?.message || data?.error || text.slice(0, 200);
      const e = new Error(`Serviço de mapas respondeu ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
      e.status = r.status;
      throw e;
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Serviço de mapas não respondeu a tempo');
    throw e;
  } finally { clearTimeout(t); }
}

/* ---------------- CEP ---------------- */
const DEMO_CEPS = {
  '87013000': { logradouro: 'Avenida Brasil', bairro: 'Zona 01', localidade: 'Maringá', uf: 'PR', lat: -23.4253, lng: -51.9386 },
  '87020025': { logradouro: 'Avenida Tiradentes', bairro: 'Zona 01', localidade: 'Maringá', uf: 'PR', lat: -23.4199, lng: -51.9337 },
  '87050390': { logradouro: 'Avenida Mandacaru', bairro: 'Jardim Alvorada', localidade: 'Maringá', uf: 'PR', lat: -23.3946, lng: -51.9505 },
  '87030010': { logradouro: 'Avenida Colombo', bairro: 'Zona 07', localidade: 'Maringá', uf: 'PR', lat: -23.4070, lng: -51.9330 },
  '87060000': { logradouro: 'Avenida Pedro Taques', bairro: 'Jardim Alvorada', localidade: 'Maringá', uf: 'PR', lat: -23.3990, lng: -51.9630 },
  '87080000': { logradouro: 'Avenida Morangueira', bairro: 'Vila Morangueira', localidade: 'Maringá', uf: 'PR', lat: -23.3960, lng: -51.9180 },
  '87015000': { logradouro: 'Avenida Cerro Azul', bairro: 'Zona 02', localidade: 'Maringá', uf: 'PR', lat: -23.4380, lng: -51.9480 },
};

export async function lookupCep(cep) {
  const c = String(cep).replace(/\D/g, '');
  if (c.length !== 8) throw new Error('CEP deve ter 8 números');
  if (DEMO && DEMO_CEPS[c]) return { cep: c, ...DEMO_CEPS[c] };
  const d = await getJSON(`https://viacep.com.br/ws/${c}/json/`);
  if (!d || d.erro) throw new Error('CEP não encontrado');
  return { cep: c, logradouro: d.logradouro || '', bairro: d.bairro || '', localidade: d.localidade || '', uf: d.uf || '' };
}

/* ---------------- Geocodificação ---------------- */
function norm(s) { return String(s).trim().replace(/\s+/g, ' ').toLowerCase(); }

function parseCoords(t) {
  const m = String(t).match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}

class NotFound extends Error {}

const GEOCODERS = {
  async google(full) {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(full)}&region=br&language=pt-BR&components=country:BR&key=${GKEY}`;
    const d = await getJSON(u);
    if (d.status === 'ZERO_RESULTS') throw new NotFound();
    if (d.status !== 'OK') throw new Error(`Google Geocoding: ${d.status} ${d.error_message || ''}`);
    const r = d.results[0];
    return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, label: r.formatted_address };
  },
  async 'google-demo'(full) {
    const q = `${encodeURIComponent(full)}?regionCode=BR&languageCode=pt-BR`;
    const headers = { 'X-Goog-Api-Key': GDEMO };
    let d;
    try { d = await getJSON(`https://geocode.googleapis.com/v4/geocode/address/${q}`, { headers }); }
    catch (e) { if (e.status !== 404) throw e; d = await getJSON(`https://geocode.googleapis.com/v4beta/geocode/address/${q}`, { headers }); }
    const r = d?.results?.[0];
    if (!r?.location) throw new NotFound();
    return { lat: r.location.latitude, lng: r.location.longitude, label: r.formattedAddress || full };
  },
  async openrouteservice(full) {
    // endereço novo (api.openrouteservice.org foi desativado em favor de api.heigit.org)
    const u = `https://api.heigit.org/pelias/v1/search?api_key=${encodeURIComponent(ORSKEY)}&text=${encodeURIComponent(full)}&boundary.country=BR&size=1`;
    const d = await getJSON(u, { headers: { Authorization: ORSKEY } });
    const f = d?.features?.[0];
    if (!f) throw new NotFound();
    return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.properties?.label || full };
  },
  async demo(full) { return demoGeocode(full); },
};

// Retorna { lat, lng, label, provider }
export async function geocode(address, cityHint) {
  const direct = parseCoords(address);
  if (direct) return { ...direct, label: address.trim(), provider: 'coordenada' };
  const full = cityHint && !norm(address).includes(norm(cityHint.split('-')[0])) ? `${address}, ${cityHint}` : address;
  const key = norm(full);
  const hit = db.prepare('SELECT lat, lng, label FROM geocache WHERE q = ?').get(key);
  if (hit) return { ...hit, provider: 'cache' };

  let res, lastErr, notFound = false;
  for (const p of chain()) {
    try { res = { ...(await GEOCODERS[p](full)), provider: p }; break; }
    catch (e) {
      if (e instanceof NotFound) notFound = true; else { lastErr = e; console.warn(`[mapas] ${p} falhou no endereço:`, e.message); }
    }
  }
  if (!res) throw new Error(notFound ? `Endereço não encontrado: "${address}". Confira a rua, o número e o CEP.` : (lastErr?.message || 'Falha ao localizar endereço'));
  db.prepare('INSERT OR REPLACE INTO geocache(q, lat, lng, label, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(key, res.lat, res.lng, res.label, nowLocal());
  return res;
}

function demoGeocode(full) {
  const cep = (full.match(/\b(\d{5})-?(\d{3})\b/) || []).slice(1).join('');
  const base = DEMO_CEPS[cep] || { lat: -23.4205, lng: -51.9333 };
  let h = 0; for (const ch of full) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { lat: base.lat + ((h % 100) - 50) / 20000, lng: base.lng + (((h >> 8) % 100) - 50) / 20000, label: full };
}

/* ---------------- Matriz de distâncias ---------------- */
function hav(a, b) {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const empty = (n) => Array.from({ length: n }, () => Array(n).fill(0));
const latLng = (x) => ({ location: { latLng: { latitude: x.lat, longitude: x.lng } } });

const MATRIX = {
  async google(points) {
    const n = points.length, km = empty(n), min = empty(n);
    const wp = points.map((x) => ({ waypoint: latLng(x) }));
    const d = await getJSON('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY, 'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,duration,condition' },
      body: JSON.stringify({ origins: wp, destinations: wp, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE' }),
    });
    for (const e of Array.isArray(d) ? d : []) {
      const i = e.originIndex ?? 0, j = e.destinationIndex ?? 0; // a API omite campos com valor zero
      if (i === j) continue;
      if (e.condition && e.condition !== 'ROUTE_EXISTS') { km[i][j] = Infinity; min[i][j] = Infinity; continue; }
      km[i][j] = (e.distanceMeters ?? 0) / 1000;
      min[i][j] = parseFloat(String(e.duration || '0s')) / 60;
    }
    return { km, min };
  },
  // Chave de demonstração: não tem a matriz, então calcula trecho por trecho (Compute Routes)
  async 'google-demo'(points) {
    const n = points.length, km = empty(n), min = empty(n);
    const jobs = [];
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) jobs.push([i, j]);
    const one = async ([i, j]) => {
      if (Math.abs(points[i].lat - points[j].lat) < 1e-6 && Math.abs(points[i].lng - points[j].lng) < 1e-6) return;
      const d = await getJSON('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GDEMO, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration' },
        body: JSON.stringify({ origin: latLng(points[i]), destination: latLng(points[j]), travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', languageCode: 'pt-BR', regionCode: 'BR' }),
      });
      const r = d?.routes?.[0];
      if (!r) { km[i][j] = Infinity; min[i][j] = Infinity; return; }
      km[i][j] = (r.distanceMeters ?? 0) / 1000;
      min[i][j] = parseFloat(String(r.duration || '0s')) / 60;
    };
    let k = 0;
    const worker = async () => { while (k < jobs.length) await one(jobs[k++]); };
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, worker));
    return { km, min };
  },
  async openrouteservice(points) {
    const n = points.length, km = empty(n), min = empty(n);
    const d = await getJSON('https://api.heigit.org/openrouteservice/v2/matrix/driving-car', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: ORSKEY },
      body: JSON.stringify({ locations: points.map((x) => [x.lng, x.lat]), metrics: ['distance', 'duration'], units: 'm' }),
    });
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const dist = d.distances?.[i]?.[j], dur = d.durations?.[i]?.[j];
      km[i][j] = dist == null ? Infinity : dist / 1000;
      min[i][j] = dur == null ? Infinity : dur / 60;
    }
    return { km, min };
  },
  async demo(points) {
    const n = points.length, km = empty(n), min = empty(n);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (i === j) continue;
      km[i][j] = hav(points[i], points[j]) * 1.35;
      min[i][j] = (km[i][j] / 30) * 60;
    }
    return { km, min };
  },
};

// Retorna { km: number[][], min: number[][], provider }
export async function matrix(points) {
  let lastErr;
  for (const p of chain()) {
    try { return { ...(await MATRIX[p](points)), provider: p }; }
    catch (e) { lastErr = e; console.warn(`[mapas] ${p} falhou nas distâncias:`, e.message); }
  }
  throw new Error('Não foi possível calcular as distâncias agora: ' + (lastErr?.message || 'serviço indisponível'));
}

/* ---------------- Pedágio ---------------- */
// Retorna { status: 'none' | 'price' | 'unknown' | 'error', value (R$), source, message }
//   none    = a rota não passa por pedágio
//   price   = tem pedágio e o Google informou o valor estimado (carro de passeio)
//   unknown = tem pedágio, mas o valor não foi informado (digite o valor)
//   error   = não foi possível verificar
const moneyValue = (m) => (+m.units || 0) + (+m.nanos || 0) / 1e9;

async function tollsGoogle(points, key) {
  const [o, ...rest] = points; const d = rest.pop();
  const body = {
    origin: latLng(o), destination: latLng(d), intermediates: rest.map(latLng),
    travelMode: 'DRIVE', extraComputations: ['TOLLS'],
    routeModifiers: { vehicleInfo: { emissionType: 'GASOLINE' } },
    languageCode: 'pt-BR', regionCode: 'BR',
  };
  const r = await getJSON('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'routes.travelAdvisory.tollInfo,routes.legs.travelAdvisory.tollInfo' },
    body: JSON.stringify(body),
  });
  const route = r?.routes?.[0];
  if (!route) throw new Error('Google não devolveu a rota');
  const info = route.travelAdvisory?.tollInfo;
  const legHasToll = (route.legs || []).some((l) => l.travelAdvisory?.tollInfo);
  if (!info && !legHasToll) return { status: 'none', value: 0 };
  const prices = (info?.estimatedPrice || []).filter((m) => !m.currencyCode || m.currencyCode === 'BRL');
  if (prices.length) return { status: 'price', value: prices.reduce((a, m) => a + moneyValue(m), 0) };
  return { status: 'unknown', value: 0 };
}

async function tollsORS(points) {
  const d = await getJSON('https://api.heigit.org/openrouteservice/v2/directions/driving-car', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ORSKEY },
    body: JSON.stringify({ coordinates: points.map((x) => [x.lng, x.lat]), extra_info: ['tollways'] }),
  });
  const sum = d?.routes?.[0]?.extras?.tollways?.summary || [];
  const has = sum.some((x) => x.value === 1 && (x.distance || 0) > 0);
  return has ? { status: 'unknown', value: 0 } : { status: 'none', value: 0 };
}

export async function checkTolls(points) {
  const tries = [];
  if (GKEY) tries.push(['google', () => tollsGoogle(points, GKEY)]);
  else if (GDEMO) tries.push(['google-demo', () => tollsGoogle(points, GDEMO)]);
  if (ORSKEY) tries.push(['openrouteservice', () => tollsORS(points)]);
  if (!tries.length) return { status: 'none', value: 0, source: 'demo' };
  let lastErr;
  for (const [name, fn] of tries) {
    try { return { ...(await fn()), source: name }; }
    catch (e) { lastErr = e; console.warn(`[mapas] ${name} falhou no pedágio:`, e.message); }
  }
  return { status: 'error', value: 0, source: null, message: lastErr?.message || '' };
}
