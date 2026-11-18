import { db, getSettings } from './db.js';
import { buildXlsx, excelDate } from './xlsx.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthLabel = (m) => { const [y, mm] = m.split('-'); return `${MESES[+mm - 1]} de ${y}`; };

export function monthRoutes(month, driverId) {
  let sql = `SELECT r.*, u.name AS driver_name FROM routes r LEFT JOIN users u ON u.id = r.driver_id
             WHERE substr(r.route_date, 1, 7) = ? AND r.status != 'cancelada'`;
  const args = [month];
  if (driverId) { sql += ' AND r.driver_id = ?'; args.push(driverId); }
  sql += ' ORDER BY r.route_date, r.created_at';
  return db.prepare(sql).all(...args).map((r) => ({ ...r, stops: JSON.parse(r.stops), origin: JSON.parse(r.origin), end_point: JSON.parse(r.end_point) }));
}

function group(list, keyFn, labelFn) {
  const m = new Map();
  for (const r of list) {
    const k = keyFn(r);
    const g = m.get(k) || { key: k, label: labelFn(r), rotas: 0, entregas: 0, km: 0, kwh: 0, litros: 0, custo: 0, pedagio: 0, total: 0 };
    g.rotas++; g.entregas += r.deliveries; g.km += r.total_km; g.kwh += r.energy_kwh || 0; g.litros += r.fuel_l || 0; g.custo += r.cost; g.pedagio += r.toll_cost || 0; g.total += r.cost + (r.toll_cost || 0);
    m.set(k, g);
  }
  return [...m.values()];
}

function byProduct(list) {
  const m = new Map();
  for (const r of list) for (const st of r.stops) {
    const k = st.produto || 'Não informado';
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([label, entregas]) => ({ label, entregas })).sort((a, b) => b.entregas - a.entregas);
}

export function summary(month, driverId) {
  const list = monthRoutes(month, driverId);
  const t = { rotas: list.length, concluidas: 0, entregas: 0, km: 0, kwh: 0, litros: 0, custo: 0, pedagio: 0, rotas_pedagio: 0, economia_km: 0, minutos: 0 };
  for (const r of list) {
    t.entregas += r.deliveries; t.km += r.total_km; t.kwh += r.energy_kwh || 0; t.litros += r.fuel_l || 0;
    t.custo += r.cost; t.economia_km += r.saved_km || 0; t.minutos += r.total_min;
    t.pedagio += r.toll_cost || 0; if ((r.toll_cost || 0) > 0) t.rotas_pedagio++;
    if (r.status === 'concluida') t.concluidas++;
  }
  t.gasto_total = t.custo + t.pedagio;
  t.custo_por_entrega = t.entregas ? t.gasto_total / t.entregas : 0;
  t.custo_por_km = t.km ? t.gasto_total / t.km : 0;
  t.preco_medio_litro = t.litros ? t.custo / t.litros : 0;
  t.km_por_entrega = t.entregas ? t.km / t.entregas : 0;
  return {
    month, label: monthLabel(month), totals: t,
    by_vehicle: group(list, (r) => r.vehicle_id, (r) => r.vehicle_name).sort((a, b) => b.entregas - a.entregas),
    by_driver: group(list, (r) => r.driver_id || 0, (r) => r.driver_name || 'Sem entregador').sort((a, b) => b.entregas - a.entregas),
    by_day: group(list, (r) => r.route_date, (r) => r.route_date).sort((a, b) => a.key.localeCompare(b.key)),
    by_product: byProduct(list),
    routes: list,
  };
}

const H = (v) => ({ v, s: 'h' });
const STATUS = { planejada: 'Planejada', em_rota: 'Em rota', concluida: 'Concluída', cancelada: 'Cancelada' };

export function reportXlsx(month, driverId) {
  const s = summary(month, driverId);
  const cfg = getSettings();
  const t = s.totals;
  const resumo = {
    name: 'Resumo',
    cols: [30, 14, 14, 14, 14, 14, 16],
    rows: [
      [{ v: `${cfg.company || 'Relatório'} — Entregas de ${s.label}`, s: 'title' }],
      [`Gerado em ${new Date().toLocaleString('pt-BR')}`],
      [],
      [H('Indicador'), H('Valor')],
      [{ v: 'Rotas feitas', s: 'b' }, { v: t.rotas, s: 'int' }],
      [{ v: 'Entregas feitas', s: 'b' }, { v: t.entregas, s: 'int' }],
      [{ v: 'Km rodados', s: 'b' }, { v: t.km, s: 'n1' }],
      [{ v: 'Combustível (litros)', s: 'b' }, { v: t.litros, s: 'n2' }],
      [{ v: 'Preço médio do litro', s: 'b' }, { v: t.preco_medio_litro, s: 'brl' }],
      [{ v: 'Gasto com combustível', s: 'b' }, { v: t.custo, s: 'brl' }],
      [{ v: 'Gasto com pedágio', s: 'b' }, { v: t.pedagio, s: 'brl' }],
      [{ v: 'GASTO TOTAL (combustível + pedágio)', s: 'b' }, { v: t.gasto_total, s: 'bbrl' }],
      [{ v: 'Gasto médio por entrega', s: 'b' }, { v: t.custo_por_entrega, s: 'brl' }],
      [{ v: 'Gasto por km', s: 'b' }, { v: t.custo_por_km, s: 'brl' }],
      [{ v: 'Km por entrega (média)', s: 'b' }, { v: t.km_por_entrega, s: 'n1' }],
      [{ v: 'Km economizados pela otimização', s: 'b' }, { v: t.economia_km, s: 'n1' }],
      [],
      [H('Scooters entregues (modelo)'), H('Entregas')],
      ...s.by_product.map((g) => [g.label, { v: g.entregas, s: 'int' }]),
      [],
      [H('Por veículo'), H('Rotas'), H('Entregas'), H('Km'), H('Litros'), H('Combustível'), H('Pedágio'), H('Total')],
      ...s.by_vehicle.map((g) => [g.label, { v: g.rotas, s: 'int' }, { v: g.entregas, s: 'int' }, { v: g.km, s: 'n1' }, { v: g.litros, s: 'n2' }, { v: g.custo, s: 'brl' }, { v: g.pedagio, s: 'brl' }, { v: g.total, s: 'brl' }]),
      [],
      [H('Por entregador'), H('Rotas'), H('Entregas'), H('Km'), H('Litros'), H('Combustível'), H('Pedágio'), H('Total')],
      ...s.by_driver.map((g) => [g.label, { v: g.rotas, s: 'int' }, { v: g.entregas, s: 'int' }, { v: g.km, s: 'n1' }, { v: g.litros, s: 'n2' }, { v: g.custo, s: 'brl' }, { v: g.pedagio, s: 'brl' }, { v: g.total, s: 'brl' }]),
      [],
      [H('Por dia'), H('Rotas'), H('Entregas'), H('Km'), H('Litros'), H('Combustível'), H('Pedágio'), H('Total')],
      ...s.by_day.map((g) => [{ v: excelDate(g.key), s: 'd' }, { v: g.rotas, s: 'int' }, { v: g.entregas, s: 'int' }, { v: g.km, s: 'n1' }, { v: g.litros, s: 'n2' }, { v: g.custo, s: 'brl' }, { v: g.pedagio, s: 'brl' }, { v: g.total, s: 'brl' }]),
    ],
  };
  const rotas = {
    name: 'Rotas',
    cols: [8, 12, 18, 18, 12, 10, 10, 10, 10, 12, 12, 12, 12, 60],
    rows: [
      [H('Nº'), H('Data'), H('Entregador'), H('Veículo'), H('Status'), H('Entregas'), H('Km'), H('Minutos'), H('Litros'), H('Preço do litro'), H('Combustível'), H('Pedágio'), H('Total'), H('Link da rota')],
      ...s.routes.map((r) => [
        { v: r.id, s: 'int' }, { v: excelDate(r.route_date), s: 'd' }, r.driver_name || '', r.vehicle_name, STATUS[r.status] || r.status,
        { v: r.deliveries, s: 'int' }, { v: r.total_km, s: 'n1' }, { v: Math.round(r.total_min), s: 'int' },
        { v: r.fuel_l ?? '', s: 'n2' }, { v: r.unit_price ?? '', s: 'brl' }, { v: r.cost, s: 'brl' }, { v: r.toll_cost || 0, s: 'brl' }, { v: r.cost + (r.toll_cost || 0), s: 'brl' }, r.maps_link,
      ]),
    ],
  };
  const entregas = {
    name: 'Entregas',
    cols: [8, 12, 8, 24, 26, 16, 55, 30],
    rows: [
      [H('Rota'), H('Data'), H('Ordem'), H('Cliente'), H('Produto'), H('Telefone'), H('Endereço'), H('Observação')],
      ...s.routes.flatMap((r) => r.stops.map((st) => [
        { v: r.id, s: 'int' }, { v: excelDate(r.route_date), s: 'd' }, { v: st.pos, s: 'int' }, st.cliente || '', st.produto || '', st.telefone || '', st.address, st.obs || '',
      ])),
    ],
  };
  return { buffer: buildXlsx([resumo, rotas, entregas]), summary: s };
}

export function reportCsv(month, driverId) {
  const s = summary(month, driverId);
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const n = (v, d = 2) => (v == null ? '' : Number(v).toFixed(d).replace('.', ','));
  const lines = [['Rota', 'Data', 'Entregador', 'Veículo', 'Status', 'Entregas', 'Km', 'Minutos', 'Litros', 'Preço do litro', 'Combustível (R$)', 'Pedágio (R$)', 'Total (R$)', 'Link'].map(q).join(';')];
  for (const r of s.routes) {
    lines.push([r.id, r.route_date.split('-').reverse().join('/'), r.driver_name || '', r.vehicle_name, STATUS[r.status] || r.status,
      r.deliveries, n(r.total_km, 1), Math.round(r.total_min), n(r.fuel_l), n(r.unit_price), n(r.cost), n(r.toll_cost || 0), n(r.cost + (r.toll_cost || 0)), r.maps_link].map(q).join(';'));
  }
  lines.push('');
  lines.push([q('TOTAL'), '', '', '', '', s.totals.entregas, n(s.totals.km, 1), Math.round(s.totals.minutos), n(s.totals.litros), n(s.totals.preco_medio_litro), n(s.totals.custo), n(s.totals.pedagio), n(s.totals.gasto_total), ''].join(';'));
  return '﻿' + lines.join('\r\n');
}
