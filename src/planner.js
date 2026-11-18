// Escolhe a melhor ordem das entregas e calcula tempo, combustível, pedágio e custo.
// O sistema sempre sugere a melhor ordem, mas quem planeja pode escolher outra (chooseOrder).
import crypto from 'node:crypto';
import { geocode, matrix, checkTolls, providerName, PROVIDER_LABEL } from './maps.js';

export const MAX_STOPS = 8; // o Google Maps aceita até 10 pontos no link (saída + 8 entregas + chegada)

function permutations(arr) {
  if (arr.length <= 1) return [arr.slice()];
  const out = [];
  arr.forEach((x, i) => {
    for (const p of permutations([...arr.slice(0, i), ...arr.slice(i + 1)])) out.push([x, ...p]);
  });
  return out;
}

export function vehicleCost(vehicle, km, settings) {
  if (vehicle.type === 'combustao') {
    const l = km / (vehicle.km_per_l || 1);
    const price = +settings.fuel_price || 0;
    return { type: 'combustao', fuel_l: l, energy_kwh: null, unit_price: price, cost: l * price, battery_pct: null };
  }
  const batt = ((vehicle.battery_v || 0) * (vehicle.battery_ah || 0)) / 1000;
  const range = vehicle.range_km || 1;
  const kwhWall = ((batt / range) * km) / Math.min(1, Math.max(0.5, +settings.charge_eff || 0.85));
  const price = +settings.kwh_price || 0;
  return { type: 'eletrico', fuel_l: null, energy_kwh: kwhWall, unit_price: price, cost: kwhWall * price, battery_pct: (km / range) * 100 };
}

const fmtKm = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
const fmtR = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function mapsLink(origin, end, ordered, mode) {
  const q = (p) => encodeURIComponent(p.maps_q);
  let u = `https://www.google.com/maps/dir/?api=1&origin=${q(origin)}&destination=${q(end)}&travelmode=${mode || 'driving'}&dir_action=navigate`;
  if (ordered.length) u += `&waypoints=${ordered.map(q).join('%7C')}`;
  return u;
}

/* ---------- 1. Localiza os endereços e mede as distâncias (uma vez por cálculo) ---------- */
async function prepare({ origin, stops, end, vehicle, settings }) {
  if (!origin?.address) throw new Error('Informe o endereço de saída');
  stops = (stops || []).filter((s) => s.address && s.address.trim());
  if (!stops.length) throw new Error('Informe pelo menos uma entrega');
  if (stops.length > MAX_STOPS) throw new Error(`Máximo de ${MAX_STOPS} entregas por rota (limite do link do Google Maps). Divida em duas rotas.`);
  const roundTrip = !end || end.mode !== 'outro';
  if (!roundTrip && !end.address) throw new Error('Informe o destino final');

  const raw = [origin, ...stops, ...(roundTrip ? [] : [end])];
  const geo = [];
  for (const p of raw) geo.push(await geocode(p.address, settings.city_hint || '')); // sequencial: usa o cache
  const pts = raw.map((p, i) => ({ ...p, lat: geo[i].lat, lng: geo[i].lng, label: geo[i].label, maps_q: geo[i].label || p.address }));

  const mx = await matrix(pts);
  const k = stops.length;
  const endIdx = roundTrip ? 0 : k + 1;
  const stopIdx = stops.map((_, i) => i + 1);
  for (const i of [0, ...stopIdx, endIdx]) for (const j of [0, ...stopIdx, endIdx]) {
    if (i !== j && !(mx.km[i][j] < Infinity)) throw new Error(`Não há rota pelas ruas entre "${pts[i].address}" e "${pts[j].address}"`);
  }

  const ctx = { pts, km: mx.km, min: mx.min, provider: mx.provider, geo, roundTrip, endIdx, stopIdx, stops, vehicle, settings };
  const all = permutations(stopIdx).map((o) => evalOrder(ctx, o));
  const urgentCount = stops.filter((s) => s.urgent).length;
  const valid = urgentCount ? all.filter((o) => o.order.slice(0, urgentCount).every((i) => stops[i - 1].urgent)) : all;
  const byScore = (a, b) => (Math.abs(a.total_km - b.total_km) > 0.05 ? a.total_km - b.total_km : a.wait - b.wait);
  valid.sort(byScore); all.sort(byScore);
  Object.assign(ctx, { valid, all, best: valid[0], freeBest: all[0], worst: all[all.length - 1], typed: evalOrder(ctx, stopIdx) });
  return ctx;
}

function evalOrder(ctx, order) {
  const { km, min, endIdx, vehicle, settings } = ctx;
  const avg = vehicle.avg_speed || 30;
  const stopMin = +settings.stop_minutes || 0;
  const seq = [0, ...order, endIdx];
  let tot = 0, t = 0, wait = 0;
  const legs = [];
  for (let s = 0; s < seq.length - 1; s++) {
    const a = seq[s], b = seq[s + 1];
    const d = a === b ? 0 : km[a][b];
    const m = a === b ? 0 : Math.max(min[a][b], (km[a][b] / avg) * 60);
    tot += d; t += m;
    legs.push({ from: a, to: b, km: d, min: m, arrive: t });
    if (s < order.length) { wait += t; t += stopMin; }
  }
  return { order, legs, total_km: tot, total_min: t, wait };
}

/* ---------- 2. Monta o resultado para uma ordem (sugerida ou escolhida) ---------- */
function buildPlan(ctx, chosen, manual) {
  const { pts, stops, roundTrip, endIdx, vehicle, settings, best, freeBest, worst, typed } = ctx;
  const k = stops.length;
  const c = vehicleCost(vehicle, chosen.total_km, settings);
  const costOf = (kmv) => vehicleCost(vehicle, kmv, settings).cost;
  const name = (i) => `Entrega ${i}${stops[i - 1].cliente ? ` (${stops[i - 1].cliente})` : ''}`;

  let why;
  if (k === 1) {
    why = roundTrip ? `Vai até a entrega e volta para a saída: ${fmtKm(chosen.total_km)} no total.` : `Rota direta: saída → entrega → destino final (${fmtKm(chosen.total_km)}).`;
  } else if (manual) {
    const extra = chosen.total_km - best.total_km;
    why = `Ordem escolhida por você: ${chosen.order.map((i) => 'Entrega ' + i).join(' → ')}.`;
    why += extra > 0.05 ? ` Ela roda ${fmtKm(extra)} a mais que a sugerida (${fmtR(costOf(extra))} a mais de combustível).` : ' Ela tem a mesma distância da sugerida.';
  } else {
    why = k === 2
      ? `Faça a ${name(chosen.order[0])} na ida e a ${name(chosen.order[1])} ${roundTrip ? 'na volta' : 'depois'}.`
      : `Siga a ordem: ${chosen.order.map((i) => 'Entrega ' + i).join(' → ')}.`;
    const diffWorst = worst.total_km - chosen.total_km;
    if (stops.some((s) => s.urgent) && freeBest.total_km < chosen.total_km - 0.05) {
      why += ` As urgentes vão primeiro, o que custa ${fmtKm(chosen.total_km - freeBest.total_km)} a mais (${fmtR(costOf(chosen.total_km - freeBest.total_km))}).`;
    } else if (diffWorst > 0.05) {
      why += ` Assim o entregador roda ${fmtKm(diffWorst)} a menos que na pior ordem`;
      const diffTyped = typed.total_km - chosen.total_km;
      why += diffTyped > 0.05 ? ` e ${fmtKm(diffTyped)} a menos que na ordem digitada.` : '.';
    } else {
      why += ` A distância total é a mesma nas duas ordens, então a mais perto vai primeiro: o primeiro cliente recebe em cerca de ${Math.round(chosen.legs[0].min)} min.`;
    }
  }

  const warnings = [];
  if (ctx.provider === 'demo') warnings.push('Modo demonstração: distâncias aproximadas. Configure a chave do Google Maps para usar as ruas reais.');
  else if (ctx.provider !== providerName()) warnings.push(`O ${PROVIDER_LABEL[providerName()]} não respondeu agora. Distâncias calculadas pelo ${PROVIDER_LABEL[ctx.provider]} (reserva).`);
  const geoUsed = [...new Set(ctx.geo.map((g) => g.provider))].filter((p) => !['cache', 'coordenada', providerName()].includes(p));
  if (geoUsed.length && providerName() !== 'demo') warnings.push(`Algum endereço foi localizado pelo ${geoUsed.map((p) => PROVIDER_LABEL[p]).join(' / ')} (reserva). Confira se o ponto está certo.`);

  const ordered = chosen.order.map((i) => pts[i]);
  const endPt = pts[endIdx];
  return {
    provider: ctx.provider,
    round_trip: roundTrip,
    manual: !!manual,
    suggested_order: best.order,
    suggested_km: best.total_km,
    suggested_cost: costOf(best.total_km),
    origin: { address: pts[0].address, label: pts[0].label, lat: pts[0].lat, lng: pts[0].lng },
    end: { address: endPt.address, label: endPt.label, lat: endPt.lat, lng: endPt.lng },
    stops: chosen.order.map((i, pos) => ({
      n: i, pos: pos + 1, address: pts[i].address, label: pts[i].label, lat: pts[i].lat, lng: pts[i].lng,
      cliente: stops[i - 1].cliente || '', produto: stops[i - 1].produto || '', telefone: stops[i - 1].telefone || '', obs: stops[i - 1].obs || '', urgent: !!stops[i - 1].urgent,
      leg_km: chosen.legs[pos].km, eta_min: chosen.legs[pos].arrive,
    })),
    last_leg_km: chosen.legs[chosen.legs.length - 1].km,
    total_km: chosen.total_km,
    total_min: chosen.total_min,
    saved_km: Math.max(0, typed.total_km - chosen.total_km),
    worst_km: worst.total_km,
    typed_km: typed.total_km,
    vehicle: { id: vehicle.id, name: vehicle.name, type: vehicle.type, range_km: vehicle.range_km },
    ...c,
    why,
    warnings,
    alternatives: ctx.valid.slice(0, 6).map((o) => ({ order: o.order, total_km: o.total_km, total_min: o.total_min, cost: costOf(o.total_km) })),
    maps_link: mapsLink(pts[0], endPt, ordered, settings.maps_mode),
  };
}

/* ---------- 3. Pedágio da ordem escolhida ---------- */
async function addTolls(ctx, plan, order) {
  const seq = [0, ...order, ctx.endIdx].map((i) => ctx.pts[i]);
  plan.toll = { ...(await checkTolls(seq)), order: order.join(',') };
  return plan;
}

/* ---------- API do módulo ---------- */
export async function planRoute(input) {
  const ctx = await prepare(input);
  const plan = buildPlan(ctx, ctx.best, false);
  plan.id = crypto.randomUUID();
  await addTolls(ctx, plan, ctx.best.order);
  return { plan, ctx };
}

// Quem planeja escolhe outra ordem. order = números das entregas (1..n), na ordem desejada.
export async function chooseOrder(ctx, id, order, prevToll) {
  const want = (order || []).map(Number);
  const sorted = [...want].sort((a, b) => a - b).join(',');
  if (sorted !== ctx.stopIdx.join(',')) throw new Error('Ordem inválida: inclua cada entrega uma vez');
  const ev = evalOrder(ctx, want);
  const isSuggested = want.join(',') === ctx.best.order.join(',');
  const plan = buildPlan(ctx, ev, !isSuggested);
  plan.id = id;
  if (prevToll && prevToll.order === want.join(',')) plan.toll = prevToll;
  else await addTolls(ctx, plan, want);
  return plan;
}
