// postflop.js — Solver ビュー: フロップを解いてGTO戦略を表示（複数ベットサイズ・OOP/IP切替）
import { GRID } from './poker.js';
import { solveFlop, POSTFLOP_PRESETS, ACT_META, parseCardInput } from './solver.js';
import { cardLabel } from './equity.js';

const $ = (id) => document.getElementById(id);
let S = null;

function randomFlop() {
  const cards = new Set();
  while (cards.size < 3) cards.add(Math.floor(Math.random() * 52));
  return [...cards];
}
function cardChip(idx) {
  const lbl = cardLabel(idx);
  const red = lbl[1] === 'h' || lbl[1] === 'd';
  const suit = { s: '♠', h: '♥', d: '♦', c: '♣' }[lbl[1]];
  return `<div class="pcard ${red ? 'red' : ''}" style="width:40px;height:56px;font-size:20px">${lbl[0]}<span style="font-size:14px">${suit}</span></div>`;
}

function renderControls() {
  const el = $('solver-controls');
  const opts = Object.values(POSTFLOP_PRESETS).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  el.innerHTML = `
    <select id="sv-preset">${opts}</select>
    <label class="sv-board">ボード <input id="sv-board" placeholder="例: Ah7d2c" value="Ah7d2c"></label>
    <button id="sv-random">🎲 ランダム</button>
    <button class="primary" id="sv-solve">解く（CFR実行）▶</button>
    <div class="sv-side" id="sv-side">
      <button data-side="oop" class="active">OOP</button>
      <button data-side="ip">IP</button>
    </div>`;
  $('sv-preset').value = S.preset.id;
  $('sv-preset').addEventListener('change', e => { S.preset = POSTFLOP_PRESETS[e.target.value]; updateDesc(); });
  $('sv-random').addEventListener('click', () => { $('sv-board').value = randomFlop().map(cardLabel).join(''); });
  $('sv-solve').addEventListener('click', solve);
  $('sv-side').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    $('sv-side').querySelectorAll('button').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.side = b.dataset.side; if (S.res) renderResult(S.res, S.lastMs);
  }));
  updateDesc();
}
function updateDesc() { $('solver-desc').textContent = S.preset.desc; }

async function solve() {
  const board = parseCardInput($('sv-board').value);
  if (board.length !== 3) { $('solver-result').innerHTML = '<p class="sv-err">フロップは3枚で入力してください（例: Ah7d2c）</p>'; return; }
  $('solver-result').innerHTML = '<p class="sv-solving">CFRソルバー実行中…</p>';
  $('solver-board').innerHTML = board.map(cardChip).join('');
  await new Promise(r => setTimeout(r, 30));
  const t0 = performance.now();
  const res = solveFlop(S.preset, board, { iterations: 550, rollouts: 90 });
  S.lastMs = (performance.now() - t0).toFixed(0);
  S.res = res;
  renderResult(res, S.lastMs);
}

function renderResult(res, ms) {
  const isOOP = S.side === 'oop';
  const strat = isOOP ? res.oopStrategy : res.ipStrategy;
  const keys = isOOP ? res.rootKeys : res.ipKeys;
  const agg = isOOP ? res.aggOOP : res.aggIP;
  const sideName = isOOP ? S.preset.oopName : S.preset.ipName;
  const map = new Map(); for (const h of strat) map.set(h.label, h);

  const m = $('solver-matrix');
  m.innerHTML = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const h = GRID[i][j];
    const info = map.get(h.label);
    const cell = document.createElement('div');
    cell.className = 'cell'; cell.dataset.label = h.label;
    if (!info) { cell.classList.add('dim'); cell.innerHTML = `<div class="bars"></div><div class="clabel">${h.label}</div>`; }
    else {
      let bars = '';
      for (const k of keys) {
        const f = info.freqs[k] || 0; if (f <= 0.004) continue;
        bars += `<span style="width:${f * 100}%;background:${ACT_META[k].color}"></span>`;
      }
      const tip = keys.map(k => `${ACT_META[k].label} ${((info.freqs[k] || 0) * 100).toFixed(0)}%`).join(' / ');
      cell.innerHTML = `<div class="bars">${bars}</div><div class="clabel">${h.label}</div>`;
      cell.title = `${h.label}  ${tip}${info.ev != null ? `  EV ${info.ev.toFixed(2)}bb` : ''}`;
    }
    m.appendChild(cell);
  }

  const statHTML = keys.map(k => `<div class="sv-stat"><b>${(agg[k] || 0).toFixed(1)}%</b><span>${ACT_META[k].label}</span></div>`).join('');
  const legendHTML = keys.map(k => `<span><i style="background:${ACT_META[k].color}"></i>${ACT_META[k].label}</span>`).join('');
  $('solver-result').innerHTML = `
    <div class="sv-sidetitle">${sideName} の戦略</div>
    <div class="sv-summary">${statHTML}</div>
    ${isOOP ? `<div class="sv-ev">OOP平均EV: <b>${res.avgEV.toFixed(2)} bb</b></div>` : '<div class="sv-ev">OOPのチェックに対するIPの応答</div>'}
    <div class="sv-legend">${legendHTML}</div>
    <p class="sv-meta">汎用ツリーCFR ${res.iterations}回 ・ ${ms}ms ・ ベットサイズ ${res.betSizes.map(b => b.bb + 'bb').join(' / ')} ＋ ポットレイズ ・ OOP ${res.nOOP} / IP ${res.nIP} ハンド</p>`;
}

export function initSolver() {
  S = { preset: Object.values(POSTFLOP_PRESETS)[0], res: null, side: 'oop', lastMs: 0 };
  renderControls();
  solve();
}
