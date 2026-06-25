// solver.js — 本物のポストフロップ・ソルバー（汎用ゲームツリー + ベクトル形CFR）
// 複数ベットサイズ（33% / 75%）＋ポットサイズ・レイズ（1回）に対応。
// フロップ1ストリート、ターン・リバーはロールアウトでエクイティ決済。
import { parseRange } from './poker.js';
import { comboCards, evaluate7, parseCardInput, cardLabel } from './equity.js';

export const POSTFLOP_PRESETS = {
  btn_vs_bb_srp: {
    id: 'btn_vs_bb_srp', name: 'SRP BTN vs BB',
    desc: 'BTN 2.5bbオープン → BBコール。ポット約5.5bb・OOP=BB / IP=BTN',
    oopName: 'BB', ipName: 'BTN', pot: 5.5,
    oop: '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, KTo+, QTo+, JTo',
    ip: '22+, A2s+, K5s+, Q7s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, A7o+, K9o+, Q9o+, J9o+, T9o',
  },
  co_vs_btn_srp: {
    id: 'co_vs_btn_srp', name: 'SRP CO vs BTN',
    desc: 'CO 2.5bbオープン → BTNコール。ポット約6bb・OOP=CO / IP=BTN',
    oopName: 'CO', ipName: 'BTN', pot: 6.0,
    oop: '22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo',
    ip: '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, A8o+, KTo+, QTo+',
  },
};

// アクションの表示メタ
export const ACT_META = {
  check: { label: 'Check', color: '#3aa655' },
  bet33: { label: 'Bet 33%', color: '#e0a32a' },
  bet75: { label: 'Bet 75%', color: '#d8442f' },
  fold: { label: 'Fold', color: '#3b6ea5' },
  call: { label: 'Call', color: '#3aa655' },
  raise: { label: 'Raise', color: '#a02622' },
};

const BET_SIZES = [{ key: 'bet33', frac: 0.33 }, { key: 'bet75', frac: 0.75 }];

function buildRange(rangeStr, board) {
  const map = parseRange(rangeStr);
  const dead = new Set(board);
  const out = [];
  for (const [label, freq] of map) {
    if (freq <= 0) continue;
    const combos = comboCards(label).filter(([a, b]) => !dead.has(a) && !dead.has(b));
    if (!combos.length) continue;
    const baseCombos = label.length === 2 ? 6 : label[2] === 's' ? 4 : 12;
    out.push({ label, weight: freq * baseCombos, combo: combos[Math.floor(combos.length / 2)] });
  }
  return out;
}

function pairEquity(c1, c2, board, rollouts) {
  if (c1[0] === c2[0] || c1[0] === c2[1] || c1[1] === c2[0] || c1[1] === c2[1]) return -1;
  const dead = new Set([...board, ...c1, ...c2]);
  let win = 0, n = 0;
  for (let it = 0; it < rollouts; it++) {
    const full = [...board]; const used = new Set(dead);
    while (full.length < 5) { const c = Math.floor(Math.random() * 52); if (!used.has(c)) { used.add(c); full.push(c); } }
    const a = evaluate7([...c1, ...full]); const b = evaluate7([...c2, ...full]);
    if (a > b) win += 1; else if (a === b) win += 0.5;
    n++;
  }
  return win / n;
}

// ---- ゲームツリー構築 ----
function buildTree(P) {
  const nodes = [];
  let rootOOP = null, ipVsCheck = null;

  function terminal(kind, inv, folder) {
    return { terminal: true, kind, inv: inv.slice(), folder };
  }
  function decision(player, inv, toCall, canRaise, afterCheck) {
    const node = { terminal: false, player, actions: [], key: nodes.length };
    const potNow = P + inv[0] + inv[1];
    if (toCall <= 0) {
      // チェック
      const checkChild = afterCheck
        ? terminal('showdown', inv)
        : decision(1 - player, inv.slice(), 0, true, true);
      node.actions.push({ key: 'check', child: checkChild });
      // ベット各サイズ
      for (const bs of BET_SIZES) {
        const size = +(bs.frac * potNow).toFixed(3);
        const ninv = inv.slice(); ninv[player] += size;
        node.actions.push({ key: bs.key, size, child: decision(1 - player, ninv, size, true, false) });
      }
    } else {
      node.actions.push({ key: 'fold', child: terminal('fold', inv, player) });
      const cinv = inv.slice(); cinv[player] += toCall;
      node.actions.push({ key: 'call', child: terminal('showdown', cinv) });
      if (canRaise) {
        const potAfterCall = P + inv[0] + inv[1] + toCall;
        const raiseAmt = +potAfterCall.toFixed(3);
        const rinv = inv.slice(); rinv[player] += toCall + raiseAmt;
        node.actions.push({ key: 'raise', size: raiseAmt, child: decision(1 - player, rinv, raiseAmt, false, false) });
      }
    }
    nodes.push(node);
    return node;
  }
  rootOOP = decision(0, [0, 0], 0, true, false);
  // IPがOOPチェックに直面するノード = rootの'check'アクションの子
  ipVsCheck = rootOOP.actions.find(a => a.key === 'check').child;
  return { rootOOP, ipVsCheck, nodes };
}

export function solveFlop(preset, board, opts = {}) {
  const iterations = opts.iterations || 500;
  const rollouts = opts.rollouts || 80;
  const P = preset.pot;
  const OOP = buildRange(preset.oop, board);
  const IP = buildRange(preset.ip, board);
  const NO = OOP.length, NI = IP.length;

  // エクイティ行列
  const eq = [];
  for (let i = 0; i < NO; i++) {
    eq[i] = new Float32Array(NI);
    for (let j = 0; j < NI; j++) eq[i][j] = pairEquity(OOP[i].combo, IP[j].combo, board, rollouts);
  }

  const { rootOOP, ipVsCheck, nodes } = buildTree(P);
  // 各ノードに後悔・戦略累積を割り当て
  for (const n of nodes) {
    if (n.terminal) continue;
    const hc = n.player === 0 ? NO : NI;
    const nA = n.actions.length;
    n.regret = Array.from({ length: hc }, () => new Float64Array(nA));
    n.strat = Array.from({ length: hc }, () => new Float64Array(nA));
  }

  const wIsum = IP.reduce((s, x) => s + x.weight, 0);
  const wOsum = OOP.reduce((s, x) => s + x.weight, 0);

  function curStrategy(node) {
    const hc = node.regret.length, nA = node.actions.length;
    const s = Array.from({ length: hc }, () => new Float64Array(nA));
    for (let h = 0; h < hc; h++) {
      let sum = 0;
      for (let a = 0; a < nA; a++) { const r = node.regret[h][a]; if (r > 0) sum += r; }
      for (let a = 0; a < nA; a++) {
        const r = node.regret[h][a];
        s[h][a] = sum > 0 ? (r > 0 ? r / sum : 0) : 1 / nA;
      }
    }
    return s;
  }
  function avgStrategy(node) {
    const hc = node.strat.length, nA = node.actions.length;
    const s = Array.from({ length: hc }, () => new Float64Array(nA));
    for (let h = 0; h < hc; h++) {
      let sum = 0; for (let a = 0; a < nA; a++) sum += node.strat[h][a];
      for (let a = 0; a < nA; a++) s[h][a] = sum > 0 ? node.strat[h][a] / sum : 1 / nA;
    }
    return s;
  }

  // ターミナル効用ベクトル [u0(NO), u1(NI)]
  function terminalUtil(node, pi0, pi1) {
    const u0 = new Float64Array(NO), u1 = new Float64Array(NI);
    if (node.kind === 'showdown') {
      const x = node.inv[0]; // == inv[1]
      const S = P + node.inv[0] + node.inv[1];
      for (let i = 0; i < NO; i++) {
        let acc = 0;
        for (let j = 0; j < NI; j++) {
          if (eq[i][j] < 0 || pi1[j] === 0) continue;
          acc += pi1[j] * (S * eq[i][j] - x);
        }
        u0[i] = acc;
      }
      for (let j = 0; j < NI; j++) {
        let acc = 0;
        for (let i = 0; i < NO; i++) {
          if (eq[i][j] < 0 || pi0[i] === 0) continue;
          acc += pi0[i] * (S * (1 - eq[i][j]) - x);
        }
        u1[j] = acc;
      }
    } else { // fold
      // payoff0 = folder==0 ? -inv0 : P+inv1
      const p0 = node.folder === 0 ? -node.inv[0] : P + node.inv[1];
      for (let i = 0; i < NO; i++) {
        let acc = 0; for (let j = 0; j < NI; j++) { if (eq[i][j] < 0) continue; acc += pi1[j] * p0; } u0[i] = acc;
      }
      for (let j = 0; j < NI; j++) {
        let acc = 0; for (let i = 0; i < NO; i++) { if (eq[i][j] < 0) continue; acc += pi0[i] * (P - p0); } u1[j] = acc;
      }
    }
    return [u0, u1];
  }

  function traverse(node, pi0, pi1, useAvg) {
    if (node.terminal) return terminalUtil(node, pi0, pi1);
    const p = node.player, nA = node.actions.length;
    const hc = p === 0 ? NO : NI;
    const s = useAvg ? avgStrategy(node) : curStrategy(node);
    const u0 = new Float64Array(NO), u1 = new Float64Array(NI);
    const cfv = []; // cfv[a] = p側の効用ベクトル(length hc)

    for (let a = 0; a < nA; a++) {
      let np0 = pi0, np1 = pi1;
      if (p === 0) { np0 = new Float64Array(NO); for (let i = 0; i < NO; i++) np0[i] = pi0[i] * s[i][a]; }
      else { np1 = new Float64Array(NI); for (let j = 0; j < NI; j++) np1[j] = pi1[j] * s[j][a]; }
      const [cu0, cu1] = traverse(node.actions[a].child, np0, np1, useAvg);
      if (p === 0) { for (let j = 0; j < NI; j++) u1[j] += cu1[j]; cfv[a] = cu0; }
      else { for (let i = 0; i < NO; i++) u0[i] += cu0[i]; cfv[a] = cu1; }
    }

    const piP = p === 0 ? pi0 : pi1;
    for (let h = 0; h < hc; h++) {
      let nodeU = 0;
      for (let a = 0; a < nA; a++) nodeU += s[h][a] * cfv[a][h];
      if (p === 0) u0[h] = nodeU; else u1[h] = nodeU;
      if (!useAvg) {
        for (let a = 0; a < nA; a++) node.regret[h][a] += cfv[a][h] - nodeU;
        for (let a = 0; a < nA; a++) node.strat[h][a] += piP[h] * s[h][a];
      }
    }
    return [u0, u1];
  }

  const pi0base = Float64Array.from(OOP.map(x => x.weight));
  const pi1base = Float64Array.from(IP.map(x => x.weight));
  for (let it = 0; it < iterations; it++) traverse(rootOOP, pi0base, pi1base, false);

  // 最終EV評価（平均戦略）
  const [u0avg] = traverse(rootOOP, pi0base, pi1base, true);

  // OOPルート戦略
  const rootAvg = avgStrategy(rootOOP);
  const rootKeys = rootOOP.actions.map(a => a.key);
  const oopStrategy = OOP.map((h, i) => {
    const freqs = {};
    rootKeys.forEach((k, a) => freqs[k] = rootAvg[i][a]);
    return { label: h.label, freqs, ev: u0avg[i] / (wIsum || 1) };
  });

  // IP（OOPチェックに対する応答）戦略
  const ipAvg = avgStrategy(ipVsCheck);
  const ipKeys = ipVsCheck.actions.map(a => a.key);
  const ipStrategy = IP.map((h, j) => {
    const freqs = {};
    ipKeys.forEach((k, a) => freqs[k] = ipAvg[j][a]);
    return { label: h.label, freqs };
  });

  // 集計
  const agg = (strat, keys, range) => {
    const tot = {}; keys.forEach(k => tot[k] = 0); let w = 0;
    strat.forEach((h, idx) => { const wt = range[idx].weight; w += wt; keys.forEach(k => tot[k] += wt * h.freqs[k]); });
    const out = {}; keys.forEach(k => out[k] = tot[k] / w * 100); return out;
  };
  let evTot = 0; oopStrategy.forEach((h, i) => evTot += OOP[i].weight * h.ev);

  return {
    oopStrategy, ipStrategy, rootKeys, ipKeys,
    aggOOP: agg(oopStrategy, rootKeys, OOP),
    aggIP: agg(ipStrategy, ipKeys, IP),
    avgEV: evTot / (wOsum || 1),
    pot: P, betSizes: BET_SIZES.map(b => ({ key: b.key, bb: +(b.frac * P).toFixed(2) })),
    boardLabels: board.map(cardLabel), nOOP: NO, nIP: NI, iterations,
  };
}

export { parseCardInput };
