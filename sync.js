// ========= クラウド同期（Firebase Auth + Firestore、手動同期） =========
// app.js（通常スクリプト）の後に type="module" で読み込む。
// Firebase SDK は動的 import で読むので、オフラインや未設定でも app.js 側は通常通り動く。
// app.js のグローバル関数 getAllData / normalizeAllData / applyAllData / rerenderCurrentView /
// formatWeekRange を使う。
//
// Firestore の構成:
//   stores/main              … テンプレート（employees / templateShifts / requirements）
//   stores/main/weeks/{週}   … 週データ（createdAt / shifts）。{週} は月曜日の日付 YYYY-MM-DD
// どのドキュメントにも updatedAt（サーバー時刻）と updatedBy { name, email } を付ける。
import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VER = '12.19.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;

const STORE_PATH = ['stores', 'main'];

// localStorage キー
const KEY_LAST_LOAD     = 'lastLoadAt';      // 最後にクラウドから読み込んだ時刻（ms）
const KEY_LAST_SAVE     = 'lastSaveAt';      // 最後にクラウドへ保存した時刻（ms）
const KEY_LOAD_CLOUD_MS = 'lastLoadCloudMs'; // 最後に読み込んだデータの updatedAt の最大値（新しい変更を探す起点）
const CHECK_INTERVAL_MS = 60 * 1000;         // 共有・データタブを開いたときのクラウド確認の間隔
const KEY_SYNC_STATE = 'syncState';   // ドキュメントごとの同期状態（下記）
// syncState: { template: { hash, base }, weeks: { [週]: { hash, base } } }
//   hash … 最後に同期した時点の内容のハッシュ（今の内容と違えば未保存の変更あり）
//   base … 最後に同期した時点のクラウドの updatedAt（ms。これより新しければ他の人が更新している）

const sync = {
  auth: null,
  authMod: null,
  db: null,
  fs: null,
  user: null,
  busy: false,
  cloudNewer: [],    // クラウドにある、最後に読み込んだ後の他の変更 [{ doc, ms, by }]
  lastCheckAt: 0,
};

function el(id) { return document.getElementById(id); }

function loadNum(key) {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

// 書き込みに失敗しても例外で止めない（失敗は app.js の帯で知らせる）
function saveLocal(key, str) {
  try {
    localStorage.setItem(key, str);
  } catch (e) {
    window.notifyStorageError(e);
  }
}

function loadSyncState() {
  try {
    const st = JSON.parse(localStorage.getItem(KEY_SYNC_STATE));
    if (st && typeof st === 'object') return { template: st.template || null, weeks: st.weeks || {} };
  } catch { /* 壊れていれば未同期扱い */ }
  return { template: null, weeks: {} };
}

function saveSyncState(st) {
  saveLocal(KEY_SYNC_STATE, JSON.stringify(st));
}

// ========= ローカルデータ → ドキュメント単位 =========
// キー順に依存しない JSON 文字列（ハッシュ用）
function stableStringify(v) {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

// FNV-1a 32bit + 文字列長
function hashOf(data) {
  const str = stableStringify(data);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${str.length}:${h.toString(16)}`;
}

// Firestore は undefined を受け付けないため JSON 経由で除去
function clean(v) { return JSON.parse(JSON.stringify(v)); }

// [{ kind: 'template' | 'week', id, data, hash }]
function getLocalDocs() {
  const all  = window.getAllData();
  const docs = [];
  const template = clean({
    employees:      all.employees,
    templateShifts: all.templateShifts,
    requirements:   all.requirements,
  });
  docs.push({ kind: 'template', id: 'template', data: template, hash: hashOf(template) });
  Object.entries(all.weeks).forEach(([weekKey, w]) => {
    const data = clean({ createdAt: w.createdAt ?? null, shifts: w.shifts });
    docs.push({ kind: 'week', id: weekKey, data, hash: hashOf(data) });
  });
  return docs;
}

function getEntry(st, d) {
  return d.kind === 'template' ? st.template : st.weeks[d.id];
}

function setEntry(st, d, entry) {
  if (d.kind === 'template') st.template = entry;
  else st.weeks[d.id] = entry;
}

// 最後の同期から内容が変わったドキュメント
function getDirtyDocs() {
  const st = loadSyncState();
  return getLocalDocs().filter(d => getEntry(st, d)?.hash !== d.hash);
}

function docLabel(d) {
  return d.kind === 'template' ? 'テンプレート・従業員・必要人数' : `${window.formatWeekRange(d.id)}の週`;
}

function docRef(d) {
  const { doc } = sync.fs;
  return d.kind === 'template'
    ? doc(sync.db, ...STORE_PATH)
    : doc(sync.db, ...STORE_PATH, 'weeks', d.id);
}

// ========= 表示 =========
function setStatus(text) {
  el('cloud-status').textContent = text;
}

function pad2(n) { return String(n).padStart(2, '0'); }

// ms → 「9月24日 14時05分」（今日なら日付を省略）
function formatSyncTime(ms) {
  const d   = new Date(ms);
  const now = new Date();
  const hm  = `${d.getHours()}時${pad2(d.getMinutes())}分`;
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

// ms → 「9月24日14時05分」（競合確認用。常に日付付き）
function formatUpdatedTime(ms) {
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日${d.getHours()}時${pad2(d.getMinutes())}分`;
}

// 読み込み・保存の時刻と、未保存の変更 / クラウドの新しい変更を表示
function renderLastSync() {
  const lastLoad = loadNum(KEY_LAST_LOAD);
  const lastSave = loadNum(KEY_LAST_SAVE);
  el('cloud-last-sync').textContent =
    `読み込み: ${lastLoad ? formatSyncTime(lastLoad) : 'まだ'} ・ 保存: ${lastSave ? formatSyncTime(lastSave) : 'まだ'}`;

  const status = el('cloud-sync-status');
  status.innerHTML = '';
  const line = (className, text) => {
    const div = document.createElement('div');
    div.className   = className;
    div.textContent = text;
    status.appendChild(div);
  };
  if (getDirtyDocs().length > 0) line('sync-dirty', 'この端末に、クラウドへ保存していない変更があります');
  const newer = sync.cloudNewer;
  if (newer.length > 0) {
    const latest = newer.reduce((a, b) => (b.ms > a.ms ? b : a));
    const who    = latest.by?.name || latest.by?.email || '（不明）';
    const more   = newer.length > 1 ? ` ほか${newer.length - 1}件` : '';
    line('sync-newer',
      `クラウドに新しい変更があります（${who}さん ${formatUpdatedTime(latest.ms)}・${docLabel(latest.doc)}${more}）。「更新」で読み込めます`);
  }
  // 新しい変更があるときは「更新」を目立たせる
  el('btn-cloud-load').classList.toggle('btn-primary', newer.length > 0);
  el('btn-cloud-load').classList.toggle('btn-secondary', newer.length === 0);
}

function renderAuthUI() {
  const user = sync.user;
  el('cloud-user').textContent = user
    ? `${user.displayName || user.email} でログイン中`
    : '未ログイン';
  el('btn-login').classList.toggle('hidden', !!user);
  el('btn-logout').classList.toggle('hidden', !user);
  el('cloud-sync-card').classList.toggle('hidden', !user);
  if (!user) setStatus('ログインしなくても、この端末だけで今まで通り使えます。');
  else       setStatus(user.email);
  renderLastSync();
}

function setBusy(busy) {
  sync.busy = busy;
  el('btn-cloud-save').disabled = busy;
  el('btn-cloud-load').disabled = busy;
}

function isConfigured() {
  return firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_');
}

function describeError(e) {
  if (e.code === 'permission-denied') return 'このアカウントには読み書きの権限がありません。';
  if (e.code === 'unavailable')       return 'サーバーに接続できません。通信状態を確認してください。';
  return `エラーが発生しました（${e.code || e.message}）`;
}

// Firestore の updatedAt（Timestamp）→ ms
function tsToMs(ts) {
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : null;
}

// クラウドに、最後に読み込んだ後の他の変更があるか確かめる（週は updatedAt が新しいものだけ取得）
async function checkCloudUpdates() {
  if (!sync.user || !sync.fs) return;
  const { doc, getDoc, getDocs, collection, query, where, Timestamp } = sync.fs;
  sync.lastCheckAt = Date.now();
  try {
    const since = loadNum(KEY_LOAD_CLOUD_MS) || 0;
    const [tSnap, wSnap] = await Promise.all([
      getDoc(doc(sync.db, ...STORE_PATH)),
      getDocs(query(collection(sync.db, ...STORE_PATH, 'weeks'), where('updatedAt', '>', Timestamp.fromMillis(since)))),
    ]);
    const st = loadSyncState();
    const newer = [];
    const add = (d, data) => {
      const ms = tsToMs(data.updatedAt);
      if (ms && ms > (getEntry(st, d)?.base ?? 0)) newer.push({ doc: d, ms, by: data.updatedBy });
    };
    if (tSnap.exists()) add({ kind: 'template', id: 'template' }, tSnap.data());
    wSnap.forEach(snap => add({ kind: 'week', id: snap.id }, snap.data()));
    sync.cloudNewer = newer;
  } catch (e) {
    console.warn('クラウドの確認に失敗しました:', e); // 表示は変えない（保存・更新のときに改めてエラーを出す）
  }
  renderLastSync();
}

// 共有・データタブを開いたとき（間隔を空けてクラウドも確認）
function onDataTabOpen() {
  renderLastSync();
  if (Date.now() - sync.lastCheckAt > CHECK_INTERVAL_MS) checkCloudUpdates();
}

// ========= ログイン =========
async function login() {
  const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = sync.authMod;
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(sync.auth, provider);
  } catch (e) {
    // ポップアップ不可の環境（ホーム画面から起動した PWA 等）はリダイレクトで再試行
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(sync.auth, provider);
      return;
    }
    if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return;
    alert(`ログインに失敗しました（${e.code || e.message}）`);
  }
}

async function logout() {
  await sync.authMod.signOut(sync.auth);
}

// ========= クラウドに保存（変更のあったドキュメントだけ） =========
async function saveToCloud() {
  if (!sync.user || sync.busy) return;
  const { getDoc, writeBatch, serverTimestamp } = sync.fs;

  const dirty = getDirtyDocs();
  if (dirty.length === 0) {
    alert('クラウドに保存する変更はありません。');
    return;
  }

  setBusy(true);
  try {
    // 競合チェック: 最後に同期した後にクラウド側が更新されていないか
    const st    = loadSyncState();
    const snaps = await Promise.all(dirty.map(d => getDoc(docRef(d))));
    const conflicts = [];
    snaps.forEach((snap, i) => {
      if (!snap.exists()) return;
      const cloudMs = tsToMs(snap.get('updatedAt'));
      const baseMs  = getEntry(st, dirty[i])?.base ?? 0;
      if (cloudMs && cloudMs > baseMs) {
        conflicts.push({ doc: dirty[i], ms: cloudMs, by: snap.get('updatedBy') });
      }
    });
    if (conflicts.length > 0) {
      const latest  = conflicts.reduce((a, b) => (b.ms > a.ms ? b : a));
      const who     = latest.by?.name || latest.by?.email || '（不明）';
      const targets = conflicts.map(c => docLabel(c.doc)).join('、');
      const ok = confirm(
        `${who}さんが${formatUpdatedTime(latest.ms)}に更新しています。上書きしますか?\n（対象: ${targets}）`
      );
      if (!ok) return;
    }

    const updatedBy = {
      name:  sync.user.displayName || sync.user.email,
      email: sync.user.email,
    };
    const batch = writeBatch(sync.db);
    dirty.forEach(d => batch.set(docRef(d), { ...d.data, updatedAt: serverTimestamp(), updatedBy }));
    await batch.commit();

    // サーバー側で確定した updatedAt を読み直して記録
    const after = await Promise.all(dirty.map(d => getDoc(docRef(d))));
    const st2 = loadSyncState();
    dirty.forEach((d, i) => setEntry(st2, d, { hash: d.hash, base: tsToMs(after[i].get('updatedAt')) }));
    saveSyncState(st2);
    saveLocal(KEY_LAST_SAVE, String(Date.now()));
    await checkCloudUpdates(); // 自分が保存していない部分に、他の人の新しい変更がないか
    alert(`クラウドに保存しました。\n（${dirty.map(docLabel).join('、')}）`);
  } catch (e) {
    alert(`保存に失敗しました。\n${describeError(e)}`);
  } finally {
    setBusy(false);
  }
}

// ========= 更新（クラウド → ローカルを置き換え） =========
async function loadFromCloud() {
  if (!sync.user || sync.busy) return;
  const { doc, getDoc, getDocs, collection } = sync.fs;

  setBusy(true);
  try {
    const [tSnap, wSnap] = await Promise.all([
      getDoc(doc(sync.db, ...STORE_PATH)),
      getDocs(collection(sync.db, ...STORE_PATH, 'weeks')),
    ]);
    if (!tSnap.exists()) {
      alert('クラウドにまだデータがありません。先に「クラウドに保存」をしてください。');
      return;
    }

    const t = tSnap.data();
    // 旧形式（stores/main に weeks をまとめて保存していた頃）の週データも読み込む
    const legacyWeeks = t.weeks && typeof t.weeks === 'object' && !Array.isArray(t.weeks) ? t.weeks : {};
    const weeks = { ...legacyWeeks };
    const weekBases = {};
    wSnap.forEach(snap => {
      const w = snap.data();
      weeks[snap.id] = { createdAt: w.createdAt ?? null, shifts: Array.isArray(w.shifts) ? w.shifts : [] };
      weekBases[snap.id] = tsToMs(w.updatedAt);
    });
    const data = window.normalizeAllData({
      employees:      t.employees,
      templateShifts: t.templateShifts,
      shifts:         t.shifts,          // 旧形式
      requirements:   t.requirements,
      weeks,
    });
    if (!data) {
      alert('クラウドのデータ構造が正しくありません。');
      return;
    }

    // 未保存の変更があるときだけ確認
    const dirty = getDirtyDocs();
    if (dirty.length > 0) {
      const ok = confirm(
        `この端末に、クラウドへ保存していない変更があります。\n（${dirty.map(docLabel).join('、')}）\n\n` +
        '更新すると、これらの変更は失われます。クラウドのデータで置き換えますか?'
      );
      if (!ok) return;
    }

    const templateMs = tsToMs(t.updatedAt);
    window.applyAllData(data, templateMs ? new Date(templateMs).toISOString() : undefined);

    // 読み込んだ内容を同期済みとして記録
    // 旧形式の週データ（サブコレクションにないもの）は未同期のままにし、次回の保存で weeks/{週} に移す。
    // stores/main に旧形式のフィールドが残っている場合も、次回の保存で書き直す
    const hasLegacy = Object.keys(legacyWeeks).length > 0 || Array.isArray(t.shifts);
    const st = { template: null, weeks: {} };
    getLocalDocs().forEach(d => {
      if (d.kind === 'template') {
        if (!hasLegacy) st.template = { hash: d.hash, base: templateMs };
      } else if (d.id in weekBases) {
        st.weeks[d.id] = { hash: d.hash, base: weekBases[d.id] };
      }
    });
    saveSyncState(st);
    const loadedMax = Math.max(templateMs || 0, ...Object.values(weekBases).map(ms => ms || 0));
    saveLocal(KEY_LAST_LOAD, String(Date.now()));
    saveLocal(KEY_LOAD_CLOUD_MS, String(loadedMax));
    sync.cloudNewer = [];
    renderLastSync();
    window.rerenderCurrentView();
    alert('クラウドのデータを読み込みました');
  } catch (e) {
    alert(`読み込みに失敗しました。\n${describeError(e)}`);
  } finally {
    setBusy(false);
  }
}

// ========= 初期化 =========
async function initSync() {
  el('btn-login').addEventListener('click', login);
  el('btn-logout').addEventListener('click', logout);
  el('btn-cloud-save').addEventListener('click', saveToCloud);
  el('btn-cloud-load').addEventListener('click', loadFromCloud);
  // 共有・データタブを開くたびに「未保存の変更」を更新し、クラウドの新しい変更も確かめる
  document.querySelector('.nav-btn[data-view="print"]').addEventListener('click', onDataTabOpen);
  // 以前のキー（②の単一ドキュメント時代 / 読み込みと保存を区別していなかった最終同期時刻）
  try { ['cloudBaseUpdatedAt', 'lastSyncAt'].forEach(k => localStorage.removeItem(k)); } catch { /* 保存できない環境 */ }
  renderLastSync();

  if (!isConfigured()) {
    el('btn-login').disabled = true;
    setStatus('Firebase が未設定です（firebase-config.js）。ローカルのみで動作します。');
    return;
  }

  let appMod;
  try {
    [appMod, sync.authMod, sync.fs] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
      import(`${CDN}/firebase-firestore.js`),
    ]);
  } catch {
    el('btn-login').disabled = true;
    setStatus('オフラインのためクラウド同期は使えません。ローカルのデータは通常通り使えます。');
    return;
  }

  const app = appMod.initializeApp(firebaseConfig);
  sync.auth = sync.authMod.getAuth(app);
  sync.db   = sync.fs.getFirestore(app);
  sync.authMod.getRedirectResult(sync.auth).catch(e => {
    alert(`ログインに失敗しました（${e.code || e.message}）`);
  });
  sync.authMod.onAuthStateChanged(sync.auth, user => {
    sync.user = user;
    sync.cloudNewer = [];
    renderAuthUI();
    if (user) checkCloudUpdates();
  });
}

initSync();
