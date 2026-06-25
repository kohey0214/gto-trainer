// builder.js — Range Builder: マトリクスを塗って自分の戦略を構築 → GTOと一致度採点
import { GRID, ALL_HANDS, compileScenario } from './poker.js';
import { SCENARIO_LIST, SCENARIOS } from '../data/ranges.js';

const $ = (id) => document.getElementById(id);
let B = null;

function blankUser() {
  // user[label] = {actionId: freq}
  const u = {};
  for (const h of ALL_HANDS) u[h.label] = {};
  return u;
}

function renderControls() {
  const el = $('builder-controls');
  const opts = SCENARIO_LIST.map(s => `<option value="${s.id}">${s.group} — ${s.name}</option>`).join('');
  el.innerHTML = `
    <select id="bld-scenario">${opts}</select>
    <div class="bld-actionsel" id="bld-actionsel"></div>
    <div class="bld-freqsel">
      <span>塗る頻度:</span>
      <button data-f="1" class="active">100%</button>
      <button data-f="0.75">75%</button>
      <button data-f="0.5">50%</button>
      <button data-f="0.25">25%</button>
      <button data-f="0">消去</button>
    </div>
    <button class="primary" id="bld-grade">GTOと比較 ▶</button>
    <button id="bld-clear">全消去</button>`;
  $('bld-scenario').value = B.scn.id;
  $('bld-scenario').addEventListener('change', e => {
    B.scn = SCENARIOS[e.target.value];
    B.user = blankUser();
    B.activeAction = B.scn.actions.find(a => a.id !== 'fold').id;
    renderActionSel(); renderMatrix(); $('builder-result').innerHTML = '';
  });
  el.querySelectorAll('.bld-freqsel button').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.bld-freqsel button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); B.brush = parseFloat(b.dataset.f);
  }));
  $('bld-grade').addEventListener('click', grade);
  $('bld-clear').addEventListener('click', () => { B.user = blankUser(); renderMatrix(); $('builder-result').innerHTML = ''; });
  renderActionSel();
}

function renderActionSel() {
  const el = $('bld-actionsel');
  el.innerHTML = '<span>アクション:</span>' + B.scn.actions.filter(a => a.id !== 'fold').map(a =>
    `<button data-id="${a.id}" style="border-color:${a.color}" class="${a.id === B.activeAction ? 'active' : ''}">
      <span class="sw" style="background:${a.color}"></span>${a.label}</button>`).join('');
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    B.activeAction = b.dataset.id; renderActionSel();
  }));
}

function paint(label) {
  const cell = B.user[label];
  if (B.brush === 0) { delete cell[B.activeAction]; }
  else {
    // 他アクションの合計が1を超えないよう調整
    let other = 0; for (const k in cell) if (k !== B.activeAction) other += cell[k];
    cell[B.activeAction] = Math.min(B.brush, Math.max(0, 1 - other));
  }
  updateCell(label);
}

function cellBarsHTML(label) {
  const cell = B.user[label];
  let html = '', sum = 0;
  for (const a of B.scn.actions) {
    if (a.id === 'fold') continue;
    const f = cell[a.id] || 0; if (f <= 0) continue;
    sum += f;
    html += `<span style="width:${f * 100}%;background:${a.color}"></span>`;
  }
  return { html, empty: sum <= 0.001 };
}

function updateCell(label) {
  const c = document.querySelector(`#builder-matrix .cell[data-label="${label}"]`);
  if (!c) return;
  const { html, empty } = cellBarsHTML(label);
  c.querySelector('.bars').innerHTML = html;
  c.classList.toggle('dim', empty);
}

function renderMatrix() {
  const m = $('builder-matrix');
  m.innerHTML = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const h = GRID[i][j];
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.dataset.label = h.label;
    cell.innerHTML = `<div class="bars"></div><div class="clabel">${h.label}</div>`;
    const { html, empty } = cellBarsHTML(h.label);
    cell.querySelector('.bars').innerHTML = html;
    cell.classList.toggle('dim', empty);
    cell.addEventListener('mousedown', () => { B.painting = true; paint(h.label); });
    cell.addEventListener('mouseenter', () => { if (B.painting) paint(h.label); });
    m.appendChild(cell);
  }
  document.addEventListener('mouseup', () => { B.painting = false; });
}

function grade() {
  const gto = compileScenario(B.scn);
  let totalCombos = 0, weightedErr = 0;
  const worst = [];
  for (const h of ALL_HANDS) {
    const g = gto.get(h.label).freqs;
    const u = B.user[h.label];
    const uFold = 1 - Object.values(u).reduce((s, v) => s + v, 0);
    // 各アクションの頻度差（foldも含む）
    let err = 0;
    for (const a of B.scn.actions) {
      const gf = g[a.id] || 0;
      const uf = a.id === 'fold' ? Math.max(0, uFold) : (u[a.id] || 0);
      err += Math.abs(gf - uf);
    }
    err = err / 2; // 0..1（合計差は最大2なので半分）
    weightedErr += err * h.combos;
    totalCombos += h.combos;
    if (err > 0.15) worst.push({ label: h.label, err, g, u, uFold });
  }
  const accuracy = Math.max(0, 100 - (weightedErr / totalCombos) * 100);
  worst.sort((a, b) => b.err - a.err);

  const aName = id => B.scn.actions.find(a => a.id === id).label;
  const fmtFreq = (obj, isUser, uFold) => B.scn.actions.map(a => {
    const f = a.id === 'fold' ? (isUser ? Math.max(0, uFold) : (obj[a.id] || 0)) : (obj[a.id] || 0);
    if (f <= 0.005) return '';
    return `<span style="color:${a.color}">${aName(a.id).split(' ')[0]} ${(f * 100).toFixed(0)}%</span>`;
  }).filter(Boolean).join(' / ');

  $('builder-result').innerHTML = `
    <div class="bld-score">
      <div class="bld-score-num">${accuracy.toFixed(1)}<small>%</small></div>
      <div class="bld-score-label">GTO一致度</div>
    </div>
    <h4>ズレの大きいハンド TOP ${Math.min(8, worst.length)}</h4>
    <div class="bld-mistakes">
      ${worst.slice(0, 8).map(w => `<div class="bld-mrow">
        <b>${w.label}</b>
        <div class="bld-mcompare">
          <div>あなた: ${fmtFreq(w.u, true, w.uFold) || '<span style="color:#3b6ea5">Fold 100%</span>'}</div>
          <div>GTO: ${fmtFreq(w.g, false)}</div>
        </div>
      </div>`).join('') || '<div style="color:var(--good)">完璧に一致しています！</div>'}
    </div>`;
}

export function initBuilder() {
  const scn = SCENARIO_LIST[0];
  B = { scn, user: blankUser(), activeAction: scn.actions.find(a => a.id !== 'fold').id, brush: 1, painting: false };
  renderControls();
  renderMatrix();
}
