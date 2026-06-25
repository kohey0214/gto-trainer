// app.js — エントリ。タブ切替・シナリオ一覧・Study/Trainer初期化
import { SCENARIO_LIST, SCENARIOS } from '../data/ranges.js';
import { loadScenario, setMode } from './study.js';
import { initTrainer } from './trainer.js';
import { initBuilder } from './builder.js';
import { initSolver } from './postflop.js';
import { initPlay } from './play.js';
import { renderStats } from './stats.js';
import { equity, parseCardInput, cardLabel } from './equity.js';

const $ = (id) => document.getElementById(id);
let trainerReady = false, builderReady = false, equityReady = false, solverReady = false, playReady = false;

// ---- タブ ----
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    $('view-' + view).classList.add('active');
    if (view === 'trainer' && !trainerReady) { initTrainer(); trainerReady = true; }
    if (view === 'play' && !playReady) { initPlay(); playReady = true; }
    if (view === 'builder' && !builderReady) { initBuilder(); builderReady = true; }
    if (view === 'solver' && !solverReady) { initSolver(); solverReady = true; }
    if (view === 'equity' && !equityReady) { initEquity(); equityReady = true; }
    if (view === 'stats') { renderStats(); }
  });
});

// ---- Equity Calculator ----
function initEquity() {
  $('equity-card').innerHTML = `
    <h2>エクイティ計算機</h2>
    <p class="eq-sub">2ハンドの勝率を実計算（モンテカルロ）。空欄は「ランダム」として扱います。</p>
    <div class="eq-form">
      <label>ヒーロー <input id="eq-hero" placeholder="例: AhKh" value="AhKh"></label>
      <label>相手 <input id="eq-vill" placeholder="例: QsQd（空欄=ランダム）" value="QsQd"></label>
      <label>ボード <input id="eq-board" placeholder="例: 2h7d9s（任意）"></label>
      <button class="primary" id="eq-run">計算する ▶</button>
    </div>
    <div class="eq-result" id="eq-result"></div>`;
  $('eq-run').addEventListener('click', runEquity);
  runEquity();
}

function handObj(str) {
  const cards = parseCardInput(str);
  if (cards.length === 2) return { cards };
  // ランダム = 全169ハンド均等
  const all = [];
  const R = '23456789TJQKA';
  for (let i = 0; i < 13; i++) for (let j = i; j < 13; j++) {
    all.push({ label: i === j ? R[i] + R[j] : R[j] + R[i] + 's', freq: 1 });
    if (i !== j) all.push({ label: R[j] + R[i] + 'o', freq: 1 });
  }
  return { range: all };
}

function runEquity() {
  const hero = handObj($('eq-hero').value);
  const vill = handObj($('eq-vill').value);
  const board = parseCardInput($('eq-board').value);
  const t0 = performance.now();
  const r = equity(hero, vill, board, 8000);
  const ms = (performance.now() - t0).toFixed(0);
  const bar = (label, eqv, color) => `
    <div class="eq-row">
      <div class="eq-rlabel"><span>${label}</span><b>${eqv.toFixed(2)}%</b></div>
      <div class="eq-track"><div class="eq-fill" style="width:${eqv}%;background:${color}"></div></div>
    </div>`;
  $('eq-result').innerHTML = `
    ${bar('ヒーロー エクイティ', r.equity, '#2dd4bf')}
    ${bar('相手 エクイティ', 100 - r.equity, '#d8442f')}
    <div class="eq-detail">勝ち ${r.win.toFixed(1)}% ・ 分け ${r.tie.toFixed(1)}% ・ 負け ${r.lose.toFixed(1)}%
    <span style="color:var(--muted)"> ／ 8,000回試行 ${ms}ms</span></div>`;
}

// ---- シナリオ一覧（Study） ----
function renderScenarioList() {
  const el = $('scenario-list');
  const groups = {};
  for (const s of SCENARIO_LIST) (groups[s.group] ||= []).push(s);
  let html = '';
  for (const g in groups) {
    html += `<div class="scn-group-title">${g}</div>`;
    for (const s of groups[g]) {
      html += `<div class="scn-item" data-id="${s.id}">
        ${s.name}<small>${s.hero}</small></div>`;
    }
  }
  el.innerHTML = html;
  el.querySelectorAll('.scn-item').forEach((item) => {
    item.addEventListener('click', () => {
      el.querySelectorAll('.scn-item').forEach((x) => x.classList.remove('active'));
      item.classList.add('active');
      loadScenario(SCENARIOS[item.dataset.id]);
    });
  });
  // 初期選択
  const first = el.querySelector('.scn-item');
  first.classList.add('active');
  loadScenario(SCENARIO_LIST[0]);
}

// ---- 表示モード切替 ----
$('display-toggle').querySelectorAll('button').forEach((b) => {
  b.addEventListener('click', () => {
    $('display-toggle').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    setMode(b.dataset.mode);
  });
});

// ---- About ----
$('about-card').innerHTML = `
  <h2>GTO Trainer について</h2>
  <p>本アプリは世界的ポーカー学習ツール「GTO Wizard」の中核体験を、ブラウザだけで動くオープンな形で再現したクローンです。</p>

  <h3>搭載機能</h3>
  <ul>
    <li><b>Study</b> — 13×13 ハンドマトリクスでGTO戦略を可視化。アクション頻度の色分け（あの縞模様）、レンジ全体の集計、ハンドごとの頻度・EV表示。</li>
    <li><b>実戦（リングゲーム）</b> — GTO風CPU5人との6maxリングゲーム。ルール準拠の進行（プリフロップ→フロップ→ターン→リバー）、サイドポット、リバー到達時の全公開＋各プレイヤーのアクション意図解説。あなたの各判断をGTO基準で採点し、コーチモードで推奨も表示。リバーまで見たら「次へ」を押すまで止まって復習。</li>
    <li><b>成績ダッシュボード</b> — 実戦のハンド数・収支bb・bb/100・GTO一致度を永続記録。ポジション別/ストリート別のミス率から弱点を自動診断。</li>
    <li><b>Trainer</b> — プリフロップ単発出題。あなたの選択を Best / Correct / Inaccuracy / Mistake / Blunder で採点。学習統計はブラウザに永続保存。</li>
    <li><b>Solver（ポストフロップ）</b> — フロップのスポットをブラウザ上で実際にCFR（後悔最小化）で求解。任意のボードを入力し、OOPのGTO戦略（ベット/チェック頻度）とEVを瞬時に計算。これは飾りではなく本物のソルバーです。</li>
    <li><b>Range Builder</b> — マトリクスをドラッグで塗って自分の戦略を構築 → GTOと一致度（%）を採点し、ズレの大きいハンドを指摘。</li>
    <li><b>Equity 計算機</b> — 任意の2ハンド・レンジ vs ランダムの勝率をモンテカルロで実計算（本物の7枚役評価器を搭載）。</li>
    <li><b>レンジデータ</b> — 6-max 100bb キャッシュの RFI・対オープン・対3ベット・スクイーズを混合戦略付きで収録（計10スポット）。</li>
  </ul>

  <h3>本家と「同じにできた」部分 <span class="tag-ok">✓</span></h3>
  <ul>
    <li>レンジマトリクスのUI・色分け・混合戦略表示</li>
    <li>Study の頻度／EV 表示切替、レンジ集計</li>
    <li>Trainer の採点ロジック（GTO無差別原理に基づくEV評価）</li>
  </ul>

  <h3>本家と「同じにできない」部分 <span class="tag-no">✕</span></h3>
  <ul>
    <li>GTO Wizard 最大の資産は、数十億スポットを超大規模サーバーで事前計算したソルバーDB（CFR計算の塊）です。これは個人環境では再現不可能なため、本アプリは「実測ソルバー出力に基づく近似レンジ」を手動収録しています。</li>
    <li>ポストフロップ全ボードの解、マルチウェイ9人ソルバー、カスタムソルブ、ノードロックは未搭載です。</li>
  </ul>
  <p style="margin-top:18px;color:#8aa0b6;font-size:13px">※学習・研究目的の独自実装。GTO Wizard の商標・独自アセットは使用していません。</p>
`;

renderScenarioList();
