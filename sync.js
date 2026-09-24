// ========= クラウド同期（Firebase Auth + Firestore、手動同期） =========
// app.js（通常スクリプト）の後に type="module" で読み込む。
// Firebase SDK は動的 import で読むので、オフラインや未設定でも app.js 側は通常通り動く。
// app.js のグローバル関数 getAllData / isValidAllData / applyAllData / rerenderCurrentView を使う。
import { firebaseConfig } from './firebase-config.js';

const FIREBASE_VER = '12.19.0';
const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VER}`;

// Firestore 上の保存先（1ドキュメントに全データ）
const DOC_PATH = ['stores', 'main'];

// localStorage キー
const KEY_LAST_SYNC  = 'lastSyncAt';          // 最後に保存 or 更新した時刻（ms）
const KEY_CLOUD_BASE = 'cloudBaseUpdatedAt';  // 最後に同期した時点のクラウド updatedAt（ms）

const sync = {
  auth: null,
  authMod: null,
  db: null,
  fs: null,
  user: null,
  busy: false,
};

function el(id) { return document.getElementById(id); }

function loadNum(key) {
  const v = Number(localStorage.getItem(key));
  return Number.isFinite(v) && v > 0 ? v : null;
}

function setStatus(text) {
  el('cloud-status').textContent = text;
}

// ms → 「9月24日 14時05分」（今日なら日付を省略）
function formatSyncTime(ms) {
  const d   = new Date(ms);
  const now = new Date();
  const hm  = `${d.getHours()}時${String(d.getMinutes()).padStart(2, '0')}分`;
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? hm : `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
}

function renderLastSync() {
  const last = loadNum(KEY_LAST_SYNC);
  el('cloud-last-sync').textContent = last
    ? `最終同期: ${formatSyncTime(last)}`
    : '最終同期: まだ同期していません';
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

// 同期成功時の記録
function markSynced(cloudUpdatedMs) {
  localStorage.setItem(KEY_LAST_SYNC, String(Date.now()));
  if (cloudUpdatedMs) localStorage.setItem(KEY_CLOUD_BASE, String(cloudUpdatedMs));
  renderLastSync();
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

// ========= クラウドに保存 =========
async function saveToCloud() {
  if (!sync.user || sync.busy) return;
  const { doc, getDoc, setDoc, serverTimestamp } = sync.fs;
  const ref = doc(sync.db, ...DOC_PATH);

  setBusy(true);
  try {
    // Firestore は undefined を受け付けないため JSON 経由で除去
    const data = JSON.parse(JSON.stringify(window.getAllData()));
    await setDoc(ref, {
      ...data,
      updatedAt: serverTimestamp(),
      updatedBy: {
        name:  sync.user.displayName || sync.user.email,
        email: sync.user.email,
      },
    });
    // サーバー側で確定した updatedAt を読み直して記録
    const snap = await getDoc(ref);
    const updatedMs = tsToMs(snap.get('updatedAt'));
    if (updatedMs) localStorage.setItem('currentDataDate', JSON.stringify(new Date(updatedMs).toISOString()));
    markSynced(updatedMs);
    alert('クラウドに保存しました');
  } catch (e) {
    alert(`保存に失敗しました。\n${describeError(e)}`);
  } finally {
    setBusy(false);
  }
}

// ========= 更新（クラウド → ローカル） =========
async function loadFromCloud() {
  if (!sync.user || sync.busy) return;
  const { doc, getDoc } = sync.fs;
  const ref = doc(sync.db, ...DOC_PATH);

  setBusy(true);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      alert('クラウドにまだデータがありません。先に「クラウドに保存」をしてください。');
      return;
    }
    const cloud = snap.data();
    const data  = {
      employees:    cloud.employees,
      shifts:       cloud.shifts,
      requirements: cloud.requirements,
    };
    if (!window.isValidAllData(data)) {
      alert('クラウドのデータ構造が正しくありません。');
      return;
    }

    const updatedMs = tsToMs(cloud.updatedAt);
    const who  = cloud.updatedBy?.name || cloud.updatedBy?.email || '（不明）';
    const when = updatedMs ? formatSyncTime(updatedMs) : '（不明）';
    // ③で「未保存の変更がある場合のみ確認」に置き換える予定
    const ok = confirm(
      `クラウドのデータ（${who}さんが${when}に更新）で、この端末のデータを置き換えます。よろしいですか?`
    );
    if (!ok) return;

    window.applyAllData(data, updatedMs ? new Date(updatedMs).toISOString() : undefined);
    markSynced(updatedMs);
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
    renderAuthUI();
  });
}

initSync();
