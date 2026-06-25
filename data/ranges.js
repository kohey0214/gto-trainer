// ranges.js — 6-max 100bb キャッシュゲームのGTO近似レンジ集
// アクション色は GTO Wizard 系統に準拠: Fold=青, Call=緑, Raise=赤/橙, 3Bet=濃赤
// ※ソルバー実測の近似値。混合戦略（中途半端な頻度）を意図的に含めてあの「縞模様」を再現

export const ACTION_COLORS = {
  fold: '#3b6ea5',     // 青
  call: '#3aa655',     // 緑
  raise: '#d8442f',    // 赤
  '3bet': '#a02622',   // 濃赤
  allin: '#5e1714',    // ダーク赤
  limp: '#caa23a',     // 黄
};

// RFI（オープンレイズ）: アクション = raise / fold
const RFI_ACTIONS = [
  { id: 'raise', label: 'Raise 2.5bb', color: ACTION_COLORS.raise },
  { id: 'fold', label: 'Fold', color: ACTION_COLORS.fold },
];

// 対オープン（3アクション）: 3bet / call / fold
const VS_OPEN_ACTIONS = [
  { id: '3bet', label: '3-Bet', color: ACTION_COLORS['3bet'] },
  { id: 'call', label: 'Call', color: ACTION_COLORS.call },
  { id: 'fold', label: 'Fold', color: ACTION_COLORS.fold },
];

export const SCENARIOS = {
  // ===== RFI =====
  utg_rfi: {
    id: 'utg_rfi', group: 'RFI', name: 'UTG オープン',
    hero: 'UTG', desc: '6-max・UTGのレイズファーストイン (≈16%)',
    actions: RFI_ACTIONS,
    ranges: {
      raise:
        '55+, 44:0.7, 33:0.5, 22:0.5, ' +
        'AKs, AQs, AJs, ATs, A9s:0.5, A5s:0.7, A4s:0.5, A3s:0.3, ' +
        'KTs+, K9s:0.4, QTs+, Q9s:0.3, JTs, J9s:0.3, T9s:0.7, 98s:0.5, 87s:0.4, 76s:0.3, ' +
        'AKo, AQo, AJo, ATo:0.4, KQo, KJo:0.4, QJo:0.3',
    },
  },
  hj_rfi: {
    id: 'hj_rfi', group: 'RFI', name: 'HJ オープン',
    hero: 'HJ', desc: '6-max・ハイジャックのRFI (≈21%)',
    actions: RFI_ACTIONS,
    ranges: {
      raise:
        '33+, 22:0.7, ' +
        'ATs+, A9s, A8s:0.6, A5s, A4s, A3s:0.6, A2s:0.4, ' +
        'KTs+, K9s, Q9s+, J9s+, T9s, 98s, 87s, 76s:0.6, 65s:0.4, ' +
        'AJo+, ATo, A9o:0.3, KQo, KJo, KTo:0.4, QJo, QTo:0.4, JTo:0.4',
    },
  },
  co_rfi: {
    id: 'co_rfi', group: 'RFI', name: 'CO オープン',
    hero: 'CO', desc: '6-max・カットオフのRFI (≈27%)',
    actions: RFI_ACTIONS,
    ranges: {
      raise:
        '22+, ' +
        'A2s+, K7s+, K6s:0.5, Q8s+, Q7s:0.4, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s:0.6, ' +
        'ATo+, A9o:0.5, A8o:0.3, KTo+, K9o:0.4, QTo+, Q9o:0.3, JTo, J9o:0.4, T9o:0.4',
    },
  },
  btn_rfi: {
    id: 'btn_rfi', group: 'RFI', name: 'BTN オープン',
    hero: 'BTN', desc: '6-max・ボタンのRFI (≈45%)',
    actions: RFI_ACTIONS,
    ranges: {
      raise:
        '22+, ' +
        'A2s+, K2s+, Q4s+, Q3s:0.5, J6s+, J5s:0.5, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s:0.6, ' +
        'A2o+, K7o+, K6o:0.5, Q8o+, Q7o:0.4, J8o+, J7o:0.4, T8o+, 98o, 97o:0.4, 87o:0.5, 76o:0.4',
    },
  },
  sb_rfi: {
    id: 'sb_rfi', group: 'RFI', name: 'SB オープン (raise)',
    hero: 'SB', desc: '6-max・SBのレイズオンリー戦略 (≈40%)',
    actions: RFI_ACTIONS,
    ranges: {
      raise:
        '22+, ' +
        'A2s+, K4s+, K3s:0.6, Q6s+, Q5s:0.5, J7s+, J6s:0.4, T7s+, 97s+, 86s+, 75s+, 64s+, 54s, 43s:0.5, ' +
        'A2o+, K7o+, K6o:0.5, Q8o+, Q7o:0.4, J8o+, J7o:0.4, T8o+, 98o, 87o:0.6, 76o:0.4',
    },
  },

  // ===== 対オープン（3bet/call/fold） =====
  bb_vs_btn: {
    id: 'bb_vs_btn', group: '対オープン', name: 'BB vs BTN オープン',
    hero: 'BB', desc: 'BTNが2.5bbオープン → BBのディフェンス',
    actions: VS_OPEN_ACTIONS,
    baseEV: (st) => (st - 0.30) * 5, // BBはポット投資済みで広く守れる
    ranges: {
      '3bet':
        'AA, KK, QQ:0.7, JJ:0.4, AKs, AKo:0.7, AQs:0.4, A5s:0.5, A4s:0.5, ' +
        'KQs:0.3, K5s:0.3, Q5s:0.3, J5s:0.3, T7s:0.3, 76s:0.3, 65s:0.3, 54s:0.4',
      call:
        '22+, ' +
        'A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 63s+, 52s+, 42s+, 32s, ' +
        'A2o+, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o, 76o, 65o, 54o',
    },
  },
  btn_vs_co: {
    id: 'btn_vs_co', group: '対オープン', name: 'BTN vs CO オープン',
    hero: 'BTN', desc: 'COが2.5bbオープン → BTNの対応',
    actions: VS_OPEN_ACTIONS,
    baseEV: (st) => (st - 0.42) * 6,
    ranges: {
      '3bet':
        'AA, KK, QQ, JJ:0.6, TT:0.3, AKs, AKo:0.8, AQs, AQo:0.4, AJs:0.5, ATs:0.4, ' +
        'A5s:0.6, A4s:0.4, KQs:0.5, KJs:0.3, KTs:0.3, QJs:0.3, 76s:0.3, 65s:0.3, 54s:0.4',
      call:
        '22-TT, ' +
        'A2s-A9s, ATs:0.6, AJs:0.5, KTs+, K9s:0.6, K8s:0.4, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, ' +
        'AJo, ATo:0.6, KQo, KJo:0.5, QJo:0.5',
    },
  },

  // ===== 対3ベット（4bet/call/fold） =====
  btn_vs_bb_3bet: {
    id: 'btn_vs_bb_3bet', group: '対3ベット', name: 'BTN open vs BB 3ベット',
    hero: 'BTN', desc: 'BTNがオープン → BBが3betでスクイーズ → BTNの対応',
    actions: [
      { id: '4bet', label: '4-Bet', color: ACTION_COLORS['3bet'] },
      { id: 'call', label: 'Call', color: ACTION_COLORS.call },
      { id: 'fold', label: 'Fold', color: ACTION_COLORS.fold },
    ],
    baseEV: (st) => (st - 0.55) * 7,
    ranges: {
      '4bet':
        'AA, KK, QQ:0.8, JJ:0.3, AKs, AKo:0.7, A5s:0.6, A4s:0.5, A3s:0.3, KQs:0.2',
      call:
        'TT-JJ, 99:0.7, 88:0.6, 77:0.5, 66:0.4, 55:0.4, ' +
        'AQs, AJs, ATs, KQs:0.7, KJs, KTs:0.6, QJs, QTs:0.6, JTs, T9s, 98s, 87s, 76s:0.6, ' +
        'AQo:0.6, AJo:0.4, KQo:0.4',
    },
  },
  co_vs_btn_3bet: {
    id: 'co_vs_btn_3bet', group: '対3ベット', name: 'CO open vs BTN 3ベット',
    hero: 'CO', desc: 'COがオープン → BTNが3bet → COの対応',
    actions: [
      { id: '4bet', label: '4-Bet', color: ACTION_COLORS['3bet'] },
      { id: 'call', label: 'Call', color: ACTION_COLORS.call },
      { id: 'fold', label: 'Fold', color: ACTION_COLORS.fold },
    ],
    baseEV: (st) => (st - 0.52) * 7,
    ranges: {
      '4bet':
        'AA, KK, QQ:0.7, AKs, AKo:0.6, AQs:0.3, A5s:0.5, A4s:0.4, KQs:0.2',
      call:
        'JJ-99, 88:0.7, 77:0.5, 66:0.4, 55:0.4, ' +
        'AQs, AJs, ATs:0.8, KQs, KJs:0.7, KTs:0.5, QJs, QTs:0.5, JTs, T9s, 98s, 87s:0.7, 76s:0.5, ' +
        'AQo:0.5, AJo:0.3, KQo:0.3',
    },
  },

  // ===== スクイーズ =====
  sb_squeeze: {
    id: 'sb_squeeze', group: 'スクイーズ', name: 'SB スクイーズ vs CO+BTN',
    hero: 'SB', desc: 'COオープン → BTNコール → SBのスクイーズ判断',
    actions: [
      { id: 'raise', label: 'Squeeze', color: ACTION_COLORS.raise },
      { id: 'call', label: 'Call', color: ACTION_COLORS.call },
      { id: 'fold', label: 'Fold', color: ACTION_COLORS.fold },
    ],
    baseEV: (st) => (st - 0.50) * 6,
    ranges: {
      raise:
        'TT+, 99:0.6, AKs, AKo, AQs, AQo:0.5, AJs:0.7, ATs:0.4, A5s:0.6, A4s:0.5, ' +
        'KQs:0.7, KJs:0.4, QJs:0.3, JTs:0.3, T9s:0.3, 65s:0.3, 54s:0.3',
      call:
        '22-99, ' +
        'A9s-AJs, ATs:0.5, KTs+, K9s:0.5, QTs+, JTs:0.6, T9s:0.6, 98s, 87s, 76s, 65s:0.6, ' +
        'AQo:0.4, KQo:0.5',
    },
  },
};

export const SCENARIO_LIST = Object.values(SCENARIOS);
