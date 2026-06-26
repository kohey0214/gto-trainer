// play.js — 実戦リングゲーム（6max）。ルール準拠のテキサスホールデム進行＋GTO風CPU＋リバー到達時の復習。
import { ALL_HANDS, compileScenario, handStrength } from './poker.js';
import { SCENARIOS } from '../data/ranges.js';
import { equity, evaluate7, cardLabel, bestFive, heroDraws } from './equity.js';

const $ = (id) => document.getElementById(id);
const RC = '23456789TJQKA';
const SUIT = ['s', 'h', 'd', 'c'];
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };

const SB = 0.5, BB = 1, START_STACK = 100;
const POS_NAMES = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
// 画面座席座標（%）— 0=Hero(下中央)。被らないよう楕円に配置
const SEAT_XY = [[50, 90], [13, 70], [13, 26], [50, 9], [87, 26], [87, 70]];

// 全169ハンド均等レンジ（CPUエクイティ推定の相手用）
const UNIFORM = ALL_HANDS.map((h) => ({ label: h.label, freq: 1 }));

let G = null;

function holeLabel(a, b) {
  const r1 = Math.floor(a / 4), r2 = Math.floor(b / 4);
  const hi = Math.max(r1, r2), lo = Math.min(r1, r2);
  if (r1 === r2) return RC[r1] + RC[r2];
  return RC[hi] + RC[lo] + ((a % 4) === (b % 4) ? 's' : 'o');
}
function fmt(n) { return (Math.round(n * 10) / 10).toString(); }

// ---- ハンド開始 ----
function newHand() {
  const deck = []; for (let i = 0; i < 52; i++) deck.push(i);
  for (let i = 51; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }

  G.button = (G.button == null) ? Math.floor(Math.random() * 6) : (G.button + 1) % 6;
  // 席→ポジション
  const posOf = (seat) => POS_NAMES[(seat - G.button - 1 + 6 * 2) % 6 === 5 ? 5 : ((seat - G.button + 5) % 6) ]; // 下で再計算するので未使用
  G.players = [];
  for (let s = 0; s < 6; s++) {
    G.players.push({
      seat: s, isHero: s === 0, name: s === 0 ? 'あなた' : 'Bot' + s,
      stack: START_STACK, hole: [deck.pop(), deck.pop()],
      folded: false, allIn: false, betThisStreet: 0, totalInvested: 0,
      acted: false, actionLabel: null, actionColor: null,
    });
  }
  // ポジション割当（BTN=button, SB=+1, BB=+2, UTG=+3, HJ=+4, CO=+5）
  const setPos = (offset, name) => { G.players[(G.button + offset) % 6].pos = name; };
  setPos(0, 'BTN'); setPos(1, 'SB'); setPos(2, 'BB'); setPos(3, 'UTG'); setPos(4, 'HJ'); setPos(5, 'CO');

  G.board = []; G.street = 'preflop'; G.deck = deck;
  G.currentBet = 0; G.lastRaiseSize = BB; G.history = [];
  G.heroFolded = false; G.heroReachedRiver = false; G.done = false;

  // ブラインド
  const sb = G.players[(G.button + 1) % 6], bb = G.players[(G.button + 2) % 6];
  postBlind(sb, SB, 'SB'); postBlind(bb, BB, 'BB');
  G.currentBet = BB; G.lastRaiseSize = BB;

  // プリフロップ最初のアクション = UTG
  G.toAct = (G.button + 3) % 6;
  // ブラインドはまだ acted=false（BBオプションのため）
  G.players.forEach((p) => { if (p.pos !== 'SB' && p.pos !== 'BB') p.acted = false; });
  sb.acted = false; bb.acted = false;

  render();
  setTimeout(advance, 500);
}

function postBlind(p, amt, lbl) {
  const a = Math.min(amt, p.stack);
  p.stack -= a; p.betThisStreet += a; p.totalInvested += a;
  if (p.stack === 0) p.allIn = true;
  p.actionLabel = 'BLIND'; p.actionColor = '#6b7a8d';
}

function activePlayers() { return G.players.filter((p) => !p.folded); }
function canActPlayers() { return G.players.filter((p) => !p.folded && !p.allIn); }

function roundClosed() {
  if (activePlayers().length <= 1) return true;
  const can = canActPlayers();
  if (can.length === 0) return true;
  return can.every((p) => p.acted && p.betThisStreet === G.currentBet);
}

// ---- 進行 ----
function advance() {
  if (G.done) return;
  if (activePlayers().length <= 1) { return endHand(); }
  if (roundClosed()) { return nextStreet(); }

  let guard = 0;
  while (true) {
    const p = G.players[G.toAct];
    if (!p.folded && !p.allIn) break;
    G.toAct = (G.toAct + 1) % 6;
    if (++guard > 12) return nextStreet();
  }
  const p = G.players[G.toAct];
  if (p.isHero) { renderHeroControls(); return; }
  // CPU
  const decision = cpuDecide(p);
  applyAction(p, decision);
  render();
  G.toAct = (G.toAct + 1) % 6;
  setTimeout(advance, 720);
}

function nextStreet() {
  // ベットを集約（totalInvestedに既算入済み）。betThisStreetリセット。
  G.players.forEach((p) => { p.betThisStreet = 0; p.acted = false; });
  G.currentBet = 0; G.lastRaiseSize = BB;

  if (G.street === 'preflop') { G.street = 'flop'; G.board.push(G.deck.pop(), G.deck.pop(), G.deck.pop()); }
  else if (G.street === 'flop') { G.street = 'turn'; G.board.push(G.deck.pop()); }
  else if (G.street === 'turn') { G.street = 'river'; G.board.push(G.deck.pop()); }
  else if (G.street === 'river') { return endHand(); }

  if (G.street === 'river' && !G.heroFolded) G.heroReachedRiver = true;

  // ポストフロップ最初のアクション = SBから生存者
  let s = (G.button + 1) % 6, guard = 0;
  while ((G.players[s].folded || G.players[s].allIn) && guard < 6) { s = (s + 1) % 6; guard++; }
  G.toAct = s;
  render();
  if (canActPlayers().length <= 1) { setTimeout(advance, 600); return; } // 全員オールイン→自動で進む
  setTimeout(advance, 650);
}

// ---- アクション適用 ----
function applyAction(p, d) {
  let add = 0;
  if (d.type === 'fold') { p.folded = true; p.actionLabel = 'FOLD'; p.actionColor = '#55657a'; if (p.isHero) G.heroFolded = true; }
  else if (d.type === 'check') { p.actionLabel = 'CHECK'; p.actionColor = '#3aa655'; }
  else {
    add = Math.min(d.add, p.stack);
    p.stack -= add; p.betThisStreet += add; p.totalInvested += add;
    if (p.stack === 0) p.allIn = true;
    if (d.type === 'call') { p.actionLabel = p.allIn ? 'ALL-IN' : 'CALL'; p.actionColor = p.allIn ? '#d8442f' : '#3aa655'; }
    else { // bet / raise
      const lbl = G.currentBet > BB || G.street !== 'preflop' && G.currentBet > 0 ? 'RAISE' : (G.street === 'preflop' ? 'RAISE' : 'BET');
      p.actionLabel = p.allIn ? 'ALL-IN' : (G.currentBet === 0 ? 'BET' : (G.street === 'preflop' && G.currentBet === BB ? 'RAISE' : 'RAISE'));
      p.actionColor = p.allIn ? '#d8442f' : '#e0a32a';
    }
    if (p.betThisStreet > G.currentBet) {
      G.lastRaiseSize = p.betThisStreet - G.currentBet;
      G.currentBet = p.betThisStreet;
      // レイズが入ったので他の生存者を未行動に
      G.players.forEach((q) => { if (q !== p && !q.folded && !q.allIn) q.acted = false; });
    }
  }
  p.acted = true;
  // 履歴（意図つき）。to = このストリートでの累計ベット額（コール/レイズの「合計いくらまで」）
  G.history.push({
    pos: p.pos, name: p.name, isHero: p.isHero, street: G.street,
    label: p.actionLabel, amount: add, to: p.betThisStreet, hole: p.hole.slice(),
    intent: d.intent || '',
  });
}

// ---- CPU 意思決定（GTO風） ----
function cpuDecide(p) {
  const toCall = G.currentBet - p.betThisStreet;
  const potNow = G.players.reduce((s, q) => s + q.totalInvested, 0);
  if (G.street === 'preflop') return cpuPreflop(p, toCall, potNow);
  return cpuPostflop(p, toCall, potNow);
}

function cpuPreflop(p, toCall, potNow) {
  const label = holeLabel(p.hole[0], p.hole[1]);
  const st = handStrength(label);
  const raised = G.currentBet > BB; // 誰かがオープン済み
  const scnId = { UTG: 'utg_rfi', HJ: 'hj_rfi', CO: 'co_rfi', BTN: 'btn_rfi', SB: 'sb_rfi' }[p.pos];

  if (!raised) {
    // 未オープン。RFIレンジで判断
    let openFreq = 0;
    if (scnId) { const strat = compileScenario(SCENARIOS[scnId]); openFreq = strat.get(label).freqs['raise'] || 0; }
    else if (p.pos === 'BB') {
      // BB: 誰もレイズしてなければチェック（オプション）
      if (toCall === 0) return { type: 'check', intent: `BB。レイズが無いのでチェックで無料フロップを見る` };
    }
    if (Math.random() < openFreq) {
      const raiseTo = 2.5; const add = raiseTo - p.betThisStreet;
      return { type: 'raise', add, intent: `${p.pos} の標準オープンレンジ(${label})。${raiseTo}bb にレイズ` };
    }
    if (toCall === 0) return { type: 'check', intent: 'チェック' };
    return { type: 'fold', intent: `${label} は ${p.pos} のオープンレンジ外。フォールド` };
  }

  // 対オープン（簡易：強度ベースで 3bet / call / fold）
  const threeBetTh = G.currentBet > 8 ? 0.965 : 0.915; // 4bet以上はさらにタイト
  const callTh = 0.74;
  const bluff = (label === 'A5s' || label === 'A4s' || label === 'KJs') && Math.random() < 0.35;
  if (st >= threeBetTh || bluff) {
    const raiseTo = G.currentBet * 3; const add = Math.min(raiseTo - p.betThisStreet, p.stack);
    return { type: 'raise', add, intent: bluff ? `${label} はブロッカー持ちの3ベットブラフ` : `${label} はプレミアム。${fmt(raiseTo)}bb へバリュー3ベット` };
  }
  if (st >= callTh) {
    return { type: 'call', add: toCall, intent: `${label} は十分な強さ。コールしてフロップへ` };
  }
  return { type: 'fold', intent: `${label} はオープンに対し弱い。フォールド` };
}

function cpuPostflop(p, toCall, potNow) {
  const nOpp = Math.max(1, activePlayers().length - 1);
  let eq = equity({ cards: p.hole }, { range: UNIFORM }, G.board, 130).equity / 100;
  eq = Math.pow(eq, nOpp); // 複数相手で割引
  const potOdds = toCall > 0 ? toCall / (potNow + toCall) : 0;
  const evbb = (x) => fmt(x);
  const streetJ = { flop: 'フロップ', turn: 'ターン', river: 'リバー' }[G.street];

  if (toCall > 0) {
    // ベットに直面
    if (eq > 0.80 && p.stack > 0 && Math.random() < 0.7) {
      const raiseTo = G.currentBet + Math.max(G.lastRaiseSize, potNow * 0.7);
      return { type: 'raise', add: Math.min(raiseTo - p.betThisStreet, p.stack), intent: `${streetJ}でエクイティ${(eq * 100).toFixed(0)}%と高い。バリューレイズ` };
    }
    if (eq >= potOdds + 0.02) return { type: 'call', add: toCall, intent: `エクイティ${(eq * 100).toFixed(0)}% ≥ ポットオッズ${(potOdds * 100).toFixed(0)}%。コールが見合う` };
    // セミブラフ（ドロー相当の中間エクイティ）でたまにコール
    if (eq > potOdds - 0.06 && Math.random() < 0.3) return { type: 'call', add: toCall, intent: `ドローのエクイティを見込んだコール` };
    return { type: 'fold', intent: `エクイティ${(eq * 100).toFixed(0)}% < ポットオッズ${(potOdds * 100).toFixed(0)}%。フォールド` };
  }

  // ノーベット（先頭）
  if (eq > 0.66) {
    const size = +(potNow * 0.66).toFixed(1);
    return { type: 'bet', add: Math.min(size, p.stack), intent: `${streetJ}で強い(eq ${(eq * 100).toFixed(0)}%)。${size}bb のバリューベット` };
  }
  if (eq > 0.5 && Math.random() < 0.4) {
    const size = +(potNow * 0.5).toFixed(1);
    return { type: 'bet', add: Math.min(size, p.stack), intent: `中程度の強さでプロテクション/薄いバリューの ${size}bb ベット` };
  }
  if (eq < 0.35 && Math.random() < 0.25) {
    const size = +(potNow * 0.5).toFixed(1);
    return { type: 'bet', add: Math.min(size, p.stack), intent: `フォールドエクイティ狙いのブラフ ${size}bb ベット` };
  }
  return { type: 'check', intent: `ポットコントロールのチェック(eq ${(eq * 100).toFixed(0)}%)` };
}

// ---- 推奨アクション（決定的・GTO基準の採点用） ----
function recommendAction(p) {
  const toCall = G.currentBet - p.betThisStreet;
  const potNow = G.players.reduce((s, q) => s + q.totalInvested, 0);
  if (G.street === 'preflop') {
    const label = holeLabel(p.hole[0], p.hole[1]);
    const st = handStrength(label);
    const raised = G.currentBet > BB;
    const scnId = { UTG: 'utg_rfi', HJ: 'hj_rfi', CO: 'co_rfi', BTN: 'btn_rfi', SB: 'sb_rfi' }[p.pos];
    if (!raised) {
      let openFreq = 0;
      if (scnId) openFreq = compileScenario(SCENARIOS[scnId]).get(label).freqs['raise'] || 0;
      if (openFreq >= 0.5) return { type: 'raise', intent: `${label} は ${p.pos} の標準オープン。レイズ推奨` };
      if (toCall === 0) return { type: 'check', intent: `${label}。チェックで様子見が無難` };
      return { type: 'fold', intent: `${label} は ${p.pos} のレンジ外。フォールド推奨` };
    }
    const threeBetTh = G.currentBet > 8 ? 0.965 : 0.915;
    if (st >= threeBetTh) return { type: 'raise', intent: `${label} はプレミアム。3ベット/4ベット推奨` };
    if (st >= 0.74) return { type: 'call', intent: `${label} はコール妥当` };
    return { type: 'fold', intent: `${label} はオープンに対し弱い。フォールド推奨` };
  }
  // ポストフロップ
  const nOpp = Math.max(1, activePlayers().length - 1);
  let eq = Math.pow(equity({ cards: p.hole }, { range: UNIFORM }, G.board, 150).equity / 100, nOpp);
  const potOdds = toCall > 0 ? toCall / (potNow + toCall) : 0;
  if (toCall > 0) {
    if (eq > 0.80) return { type: 'raise', intent: `エクイティ${(eq * 100).toFixed(0)}%と高い。レイズ推奨` };
    if (eq >= potOdds + 0.02) return { type: 'call', intent: `エクイティ${(eq * 100).toFixed(0)}% ≥ ポットオッズ${(potOdds * 100).toFixed(0)}%。コール推奨` };
    return { type: 'fold', intent: `エクイティ${(eq * 100).toFixed(0)}% < ポットオッズ${(potOdds * 100).toFixed(0)}%。フォールド推奨` };
  }
  if (eq > 0.62) return { type: 'bet', intent: `強い(eq ${(eq * 100).toFixed(0)}%)。バリューベット推奨` };
  return { type: 'check', intent: `eq ${(eq * 100).toFixed(0)}%。チェック推奨` };
}

const CAT = (t) => t === 'fold' ? 'F' : (t === 'check' || t === 'call') ? 'P' : 'A';
function gradeAction(heroType, rec, st) {
  const hc = CAT(heroType), rc = CAT(rec.type);
  if (hc === rc) return { g: 'Best', color: '#2dd4bf' };
  const key = rc + hc;
  const strong = st > 0.85;
  const map = {
    'AF': strong ? { g: '大ミス', color: '#d8442f' } : { g: 'ミス', color: '#e0792a' }, // 推奨アグレなのに降り
    'AP': { g: '不正確', color: '#caa23a' }, // パッシブすぎ＝バリュー逃し
    'FA': { g: '大ミス', color: '#d8442f' }, // 推奨フォールドなのにアグレ
    'FP': { g: 'ミス', color: '#e0792a' }, // 推奨フォールドなのにコール
    'PA': { g: '不正確', color: '#caa23a' }, // オーバープレイ
    'PF': { g: '不正確', color: '#caa23a' }, // タイトすぎ
  };
  return map[key] || { g: 'OK', color: '#3aa655' };
}

// ---- Hero アクション ----
function heroAct(type, addAmount, intentBuilder) {
  const p = G.players[0];
  const toCall = G.currentBet - p.betThisStreet;
  const label = holeLabel(p.hole[0], p.hole[1]);
  const rec = recommendAction(p); // 適用前に推奨を算出
  let d;
  if (type === 'fold') d = { type: 'fold', intent: 'あなたのフォールド' };
  else if (type === 'check') d = { type: 'check', intent: 'あなたのチェック' };
  else if (type === 'call') d = { type: 'call', add: toCall, intent: 'あなたのコール' };
  else d = { type: type, add: addAmount, intent: 'あなたのベット/レイズ' };
  applyAction(p, d);
  // 採点を直近履歴に付与
  const grade = gradeAction(type === 'allin' ? 'raise' : type, rec, handStrength(label));
  const last = G.history[G.history.length - 1];
  last.grade = grade.g; last.gradeColor = grade.color; last.rec = rec.intent;
  render();
  if (type === 'fold') {
    if (G.street === 'preflop') {
      // プリフロップのフォールドは頻度が高いので即次のハンドへ
      G.toAct = (G.toAct + 1) % 6;
      finishOrContinueFast();
      return;
    }
    // ポストフロップ(フロップ/ターン/リバー)のフォールド →
    // 相手の手札を公開してレビュー表示。「相手がどんなハンドでベットしたか」を学べる
    revealFoldReview();
    return;
  }
  G.toAct = (G.toAct + 1) % 6;
  setTimeout(advance, 600);
}

function finishOrContinueFast() {
  // Heroが降りた後、CPU同士は内部で進めて即終了（見せずに次へ）
  G.done = true;
  recordStats(-G.players[0].totalInvested);
  $('play-controls').innerHTML = '';
  $('play-review').innerHTML = `<div class="pl-fast">フォールドしました。次のハンドへ…</div>`;
  setTimeout(() => { newHand(); }, 900);
}

function revealFoldReview() {
  // ポストフロップでHeroがフォールドした時：まだ降りていない相手の手札を公開して
  // 「どんなハンドでベットしてきたか」をレビューで確認できるようにする
  G.done = true;
  recordStats(-G.players[0].totalInvested);
  G.players.forEach((p) => { if (!p.folded) p.revealed = true; });
  render();
  renderReview(null); // null = ショーダウンではなくフォールド時レビュー
}

// ---- ハンド終了 ----
function endHand() {
  G.done = true;
  // 残りボードを埋める（ショーダウンに必要なら）
  while (G.board.length < 5 && activePlayers().length > 1) G.board.push(G.deck.pop());

  const alive = activePlayers();
  // ポット分配（サイドポット対応）
  const results = distributePots(alive);

  if (G.heroReachedRiver) {
    recordStats((results[0] || 0) - G.players[0].totalInvested);
    revealAll();
    render();
    renderReview(results);
  } else {
    // Heroが早く降りた等 → 即次へ
    finishOrContinueFast();
  }
}

function distributePots(alive) {
  // totalInvested によるサイドポット計算
  const contribs = G.players.map((p) => ({ p, inv: p.totalInvested }));
  const winners = []; // {seat, amount}
  let remaining = contribs.map((c) => c.inv);
  const seatWin = {};
  // 層を作る
  const levels = [...new Set(G.players.map((p) => p.totalInvested).filter((v) => v > 0))].sort((a, b) => a - b);
  let prev = 0;
  for (const lvl of levels) {
    const layer = lvl - prev; prev = lvl;
    const contributors = G.players.filter((p) => p.totalInvested >= lvl);
    const potSize = layer * contributors.length;
    const eligible = contributors.filter((p) => !p.folded);
    if (!eligible.length) continue;
    // 勝者判定
    let best = -1, bestSeats = [];
    for (const p of eligible) {
      const sc = evaluate7([...p.hole, ...G.board]);
      if (sc > best) { best = sc; bestSeats = [p.seat]; }
      else if (sc === best) bestSeats.push(p.seat);
    }
    const share = potSize / bestSeats.length;
    bestSeats.forEach((s) => { seatWin[s] = (seatWin[s] || 0) + share; });
  }
  Object.entries(seatWin).forEach(([s, amt]) => { G.players[+s].stack += amt; });
  return seatWin;
}

function revealAll() { G.players.forEach((p) => { p.revealed = true; }); }

// ---- 成績の永続記録 ----
const STATS_KEY = 'gto_play_stats_v1';
export function loadPlayStats() {
  try { const r = localStorage.getItem(STATS_KEY); if (r) return JSON.parse(r); } catch (e) {}
  return { hands: 0, netBB: 0, grades: {}, byPos: {}, byStreet: {} };
}
function recordStats(heroNet) {
  if (G.recorded) return; G.recorded = true;
  const s = loadPlayStats();
  s.hands++; s.netBB += heroNet;
  for (const h of G.history) {
    if (!h.isHero || !h.grade) continue;
    s.grades[h.grade] = (s.grades[h.grade] || 0) + 1;
    const bad = (h.grade === 'ミス' || h.grade === '大ミス' || h.grade === '不正確') ? 1 : 0;
    s.byPos[h.pos] = s.byPos[h.pos] || { n: 0, bad: 0 };
    s.byPos[h.pos].n++; s.byPos[h.pos].bad += bad;
    s.byStreet[h.street] = s.byStreet[h.street] || { n: 0, bad: 0 };
    s.byStreet[h.street].n++; s.byStreet[h.street].bad += bad;
  }
  try { localStorage.setItem(STATS_KEY, JSON.stringify(s)); } catch (e) {}
}

// ---- 描画 ----
function handTypeName(hole, board) {
  const sc = evaluate7([...hole, ...board]);
  const cat = Math.floor(sc / 1e10);
  return ['ハイカード', 'ワンペア', 'ツーペア', 'トリップス', 'ストレート', 'フラッシュ', 'フルハウス', 'クアッズ', 'ストレートフラッシュ'][cat] || '';
}
// ランク表示（10は"10"表記。マークは付けない）
const SUIT_SYM_IDX = ['♠', '♥', '♦', '♣']; // equity.js の SUIT_CHARS=['s','h','d','c'] と同順
function rankJP(r) { return ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'][r]; }
// 成立した役を「どの数字で出来たか」付きで説明（数字のみ・SFだけマーク付き）
function describeMade(hole, board) {
  const all = [...hole, ...board];
  if (all.length < 2) return '';
  const { cat, cards } = bestFive(all);
  const ranks = cards.map((c) => Math.floor(c / 4));
  const counts = {}; ranks.forEach((r) => { counts[r] = (counts[r] || 0) + 1; });
  const byCount = (n) => Object.keys(counts).filter((r) => counts[r] === n).map(Number).sort((a, b) => b - a);
  if (cat === 8 || cat === 4) { // ストレート / ストレートフラッシュ
    const asc = [...ranks].sort((a, b) => a - b);
    const isWheel = asc.includes(12) && asc.includes(0) && !asc.includes(11);
    const order = isWheel ? [12, 0, 1, 2, 3] : asc;
    const txt = order.map(rankJP).join('-');
    if (cat === 8) return `ストレートフラッシュ（${txt} ${SUIT_SYM_IDX[cards[0] % 4]}）`;
    return `ストレート（${txt}）`;
  }
  if (cat === 7) return `クアッズ（${rankJP(byCount(4)[0])}）`;
  if (cat === 6) return `フルハウス（${rankJP(byCount(3)[0])}×3・${rankJP(byCount(2)[0])}×2）`;
  if (cat === 5) return `フラッシュ（${[...ranks].sort((a, b) => b - a).map(rankJP).join('-')}）`;
  if (cat === 3) return `トリップス（${rankJP(byCount(3)[0])}）`;
  if (cat === 2) { const p = byCount(2); return `ツーペア（${rankJP(p[0])}・${rankJP(p[1])}）`; }
  if (cat === 1) return `ワンペア（${rankJP(byCount(2)[0])}）`;
  return `ハイカード（${rankJP(Math.max(...ranks))}）`;
}
// Heroの強いドロー（次の1枚で完成する役）を「アウツ→役」で表示するHTML
function drawHintHTML() {
  const hero = G.players[0];
  if (!hero || hero.folded || G.done) return '';
  if (!(G.street === 'flop' || G.street === 'turn')) return '';
  const d = heroDraws(hero.hole, G.board);
  const cats = Object.keys(d).map(Number).sort((a, b) => b - a); // 強い役から
  if (!cats.length) return '';
  const NAME = { 4: 'ストレート', 5: 'フラッシュ', 6: 'フルハウス', 7: 'クアッズ', 8: 'ストレートF' };
  const rows = cats.map((cat) => {
    const o = d[cat];
    let outs = '';
    if (o.ranks.size) outs = [...o.ranks].sort((a, b) => a - b).map(rankJP).join('/');
    else if (o.suits.size) outs = [...o.suits].map((s) => SUIT_SYM_IDX[s]).join('/');
    else if (o.cards.size) outs = [...o.cards].map((c) => rankJP(Math.floor(c / 4)) + SUIT_SYM_IDX[c % 4]).join('/');
    return `<div class="dh-row"><span class="dh-out">${outs}</span><span class="dh-name">${NAME[cat]}</span></div>`;
  }).join('');
  return `<div class="draw-hint" title="次のカードで完成する役">${rows}</div>`;
}
function cardHTML(idx, small) {
  const lbl = cardLabel(idx); const red = lbl[1] === 'h' || lbl[1] === 'd';
  const sz = small ? 'pcard-sm' : '';
  return `<div class="pcard ${red ? 'red' : ''} ${sz}">${lbl[0]}<span>${SUIT_SYM[lbl[1]]}</span></div>`;
}
function cardBack(small) { return `<div class="pcard back ${small ? 'pcard-sm' : ''}"></div>`; }

// ベットチップ表示（チップの枚数ビジュアル＋bb額）。seatIdxで中央向きに配置
function chipStackHTML(amount, seatIdx) {
  const n = Math.max(1, Math.min(7, Math.round(amount)));
  let discs = '';
  for (let k = 0; k < n; k++) discs += `<span class="chip c${k % 4}"></span>`;
  const cls = [2, 3, 4].includes(seatIdx) ? 'below' : 'above';
  return `<div class="seat-bet ${cls}"><span class="chip-stack">${discs}</span><span class="chip-amt">${fmt(amount)} bb</span></div>`;
}

function render() {
  if (!G) return;
  const pot = G.players.reduce((s, p) => s + p.totalInvested, 0);
  // テーブル
  const tbl = $('play-table');
  let html = `<div class="pot-info">Pot ${fmt(pot)} bb</div>
    <div class="board-cards">${G.board.map((c) => cardHTML(c)).join('') || '<span class="board-empty">— プリフロップ —</span>'}${drawHintHTML()}</div>`;
  G.players.forEach((p, s) => {
    const [x, y] = SEAT_XY[s];
    const isTurn = !G.done && G.toAct === s && !p.folded && !p.allIn;
    const showCards = p.isHero || p.revealed;
    html += `<div class="seat ${p.isHero ? 'hero' : ''} ${p.folded ? 'folded' : ''} ${isTurn ? 'turn' : ''}" style="left:${x}%;top:${y}%">
      <div class="seat-top">
        <span class="pos-badge">${p.pos}</span>
        <span class="pname">${p.name}</span>
        ${G.button === s ? '<span class="dealer">D</span>' : ''}
      </div>
      <div class="seat-cards">${showCards ? p.hole.map((c) => cardHTML(c, true)).join('') : cardBack(true) + cardBack(true)}</div>
      <div class="seat-stack">${fmt(p.stack)} bb</div>
      ${p.betThisStreet > 0 ? chipStackHTML(p.betThisStreet, s) : ''}
      ${p.actionLabel ? `<div class="seat-action" style="background:${p.actionColor}">${p.actionLabel}</div>` : ''}
      ${((p.isHero && G.board.length >= 3) || (p.revealed && !p.folded)) ? `<div class="seat-handname">${describeMade(p.hole, G.board)}</div>` : ''}
    </div>`;
  });
  tbl.innerHTML = html;

  renderActionOrder();
  renderRangeTable();
}

function renderActionOrder() {
  // UTG→HJ→CO→BTN→SB→BB の順で最新アクション
  const order = POS_NAMES.map((pos) => G.players.find((p) => p.pos === pos)).filter(Boolean);
  const colorOf = (p) => p.folded ? '#55657a' : (p.actionColor || '#2a3a4d');
  const amtOf = (p) => (['RAISE', 'BET', 'CALL', 'ALL-IN', 'BLIND'].includes(p.actionLabel) && p.betThisStreet > 0)
    ? ' ' + fmt(p.betThisStreet) + 'bb' : '';
  $('play-order').innerHTML = `<div class="po-title">アクション順（${{ preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー' }[G.street] || ''}）</div>` + order.map((p) =>
    `<div class="po-row ${p.isHero ? 'hero' : ''} ${p.folded ? 'folded' : ''}">
      <span class="po-pos">${p.pos}</span>
      <span class="po-name">${p.name}</span>
      <span class="po-act" style="background:${colorOf(p)}">${p.actionLabel || '—'}${amtOf(p)}</span>
    </div>`).join('');
}

function renderHeroControls() {
  const p = G.players[0];
  const toCall = +(G.currentBet - p.betThisStreet).toFixed(1);
  const pot = G.players.reduce((s, q) => s + q.totalInvested, 0);
  const el = $('play-controls');
  const isRaise = G.currentBet > 0;
  const verb = isRaise ? 'レイズ' : 'ベット';
  const minRaiseTo = G.currentBet + G.lastRaiseSize;
  // 相手のベット/レイズに被せる状況か
  //  - プリフロップ: BB(1bb)超え＝誰かがオープン済み → こちらのレイズは3ベット以上
  //  - ポストフロップ: 相手がベット済み(0超え) → こちらのレイズはリレイズ
  // この場合はポット比ではなく「相手のベット額の◯倍」でサイズを出す
  const facingRaise = G.street === 'preflop' ? G.currentBet > BB : G.currentBet > 0;
  // 「レイズ to ◯◯bb」は必ず 0.5bb 刻みに丸める（中途半端な 2.9bb / 3.3bb を出さない）
  const r05 = (x) => Math.round(x * 2) / 2;
  const mkBtn = (label, toRaw) => {
    const to = r05(toRaw);
    const add = +(to - p.betThisStreet).toFixed(1);
    if (add <= 0 || add >= p.stack) return '';            // 無効 or オールイン相当
    if (isRaise && to < minRaiseTo - 0.001) return '';     // 最小レイズ未満は不可
    if (!isRaise && to < BB - 0.001) return '';            // 最小ベット未満
    return `<button class="act-btn raise" data-a="${isRaise ? 'raise' : 'bet'}" data-add="${add}">${label}<br><b>${fmt(to)}bb</b></button>`;
  };
  // ポット比（ポストフロップのベット/レイズ）
  const mkSize = (ratio, frac) => mkBtn(`${verb} ${ratio}`, isRaise ? G.currentBet + frac * pot : frac * pot);
  // 相手のベット額の倍率（3ベット/リレイズ）
  const mkMult = (mult) => mkBtn(`レイズ ${mult}x`, mult * G.currentBet);
  // プリフロップのオープン/アイソレート（クリーンな絶対bb: 2.5 / 3 / 4 など）
  const mkOpen = (toBB) => mkBtn('レイズ', toBB);
  // 1行目: フォールド / チェック・コール / 標準サイズ
  let row1 = `<button class="act-btn fold" data-a="fold">フォールド</button>`;
  if (toCall <= 0.001) row1 += `<button class="act-btn check" data-a="check">チェック</button>`;
  else row1 += `<button class="act-btn call" data-a="call">コール<br><b>${fmt(toCall)}bb</b></button>`;
  let row2 = '';
  if (p.stack > toCall) {
    if (facingRaise) {
      // 3ベット/リレイズ: 相手のベット額に対する倍率（2x/2.5x/3x/4x）
      row1 += mkMult(2) + mkMult(2.5) + mkMult(3);
      row2 += mkMult(4);
    } else if (G.street === 'preflop') {
      // プリフロップのオープン: 2.5 / 3 / 4 bb（2倍オープンは出さない）
      row1 += mkOpen(2.5) + mkOpen(3) + mkOpen(4);
    } else {
      // ポストフロップのベット: ポット比（⅓/½/⅔/ポット ＋ オーバーベット）
      row1 += mkSize('⅓', 0.33) + mkSize('½', 0.5) + mkSize('⅔', 0.66) + mkSize('ポット', 1.0);
      row2 += mkSize('1.5x', 1.5) + mkSize('2x', 2.0);
    }
    row2 += `<button class="act-btn allin" data-a="allin" data-add="${p.stack.toFixed(1)}">オールイン<br><b>${fmt(p.stack)}bb</b></button>`;
  }
  let coachHTML = '';
  if (G.coach) {
    const rec = recommendAction(p);
    const recName = { fold: 'フォールド', check: 'チェック', call: 'コール', bet: 'ベット', raise: 'レイズ' }[rec.type];
    coachHTML = `<div class="coach-hint">🎓 GTO推奨：<b>${recName}</b> — ${rec.intent}</div>`;
  }
  el.innerHTML = `<div class="hero-turn-label">あなたの番（${p.pos}）</div>${coachHTML}
    <div class="hero-btns">${row1}</div>
    ${row2 ? `<div class="hero-btns row2">${row2}</div>` : ''}`;
  el.querySelectorAll('.act-btn').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.a;
    if (a === 'allin') heroAct('raise', parseFloat(b.dataset.add));
    else if (a === 'bet' || a === 'raise') heroAct(a, parseFloat(b.dataset.add));
    else heroAct(a);
  }));
  $('play-review').innerHTML = '';
}

function renderReview(seatWin) {
  $('play-controls').innerHTML = '';
  const heroFold = !seatWin;                       // null = ポストフロップのフォールド時レビュー
  const heroInvest = G.players[0].totalInvested;
  const net = heroFold ? -heroInvest : (seatWin[0] || 0) - heroInvest;
  // ストリート別履歴
  const byStreet = { preflop: [], flop: [], turn: [], river: [] };
  G.history.forEach((h) => byStreet[h.street] && byStreet[h.street].push(h));
  const sLabel = { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー' };
  let histHTML = '';
  for (const st of ['preflop', 'flop', 'turn', 'river']) {
    if (!byStreet[st].length) continue;
    histHTML += `<div class="rv-street"><div class="rv-street-h">${sLabel[st]}</div>`;
    byStreet[st].forEach((h) => {
      const lblHand = holeLabel(h.hole[0], h.hole[1]);
      histHTML += `<div class="rv-act ${h.isHero ? 'hero' : ''}">
        <span class="rv-pos">${h.pos}</span>
        <span class="rv-hand">${h.hole.map((c) => { const l = cardLabel(c); const r = l[1] === 'h' || l[1] === 'd'; return `<i class="${r ? 'red' : ''}">${l[0]}${SUIT_SYM[l[1]]}</i>`; }).join('')}</span>
        <span class="rv-label" style="color:#cdd9e3">${h.label}${(h.label === 'CALL' || h.label === 'BET' || h.label === 'RAISE' || h.label === 'ALL-IN') && h.to > 0 ? ' ' + fmt(h.to) + 'bb' : ''}</span>
        ${h.grade ? `<span class="rv-grade" style="background:${h.gradeColor}">${h.grade}</span>` : ''}
        <span class="rv-intent">${h.intent}${h.rec && h.grade !== 'Best' ? `<br><span class="rv-rec">→ GTO推奨: ${h.rec}</span>` : ''}</span>
      </div>`;
    });
    histHTML += `</div>`;
  }
  let resultHTML;
  if (heroFold) {
    const st = { flop: 'フロップ', turn: 'ターン', river: 'リバー' }[G.street] || '';
    resultHTML = `
      <div class="rv-result lose">
        ▼ ${fmt(net)} bb
        <span class="rv-winner">${st}でフォールド — 相手の手札を公開（どんなハンドでベットしたか確認）</span>
      </div>`;
  } else {
    const winnerSeats = Object.keys(seatWin).map((s) => G.players[+s]);
    const winNames = winnerSeats.map((p) => `${p.name}(${p.pos}) ${describeMade(p.hole, G.board)}`).join('、');
    resultHTML = `
      <div class="rv-result ${net >= 0 ? 'win' : 'lose'}">
        ${net >= 0 ? '🏆 +' + fmt(net) : '▼ ' + fmt(net)} bb
        <span class="rv-winner">勝者: ${winNames}</span>
      </div>`;
  }

  // テーブル直下（play-controls）に「結果＋次へボタン」を出す。
  // スマホでもPCでもスクロール不要で押せ、テーブルを見たまま勉強→次へ進める。
  $('play-controls').innerHTML = `
    <div class="rv-top">
      ${resultHTML}
      <button class="rv-next" id="rv-next">次のハンドへ ▶</button>
      <div class="rv-scroll-hint">↓ 下に全員のハンドとアクションの解説</div>
    </div>`;
  // 詳細な学習用レビュー（ボード・全員のハンド・意図）は下に表示
  $('play-review').innerHTML = `
    <div class="rv-card">
      <div class="rv-board">ボード: ${G.board.map((c) => cardHTML(c, true)).join('')}</div>
      <div class="rv-hist-title">全プレイヤーのアクションと意図</div>
      <div class="rv-hist">${histHTML}</div>
    </div>`;
  $('rv-next').addEventListener('click', () => newHand());
}

// ---- ハンドレンジ表（実戦内・ON/OFF） ----
function renderRangeTable() {
  const wrap = $('play-range');
  if (!G.rangeOn) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  const hero = G.players[0];
  const scnId = { UTG: 'utg_rfi', HJ: 'hj_rfi', CO: 'co_rfi', BTN: 'btn_rfi', SB: 'sb_rfi' }[hero.pos] || 'btn_rfi';
  const scn = SCENARIOS[scnId];
  const strat = compileScenario(scn);
  let cells = '';
  for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
    const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
    const hi = RANKS[Math.min(i, j)], lo = RANKS[Math.max(i, j)];
    const label = i === j ? hi + lo : i < j ? hi + lo + 's' : hi + lo + 'o';
    const f = strat.get(label).freqs['raise'] || 0;
    cells += `<div class="rg-cell ${f < 0.01 ? 'dim' : ''}"><span class="rg-bar" style="width:${f * 100}%"></span><span class="rg-l">${label}</span></div>`;
  }
  wrap.innerHTML = `<div class="rg-title">ハンドレンジ表 — ${hero.pos} オープン（${scn.name}）</div><div class="rg-grid">${cells}</div>`;
}

export function initPlay() {
  G = { button: null, rangeOn: false, coach: false };
  // トグル群（コーチ・レンジ表）
  $('play-range-toggle').innerHTML = `
    <button id="coach-toggle">🎓 コーチモード OFF</button>
    <button id="rg-toggle">ハンドレンジ表 OFF</button>`;
  $('coach-toggle').addEventListener('click', () => {
    G.coach = !G.coach;
    $('coach-toggle').textContent = G.coach ? '🎓 コーチモード ON' : '🎓 コーチモード OFF';
    $('coach-toggle').classList.toggle('on', G.coach);
    if (!G.done && G.players && G.players[0] && G.toAct === 0) renderHeroControls();
  });
  $('rg-toggle').addEventListener('click', () => {
    G.rangeOn = !G.rangeOn;
    $('rg-toggle').textContent = G.rangeOn ? 'ハンドレンジ表 ON' : 'ハンドレンジ表 OFF';
    $('rg-toggle').classList.toggle('on', G.rangeOn);
    renderRangeTable();
  });
  newHand();
}
