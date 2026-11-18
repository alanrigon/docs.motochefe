// Folha de entrega para imprimir (romaneio) — sempre em preto e branco, uma folha por rota.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateBR = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const km = (n) => (n ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' km';
const mins = (m) => { m = Math.round(m || 0); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };

export function routeSheetHtml(r, company) {
  const stops = r.stops || [];
  const produtos = stops.map((s) => s.produto).filter(Boolean);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rota nº ${r.id} — ${esc(dateBR(r.route_date))}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #fff; color: #000; }
  body { font: 12pt/1.35 Arial, Helvetica, sans-serif; -webkit-print-color-adjust: economy; print-color-adjust: economy; }
  .page { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 6px; }
  .brand { font-weight: 900; font-size: 20pt; letter-spacing: .02em; line-height: 1; }
  .brand small { display: block; font-size: 9pt; letter-spacing: .45em; font-weight: 700; margin-top: 3px; }
  .doc { text-align: right; }
  .doc b { display: block; font-size: 14pt; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #000; border-top: 0; }
  .meta div { padding: 5px 8px; border-right: 1px solid #000; font-size: 10pt; }
  .meta div:last-child { border-right: 0; }
  .meta span { display: block; font-size: 8pt; text-transform: uppercase; letter-spacing: .05em; }
  .meta b { font-size: 11pt; }
  .saida { margin: 8px 0 10px; font-size: 10pt; }
  .stop { border: 1.5px solid #000; margin-bottom: 8px; page-break-inside: avoid; break-inside: avoid; }
  .stop-h { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #000; padding: 5px 8px; }
  .num { width: 26px; height: 26px; border: 2px solid #000; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font-weight: 900; flex: none; }
  .stop-h .who { font-size: 13pt; font-weight: 700; flex: 1; }
  .stop-h .urg { border: 1.5px solid #000; padding: 1px 6px; font-size: 9pt; font-weight: 700; }
  .rows { display: grid; grid-template-columns: 26mm 1fr; }
  .rows div { padding: 4px 8px; border-bottom: 1px dotted #000; font-size: 11pt; }
  .rows div:nth-last-child(-n+2) { border-bottom: 0; }
  .rows .l { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; padding-top: 6px; }
  .rows .prod { font-weight: 700; font-size: 12pt; }
  .sign { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; padding: 14px 8px 6px; border-top: 1px solid #000; font-size: 9pt; }
  .sign div { border-top: 1px solid #000; padding-top: 3px; }
  .resumo { margin-top: 10px; border: 1px solid #000; padding: 6px 8px; font-size: 10pt; }
  .resumo b { font-size: 10.5pt; }
  footer { margin-top: 10px; font-size: 8.5pt; display: flex; justify-content: space-between; }
  .noprint { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #000; padding: 10px; display: flex; gap: 10px; justify-content: center; }
  .noprint button { font: 700 12pt Arial, sans-serif; padding: 10px 22px; border: 2px solid #000; background: #fff; color: #000; border-radius: 6px; cursor: pointer; }
  .noprint button.main { background: #000; color: #fff; }
  @media print { .noprint { display: none; } .page { padding: 0; } }
</style>
</head>
<body>
<div class="noprint"><button class="main" onclick="window.print()">Imprimir</button><button onclick="window.close()">Fechar</button></div>
<div class="page">
  <header>
    <div class="brand">MOTO CHEFE<small>MARINGÁ</small></div>
    <div class="doc"><b>Folha de entrega — Rota nº ${r.id}</b>${esc(company || '')}</div>
  </header>
  <div class="meta">
    <div><span>Data</span><b>${esc(dateBR(r.route_date))}</b></div>
    <div><span>Entregador</span><b>${esc(r.driver_name || '—')}</b></div>
    <div><span>Veículo</span><b>${esc(r.vehicle_name || '—')}</b></div>
    <div><span>Entregas</span><b>${stops.length} · ${km(r.total_km)} · ~${mins(r.total_min)}</b></div>
  </div>
  ${(r.toll_cost || 0) > 0 ? `<div class="saida"><b>Pedágio previsto na rota:</b> ${(r.toll_cost).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} — levar dinheiro ou tag.</div>` : (r.toll_status === 'unknown' ? '<div class="saida"><b>Atenção:</b> a rota passa por pedágio.</div>' : '')}
  <div class="saida"><b>Saída:</b> ${esc(r.origin?.address || '')}${r.end_point && r.end_point.round_trip === false ? ` &nbsp;·&nbsp; <b>Fim:</b> ${esc(r.end_point.address || '')}` : ' &nbsp;·&nbsp; volta para a loja'}</div>

  ${stops.map((s, i) => `
  <section class="stop">
    <div class="stop-h"><span class="num">${i + 1}</span><span class="who">${esc(s.cliente || 'Cliente não informado')}</span>${s.urgent ? '<span class="urg">URGENTE</span>' : ''}</div>
    <div class="rows">
      <div class="l">Produto</div><div class="prod">${esc(s.produto || '—')}</div>
      <div class="l">Endereço</div><div>${esc(s.address)}</div>
      ${s.obs ? `<div class="l">Complemento / obs.</div><div>${esc(s.obs)}</div>` : ''}
      <div class="l">Telefone</div><div>${esc(s.telefone || '—')}</div>
    </div>
    <div class="sign"><div>Assinatura de quem recebeu</div><div>Data e hora</div></div>
  </section>`).join('')}

  ${produtos.length ? `<div class="resumo"><b>Conferência de carga:</b> ${produtos.length} ${produtos.length > 1 ? 'itens' : 'item'} — ${esc(produtos.join(' · '))}</div>` : ''}
  ${r.notes ? `<div class="resumo"><b>Observação da rota:</b> ${esc(r.notes)}</div>` : ''}
  <footer><span>Impresso em ${esc(new Date().toLocaleString('pt-BR'))}</span><span>Rota nº ${r.id}</span></footer>
</div>
<script>if (location.hash !== '#ver') setTimeout(() => window.print(), 400);</script>
</body>
</html>`;
}
