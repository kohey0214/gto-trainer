// study.js — Study モード: レンジマトリクス・凡例・集計・ハンド詳細
import { GRID, ALL_HANDS, compileScenario } from './poker.js';

let current = { scn: null, strat: null, mode: 'strategy', selected: null };

const $ = (id) => document.getElementById(id);

function actionMeta(scn, id) { return scn.actions.find((a) => a.id === id); }

// セル背景: アクション頻度を横棒で積層
function renderCellBars(cell, info, scn, mode) {
  const bars = cell.querySelector('.bars');
  bars.innerHTML = '';
  // fold は最後・他は定義順
  const order = scn.actions.map((a) => a.id);
  let any = false;
  for (const id of order) {
    const f = info.freqs[id] || 0;
    if (f <= 0.001) continue;
    any = true;
    const span = document.createElement('span');
    span.style.width = (f * 100) + '%';
    let color = actionMeta(scn, id).color;
    if (mode === 'ev') {
      // EVモード: プレイされるアクションをEVで明度変化（高EV=明るい）
      span.style.background = color;
      span.style.opacity = '0.92';
    } else {
      span.style.background = color;
    }
    bars.appendChild(span);
  }
  // フォールド100%（レンジ外）→ dim
  cell.classList.toggle('dim', !any || (info.freqs['fold'] || 0) > 0.999);
}

export function renderMatrix() {
  const { scn, strat, mode } = current;
  const m = $('matrix');
  m.innerHTML = '';
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) {
      const h = GRID[i][j];
      const info = strat.get(h.label);
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.label = h.label;
      cell.innerHTML = `<div class="bars"></div><div class="clabel">${h.label}</div>`;
      renderCellBars(cell, info, scn, mode);
      cell.addEventListener('mouseenter', () => showHand(h.label));
      cell.addEventListener('click', () => { current.selected = h.label; showHand(h.label); markSel(); });
      m.appendChild(cell);
    }
  }
  markSel();
}

function markSel() {
  document.querySelectorAll('.cell').forEach((c) =>
    c.classList.toggle('sel', c.dataset.label === current.selected));
}

function renderLegend() {
  const { scn } = current;
  const el = $('legend');
  el.innerHTML = scn.actions.map((a) =>
    `<div class="lg"><span class="sw" style="background:${a.color}"></span>${a.label}</div>`).join('');
}

function renderAggregate() {
  const { scn, strat } = current;
  // コンボ加重でレンジ全体の頻度を集計
  const totals = {}; let totalCombos = 0;
  for (const a of scn.actions) totals[a.id] = 0;
  for (const h of ALL_HANDS) {
    const info = strat.get(h.label);
    totalCombos += h.combos;
    for (const a of scn.actions) totals[a.id] += (info.freqs[a.id] || 0) * h.combos;
  }
  const el = $('agg-bars');
  el.innerHTML = scn.actions.map((a) => {
    const pct = totalCombos ? (totals[a.id] / totalCombos * 100) : 0;
    return `<div class="agg-row">
      <div class="agg-label"><span>${a.label}</span><b>${pct.toFixed(1)}%</b></div>
      <div class="agg-track"><div class="agg-fill" style="width:${pct}%;background:${a.color}"></div></div>
    </div>`;
  }).join('');
}

function showHand(label) {
  const { scn, strat } = current;
  const info = strat.get(label);
  const h = ALL_HANDS.find((x) => x.label === label);
  const el = $('hand-detail');
  let html = `<h3>ハンド詳細</h3>
    <div class="hd-hand">${label}</div>
    <div class="hd-combos">${h.type} ・ ${h.combos} コンボ</div>`;
  for (const a of scn.actions) {
    const f = info.freqs[a.id] || 0;
    const ev = info.ev[a.id];
    html += `<div class="hd-action">
      <div class="hd-action-top">
        <span class="hd-action-name"><span class="sw" style="background:${a.color}"></span>${a.label}</span>
        <span>${(f * 100).toFixed(1)}%</span>
      </div>
      <div class="hd-track"><div class="hd-fill" style="width:${f * 100}%;background:${a.color}"></div></div>
      <div class="hd-ev">EV: ${ev >= 0 ? '+' : ''}${ev.toFixed(2)} bb</div>
    </div>`;
  }
  el.innerHTML = html;
}

export function loadScenario(scn) {
  current.scn = scn;
  current.strat = compileScenario(scn);
  current.selected = null;
  $('spot-title').textContent = scn.name;
  $('spot-desc').textContent = scn.desc;
  renderLegend();
  renderMatrix();
  renderAggregate();
  $('hand-detail').innerHTML = '<h3>ハンド詳細</h3><div class="hd-empty">マトリクスのハンドにカーソルを合わせてください</div>';
}

export function setMode(mode) {
  current.mode = mode;
  renderMatrix();
}

export function getStrat() { return current; }
