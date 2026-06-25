// stats.js — 成績ダッシュボード（実戦の上達を可視化）
import { loadPlayStats } from './play.js';

const $ = (id) => document.getElementById(id);
const GRADE_ORDER = ['Best', 'OK', '不正確', 'ミス', '大ミス'];
const GRADE_COLOR = { 'Best': '#2dd4bf', 'OK': '#3aa655', '不正確': '#caa23a', 'ミス': '#e0792a', '大ミス': '#d8442f' };
const POS_ORDER = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const STREET_ORDER = ['preflop', 'flop', 'turn', 'river'];
const STREET_JP = { preflop: 'プリフロップ', flop: 'フロップ', turn: 'ターン', river: 'リバー' };

export function renderStats() {
  const s = loadPlayStats();
  const totalActions = GRADE_ORDER.reduce((a, g) => a + (s.grades[g] || 0), 0);
  const good = (s.grades['Best'] || 0) + (s.grades['OK'] || 0);
  const acc = totalActions ? good / totalActions * 100 : 0;
  const bbper100 = s.hands ? s.netBB / s.hands * 100 : 0;

  const gradeBars = GRADE_ORDER.map(g => {
    const n = s.grades[g] || 0; const pct = totalActions ? n / totalActions * 100 : 0;
    return `<div class="st-row">
      <div class="st-rl"><span style="color:${GRADE_COLOR[g]}">${g}</span><b>${n}（${pct.toFixed(0)}%）</b></div>
      <div class="st-track"><div class="st-fill" style="width:${pct}%;background:${GRADE_COLOR[g]}"></div></div>
    </div>`;
  }).join('');

  const weakRow = (label, d) => {
    const rate = d && d.n ? d.bad / d.n * 100 : 0;
    return `<div class="st-row">
      <div class="st-rl"><span>${label}</span><b>${d ? d.n : 0}手 ・ ミス率 ${rate.toFixed(0)}%</b></div>
      <div class="st-track"><div class="st-fill" style="width:${rate}%;background:${rate > 35 ? '#d8442f' : rate > 18 ? '#caa23a' : '#3aa655'}"></div></div>
    </div>`;
  };
  const posRows = POS_ORDER.map(p => weakRow(p, s.byPos[p])).join('');
  const streetRows = STREET_ORDER.map(st => weakRow(STREET_JP[st], s.byStreet[st])).join('');

  // 弱点の自動診断
  let advice = '実戦タブでハンドをプレイすると、ここに上達データが蓄積されます。';
  if (s.hands > 0) {
    let worstPos = null, worstRate = -1;
    POS_ORDER.forEach(p => { const d = s.byPos[p]; if (d && d.n >= 3) { const r = d.bad / d.n; if (r > worstRate) { worstRate = r; worstPos = p; } } });
    let worstSt = null, worstStRate = -1;
    STREET_ORDER.forEach(st => { const d = s.byStreet[st]; if (d && d.n >= 3) { const r = d.bad / d.n; if (r > worstStRate) { worstStRate = r; worstSt = st; } } });
    const tips = [];
    if (worstPos) tips.push(`<b>${worstPos}</b> のプレイ精度が最も低い（ミス率${(worstRate * 100).toFixed(0)}%）。Studyタブで ${worstPos} のレンジを復習しましょう`);
    if (worstSt) tips.push(`<b>${STREET_JP[worstSt]}</b> でのミスが多い。${worstSt === 'preflop' ? 'プリフロップレンジの暗記' : 'Solverタブでそのストリートの戦略を確認'}が有効`);
    advice = tips.join('<br>') || 'バランス良くプレイできています。コーチモードOFFでも好成績を狙いましょう。';
  }

  $('stats-card').innerHTML = `
    <h2>成績ダッシュボード</h2>
    <p class="st-sub">実戦タブのプレイを永続記録。GTO基準で上達を可視化します。</p>
    <div class="st-kpis">
      <div class="st-kpi"><b>${s.hands}</b><span>プレイ ハンド</span></div>
      <div class="st-kpi"><b class="${s.netBB >= 0 ? 'pos' : 'neg'}">${s.netBB >= 0 ? '+' : ''}${s.netBB.toFixed(1)}</b><span>累計収支 (bb)</span></div>
      <div class="st-kpi"><b class="${bbper100 >= 0 ? 'pos' : 'neg'}">${bbper100 >= 0 ? '+' : ''}${bbper100.toFixed(1)}</b><span>bb / 100手</span></div>
      <div class="st-kpi"><b>${acc.toFixed(1)}%</b><span>GTO一致度</span></div>
    </div>
    <div class="st-advice">💡 ${advice}</div>
    <h3>判断の質（${totalActions}アクション）</h3>${gradeBars}
    <h3>ポジション別ミス率</h3>${posRows}
    <h3>ストリート別ミス率</h3>${streetRows}
    <button class="st-reset" id="st-reset">成績をリセット</button>`;
  $('st-reset').addEventListener('click', () => {
    try { localStorage.removeItem('gto_play_stats_v1'); } catch (e) {}
    renderStats();
  });
}

export function initStats() { renderStats(); }
