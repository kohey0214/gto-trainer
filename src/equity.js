// equity.js — 本物のポーカーハンド評価器 + モンテカルロ・エクイティ計算
// 7枚から最高5枚役を評価し、ハンド/レンジ同士の勝率を実計算する

// カード: 0..51 → rank = floor(i/4) (0=2 ... 12=A), suit = i%4
const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = ['s', 'h', 'd', 'c'];

export function cardIndex(rankChar, suit) {
  return RANK_CHARS.indexOf(rankChar) * 4 + suit;
}
export function cardLabel(i) {
  return RANK_CHARS[Math.floor(i / 4)] + SUIT_CHARS[i % 4];
}

// 7枚（数値配列）→ 役スコア（大きいほど強い）
export function evaluate7(cards) {
  const rankCount = new Array(13).fill(0);
  const suitCount = new Array(4).fill(0);
  const suited = [[], [], [], []];
  for (const c of cards) {
    const r = Math.floor(c / 4), s = c % 4;
    rankCount[r]++; suitCount[s]++; suited[s].push(r);
  }

  // フラッシュ / ストレートフラッシュ
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCount[s] >= 5) flushSuit = s;

  const straightTop = (ranks) => {
    // ranks: Setライク（bool配列 length13）。A-5用にAを-1としても見る
    let run = 0, top = -1;
    // Aを下(=-1相当)として 5-high ストレートも判定するため、index12(A)を先頭にwheel対応
    const present = new Array(15).fill(false);
    for (let r = 0; r < 13; r++) if (ranks[r]) { present[r + 2] = true; }
    if (ranks[12]) present[1] = true; // A を 1 としても
    for (let v = 14; v >= 1; v--) {
      if (present[v]) { run++; if (run >= 5) { top = v; break; } }
      else run = 0;
    }
    return top; // 5..14 (14=A high), -1 なし
  };

  if (flushSuit >= 0) {
    const fr = new Array(13).fill(false);
    for (const r of suited[flushSuit]) fr[r] = true;
    const sfTop = straightTop(fr);
    if (sfTop > 0) return 8 * 1e10 + sfTop; // ストレートフラッシュ
  }

  // 役の集計
  const byCount = { 4: [], 3: [], 2: [], 1: [] };
  for (let r = 12; r >= 0; r--) if (rankCount[r] > 0) byCount[rankCount[r]].push(r);
  const RV = (r) => r + 2; // 2..14 表示用

  // 4カード
  if (byCount[4].length) {
    const q = byCount[4][0];
    const kick = Math.max(...[...byCount[3], ...byCount[2], ...byCount[1]].filter(r => r !== q), -1);
    return 7 * 1e10 + RV(q) * 100 + RV(kick);
  }
  // フルハウス
  if (byCount[3].length >= 2) return 6 * 1e10 + RV(byCount[3][0]) * 100 + RV(byCount[3][1]);
  if (byCount[3].length === 1 && byCount[2].length >= 1)
    return 6 * 1e10 + RV(byCount[3][0]) * 100 + RV(byCount[2][0]);
  // フラッシュ
  if (flushSuit >= 0) {
    const top5 = suited[flushSuit].sort((a, b) => b - a).slice(0, 5);
    let sc = 5 * 1e10; for (let k = 0; k < 5; k++) sc += RV(top5[k]) * Math.pow(15, 4 - k);
    return sc;
  }
  // ストレート
  const allR = new Array(13).fill(false);
  for (let r = 0; r < 13; r++) if (rankCount[r] > 0) allR[r] = true;
  const stop = straightTop(allR);
  if (stop > 0) return 4 * 1e10 + stop;
  // トリップス
  if (byCount[3].length) {
    const t = byCount[3][0];
    const ks = byCount[1].concat(byCount[2]).filter(r => r !== t).sort((a, b) => b - a).slice(0, 2);
    return 3 * 1e10 + RV(t) * 10000 + RV(ks[0] ?? -2) * 100 + RV(ks[1] ?? -2);
  }
  // ツーペア
  if (byCount[2].length >= 2) {
    const [p1, p2] = byCount[2];
    const k = Math.max(...byCount[1].concat(byCount[2].slice(2)), -1);
    return 2 * 1e10 + RV(p1) * 10000 + RV(p2) * 100 + RV(k);
  }
  // ワンペア
  if (byCount[2].length === 1) {
    const p = byCount[2][0];
    const ks = byCount[1].filter(r => r !== p).sort((a, b) => b - a).slice(0, 3);
    let sc = 1 * 1e10 + RV(p) * 1e6;
    for (let k = 0; k < 3; k++) sc += RV(ks[k] ?? -2) * Math.pow(15, 2 - k);
    return sc;
  }
  // ハイカード
  const hi = byCount[1].sort((a, b) => b - a).slice(0, 5);
  let sc = 0; for (let k = 0; k < 5; k++) sc += RV(hi[k]) * Math.pow(15, 4 - k);
  return sc;
}

// ハンドラベル "AKs" → 具体的な2枚の組合せ全列挙 [[c1,c2],...]
export function comboCards(label) {
  const r1 = label[0], r2 = label[1];
  const out = [];
  if (label.length === 2) { // pair
    const ri = RANK_CHARS.indexOf(r1);
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
      out.push([ri * 4 + a, ri * 4 + b]);
  } else if (label[2] === 's') {
    const i1 = RANK_CHARS.indexOf(r1), i2 = RANK_CHARS.indexOf(r2);
    for (let s = 0; s < 4; s++) out.push([i1 * 4 + s, i2 * 4 + s]);
  } else {
    const i1 = RANK_CHARS.indexOf(r1), i2 = RANK_CHARS.indexOf(r2);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++)
      if (a !== b) out.push([i1 * 4 + a, i2 * 4 + b]);
  }
  return out;
}

function pickRandomCombo(rangeLabels, dead) {
  // rangeLabels: 重み付き [{label,freq}] からランダムに1ハンド選び、デッドと衝突しない2枚を返す
  for (let tries = 0; tries < 40; tries++) {
    const pick = rangeLabels[Math.floor(Math.random() * rangeLabels.length)];
    const combos = comboCards(pick.label).filter(([a, b]) => !dead.has(a) && !dead.has(b));
    if (combos.length) return combos[Math.floor(Math.random() * combos.length)];
  }
  return null;
}

// メイン: hero(2枚 or レンジ) vs villain(2枚 or レンジ), board(0-5枚), iterations
// hero/villain は {cards:[c1,c2]} または {range:[{label,freq}]}
export function equity(hero, villain, board = [], iterations = 4000) {
  let win = 0, tie = 0, total = 0;
  const baseBoard = [...board];
  for (let it = 0; it < iterations; it++) {
    const dead = new Set(baseBoard);
    let hc = hero.cards;
    if (!hc) { hc = pickRandomCombo(hero.range, dead); if (!hc) continue; }
    hc.forEach(c => dead.add(c));
    let vc = villain.cards;
    if (!vc) { vc = pickRandomCombo(villain.range, dead); if (!vc) continue; }
    if (dead.has(vc[0]) || dead.has(vc[1])) continue;
    vc.forEach(c => dead.add(c));
    // 残りボードを埋める
    const fullBoard = [...baseBoard];
    while (fullBoard.length < 5) {
      const c = Math.floor(Math.random() * 52);
      if (!dead.has(c)) { dead.add(c); fullBoard.push(c); }
    }
    const hs = evaluate7([...hc, ...fullBoard]);
    const vs = evaluate7([...vc, ...fullBoard]);
    if (hs > vs) win++; else if (hs === vs) tie++;
    total++;
  }
  if (!total) return { win: 0, tie: 0, lose: 0, equity: 0 };
  return {
    win: win / total * 100,
    tie: tie / total * 100,
    lose: (total - win - tie) / total * 100,
    equity: (win + tie / 2) / total * 100,
  };
}

export function parseCardInput(str) {
  // "AhKd" or "As Ks" → [idx,idx]
  const clean = str.replace(/\s+/g, '');
  const cards = [];
  for (let i = 0; i < clean.length - 1; i += 2) {
    const r = clean[i].toUpperCase();
    const s = SUIT_CHARS.indexOf(clean[i + 1].toLowerCase());
    if (RANK_CHARS.includes(r) && s >= 0) cards.push(RANK_CHARS.indexOf(r) * 4 + s);
  }
  return cards;
}
