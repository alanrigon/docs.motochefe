/* Rotas de Entrega — painel */
(() => {
'use strict';

/* ---------- utilitários ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (n) => (n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const km = (n) => nf1.format(n ?? 0) + ' km';
const mins = (m) => { m = Math.round(m || 0); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };
const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthISO = () => todayISO().slice(0, 7);
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const cepFmt = (c) => { c = String(c || '').replace(/\D/g, '').slice(0, 8); return c.length > 5 ? c.slice(0, 5) + '-' + c.slice(5) : c; };
const STATUS = { planejada: 'Planejada', em_rota: 'Em rota', concluida: 'Concluída', cancelada: 'Cancelada' };

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401 && !url.includes('/api/me/password')) { location.href = '/login'; throw new Error('Sessão expirada'); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erro ' + r.status);
  return d;
}
let toastT;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => (t.className = 'toast'), 3200);
}
function openModal(html, onMount) {
  $('#modalBox').innerHTML = html; $('#modal').hidden = false;
  $$('[data-close]', $('#modalBox')).forEach((b) => (b.onclick = closeModal));
  onMount && onMount($('#modalBox'));
}
function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; }
$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Link copiado'); }
  catch { prompt('Copie o link:', text); }
}

/* ---------- estado ---------- */
const S = { me: null, settings: null, vehicles: [], users: [], catalog: [] };
const isAdmin = () => S.me?.role === 'admin';
const drivers = () => S.users.filter((u) => u.active !== 0 && u.active !== false);

const ICON = {
  route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 3v18h18"/><path d="M7 15v2M12 10v7M17 6v11"/></svg>',
  bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 11.5M5.5 17.5 9 10h6l-3 7.5h-3"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/></svg>',
};

function navItems() {
  if (isAdmin()) return [
    ['nova', 'Nova rota', ICON.route], ['rotas', 'Rotas', ICON.list], ['relatorio', 'Relatório do mês', ICON.chart], 'sep',
    ['veiculos', 'Veículos', ICON.bike], ['usuarios', 'Usuários', ICON.users], ['config', 'Configurações', ICON.gear], ['conta', 'Minha senha', ICON.key],
  ];
  return [['rotas', 'Minhas rotas', ICON.list], ['relatorio', 'Meu mês', ICON.chart], 'sep', ['conta', 'Minha senha', ICON.key]];
}
function renderNav(cur) {
  $('#nav').innerHTML = navItems().map((n) => (n === 'sep' ? '<div class="sep"></div>' : `<a href="#${n[0]}" class="${n[0] === cur ? 'on' : ''}">${n[2]}<span>${n[1]}</span></a>`)).join('');
}

const VIEWS = {};
function route() {
  let v = location.hash.slice(1) || (isAdmin() ? 'nova' : 'rotas');
  if (S.me.must_change) v = 'conta';
  if (!VIEWS[v] || (!isAdmin() && ['nova', 'veiculos', 'usuarios', 'config'].includes(v))) v = isAdmin() ? 'nova' : 'rotas';
  renderNav(v);
  $('#view').scrollTop = 0;
  VIEWS[v]($('#view'));
}

/* ====================================================================== */
/*  NOVA ROTA                                                               */
/* ====================================================================== */
const newStop = () => ({ cep: '', rua: '', numero: '', bairro: '', cidade: '', comp: '', cliente: '', telefone: '', obs: '', produto: '', urgent: false });
let F = null;   // formulário
let PLAN = null; // último cálculo
function resetForm() {
  F = {
    date: todayISO(),
    driver_id: drivers().find((u) => u.role === 'entregador')?.id || '',
    vehicle_id: S.vehicles.find((v) => v.active)?.id || '',
    origin: S.settings.base_address || '',
    fuel_price: S.settings.fuel_price,
    endMode: S.settings.return_default ? 'base' : 'outro',
    end: newStop(),
    stops: [newStop()],
  };
  PLAN = null;
}
function addressOf(s) {
  if (!s.rua.trim()) return '';
  const city = s.cidade || S.settings.city_hint || '';
  return `${s.rua.trim()}${s.numero ? ', ' + s.numero.trim() : ''}${s.bairro ? ' - ' + s.bairro.trim() : ''}${city ? ', ' + city : ''}${s.cep ? ', ' + cepFmt(s.cep) : ''}`;
}

VIEWS.nova = (el) => {
  if (!F) resetForm();
  const act = S.vehicles.filter((v) => v.active);
  el.innerHTML = `
    <div class="head"><div><h1>Nova rota</h1><p>Digite o CEP de cada entrega. O sistema acha a melhor ordem e calcula o gasto de combustível.</p></div>
      <div class="right"><button class="btn" id="clearAll">Limpar</button></div></div>
    ${!act.length ? `<div class="banner">⚠️ Cadastre um veículo antes de planejar rotas. <a href="#veiculos">Ir para Veículos</a></div>` : ''}
    ${!S.settings.base_address ? `<div class="banner">📍 Defina o endereço da loja em <a href="#config">Configurações</a> para ele já vir preenchido como saída.</div>` : ''}
    <div class="grid2">
      <div>
        <div class="card">
          <h3>Quem, quando e com o quê</h3>
          <div class="fields" style="grid-template-columns:1fr 1fr 1.3fr 1fr">
            <label>Data<input type="date" id="fDate" value="${F.date}"></label>
            <label>Entregador<select id="fDriver"><option value="">— sem entregador —</option>${drivers().map((u) => `<option value="${u.id}" ${+F.driver_id === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
            <label>Veículo<select id="fVehicle">${act.map((v) => `<option value="${v.id}" ${+F.vehicle_id === v.id ? 'selected' : ''}>${esc(v.name)} (${nf1.format(v.km_per_l || 0)} km/l)</option>`).join('')}</select></label>
            <label>Combustível hoje (R$/litro)<input type="number" step="0.01" min="0" id="fFuel" value="${F.fuel_price ?? ''}"></label>
          </div>
          <p class="hint">O preço do litro fica gravado na rota, então o relatório usa o valor de cada dia. O próximo cálculo já vem com o último preço usado.</p>
        </div>
        <div class="card">
          <h3>Percurso</h3>
          <div class="stop">
            <div class="stop-head"><span class="pin base">S</span><b>Saída</b></div>
            <input id="fOrigin" value="${esc(F.origin)}" placeholder="Endereço de saída (loja)">
          </div>
          <div id="stops" style="margin-top:10px"></div>
          <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
            <button class="btn" id="addStop">+ Adicionar entrega</button>
            <span class="muted" style="font-size:12px">até ${S.settings.max_stops} entregas por rota</span>
          </div>
          <div style="margin-top:18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <b style="font-size:13px">Depois das entregas</b>
            <div class="seg" id="endSeg"><button data-v="base">Volta para a loja</button><button data-v="outro">Termina em outro lugar</button></div>
          </div>
          <div id="endBox" style="margin-top:10px"></div>
        </div>
        <button class="btn green lg block" id="calc" style="margin-top:16px" ${act.length ? '' : 'disabled'}>Calcular melhor rota</button>
      </div>
      <div class="sticky" id="result"></div>
    </div>`;

  $('#fDate').onchange = (e) => (F.date = e.target.value);
  $('#fDriver').onchange = (e) => (F.driver_id = e.target.value);
  $('#fVehicle').onchange = (e) => (F.vehicle_id = e.target.value);
  $('#fFuel').oninput = (e) => (F.fuel_price = e.target.value);
  $('#fOrigin').oninput = (e) => (F.origin = e.target.value);
  $('#addStop').onclick = () => {
    if (F.stops.length >= S.settings.max_stops) return toast(`Máximo de ${S.settings.max_stops} entregas por rota`, true);
    F.stops.push(newStop()); renderStops(); $$('#stops .stop').pop().querySelector('input').focus();
  };
  $('#clearAll').onclick = () => { resetForm(); VIEWS.nova(el); };
  $$('#endSeg button').forEach((b) => (b.onclick = () => { F.endMode = b.dataset.v; renderEnd(); }));
  $('#calc').onclick = calculate;
  renderStops(); renderEnd(); renderResult();
};

function addrFields(s, i, kind) {
  return `
    <div class="cep-row">
      <label class="cep-wrap">CEP<input data-k="cep" inputmode="numeric" maxlength="9" placeholder="00000-000" value="${esc(cepFmt(s.cep))}"><span class="spin"></span></label>
      <label>Rua<input data-k="rua" value="${esc(s.rua)}" placeholder="preenchida pelo CEP"></label>
      <label>Número<input data-k="numero" value="${esc(s.numero)}" placeholder="nº"></label>
    </div>
    <div class="fields f3" style="margin-top:10px">
      <label>Bairro<input data-k="bairro" value="${esc(s.bairro)}"></label>
      <label>Cidade<input data-k="cidade" value="${esc(s.cidade)}" placeholder="${esc(S.settings.city_hint)}"></label>
      <label>Complemento<input data-k="comp" value="${esc(s.comp)}" placeholder="apto, bloco, referência"></label>
    </div>
    ${kind === 'stop' ? `<div class="fields f2" style="margin-top:10px">
      <label>Cliente<input data-k="cliente" value="${esc(s.cliente)}"></label>
      <label>Telefone<input data-k="telefone" value="${esc(s.telefone)}" inputmode="tel"></label>
      <label>Produto entregue<select data-k="produto"><option value="">— escolher —</option>${S.catalog.map((c) => `<option ${s.produto === c.nome ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}<option ${s.produto === 'Acessório / peça' ? 'selected' : ''}>Acessório / peça</option><option ${s.produto === 'Outro' ? 'selected' : ''}>Outro</option></select></label>
      <label>Observação<input data-k="obs" value="${esc(s.obs)}" placeholder="ex.: pagar na entrega"></label>
    </div>` : ''}
    <div class="addr-msg"></div>`;
}
function bindAddr(box, s) {
  $$('[data-k]', box).forEach((inp) => {
    inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = inp.dataset.k;
      if (k === 'cep') { inp.value = cepFmt(inp.value); s.cep = inp.value.replace(/\D/g, ''); if (s.cep.length === 8) fillCep(box, s); }
      else s[k] = inp.value;
    });
  });
}
async function fillCep(box, s) {
  const spin = $('.spin', box), msg = $('.addr-msg', box);
  spin.textContent = 'buscando…'; msg.className = 'addr-msg'; msg.textContent = '';
  try {
    const d = await api('GET', '/api/cep/' + s.cep);
    s.rua = d.logradouro || s.rua; s.bairro = d.bairro || s.bairro; s.cidade = d.localidade ? `${d.localidade} - ${d.uf}` : s.cidade;
    $('[data-k=rua]', box).value = s.rua; $('[data-k=bairro]', box).value = s.bairro; $('[data-k=cidade]', box).value = s.cidade;
    msg.className = 'addr-msg addr-ok'; msg.textContent = `✓ ${[s.rua, s.bairro, s.cidade].filter(Boolean).join(', ')}`;
    if (!d.logradouro) { msg.textContent += ' — CEP geral da cidade: digite a rua.'; $('[data-k=rua]', box).focus(); }
    else $('[data-k=numero]', box).focus();
  } catch (e) { msg.className = 'addr-msg addr-err'; msg.textContent = e.message + '. Você pode digitar a rua à mão.'; }
  spin.textContent = '';
}
function renderStops() {
  const box = $('#stops');
  box.innerHTML = F.stops.map((s, i) => `
    <div class="stop" data-i="${i}">
      <div class="stop-head"><span class="pin">${i + 1}</span><b>Entrega ${i + 1}</b>
        <div class="tools"><label class="check"><input type="checkbox" data-urg ${s.urgent ? 'checked' : ''}> Urgente</label>
        ${F.stops.length > 1 ? '<button class="link red" data-rm>Remover</button>' : ''}</div></div>
      ${addrFields(s, i, 'stop')}
    </div>`).join('');
  $$('.stop', box).forEach((d) => {
    const s = F.stops[+d.dataset.i];
    bindAddr(d, s);
    $('[data-urg]', d).onchange = (e) => (s.urgent = e.target.checked);
    const rm = $('[data-rm]', d); if (rm) rm.onclick = () => { F.stops.splice(+d.dataset.i, 1); renderStops(); };
  });
}
function renderEnd() {
  $$('#endSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === F.endMode));
  const box = $('#endBox');
  if (F.endMode === 'base') { box.innerHTML = ''; return; }
  box.innerHTML = `<div class="stop"><div class="stop-head"><span class="pin end">F</span><b>Destino final</b></div>${addrFields(F.end, 0, 'end')}</div>`;
  bindAddr($('.stop', box), F.end);
}

async function calculate() {
  const stops = F.stops.map((s) => ({
    address: addressOf(s), cliente: s.cliente, telefone: s.telefone,
    obs: [s.comp, s.obs].filter(Boolean).join(' · '), urgent: s.urgent, produto: s.produto,
  }));
  const empty = stops.findIndex((s) => !s.address);
  if (empty >= 0) return toast(`Preencha o CEP/rua da Entrega ${empty + 1}`, true);
  if (stops.some((s, i) => !F.stops[i].numero)) {
    const i = F.stops.findIndex((s) => !s.numero);
    if (!confirm(`A Entrega ${i + 1} está sem número. Calcular assim mesmo?`)) return;
  }
  if (F.endMode === 'outro' && !addressOf(F.end)) return toast('Preencha o destino final', true);
  const b = $('#calc'); b.disabled = true; b.textContent = 'Calculando…';
  $('#result').innerHTML = `<div class="card empty-state"><div class="big">🧭</div>Calculando as distâncias pelas ruas…</div>`;
  try {
    PLAN = await api('POST', '/api/plan', {
      vehicle_id: +F.vehicle_id, origin: { address: F.origin }, stops, fuel_price: F.fuel_price,
      end: { mode: F.endMode, address: F.endMode === 'outro' ? addressOf(F.end) : '' },
    });
    PLAN._saved = false;
    renderResult();
  } catch (e) {
    $('#result').innerHTML = `<div class="card"><div class="warn-box">${esc(e.message)}</div></div>`;
  } finally { b.disabled = false; b.textContent = 'Calcular melhor rota'; }
}

function mapSvg(p) {
  const pts = [p.origin, ...p.stops, p.end];
  const lats = pts.map((x) => x.lat), lngs = pts.map((x) => x.lng);
  let [a, b, c, d] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const W = 640, Hh = 300, P = 40;
  const midLat = (a + b) / 2, kx = Math.cos((midLat * Math.PI) / 180);
  let spanX = (d - c) * kx || 0.01, spanY = (b - a) || 0.01;
  const sc = Math.min((W - 2 * P) / spanX, (Hh - 2 * P) / spanY);
  const ox = (W - spanX * sc) / 2, oy = (Hh - spanY * sc) / 2;
  const X = (x) => ox + (x.lng - c) * kx * sc, Y = (x) => Hh - (oy + (x.lat - a) * sc);
  const path = pts.map((x, i) => `${i ? 'L' : 'M'}${X(x).toFixed(1)},${Y(x).toFixed(1)}`).join(' ');
  const grid = Array.from({ length: 13 }, (_, i) => `<line x1="${i * 55}" y1="0" x2="${i * 55}" y2="${Hh}"/>`).join('') + Array.from({ length: 7 }, (_, i) => `<line x1="0" y1="${i * 55}" x2="${W}" y2="${i * 55}"/>`).join('');
  const marker = (x, label, cls, name) => `<g transform="translate(${X(x).toFixed(1)},${Y(x).toFixed(1)})"><circle r="13" class="${cls}"/><text y="4.5" text-anchor="middle" fill="#fff" font-size="12" font-weight="700">${label}</text>${name ? `<text x="18" y="4" font-size="11.5" font-weight="600" fill="#1f2328" stroke="#eef1f4" stroke-width="3" paint-order="stroke">${esc(name)}</text>` : ''}</g>`;
  return `<svg viewBox="0 0 ${W} ${Hh}" xmlns="http://www.w3.org/2000/svg">
    <g stroke="#dfe4ea" stroke-width="1">${grid}</g>
    <path d="${path}" fill="none" stroke="#f4c400" stroke-opacity=".55" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${path}" fill="none" stroke="#111111" stroke-width="3" stroke-dasharray="1 0" stroke-linejoin="round" stroke-linecap="round"/>
    <style>.mk-b{fill:#111111}.mk-s{fill:#f4c400;stroke:#111;stroke-width:1.5}.mk-e{fill:#6b21a8}.mk-b+text{fill:#f4c400}.mk-s+text{fill:#111}</style>
    ${p.round_trip ? '' : marker(p.end, 'F', 'mk-e', 'Fim')}
    ${p.stops.map((s, i) => marker(s, i + 1, 'mk-s', s.cliente || '')).reverse().join('')}
    ${marker(p.origin, 'S', 'mk-b', 'Loja')}
  </svg>`;
}
function mapBlock(p) {
  if (S.settings.embed_key && p.provider.startsWith('google')) {
    const q = (x) => encodeURIComponent(x.label || x.address);
    const wp = p.stops.map(q).join('|');
    const src = `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(S.settings.embed_key)}&origin=${q(p.origin)}&destination=${q(p.end)}${wp ? '&waypoints=' + wp : ''}&mode=driving&language=pt-BR&region=BR`;
    return `<div class="map-box"><iframe src="${src}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>`;
  }
  return `<div class="map-box"><span class="map-tag">Esquema da rota</span>${mapSvg(p)}</div>`;
}
function waText(p, dateStr) {
  const lines = [`🛵 *Rota de ${dateBR(dateStr)}* — ${p.stops.length} ${p.stops.length > 1 ? 'entregas' : 'entrega'}, ${km(p.total_km)}`, ''];
  p.stops.forEach((s, i) => {
    lines.push(`*${i + 1}. ${s.cliente || 'Entrega ' + s.n}*${s.urgent ? ' (URGENTE)' : ''}`);
    if (s.produto) lines.push('🛵 ' + s.produto);
    lines.push(s.address);
    if (s.obs) lines.push('📝 ' + s.obs);
    if (s.telefone) lines.push('📞 ' + s.telefone);
    lines.push('');
  });
  lines.push('▶️ Abra o link e toque em *Iniciar*:', p.maps_link);
  return lines.join('\n');
}

function tollBox(p) {
  const t = p.toll || { status: 'error' };
  const src = t.source === 'google' || t.source === 'google-demo' ? 'Google' : t.source === 'openrouteservice' ? 'OpenRouteService' : '';
  const val = p._toll ?? (t.status === 'price' ? t.value : 0);
  const msg = {
    none: `✅ <b>Sem pedágio</b> nesta rota${src ? ` <span class="muted">(${src})</span>` : ''}.`,
    price: `🛣️ <b>Tem pedágio:</b> ${brl(t.value)} estimado pelo ${src} (carro de passeio, ida e volta somadas). Confira o valor da Saveiro na praça.`,
    unknown: `🛣️ <b>A rota passa por pedágio</b>, mas o valor não foi informado${src ? ` pelo ${src}` : ''}. Digite o valor ao lado.`,
    error: '⚠️ Não foi possível verificar pedágio agora. Se a rota tiver, digite o valor ao lado.',
  }[t.status] || '';
  return `<div class="toll ${t.status}"><div class="toll-msg">${msg}</div>
    <label class="toll-in">Pedágio (R$)<input type="number" step="0.01" min="0" id="tollVal" value="${val ? val.toFixed(2) : '0'}"></label></div>`;
}

async function setOrder(order) {
  const el = $('#result');
  el.style.opacity = '.55'; el.style.pointerEvents = 'none';
  try {
    const keepToll = PLAN._tollTouched ? PLAN._toll : undefined;
    PLAN = await api('POST', `/api/plan/${PLAN.id}/order`, { order });
    PLAN._saved = false;
    if (keepToll != null) { PLAN._toll = keepToll; PLAN._tollTouched = true; }
    renderResult();
  } catch (e) { toast(e.message, true); }
  el.style.opacity = ''; el.style.pointerEvents = '';
}

function renderResult() {
  const el = $('#result'); if (!el) return;
  const p = PLAN;
  if (!p) {
    el.innerHTML = `<div class="card empty-state"><div class="big">🗺️</div><b>A melhor rota aparece aqui</b><p>Preencha as entregas e clique em <b>Calcular melhor rota</b>.</p></div>`;
    return;
  }
  if (p._toll == null) p._toll = p.toll?.status === 'price' ? p.toll.value : 0;
  const order = p.stops.map((s) => s.n);
  const n = order.length;
  const tagOf = (i) => (n < 2 ? '' : i === 0 ? '<span class="tag ida">na ida</span>' : i === n - 1 ? `<span class="tag volta">${p.round_trip ? 'na volta' : 'por último'}</span>` : '<span class="tag">no caminho</span>');
  const wa = 'https://wa.me/?text=' + encodeURIComponent(waText(p, F.date));
  const extraKm = p.total_km - p.suggested_km;
  const mover = (i) => (n < 2 || p._saved ? '' : `<div class="mv"><button title="Subir" data-up="${i}" ${i === 0 ? 'disabled' : ''}>▲</button><button title="Descer" data-down="${i}" ${i === n - 1 ? 'disabled' : ''}>▼</button></div>`);
  el.innerHTML = `
    <div class="card">
      <h3>${p.manual ? '✋ Rota escolhida por você' : '✅ Melhor rota (sugerida)'} <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:500;margin-left:auto">${esc(p.vehicle.name)}</span></h3>
      ${p.manual ? `<div class="manual-bar"><div>Você mudou a ordem. ${extraKm > 0.05 ? `São <b>${km(extraKm)} a mais</b> (${brl(p.cost - p.suggested_cost)} de combustível) que a sugerida.` : 'A distância é a mesma da sugerida.'}</div>${p._saved ? '' : '<button class="btn sm" id="backBest">Voltar para a sugerida</button>'}</div>` : ''}
      ${mapBlock(p)}
      <div class="kpis">
        <div class="kpi hl"><span>Distância</span><b>${nf1.format(p.total_km)}</b><small>km no total</small></div>
        <div class="kpi"><span>Tempo</span><b>${mins(p.total_min)}</b><small>com ${S.settings.stop_minutes} min por parada</small></div>
        <div class="kpi"><span>Combustível</span><b>${brl(p.cost)}</b><small>${nf2.format(p.fuel_l)} L a ${brl(p.unit_price)}</small></div>
        <div class="kpi"><span>Total da rota</span><b id="totalVal">${brl(p.cost + (+p._toll || 0))}</b><small>combustível + pedágio</small></div>
      </div>
      ${tollBox(p)}
      <div class="why" style="margin-top:12px"><span>💡</span><div>${esc(p.why).replace(/(Entrega \d+(?: \([^)]*\))?)/g, '<b>$1</b>')}</div></div>
      ${p.warnings.map((w) => `<div class="warn-box ${/^(Modo demonstração|O .* não respondeu|Algum endereço)/.test(w) ? 'soft' : ''}">${esc(w)}</div>`).join('')}
      ${n > 1 && !p._saved ? '<p class="hint" style="margin:12px 0 0">Quer outro caminho? Use ▲ ▼ para mudar a ordem das entregas, ou escolha uma das opções na comparação abaixo.</p>' : ''}
      <ul class="timeline">
        <li><span class="pin base">S</span><div class="t-main"><b>Saída</b><div>${esc(p.origin.address)}</div></div><div class="t-side"><b>0 min</b></div></li>
        ${p.stops.map((s, i) => `<li>${mover(i)}<span class="pin">${i + 1}</span><div class="t-main"><b>${esc(s.cliente || 'Entrega ' + s.n)}</b> ${tagOf(i)} ${s.urgent ? '<span class="tag urg">urgente</span>' : ''}${s.produto ? `<div>🛵 ${esc(s.produto)}</div>` : ''}<div>${esc(s.address)}</div>${s.obs ? `<div>📝 ${esc(s.obs)}</div>` : ''}</div><div class="t-side"><b>~${mins(s.eta_min)}</b>+${km(s.leg_km)}</div></li>`).join('')}
        <li><span class="pin ${p.round_trip ? 'base' : 'end'}">${p.round_trip ? 'S' : 'F'}</span><div class="t-main"><b>${p.round_trip ? 'Volta para a loja' : 'Destino final'}</b><div>${esc(p.end.address)}</div></div><div class="t-side"><b>~${mins(p.total_min)}</b>+${km(p.last_leg_km)}</div></li>
      </ul>
      <div class="actions">
        <a class="btn maps lg full" href="${esc(p.maps_link)}" target="_blank" rel="noopener">📍 Abrir rota no Google Maps</a>
        <a class="btn wa" href="${esc(wa)}" target="_blank" rel="noopener">Enviar no WhatsApp</a>
        <button class="btn" id="copyLink">Copiar link</button>
      </div>
    </div>
    ${p.alternatives.length > 1 ? `<div class="card"><h3>Comparação das ordens</h3>
      <table><tr><th>Ordem</th><th class="r">Km</th><th class="r">Tempo</th><th class="r">Combustível</th><th></th></tr>
      ${p.alternatives.map((a, i) => { const cur = a.order.join(',') === order.join(','); return `<tr${cur ? ' class="cur"' : ''}><td>${i === 0 ? '✅ ' : ''}${a.order.map((x) => 'Entrega ' + x).join(' → ')}${i === 0 ? ' <span class="tag">sugerida</span>' : ''}</td><td class="r">${nf1.format(a.total_km)}</td><td class="r">${mins(a.total_min)}</td><td class="r">${brl(a.cost)}</td><td class="r">${cur ? '<span class="muted" style="font-size:12px">em uso</span>' : p._saved ? '' : `<button class="link" data-use="${a.order.join(',')}">Usar esta</button>`}</td></tr>`; }).join('')}
      </table>${n > 3 ? `<p class="hint">Mostrando as 6 melhores de todas as combinações possíveis.</p>` : ''}</div>` : ''}
    <div class="card">
      <h3>Salvar no histórico</h3>
      ${p._saved ? `<div class="why" style="background:var(--green-soft);border-color:#bfe5cd"><span>✔️</span><div>Rota nº <b>${p._saved}</b> salva. Ela já entra no relatório do mês.</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px"><a class="btn" href="/rota/${p._saved}/imprimir" target="_blank" rel="noopener">🖨 Imprimir folha de entrega</a><button class="btn primary" id="newRoute">Planejar nova rota</button></div>` : `
      <label>Observação da rota (opcional)<input id="rNotes" placeholder="ex.: turno da tarde"></label>
      <button class="btn primary block" id="saveRoute" style="margin-top:12px">Salvar rota${p.manual ? ' com a ordem escolhida' : ''}</button>
      <p class="hint">Depois de salvar aparece o botão para imprimir a folha de entrega.</p>`}
    </div>`;
  $('#copyLink').onclick = () => copy(p.maps_link);
  const tv = $('#tollVal');
  if (tv) {
    tv.disabled = !!p._saved;
    tv.oninput = () => { p._toll = Math.max(0, parseFloat(String(tv.value).replace(',', '.')) || 0); p._tollTouched = true; $('#totalVal').textContent = brl(p.cost + p._toll); };
  }
  $$('[data-up]', el).forEach((b) => (b.onclick = () => { const i = +b.dataset.up; const o = order.slice(); [o[i - 1], o[i]] = [o[i], o[i - 1]]; setOrder(o); }));
  $$('[data-down]', el).forEach((b) => (b.onclick = () => { const i = +b.dataset.down; const o = order.slice(); [o[i + 1], o[i]] = [o[i], o[i + 1]]; setOrder(o); }));
  $$('[data-use]', el).forEach((b) => (b.onclick = () => setOrder(b.dataset.use.split(',').map(Number))));
  if ($('#backBest')) $('#backBest').onclick = () => setOrder(p.suggested_order);
  if ($('#saveRoute')) $('#saveRoute').onclick = async () => {
    try {
      const r = await api('POST', '/api/routes', { plan_id: p.id, driver_id: F.driver_id ? +F.driver_id : null, route_date: F.date, notes: $('#rNotes').value, toll_cost: +p._toll || 0 });
      p._saved = r.id; S.settings.fuel_price = p.unit_price; toast('Rota salva'); renderResult();
    } catch (e) { toast(e.message, true); }
  };
  if ($('#newRoute')) $('#newRoute').onclick = () => { resetForm(); VIEWS.nova($('#view')); };
}

/* ====================================================================== */
/*  ROTAS                                                                   */
/* ====================================================================== */
const RF = { month: monthISO(), driver: '', status: '' };
VIEWS.rotas = async (el) => {
  const admin = isAdmin();
  el.innerHTML = `
    <div class="head"><div><h1>${admin ? 'Rotas' : 'Minhas rotas'}</h1><p>${admin ? 'Todas as rotas salvas. Clique numa linha para ver as entregas.' : 'Abra no Google Maps e marque como concluída ao terminar.'}</p></div>
      <div class="right">
        <input type="month" id="rMonth" value="${RF.month}" style="width:170px">
        ${admin ? `<select id="rDriver" style="width:190px"><option value="">Todos os entregadores</option>${S.users.map((u) => `<option value="${u.id}" ${+RF.driver === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
        <select id="rStatus" style="width:150px"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${RF.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${admin ? '<a class="btn green" href="#nova">+ Nova rota</a>' : ''}
      </div></div>
    <div id="rList"><div class="card empty-state">Carregando…</div></div>`;
  $('#rMonth').onchange = (e) => { RF.month = e.target.value || monthISO(); load(); };
  $('#rStatus').onchange = (e) => { RF.status = e.target.value; load(); };
  if (admin) $('#rDriver').onchange = (e) => { RF.driver = e.target.value; load(); };
  async function load() {
    const q = new URLSearchParams({ month: RF.month, ...(RF.driver && { driver: RF.driver }), ...(RF.status && { status: RF.status }) });
    let list;
    try { list = await api('GET', '/api/routes?' + q); } catch (e) { return toast(e.message, true); }
    const box = $('#rList'); if (!box) return;
    if (!list.length) { box.innerHTML = `<div class="card empty-state"><div class="big">📭</div>Nenhuma rota neste período.</div>`; return; }
    admin ? tableView(box, list, load) : driverView(box, list, load);
  }
  load();
};
function statusSel(r) {
  return `<select data-status="${r.id}" class="status st-${r.status}" style="border:0;width:auto;padding:4px 10px">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${r.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
}
function tableView(box, list, reload) {
  const tot = list.filter((r) => r.status !== 'cancelada').reduce((a, r) => ({ e: a.e + r.deliveries, k: a.k + r.total_km, c: a.c + r.cost + (r.toll_cost || 0) }), { e: 0, k: 0, c: 0 });
  box.innerHTML = `<div class="tbl"><table>
    <tr><th>Nº</th><th>Data</th><th>Entregador</th><th>Veículo</th><th class="r">Entregas</th><th class="r">Km</th><th class="r">Tempo</th><th class="r">Gasto</th><th>Status</th><th></th></tr>
    ${list.map((r) => `<tr class="click" data-id="${r.id}"><td class="num">#${r.id}</td><td>${dateBR(r.route_date)}</td><td>${esc(r.driver_name || '—')}</td><td>${esc(r.vehicle_name)}</td>
      <td class="r">${r.deliveries}</td><td class="r">${nf1.format(r.total_km)}</td><td class="r">${mins(r.total_min)}</td><td class="r">${brl(r.cost + (r.toll_cost || 0))}${r.toll_cost > 0 ? '<div class="muted" style="font-size:11px">c/ pedágio</div>' : ''}</td>
      <td data-stop>${statusSel(r)}</td>
      <td data-stop style="white-space:nowrap"><a class="btn sm maps" href="${esc(r.maps_link)}" target="_blank" rel="noopener">Maps</a> <a class="btn sm" href="/rota/${r.id}/imprimir" target="_blank" rel="noopener">🖨 Imprimir</a> <button class="btn sm" data-copy="${r.id}">Copiar</button></td></tr>
      <tr class="detail" data-detail="${r.id}" hidden><td colspan="10"><div style="display:flex;gap:30px;flex-wrap:wrap">
        <div style="flex:1;min-width:300px"><b>Ordem das entregas</b><ol>${r.stops.map((s) => `<li><b>${esc(s.cliente || 'Entrega ' + s.n)}</b>${s.produto ? ` · 🛵 ${esc(s.produto)}` : ''} — ${esc(s.address)}${s.obs ? ` <span class="muted">(${esc(s.obs)})</span>` : ''}${s.telefone ? ` · ${esc(s.telefone)}` : ''}</li>`).join('')}</ol></div>
        <div style="min-width:220px;font-size:13px">
          <div>Saída: ${esc(r.origin.address)}</div>
          <div>Combustível: ${nf2.format(r.fuel_l || 0)} L a ${brl(r.unit_price)}/litro</div>
          <div style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="number" step="0.01" data-fp="${r.id}" value="${r.unit_price ?? ''}" style="width:110px;padding:6px 8px"><button class="btn sm" data-fpsave="${r.id}">Corrigir preço do litro</button></div>
          <div>Pedágio: ${brl(r.toll_cost || 0)}${r.toll_status === 'unknown' ? ' (rota com pedágio, valor não informado)' : ''}</div>
          <div style="display:flex;gap:6px;align-items:center;margin:6px 0"><input type="number" step="0.01" data-tl="${r.id}" value="${(r.toll_cost || 0).toFixed(2)}" style="width:110px;padding:6px 8px"><button class="btn sm" data-tlsave="${r.id}">Corrigir pedágio</button></div>
          ${r.manual_order ? '<div>✋ Ordem escolhida por quem planejou</div>' : ''}
          ${r.saved_km > 0.05 ? `<div>Economia vs ordem digitada: ${km(r.saved_km)}</div>` : ''}
          ${r.notes ? `<div>Obs.: ${esc(r.notes)}</div>` : ''}
          <div style="margin-top:10px"><button class="link red" data-del="${r.id}">Excluir rota</button></div>
        </div></div></td></tr>`).join('')}
    <tr><td colspan="4"><b>Total do período</b> <span class="muted">(sem canceladas)</span></td><td class="r"><b>${tot.e}</b></td><td class="r"><b>${nf1.format(tot.k)}</b></td><td></td><td class="r"><b>${brl(tot.c)}</b></td><td colspan="2"></td></tr>
  </table></div>`;
  $$('tr.click', box).forEach((tr) => tr.addEventListener('click', (e) => {
    if (e.target.closest('[data-stop]')) return;
    const d = $(`[data-detail="${tr.dataset.id}"]`, box); d.hidden = !d.hidden;
  }));
  bindRouteActions(box, list, reload);
}
function driverView(box, list, reload) {
  box.innerHTML = `<div class="dcards">${list.map((r) => `
    <div class="card" style="margin:0">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><b style="font-size:16px">${dateBR(r.route_date)}</b><span class="status st-${r.status}">${STATUS[r.status]}</span><span class="muted" style="margin-left:auto">#${r.id}</span></div>
      <div class="muted" style="margin-bottom:10px">${r.deliveries} ${r.deliveries > 1 ? 'entregas' : 'entrega'} · ${km(r.total_km)} · ~${mins(r.total_min)} · ${esc(r.vehicle_name)}</div>
      <ol style="margin:0 0 14px;padding-left:20px">${r.stops.map((s) => `<li style="margin:4px 0"><b>${esc(s.cliente || 'Entrega ' + s.n)}</b>${s.produto ? ` · 🛵 ${esc(s.produto)}` : ''}<div class="muted" style="font-size:13px">${esc(s.address)}${s.obs ? ' · ' + esc(s.obs) : ''}</div></li>`).join('')}</ol>
      <a class="btn maps lg block" href="${esc(r.maps_link)}" target="_blank" rel="noopener">📍 Abrir no Google Maps</a>
      <a class="btn block" style="margin-top:8px" href="/rota/${r.id}/imprimir" target="_blank" rel="noopener">🖨 Imprimir folha de entrega</a>
      ${r.status !== 'concluida' && r.status !== 'cancelada' ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
        <button class="btn" data-set="${r.id}" data-v="em_rota">Saí para entregar</button><button class="btn green" data-set="${r.id}" data-v="concluida">Concluí</button></div>` : ''}
    </div>`).join('')}</div>`;
  $$('[data-set]', box).forEach((b) => (b.onclick = async () => {
    try { await api('PATCH', '/api/routes/' + b.dataset.set, { status: b.dataset.v }); toast('Status atualizado'); reload(); } catch (e) { toast(e.message, true); }
  }));
}
function bindRouteActions(box, list, reload) {
  $$('[data-status]', box).forEach((s) => (s.onchange = async () => {
    try { await api('PATCH', '/api/routes/' + s.dataset.status, { status: s.value }); s.className = 'status st-' + s.value; toast('Status atualizado'); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-copy]', box).forEach((b) => (b.onclick = () => copy(list.find((r) => r.id === +b.dataset.copy).maps_link)));
  $$('[data-tlsave]', box).forEach((b) => (b.onclick = async () => {
    const v = $(`[data-tl="${b.dataset.tlsave}"]`, box).value;
    try { await api('PATCH', '/api/routes/' + b.dataset.tlsave, { toll_cost: v }); toast('Pedágio corrigido'); reload(); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-fpsave]', box).forEach((b) => (b.onclick = async () => {
    const v = $(`[data-fp="${b.dataset.fpsave}"]`, box).value;
    try { await api('PATCH', '/api/routes/' + b.dataset.fpsave, { fuel_price: v }); toast('Preço corrigido e gasto recalculado'); reload(); } catch (e) { toast(e.message, true); }
  }));
  $$('[data-del]', box).forEach((b) => (b.onclick = async () => {
    if (!confirm(`Excluir a rota #${b.dataset.del}? Ela sai do relatório.`)) return;
    try { await api('DELETE', '/api/routes/' + b.dataset.del); toast('Rota excluída'); reload(); } catch (e) { toast(e.message, true); }
  }));
}

/* ====================================================================== */
/*  RELATÓRIO                                                               */
/* ====================================================================== */
const REP = { month: monthISO(), driver: '' };
VIEWS.relatorio = async (el) => {
  const admin = isAdmin();
  const q = () => new URLSearchParams({ month: REP.month, ...(REP.driver && { driver: REP.driver }) }).toString();
  el.innerHTML = `
    <div class="head"><div><h1>${admin ? 'Relatório do mês' : 'Meu mês'}</h1><p id="repSub">Entregas feitas e gasto com combustível.</p></div>
      <div class="right">
        <input type="month" id="mMonth" value="${REP.month}" style="width:170px">
        ${admin ? `<select id="mDriver" style="width:190px"><option value="">Todos os entregadores</option>${S.users.map((u) => `<option value="${u.id}" ${+REP.driver === u.id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>` : ''}
        <a class="btn green" id="xlsx">⬇ Exportar Excel</a><a class="btn" id="csv">CSV</a>
      </div></div>
    <div id="rep"><div class="card empty-state">Carregando…</div></div>`;
  const setLinks = () => { $('#xlsx').href = '/api/report.xlsx?' + q(); $('#csv').href = '/api/report.csv?' + q(); };
  $('#mMonth').onchange = (e) => { REP.month = e.target.value || monthISO(); load(); };
  if (admin) $('#mDriver').onchange = (e) => { REP.driver = e.target.value; load(); };
  async function load() {
    setLinks();
    let s; try { s = await api('GET', '/api/report?' + q()); } catch (e) { return toast(e.message, true); }
    const box = $('#rep'); if (!box) return;
    const t = s.totals;
    $('#repSub').textContent = `${s.label[0].toUpperCase() + s.label.slice(1)} · ${t.concluidas} de ${t.rotas} rotas concluídas`;
    const [y, m] = REP.month.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    const byDay = Object.fromEntries(s.by_day.map((d) => [d.key, d]));
    const max = Math.max(1, ...s.by_day.map((d) => d.entregas));
    const groupTbl = (title, rows) => `<div class="card"><h3>${title}</h3>${rows.length ? `<table><tr><th></th><th class="r">Rotas</th><th class="r">Entregas</th><th class="r">Km</th><th class="r">Gasto</th><th class="r">Por entrega</th></tr>
      ${rows.map((g) => `<tr><td><b>${esc(g.label)}</b></td><td class="r">${g.rotas}</td><td class="r">${g.entregas}</td><td class="r">${nf1.format(g.km)}</td><td class="r">${brl(g.total)}</td><td class="r">${brl(g.entregas ? g.total / g.entregas : 0)}</td></tr>`).join('')}</table>` : '<p class="muted">Sem dados.</p>'}</div>`;
    box.innerHTML = `
      <div class="kpi-row">
        <div class="kpi hl"><span>Entregas feitas</span><b>${t.entregas}</b><small>em ${t.rotas} rotas</small></div>
        <div class="kpi"><span>Gasto total</span><b>${brl(t.gasto_total)}</b><small>${brl(t.custo_por_entrega)} por entrega</small></div>
        <div class="kpi"><span>Km rodados</span><b>${nf1.format(t.km)}</b><small>${brl(t.custo_por_km)} por km</small></div>
        <div class="kpi"><span>Combustível</span><b>${brl(t.custo)}</b><small>${nf1.format(t.litros)} L · média ${brl(t.preco_medio_litro)}/litro</small></div>
      </div>
      <div class="kpi-row" style="margin-top:14px">
        <div class="kpi"><span>Km por entrega</span><b>${nf1.format(t.km_por_entrega)}</b><small>média do mês</small></div>
        <div class="kpi"><span>Pedágios</span><b>${brl(t.pedagio)}</b><small>${t.rotas_pedagio} ${t.rotas_pedagio === 1 ? 'rota' : 'rotas'} com pedágio</small></div>
        <div class="kpi"><span>Km poupados pela otimização</span><b>${nf1.format(t.economia_km)}</b><small>vs. ordem digitada</small></div>
        <div class="kpi"><span>Tempo rodando</span><b>${mins(t.minutos)}</b><small>somando todas as rotas</small></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>Entregas por dia</h3>
        <div class="bars">${Array.from({ length: days }, (_, i) => { const k = `${REP.month}-${pad(i + 1)}`; const d = byDay[k]; const v = d ? d.entregas : 0;
          return `<div class="bar" title="${dateBR(k)}: ${v} entregas${d ? ' · ' + brl(d.custo) : ''}">${v ? `<span>${v}</span>` : ''}<i style="height:${(v / max) * 82}%;${v ? '' : 'background:var(--line)'}"></i></div>`; }).join('')}</div>
        <div class="bars-x">${Array.from({ length: days }, (_, i) => `<span>${(i + 1) % 5 === 0 || i === 0 ? i + 1 : ''}</span>`).join('')}</div>
      </div>
      <div class="two">${groupTbl('Por veículo', s.by_vehicle)}${admin ? groupTbl('Por entregador', s.by_driver) : ''}</div>
      <div class="card" style="margin-top:16px"><h3>Scooters entregues por modelo</h3>${s.by_product.length ? `<table><tr><th>Produto</th><th class="r">Entregas</th></tr>${s.by_product.map((g) => `<tr><td><b>${esc(g.label)}</b></td><td class="r">${g.entregas}</td></tr>`).join('')}</table>` : '<p class="muted">Sem dados.</p>'}</div>`;
  }
  load();
};

/* ====================================================================== */
/*  VEÍCULOS                                                                */
/* ====================================================================== */
const costPerKm = (v) => (+S.settings.fuel_price || 0) / (v.km_per_l || 1);
VIEWS.veiculos = (el) => {
  el.innerHTML = `
    <div class="head"><div><h1>Veículos de entrega</h1><p>Os veículos que levam as scooters até o cliente. O gasto de cada rota usa a média de km por litro daqui.</p></div>
      <div class="right"><button class="btn green" id="vAdd">+ Adicionar veículo</button></div></div>
    <div class="vgrid">${S.vehicles.length ? S.vehicles.map((v) => `
      <div class="vcard ${v.active ? '' : 'off'}">
        <div class="vtop"><div class="vicon">⛽</div><div><h4>${esc(v.name)}</h4><span class="muted" style="font-size:12px">${v.plate ? esc(v.plate) : 'sem placa'}${v.active ? '' : ' · inativo'}</span></div></div>
        <div class="specs">
          <div><span>Média</span><b>${nf1.format(v.km_per_l || 0)} km/l</b></div>
          <div><span>Custo por km hoje</span><b>${brl(costPerKm(v))}</b></div>
          <div><span>Litro hoje</span><b>${brl(S.settings.fuel_price)}</b></div>
          <div><span>Vel. média</span><b>${v.avg_speed} km/h</b></div>
        </div>
        <div class="foot"><button class="btn sm" data-edit="${v.id}">Editar</button><button class="btn sm" data-tog="${v.id}">${v.active ? 'Desativar' : 'Reativar'}</button></div>
      </div>`).join('') : `<div class="card empty-state" style="grid-column:1/-1"><div class="big">🚚</div>Nenhum veículo ainda. Clique em <b>Adicionar veículo</b> e cadastre a Saveiro com a média de km por litro.</div>`}</div>`;
  $('#vAdd').onclick = () => vehicleModal();
  $$('[data-edit]').forEach((b) => (b.onclick = () => vehicleModal(S.vehicles.find((v) => v.id === +b.dataset.edit))));
  $$('[data-tog]').forEach((b) => (b.onclick = async () => {
    const v = S.vehicles.find((x) => x.id === +b.dataset.tog);
    try { await api('PUT', '/api/vehicles/' + v.id, { active: !v.active }); await loadVehicles(); VIEWS.veiculos(el); } catch (e) { toast(e.message, true); }
  }));
};
function vehicleModal(v) {
  const x = v || { avg_speed: 30 };
  openModal(`
    <h2>${v ? 'Editar veículo' : 'Adicionar veículo'}</h2>
    <div class="fields f2">
      <label>Nome do veículo<input id="mName" value="${esc(x.name || '')}" placeholder="ex.: Saveiro"></label>
      <label>Placa<input id="mPlate" value="${esc(x.plate || '')}" placeholder="ABC1D23"></label>
      <label>Média de consumo (km por litro)<input id="mKmL" type="number" step="0.1" min="0" value="${x.km_per_l ?? ''}" placeholder="ex.: 10"></label>
      <label>Velocidade média na cidade (km/h)<input id="mSpeed" type="number" step="1" value="${x.avg_speed ?? 30}"></label>
    </div>
    <p class="hint">Use a média real do veículo carregado, na cidade, e do combustível que vocês abastecem: no etanol a média costuma ser menor que na gasolina. Ela vale para as próximas rotas; as rotas já salvas mantêm o cálculo da época.</p>
    <div class="modal-foot"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="mSave">Salvar</button></div>`, (box) => {
    $('#mSave', box).onclick = async () => {
      const body = { name: $('#mName', box).value, plate: $('#mPlate', box).value, km_per_l: $('#mKmL', box).value, avg_speed: $('#mSpeed', box).value };
      try { await api(v ? 'PUT' : 'POST', '/api/vehicles' + (v ? '/' + v.id : ''), body); closeModal(); toast('Veículo salvo'); await loadVehicles(); route(); } catch (e) { toast(e.message, true); }
    };
  });
}

/* ====================================================================== */
/*  USUÁRIOS                                                                */
/* ====================================================================== */
VIEWS.usuarios = async (el) => {
  await loadUsers();
  el.innerHTML = `
    <div class="head"><div><h1>Usuários</h1><p>Cada entregador entra com seu próprio usuário e senha e vê só as rotas dele.</p></div>
      <div class="right"><button class="btn green" id="uAdd">+ Novo usuário</button></div></div>
    <div class="tbl"><table><tr><th>Nome</th><th>Usuário</th><th>Perfil</th><th>Situação</th><th>Criado em</th><th></th></tr>
    ${S.users.map((u) => `<tr><td><b>${esc(u.name)}</b>${u.id === S.me.id ? ' <span class="tag">você</span>' : ''}</td><td>${esc(u.username)}</td><td>${u.role === 'admin' ? 'Administrador' : 'Entregador'}</td>
      <td>${u.active ? '<span class="status st-concluida">Ativo</span>' : '<span class="status st-cancelada">Inativo</span>'}</td><td>${dateBR(u.created_at)}</td>
      <td style="text-align:right"><button class="btn sm" data-u="${u.id}">Editar</button></td></tr>`).join('')}
    </table></div>`;
  $('#uAdd').onclick = () => userModal();
  $$('[data-u]').forEach((b) => (b.onclick = () => userModal(S.users.find((u) => u.id === +b.dataset.u))));
};
function userModal(u) {
  openModal(`
    <h2>${u ? 'Editar usuário' : 'Novo usuário'}</h2>
    <div class="fields f2">
      <label>Nome<input id="uName" value="${esc(u?.name || '')}"></label>
      <label>Usuário (login)<input id="uUser" value="${esc(u?.username || '')}" ${u ? 'disabled' : ''} placeholder="ex.: joao"></label>
      <label>Perfil<select id="uRole"><option value="entregador">Entregador</option><option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador</option></select></label>
      <label>${u ? 'Nova senha (deixe vazio para manter)' : 'Senha'}<input id="uPass" type="text" autocomplete="new-password" placeholder="mínimo 6 caracteres"></label>
      ${u ? `<label class="check span2"><input type="checkbox" id="uActive" ${u.active ? 'checked' : ''}> Usuário ativo (pode entrar no sistema)</label>` : ''}
    </div>
    <p class="hint">Entregador vê e conclui só as rotas dele. Administrador planeja rotas, vê relatórios e muda configurações.</p>
    <div class="modal-foot"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="uSave">Salvar</button></div>`, (box) => {
    $('#uSave', box).onclick = async () => {
      const body = { name: $('#uName', box).value, role: $('#uRole', box).value };
      const pw = $('#uPass', box).value; if (pw || !u) body.password = pw;
      if (u) body.active = $('#uActive', box).checked; else body.username = $('#uUser', box).value;
      try { await api(u ? 'PUT' : 'POST', '/api/users' + (u ? '/' + u.id : ''), body); closeModal(); toast('Usuário salvo'); route(); } catch (e) { toast(e.message, true); }
    };
  });
}

/* ====================================================================== */
/*  CONFIGURAÇÕES                                                           */
/* ====================================================================== */
VIEWS.config = (el) => {
  const s = S.settings;
  const PL = { google: 'Google Maps', 'google-demo': 'Google Maps (demonstração)', openrouteservice: 'OpenRouteService' };
  const prov = s.provider === 'demo'
    ? '<span class="pill-warn">● Modo demonstração — configure as chaves de mapa</span>'
    : `<span class="pill-ok">● ${PL[s.provider]}${s.provider_backup ? ` · reserva: ${PL[s.provider_backup]}` : ''}</span>${s.provider !== 'openrouteservice' && !s.provider_backup ? ' <span class="pill-warn">● sem reserva configurada</span>' : ''}`;
  el.innerHTML = `
    <div class="head"><div><h1>Configurações</h1><p>Valores usados em todos os cálculos de rota e custo.</p></div><div class="right">${prov}</div></div>
    <div class="grid2" style="grid-template-columns:1fr 1fr">
      <div class="card"><h3>Loja</h3><div class="fields">
        <label>Nome da empresa<input id="cCompany" value="${esc(s.company)}"></label>
        <label>CEP da loja<input id="cCep" inputmode="numeric" maxlength="9" placeholder="00000-000"></label>
        <label>Endereço de saída (loja)<input id="cBase" value="${esc(s.base_address)}" placeholder="Rua, número - bairro, cidade - UF"></label>
        <label>Cidade padrão (completa endereços sem cidade)<input id="cCity" value="${esc(s.city_hint)}"></label>
        <label class="check"><input type="checkbox" id="cRet" ${s.return_default ? 'checked' : ''}> Por padrão o entregador volta para a loja</label>
      </div></div>
      <div class="card"><h3>Combustível e rota</h3><div class="fields f2">
        <label>Preço atual do combustível (R$/litro)<input id="cFuel" type="number" step="0.01" value="${s.fuel_price}"></label>
        <label>Minutos parado em cada entrega<input id="cStop" type="number" step="1" value="${s.stop_minutes}"></label>
        <label class="span2">Modo no Google Maps<select id="cMode"><option value="driving">Carro (recomendado)</option><option value="two-wheeler" ${s.maps_mode === 'two-wheeler' ? 'selected' : ''}>Moto / duas rodas (se disponível no aparelho)</option></select></label>
      </div><p class="hint">O preço do litro também pode ser ajustado em cada rota, na tela Nova rota. Cada rota grava o preço do dia, então mudar aqui não altera as rotas antigas.</p></div>
    </div>
    <button class="btn primary lg" id="cSave" style="margin-top:16px">Salvar configurações</button>`;
  $('#cCep').oninput = async (e) => {
    e.target.value = cepFmt(e.target.value);
    const c = e.target.value.replace(/\D/g, '');
    if (c.length !== 8) return;
    try { const d = await api('GET', '/api/cep/' + c); $('#cBase').value = `${d.logradouro}, nº - ${d.bairro}, ${d.localidade} - ${d.uf}, ${cepFmt(c)}`; $('#cBase').focus(); toast('Complete o número da loja'); } catch (x) { toast(x.message, true); }
  };
  $('#cSave').onclick = async () => {
    const b = $('#cSave'); b.disabled = true;
    try {
      S.settings = await api('PUT', '/api/settings', {
        company: $('#cCompany').value, base_address: $('#cBase').value, city_hint: $('#cCity').value, return_default: $('#cRet').checked,
        fuel_price: $('#cFuel').value, stop_minutes: $('#cStop').value, maps_mode: $('#cMode').value,
      });
      $('#company').textContent = S.settings.company;
      if (F && !PLAN) F.origin = S.settings.base_address;
      toast('Configurações salvas');
    } catch (e) { toast(e.message, true); }
    b.disabled = false;
  };
};

/* ====================================================================== */
/*  MINHA SENHA                                                             */
/* ====================================================================== */
VIEWS.conta = (el) => {
  el.innerHTML = `
    <div class="head"><div><h1>Minha senha</h1><p>${esc(S.me.name)} · usuário <b>${esc(S.me.username)}</b></p></div></div>
    ${S.me.must_change ? '<div class="banner">🔒 Por segurança, troque a senha temporária antes de continuar.</div>' : ''}
    <div class="card" style="max-width:460px"><div class="fields">
      <label>Senha atual<input id="pCur" type="password" autocomplete="current-password"></label>
      <label>Nova senha<input id="pNew" type="password" autocomplete="new-password" placeholder="mínimo 6 caracteres"></label>
      <label>Repita a nova senha<input id="pNew2" type="password" autocomplete="new-password"></label>
      <button class="btn primary" id="pSave">Trocar senha</button>
    </div></div>`;
  $('#pSave').onclick = async () => {
    if ($('#pNew').value !== $('#pNew2').value) return toast('As senhas novas não são iguais', true);
    try { await api('PUT', '/api/me/password', { current: $('#pCur').value, password: $('#pNew').value }); S.me.must_change = false; toast('Senha trocada'); location.hash = ''; route(); } catch (e) { toast(e.message, true); }
  };
};

/* ---------- carga inicial ---------- */
async function loadVehicles() { S.vehicles = await api('GET', '/api/vehicles'); }
async function loadUsers() { S.users = await api('GET', '/api/users'); }
async function init() {
  const me = await api('GET', '/api/me');
  S.me = me.user; S.settings = me.settings;
  $('#company').textContent = S.settings.company || 'Moto Chefe';
  $('#meName').textContent = S.me.name; $('#meRole').textContent = isAdmin() ? 'Administrador' : 'Entregador';
  $('#avatar').textContent = S.me.name.trim()[0]?.toUpperCase() || '?';
  $('#logout').onclick = async () => { await api('POST', '/api/logout'); location.href = '/login'; };
  await Promise.all([loadVehicles(), loadUsers(), api('GET', '/api/catalog').then((c) => (S.catalog = c))]);
  window.addEventListener('hashchange', route);
  route();
}
init().catch((e) => { $('#view').innerHTML = `<div class="card">${esc(e.message)}</div>`; });
})();
