// poker.js — ハンドグリッド / レンジ記法パーサ / 強さ評価 / 戦略・EV合成
// GTO Wizard クローンのエンジン部分（外部依存なし・ブラウザES module）

export const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'];
// RANKS[0]=A が最強。グリッドは左上AAから。

// 13x13 の全169ハンドを生成（i=row, j=col）。i<j → suited, i>j → offsuit, i==j → pair
export function buildGrid() {
  const grid = [];
  for (let i = 0; i < 13; i++) {
    const row = [];
    for (let j = 0; j < 13; j++) {
      const hi = RANKS[Math.min(i, j)];
      const lo = RANKS[Math.max(i, j)];
      let label, type;
      if (i === j) { label = hi + lo; type = 'pair'; }
      else if (i < j) { label = hi + lo + 's'; type = 'suited'; }
      else { label = hi + lo + 'o'; type = 'offsuit'; }
      row.push({ label, type, i, j, combos: type === 'pair' ? 6 : type === 'suited' ? 4 : 12 });
    }
    grid.push(row);
  }
  return grid;
}

export const GRID = buildGrid();
export const ALL_HANDS = GRID.flat();

// ---- レンジ記法パーサ ------------------------------------------------------
// 例: "22+", "55-TT", "ATs+", "A2s-A5s", "AKo", "AJo+", "KQ", "T9s:0.5"
const rIdx = (c) => RANKS.indexOf(c); // 0=A ... 12=2 （小さいほど強い）

function pairList(from, to) {
  // from,to はランク文字。強い順に並べる
  const a = rIdx(from), b = rIdx(to);
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const out = [];
  for (let k = lo; k <= hi; k++) out.push(RANKS[k] + RANKS[k]);
  return out;
}

function expandToken(token) {
  // 戻り値: [{label, freq}]
  let freq = 1;
  const colon = token.indexOf(':');
  if (colon >= 0) { freq = parseFloat(token.slice(colon + 1)); token = token.slice(0, colon); }
  token = token.trim();
  const out = [];
  const push = (lbl) => out.push({ label: lbl, freq });

  // ペア系
  if (token.length >= 2 && token[0] === token[1] && !/[so]/.test(token[2] || '')) {
    if (token.endsWith('+')) {
      const base = token[0];
      // 22+ → 22..AA, TT+ → TT..AA
      pairList(base, 'A').forEach(push);
      return out;
    }
    const dash = token.indexOf('-');
    if (dash > 0) {
      const f = token[0], t = token[dash + 1];
      pairList(f, t).forEach(push);
      return out;
    }
    push(token.slice(0, 2));
    return out;
  }

  // suited/offsuit 系
  const suit = token.includes('s') ? 's' : token.includes('o') ? 'o' : '';
  const plus = token.endsWith('+');
  const dash = token.indexOf('-');

  const mkLabel = (hi, lo, s) => hi + lo + s;

  if (dash > 0) {
    // A2s-A5s 形式（高位カード固定、低位カードを範囲で）
    const left = token.slice(0, dash);
    const right = token.slice(dash + 1);
    const s = left.includes('s') ? 's' : left.includes('o') ? 'o' : '';
    const hi = left[0];
    const loA = left[1], loB = right[1];
    const a = rIdx(loA), b = rIdx(loB);
    const lo = Math.min(a, b), high = Math.max(a, b);
    for (let k = lo; k <= high; k++) push(mkLabel(hi, RANKS[k], s));
    return out;
  }

  const hi = token[0], lo = token[1];
  const suits = suit ? [suit] : ['s', 'o'];
  for (const s of suits) {
    if (plus) {
      // ATs+ → 低位カードを (hi-1) まで上げる
      const start = rIdx(lo), end = rIdx(hi) + 1; // end は hi の1つ下まで
      for (let k = start; k >= end; k--) push(mkLabel(hi, RANKS[k], s));
    } else {
      push(mkLabel(hi, lo, s));
    }
  }
  return out;
}

export function parseRange(str) {
  // 戻り値: Map<label, freq>
  const map = new Map();
  if (!str) return map;
  for (const tok of str.split(',')) {
    const t = tok.trim();
    if (!t) continue;
    for (const { label, freq } of expandToken(t)) {
      // 既存があれば大きい方を採用（重複定義の安全策）
      map.set(label, Math.max(map.get(label) || 0, freq));
    }
  }
  return map;
}

// ---- ハンド強さ（Chen式ベース・並べ替え/EV合成用） -------------------------
function chenScore(hand) {
  const r1 = hand[0], r2 = hand[1];
  const val = (r) => {
    if (r === 'A') return 10;
    if (r === 'K') return 8;
    if (r === 'Q') return 7;
    if (r === 'J') return 6;
    const n = parseInt(r === 'T' ? '10' : r, 10);
    return n / 2;
  };
  const i1 = rIdx(r1), i2 = rIdx(r2);
  if (r1 === r2) { // pair
    return Math.max(5, val(r1) * 2);
  }
  let score = Math.max(val(r1), val(r2));
  const suited = hand.endsWith('s');
  if (suited) score += 2;
  const gap = Math.abs(i1 - i2) - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;
  // ストレートボーナス（両方Q未満かつ gap<=1）
  const bothLow = Math.min(i1, i2) >= rIdx('Q'); // index大=ランク低
  if (gap <= 1 && bothLow && r1 !== r2) score += 1;
  return Math.ceil(score);
}

// 169ハンドを強い順に並べたパーセンタイル（0=最弱, 1=最強）
const strengthMap = (() => {
  const arr = ALL_HANDS.map((h) => ({ label: h.label, s: chenScore(h.label) }));
  arr.sort((a, b) => a.s - b.s);
  const m = new Map();
  arr.forEach((x, idx) => m.set(x.label, idx / (arr.length - 1)));
  return m;
})();
export const handStrength = (label) => strengthMap.get(label) ?? 0.5;

// ---- シナリオのコンパイル（レンジ → 各ハンドの戦略 + EV） -------------------
// scenario.actions: [{id,label,color}]  最後が fold 想定でなくてもよい
// scenario.ranges: { actionId: "レンジ文字列" }  fold は残余で自動算出
export function compileScenario(scn) {
  const actionMaps = {};
  for (const a of scn.actions) {
    if (a.id === 'fold') continue;
    actionMaps[a.id] = parseRange(scn.ranges[a.id] || '');
  }
  const hasFold = scn.actions.some((a) => a.id === 'fold');

  const strat = new Map(); // label -> {freqs:{id:f}, ev:{id:bb}, top:id, inRange:bool}
  for (const h of ALL_HANDS) {
    const freqs = {};
    let sum = 0;
    for (const a of scn.actions) {
      if (a.id === 'fold') continue;
      const f = Math.max(0, Math.min(1, actionMaps[a.id].get(h.label) || 0));
      freqs[a.id] = f;
      sum += f;
    }
    // 合計>1 の場合は非foldアクションを正規化（レンジ重複の保険）
    if (sum > 1) {
      for (const a of scn.actions) {
        if (a.id === 'fold') continue;
        freqs[a.id] /= sum;
      }
      sum = 1;
    }
    if (hasFold) freqs['fold'] = Math.max(0, 1 - sum);

    // top アクション
    let top = null, topF = -1;
    for (const k in freqs) { if (freqs[k] > topF) { topF = freqs[k]; top = k; } }

    // EV 合成（GTOの無差別原理に基づく）
    const ev = synthEV(h.label, freqs, scn);
    strat.set(h.label, { freqs, ev, top, inRange: (freqs['fold'] ?? 0) < 0.999 });
  }
  return strat;
}

// EV合成: プレイされるアクションはほぼ無差別（top がわずかに最良）。
// 頻度0のアクションは強さ・コミット度に応じてEVを失う。単位 bb。
function synthEV(label, freqs, scn) {
  const st = handStrength(label); // 0..1
  // ベースとなる「このハンドをプレイした時の価値」
  const base = scn.baseEV ? scn.baseEV(st) : (st - 0.45) * 6; // bb目安
  let maxF = 0;
  for (const k in freqs) maxF = Math.max(maxF, freqs[k]);
  const ev = {};
  for (const k in freqs) {
    const f = freqs[k];
    if (k === 'fold') {
      // foldのEVは基準0（プリフロップ）
      ev[k] = freqs['fold'] > 0 ? 0 - (maxF - f) * 0.05 : -Math.abs(base) - 0.3;
      if (freqs['fold'] > 0.001) ev[k] = 0; // フォールドが解の一部なら0
      else ev[k] = -(0.25 + 2.4 * maxF); // フォールドが間違いなら強くマイナス
      continue;
    }
    if (f > 0.001) {
      // プレイされるアクション: ほぼ無差別。topからの差をごく小さく
      ev[k] = Math.max(0.02, base) - (maxF - f) * 0.12;
    } else {
      // 解に含まれないアクション: コミット度に応じて損失
      ev[k] = Math.max(0.02, base) - (0.35 + 2.6 * maxF);
    }
  }
  return ev;
}
