// jsdom でアプリ（index.html + app.js）を動かすための共通処理
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const readRoot = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// <script> を除いた index.html（app.js などはテスト側で読み込む。Service Worker の登録もしない）
const HTML   = readRoot('index.html').replace(/<script[\s\S]*?<\/script>/g, '');
const APP_JS = readRoot('app.js');

// テストの「今」は 2026-09-24(木) 10:00 に固定（週・今日の曜日の判定を安定させるため）
const FIXED_DATE_JS = `(() => {
  const R = Date; const T = new R(2026, 8, 24, 10, 0).getTime();
  class D extends R { constructor(...a) { a.length ? super(...a) : super(T); } static now() { return T; } }
  window.Date = D;
})();`;

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}`);
  if (!cond) failures++;
}

// 結果を表示して終了（失敗があれば終了コード 1）
function finish() {
  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures ? 1 : 0);
}

function createWindow() {
  return new JSDOM(HTML, { runScripts: 'dangerously', url: 'http://localhost/' }).window;
}

// ブラウザと同じく通常のスクリプトとして実行する（関数宣言がグローバルになる）
function runScript(w, code) {
  const sc = w.document.createElement('script');
  sc.textContent = code;
  w.document.body.appendChild(sc);
}

// アプリを起動する。seed は localStorage に入れておく値（キー → 値）
// → { w: window, alerts: alert の文言, $: id → 要素 }。アプリの state は w.__state で参照できる
function boot(seed = {}) {
  const w = createWindow();
  const alerts = [];
  w.alert = m => alerts.push(m);
  w.confirm = () => true;
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, JSON.stringify(v));
  w.eval(FIXED_DATE_JS);
  runScript(w, APP_JS + '\n;window.__state = state;');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  return { w, alerts, $: id => w.document.getElementById(id) };
}

module.exports = { ROOT, HTML, APP_JS, FIXED_DATE_JS, readRoot, check, finish, createWindow, runScript, boot };
