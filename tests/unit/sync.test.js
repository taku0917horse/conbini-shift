// クラウド同期（sync.js）: 偽の Firebase（メモリ上）で2〜3台の端末を動かし、保存・更新・競合・表示を確かめる
const { check, finish, readRoot, createWindow, runScript, APP_JS, FIXED_DATE_JS } = require('../helpers/harness');

// ES モジュールを通常スクリプトとして動かすため、import を偽の Firebase に差し替える
const syncJs = readRoot('sync.js')
  .replace(/^import \{ firebaseConfig \}.*$/m, "const firebaseConfig = { apiKey: 'test' };")
  .replace(/import\(`\$\{CDN\}\/firebase-(\w+)\.js`\)/g, 'Promise.resolve(window.__mock.$1)');

// ---- 偽 Firestore（全端末で共有） ----
const cloud = new Map(); // path -> data
let getDocsCalls = 0;
let clock = 1_000_000;
const SERVER_TS = { __serverTs: true };
const ts = ms => ({ toMillis: () => ms });
function snapOf(p) {
  const data = cloud.get(p);
  return {
    id: p.split('/').pop(),
    exists: () => data !== undefined,
    data: () => (data ? JSON.parse(JSON.stringify(data, (k, v) => v)) : undefined) && revive(data),
    get: f => data && revive(data)[f],
  };
}
function revive(d) { return { ...d, updatedAt: d.updatedAt != null ? ts(d.updatedAt) : undefined }; }
const firestoreMock = {
  getFirestore: () => ({}),
  doc: (db, ...segs) => ({ path: segs.join('/') }),
  collection: (db, ...segs) => ({ path: segs.join('/') }),
  query: (col, cond) => ({ path: col.path, cond }),
  where: (field, op, val) => ({ field, op, val }),
  Timestamp: { fromMillis: ms => ts(ms) },
  getDoc: async ref => snapOf(ref.path),
  getDocs: async col => {
    getDocsCalls++;
    const since = col.cond ? col.cond.val.toMillis() : -Infinity; // where('updatedAt', '>', ts)
    const docs = [...cloud.keys()]
      .filter(p => p.startsWith(col.path + '/') && !p.slice(col.path.length + 1).includes('/'))
      .filter(p => (cloud.get(p).updatedAt ?? 0) > since)
      .map(snapOf);
    return { empty: docs.length === 0, forEach: fn => docs.forEach(fn) };
  },
  serverTimestamp: () => SERVER_TS,
  writeBatch: () => {
    const ops = [];
    return {
      set: (ref, data) => ops.push([ref.path, data]),
      commit: async () => {
        clock += 1000;
        ops.forEach(([p, data]) => {
          const d = JSON.parse(JSON.stringify(data));
          d.updatedAt = clock;
          cloud.set(p, d);
        });
      },
    };
  },
};

function boot(seed, user) {
  const w = createWindow();
  const log = { alerts: [], confirms: [] };
  w.alert = m => log.alerts.push(m);
  w.__confirmAnswer = true;
  w.confirm = m => { log.confirms.push(m); return w.__confirmAnswer; };
  for (const [k, v] of Object.entries(seed)) w.localStorage.setItem(k, JSON.stringify(v));
  w.eval(FIXED_DATE_JS);
  w.__mock = {
    app: { initializeApp: () => ({}) },
    auth: {
      getAuth: () => ({}),
      getRedirectResult: async () => null,
      onAuthStateChanged: (a, cb) => cb(user),
      GoogleAuthProvider: class { setCustomParameters() {} },
    },
    firestore: firestoreMock,
  };
  runScript(w, APP_JS + '\n;window.__state = state;');
  runScript(w, syncJs);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const $ = id => w.document.getElementById(id);
  const click = async id => { $(id).click(); await new Promise(r => setTimeout(r, 20)); };
  return { w, $, log, click, st: () => w.__state };
}
const tick = () => new Promise(r => setTimeout(r, 20));

(async () => {
  const emp = { id: 'e1', name: '田中', color: '#2563eb', category: '日勤' };
  const seedA = {
    employees: [emp],
    templateShifts: [{ id: 't1', empId: 'e1', day: '月', startMin: 360, endMin: 840, breakMin: 0 }],
    weeks: { '2026-09-21': { createdAt: 'x', shifts: [{ id: 'w1', empId: 'e1', day: '月', startMin: 360, endMin: 840, breakMin: 0, absent: false }] } },
    requirements: [],
  };
  const userA = { displayName: 'A', email: 'a@example.com' };
  const userB = { displayName: 'B', email: 'b@example.com' };

  // ---- 1. 端末Aで初回保存 ----
  const A = boot(seedA, userA);
  await tick();
  check('ログイン時に手動同期カード表示', !A.$('cloud-sync-card').classList.contains('hidden'));
  check('初回は未保存の変更あり表示', A.$('cloud-sync-status').textContent.includes('保存していない変更'));
  check('初回の時刻表示', A.$('cloud-last-sync').textContent === '読み込み: まだ ・ 保存: まだ');
  check('未保存の変更があればナビに赤い点', A.w.document.querySelector('.nav-btn[data-view="print"]').classList.contains('has-badge'));
  await A.click('btn-cloud-save');
  check('初回保存で確認なし', A.log.confirms.length === 0);
  check('stores/main に保存', cloud.has('stores/main') && cloud.get('stores/main').templateShifts.length === 1);
  check('stores/main に weeks を含めない', !('weeks' in cloud.get('stores/main')));
  check('weeks/{週} に保存', cloud.has('stores/main/weeks/2026-09-21'));
  check('updatedBy 記録', cloud.get('stores/main').updatedBy.email === 'a@example.com');
  check('保存後は未保存表示なし', !A.$('cloud-sync-status').textContent.includes('保存していない変更'));
  check('保存の時刻だけ更新', A.$('cloud-last-sync').textContent === '読み込み: まだ ・ 保存: 10時00分');
  check('自分の保存は新しい変更として出ない', !A.$('cloud-sync-status').textContent.includes('クラウドに新しい変更'));
  check('保存後は赤い点が消える', !A.w.document.querySelector('.nav-btn[data-view="print"]').classList.contains('has-badge'));
  // 編集すると（0.3秒後に）赤い点が出る
  A.st().templateShifts[0].breakMin = 15;
  A.w.saveShifts();
  await new Promise(r => setTimeout(r, 400));
  check('編集すると赤い点が出る', A.w.document.querySelector('.nav-btn[data-view="print"]').classList.contains('has-badge'));
  A.st().templateShifts[0].breakMin = 0;
  A.w.saveShifts();
  await new Promise(r => setTimeout(r, 400));
  check('元に戻すと赤い点が消える', !A.w.document.querySelector('.nav-btn[data-view="print"]').classList.contains('has-badge'));

  // ---- 2. 変更なしで保存 ----
  const writesBefore = clock;
  await A.click('btn-cloud-save');
  check('変更なしなら書き込まない', clock === writesBefore && A.log.alerts.at(-1).includes('変更はありません'));

  // ---- 3. 端末B（別データあり）で更新 → 未保存の確認 ----
  const B = boot({ employees: [], templateShifts: [], weeks: {}, requirements: [] }, userB);
  await tick();
  await B.click('btn-cloud-load');
  // B のローカルは空テンプレート（未同期）なので確認が出る
  check('Bは未保存扱いで確認あり', B.log.confirms.length === 1 && B.log.confirms[0].includes('保存していない変更'));
  check('Bにデータが入る', B.st().templateShifts.length === 1 && B.st().weeks['2026-09-21'].shifts.length === 1);
  check('B更新後は未保存なし', !B.$('cloud-sync-status').textContent.includes('保存していない変更'));
  check('B 読み込みの時刻', B.$('cloud-last-sync').textContent === '読み込み: 10時00分 ・ 保存: まだ');

  // ---- 4. 未保存の変更がなければ更新時に確認なし ----
  await B.click('btn-cloud-load');
  check('未保存なしなら確認なし', B.log.confirms.length === 1);

  // ---- 5. Bが週を編集して保存（競合なし） ----
  B.st().weeks['2026-09-21'].shifts[0].absent = true;
  B.w.saveShifts();
  await B.click('btn-cloud-save');
  check('Bの保存は確認なし', B.log.confirms.length === 1);
  check('週だけ書き込み', cloud.get('stores/main/weeks/2026-09-21').updatedBy.email === 'b@example.com'
    && cloud.get('stores/main').updatedBy.email === 'a@example.com');

  // ---- 6. Aが同じ週を編集して保存 → 競合確認（キャンセル） ----
  A.st().weeks['2026-09-21'].shifts[0].breakMin = 60;
  A.w.saveShifts();
  A.w.__confirmAnswer = false;
  await A.click('btn-cloud-save');
  const msg = A.log.confirms.at(-1) || '';
  check('競合確認メッセージ', /^Bさんが\d+月\d+日\d+時\d{2}分に更新しています。上書きしますか\?/.test(msg));
  check('対象の週を表示', msg.includes('9/21(月)〜9/27(日)の週'));
  check('キャンセルなら書き込まない', cloud.get('stores/main/weeks/2026-09-21').shifts[0].absent === true);

  // ---- 7. 別の週・テンプレートだけの変更は競合しない ----
  A.w.__confirmAnswer = true;
  // A の週の変更を元に戻し、テンプレートだけ変更
  A.st().weeks['2026-09-21'].shifts[0].breakMin = 0;
  A.st().templateShifts[0].breakMin = 45;
  A.w.saveShifts();
  const nConf = A.log.confirms.length;
  await A.click('btn-cloud-save');
  check('テンプレートのみ保存で確認なし', A.log.confirms.length === nConf);
  check('週はBの内容のまま', cloud.get('stores/main/weeks/2026-09-21').shifts[0].absent === true);
  check('テンプレートはAの内容', cloud.get('stores/main').templateShifts[0].breakMin === 45);
  // A はテンプレートだけ保存したが、Bが先に週を更新している → 保存後に「クラウドに新しい変更」
  check('保存後に他の人の変更を表示', A.$('cloud-sync-status').textContent.includes('クラウドに新しい変更があります（Bさん')
    && A.$('cloud-sync-status').textContent.includes('9/21(月)〜9/27(日)の週'));
  check('「更新」を目立たせる', A.$('btn-cloud-load').classList.contains('btn-primary'));

  // ---- 8. 競合を承認して上書き ----
  A.st().weeks['2026-09-21'].shifts[0].breakMin = 30;
  A.w.saveShifts();
  await A.click('btn-cloud-save');
  check('承認で上書き', cloud.get('stores/main/weeks/2026-09-21').shifts[0].breakMin === 30
    && cloud.get('stores/main/weeks/2026-09-21').updatedBy.email === 'a@example.com');

  // ---- 8b. B が共有・データタブを開くと、A の新しい変更（週とテンプレート）が出る ----
  check('B はまだ知らない', !B.$('cloud-sync-status').textContent.includes('クラウドに新しい変更'));
  B.w.eval('sync.lastCheckAt = 0');
  B.w.document.querySelector('.nav-btn[data-view="print"]').click();
  await tick();
  check('他の人の新しい変更でも赤い点', B.w.document.querySelector('.nav-btn[data-view="print"]').classList.contains('has-badge'));
  check('タブを開くと A の変更を表示', B.$('cloud-sync-status').textContent.includes('クラウドに新しい変更があります（Aさん')
    && B.$('cloud-sync-status').textContent.includes('ほか1件'));
  const callsBefore = getDocsCalls;
  B.w.document.querySelector('.nav-btn[data-view="shift"]').click();
  B.w.document.querySelector('.nav-btn[data-view="print"]').click();
  await tick();
  check('1分以内は確認し直さない', getDocsCalls === callsBefore);
  await B.click('btn-cloud-load');
  check('更新で読み込むと表示が消える', !B.$('cloud-sync-status').textContent.includes('クラウドに新しい変更')
    && B.$('btn-cloud-load').classList.contains('btn-secondary')
    && B.st().weeks['2026-09-21'].shifts[0].breakMin === 30);
  // 読み込み後は、それより前の更新を新しい変更として拾わない
  B.w.eval('sync.lastCheckAt = 0');
  B.w.document.querySelector('.nav-btn[data-view="print"]').click();
  await tick();
  check('読み込み後は赤い点なし', !B.w.document.querySelector('.nav-btn[data-view="print"]').classList.contains('has-badge'));
  check('読み込み後は新しい変更なし', !B.$('cloud-sync-status').textContent.includes('クラウドに新しい変更'));

  // ---- 9. 旧形式（②: stores/main に weeks をまとめて保存）からの移行 ----
  cloud.clear();
  cloud.set('stores/main', {
    employees: [emp], shifts: [{ id: 'o1', empId: 'e1', day: '火', startMin: 0, endMin: 180, breakMin: 0 }],
    requirements: [], updatedAt: 5, updatedBy: { name: 'A', email: 'a@example.com' },
  });
  cloud.get('stores/main').weeks = { '2026-09-14': { createdAt: 'y', shifts: [] } };
  const C = boot({ employees: [], templateShifts: [], weeks: {}, requirements: [] }, userA);
  await tick();
  await C.click('btn-cloud-load');
  check('旧形式のテンプレートを読み込み', C.st().templateShifts[0].id === 'o1');
  check('旧形式の週を読み込み', '2026-09-14' in C.st().weeks);
  check('旧形式は未保存扱い', C.$('cloud-sync-status').textContent.includes('保存していない変更'));
  await C.click('btn-cloud-save');
  check('移行保存で weeks/{週} 作成', cloud.has('stores/main/weeks/2026-09-14'));
  check('stores/main から旧フィールド削除', !('weeks' in cloud.get('stores/main')) && !('shifts' in cloud.get('stores/main')));

  const D = boot({ employees: [emp], templateShifts: [], weeks: {}, requirements: [] }, null);
  await tick();
  check('未ログインでは赤い点を出さない', !D.w.document.querySelector('.nav-btn[data-view="print"]').classList.contains('has-badge'));

  finish();
})();
