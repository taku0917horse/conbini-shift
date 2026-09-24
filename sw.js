// アプリのファイルはネットワーク優先で返す。
// - 通信できるときはサーバーに最新版があるか確認して返し、キャッシュも更新する
//   （更新のたびにキャッシュ名を変える必要はない）
// - オフラインのときや、通信が NETWORK_TIMEOUT_MS より遅いときはキャッシュを返す
const CACHE = 'conbini-shift';
const ASSETS = ['./', './index.html', './style.css', './app.js', './sync.js', './firebase-config.js', './manifest.json', './icon.svg'];
const NETWORK_TIMEOUT_MS = 3000;

self.addEventListener('install', e => {
  // ブラウザの HTTP キャッシュを通さずに最新版を保存しておく
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // 以前のバージョン名つきキャッシュ（conbini-shift-v1〜）を削除
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // 自サイトの GET だけ扱う。Firebase（Auth / Firestore / CDN）の通信には介入しない
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(networkFirst(e.request));
});

// 通信が遅いと分かったら、しばらくはネットワークを待たずにキャッシュを返す
// （ページ本体 → CSS・スクリプト → モジュール、と段階ごとに待つと合計で何倍も遅くなるため）
const SLOW_NETWORK_HOLD_MS = 10000;
let slowUntil = 0;

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = () => cache.match(req, { ignoreSearch: true });

  // サーバーに更新を確認させる（HTTP キャッシュの古い版を使わない）。
  // ページ遷移のリクエストはそのまま作り直せないので URL から作る（リダイレクトはブラウザに任せる）
  const netReq = req.mode === 'navigate'
    ? new Request(req.url, { cache: 'no-cache', redirect: 'manual', credentials: 'same-origin' })
    : new Request(req, { cache: 'no-cache' });
  const network = fetch(netReq).then(res => {
    // リダイレクト後の応答はページ遷移で使うとエラーになるので保存しない
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  });
  network.catch(() => {}); // タイムアウトでキャッシュを返した後に失敗しても未処理エラーにしない

  // 直前に通信が遅かった: キャッシュがあればすぐ返す（取得は裏で続けてキャッシュを更新し、次回反映）
  if (Date.now() < slowUntil) {
    const hit = await cached();
    if (hit) return hit;
  }

  const timeout = new Promise(resolve => setTimeout(resolve, NETWORK_TIMEOUT_MS, null));
  try {
    const res = await Promise.race([network, timeout]);
    if (res) return res;
    // 通信が遅い: キャッシュがあればそれを返し、なければネットワークを待つ
    slowUntil = Date.now() + SLOW_NETWORK_HOLD_MS;
    return (await cached()) || network;
  } catch {
    // オフラインなど
    return (await cached()) || Response.error();
  }
}
