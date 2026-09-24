const CACHE = 'conbini-shift-v7';
const ASSETS = ['./', './index.html', './style.css', './app.js', './sync.js', './firebase-config.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // 自サイトの GET だけキャッシュ対象。Firebase（Auth / Firestore / CDN）の通信には介入しない
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
