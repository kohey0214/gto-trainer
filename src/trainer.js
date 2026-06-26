// trainer.js — Trainer モード: 出題 → 選択 → GTO採点（Best/Correct/Inaccuracy/Mistake/Blunder）
import { ALL_HANDS, RANKS, compileScenario } from './poker.js';
import { SCENARIO_LIST } from '../data/ranges.js';

const $ = (id) => document.getElementById(id);
const SUITS = [
  { s: '♠', red: false }, { s: '♥', red: true }, { s: '♦', red: true }, { s: '♣', red: false },
];

// 6-max ポジション順（クロックワイズ）
const POS_ORDER = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
// テーブル上の座席座標（%）— 先頭がヒーロー(下中央)
const SEAT_XY = [
  [50, 90], [11, 70], [11, 24], [50, 8], [89, 24], [89, 70],
];

let state = null;

function pickWeightedHand() {
  // コンボ数で加重 → 実戦に近いハンド分布
  const total = ALL_HANDS.reduce((s, h) => s + h.combos, 0);
  let r = Math.random() * total;
  for (const h of ALL_HANDS) { r -= h.combos; if (r <= 0) return h; }
  return ALL_HANDS[0];
}

function makeCards(label) {
  const type = label.length === 3 ? (label[2] === 's' ? 'suited' : 'offsuit') : 'pair';
  const r1 = label[0], r2 = label[1];
  let c1, c2;
  if (type === 'pair') {
    const idx = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    c1 = { r: r1, ...SUITS[idx[0]] }; c2 = { r: r2, ...SUITS[idx[1]] };
  } else if (type === 'suited') {
    const s = SUITS[Math.floor(Math.random() * 4)];
    c1 = { r: r1, ...s }; c2 = { r: r2, ...s };
  } else {
    const idx = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    c1 = { r: r1, ...SUITS[idx[0]] }; c2 = { r: r2, ...SUITS[idx[1]] };
  }
  return [c1, c2];
}

function renderConfig() {
  const el = $('trainer-config');
  const opts = SCENARIO_LIST.map((s) =>
    `<option value="${s.id}">${s.group} — ${s.name}</option>`).join('');
  el.innerHTML = `
    <select id="tr-scenario">${opts}</select>
    <button class="primary" id="tr-deal">次のハンド ▶</button>
    <button id="tr-reset">スコアリセット</button>`;
  $('tr-scenario').value = state.scn.id;
  $('tr-scenario').addEventListener('change', (e) => {
    state.scn = SCENARIO_LIST.find((s) => s.id === e.target.value);
    state.strat = compileScenario(state.scn);
    deal();
  });
  $('tr-deal').addEventListener('click', deal);
  $('tr-reset').addEventListener('click', () => { resetScore(); renderScore(); });
}

function renderTable() {
  const el = $('poker-table');
  const hero = state.scn.hero;
  // ヒーローを先頭に回転した順
  const start = POS_ORDER.indexOf(hero);
  const rotated = [...POS_ORDER.slice(start), ...POS_ORDER.slice(0, start)];
  let html = `<div class="pot-info">Pot ${state.pot.toFixed(1)} bb<br><span style="font-size:11px;color:#9fb">100bb stacks</span></div>`;
  rotated.forEach((pos, idx) => {
    const [x, y] = SEAT_XY[idx];
    const isHero = pos === hero;
    const tag = state.tags[pos] || '';
    html += `<div class="seat ${isHero ? 'hero' : ''} ${tag ? 'acted' : ''}" style="left:${x}%;top:${y}%">
      <div class="pos">${pos}${isHero ? ' (You)' : ''}</div>
      <div class="stack">100 bb</div>
      ${tag ? `<div class="tag" style="background:${tag.color}">${tag.text}</div>` : ''}
      ${isHero ? `<div class="cards-hero">${state.cards.map((c) =>
        `<div class="pcard ${c.red ? 'red' : ''}">${c.r}<span style="font-size:16px">${c.s}</span></div>`).join('')}</div>` : ''}
    </div>`;
  });
  el.innerHTML = html;
}

function buildTags() {
  // 出題状況に応じて他席のアクション表示
  const tags = {};
  const g = state.scn.group;
  if (g === 'RFI') {
    // ヒーローより前のポジションはフォールド
    const heroIdx = POS_ORDER.indexOf(state.scn.hero);
    for (let i = 0; i < heroIdx; i++) tags[POS_ORDER[i]] = { text: 'Fold', color: '#3b6ea5' };
    state.pot = 1.5; // SB+BB
  } else {
    // 対オープン: opener を判定
    const opener = state.scn.id === 'bb_vs_btn' ? 'BTN' : 'CO';
    tags[opener] = { text: 'Raise 2.5', color: '#d8442f' };
    // opener より前はフォールド
    const oIdx = POS_ORDER.indexOf(opener);
    for (let i = 0; i < oIdx; i++) tags[POS_ORDER[i]] = { text: 'Fold', color: '#3b6ea5' };
    state.pot = 2.5 + 1.5;
  }
  state.tags = tags;
}

function questionText() {
  const g = state.scn.group;
  if (g === 'RFI') {
    const hero = state.scn.hero;
    // UTG はプリフロップで最初に行動するポジション。前に誰もいないので「全員フォールド」はありえない
    if (hero === 'UTG') {
      return `あなたは <b>UTG</b>（アンダー・ザ・ガン＝プリフロップで最初に行動するポジション）。ファーストインのアクションは？`;
    }
    // それ以外は「自分の前のプレイヤーが全員フォールドして回ってきた」状況
    return `あなたまで全員フォールドで回ってきました。<b>${hero}</b> のあなたのアクションは？`;
  }
  const opener = state.scn.id === 'bb_vs_btn' ? 'BTN' : 'CO';
  return `<b>${opener}</b> が 2.5bb にオープン。<b>${state.scn.hero}</b> のあなたの対応は？`;
}

function deal() {
  state.hand = pickWeightedHand();
  state.cards = makeCards(state.hand.label);
  state.answered = false;
  buildTags();
  renderTable();
  $('trainer-question').innerHTML = questionText();
  renderActions(false);
  $('trainer-feedback').innerHTML = '';
}

function renderActions(disabled) {
  const el = $('trainer-actions');
  el.innerHTML = state.scn.actions.map((a) =>
    `<button class="act-btn" data-id="${a.id}" style="background:${a.color}" ${disabled ? 'disabled' : ''}>${a.label}</button>`).join('');
  if (!disabled) {
    el.querySelectorAll('.act-btn').forEach((b) =>
      b.addEventListener('click', () => answer(b.dataset.id)));
  }
}

function answer(actionId) {
  if (state.answered) return;
  state.answered = true;
  const info = state.strat.get(state.hand.label);
  const scn = state.scn;

  // top アクション
  let topId = null, topF = -1;
  for (const a of scn.actions) { const f = info.freqs[a.id] || 0; if (f > topF) { topF = f; topId = a.id; } }
  let bestEV = -Infinity;
  for (const a of scn.actions) bestEV = Math.max(bestEV, info.ev[a.id]);

  const chosenF = info.freqs[actionId] || 0;
  const chosenEV = info.ev[actionId];
  const loss = bestEV - chosenEV;

  let grade, color;
  if (chosenF >= topF - 0.001) { grade = 'Best Play'; color = '#2dd4bf'; }
  else if (chosenF > 0.001) { grade = 'Correct'; color = '#3aa655'; }
  else if (loss < 0.5) { grade = 'Inaccuracy'; color = '#caa23a'; }
  else if (loss < 1.5) { grade = 'Mistake'; color = '#e0792a'; }
  else { grade = 'Blunder'; color = '#d8442f'; }

  // スコア集計
  state.score.count++;
  state.score.lossSum += Math.max(0, loss);
  state.score.grades[grade] = (state.score.grades[grade] || 0) + 1;
  saveScore();

  renderFeedback(grade, color, actionId, info, loss);
  renderActions(true);
  // 選んだボタンを強調
  const btn = $('trainer-actions').querySelector(`[data-id="${actionId}"]`);
  if (btn) btn.style.outline = '3px solid #fff';
  renderScore();
}

function renderFeedback(grade, color, actionId, info, loss) {
  const scn = state.scn;
  const aName = (id) => scn.actions.find((a) => a.id === id).label;
  const bars = scn.actions.map((a) => {
    const f = info.freqs[a.id] || 0;
    return `<div class="hd-action">
      <div class="hd-action-top">
        <span class="hd-action-name"><span class="sw" style="background:${a.color}"></span>${a.label}</span>
        <span>${(f * 100).toFixed(1)}% ・ EV ${info.ev[a.id] >= 0 ? '+' : ''}${info.ev[a.id].toFixed(2)}</span>
      </div>
      <div class="hd-track"><div class="hd-fill" style="width:${f * 100}%;background:${a.color}"></div></div>
    </div>`;
  }).join('');
  $('trainer-feedback').innerHTML = `<div class="fb-card">
    <div class="fb-grade" style="color:${color}">${grade}</div>
    <div class="fb-detail">
      <span class="yourpick">${state.hand.label}</span> で <b>${aName(actionId)}</b> を選択。
      ${loss > 0.01 ? `EV損失 <b style="color:${color}">−${loss.toFixed(2)} bb</b>` : 'GTO最適！'}
    </div>
    <div class="fb-bars">${bars}</div>
  </div>`;
}

const STORAGE_KEY = 'gto_trainer_stats_v1';

function loadScore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { count: 0, lossSum: 0, grades: {} };
}
function saveScore() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.score)); } catch (e) { /* ignore */ }
}

function resetScore() {
  state.score = { count: 0, lossSum: 0, grades: {} };
  saveScore();
}

function renderScore() {
  const s = state.score;
  const el = $('trainer-score');
  // GTOスコア: EV損失から算出（損失が少ないほど100に近い）
  const avgLoss = s.count ? s.lossSum / s.count : 0;
  const gtoScore = Math.max(0, 100 - avgLoss * 25);
  const order = ['Best Play', 'Correct', 'Inaccuracy', 'Mistake', 'Blunder'];
  const colors = { 'Best Play': '#2dd4bf', 'Correct': '#3aa655', 'Inaccuracy': '#caa23a', 'Mistake': '#e0792a', 'Blunder': '#d8442f' };
  el.innerHTML = `
    <h3 style="color:var(--muted);text-transform:uppercase;font-size:13px;letter-spacing:.8px;margin-bottom:6px">GTO スコア</h3>
    <div class="score-big">${gtoScore.toFixed(1)}</div>
    <div class="score-sub">${s.count} ハンド ・ 平均EV損失 ${avgLoss.toFixed(3)} bb</div>
    ${order.map((g) => `<div class="grade-count"><span style="color:${colors[g]}">${g}</span><b>${s.grades[g] || 0}</b></div>`).join('')}
  `;
}

export function initTrainer() {
  const scn = SCENARIO_LIST[0];
  state = { scn, strat: compileScenario(scn), score: loadScore(), pot: 1.5, tags: {} };
  renderConfig();
  deal();
  renderScore();
}
