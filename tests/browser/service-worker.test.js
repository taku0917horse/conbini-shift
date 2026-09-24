// Service Worker（ネットワーク優先）: 更新が届くか・オフラインで起動するか・通信が遅いときに待たされないか
// アプリを一時フォルダにコピーして配信し、ファイルを書き換えながら Chrome で確かめる
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, check, finish } = require('../helpers/harness');
const { startServer } = require('../helpers/server');
const { launchChrome } = require('../helpers/chrome');

const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'conbini-shift-sw-'));
for (const f of ['index.html', 'style.css', 'app.js', 'sync.js', 'firebase-config.js', 'manifest.json', 'icon.svg', 'sw.js']) {
  fs.copyFileSync(path.join(ROOT, f), path.join(SITE, f));
}
fs.writeFileSync(path.join(SITE, 'blank.html'), '<!DOCTYPE html><title>blank</title>');

(async () => {
  const server  = await startServer(SITE);
  // ブラウザ自身のキャッシュ（GitHub Pages は10分）が切れた後の状態を想定する。
  // 10分以内はブラウザが Service Worker を通さずスクリプトを再利用することがあり、その間は古い版のままになりうる
  server.setCacheControl('no-cache');
  const browser = await launchChrome();
  const page    = await browser.newPage();
  const errors  = [];
  page.on('pageerror', e => errors.push(e.message));
  const url = server.url;

  try {
    // 0. 以前の版（キャッシュ名にバージョンを付けていた頃）のキャッシュがある状態を再現
    await page.goto(url + 'blank.html', { waitUntil: 'networkidle0' });
    await page.evaluate(async () => {
      const c = await caches.open('conbini-shift-v16');
      await c.put(new Request(location.origin + '/old-entry'), new Response('// old'));
    });
    check('以前の版のキャッシュ（v16）がある状態', (await page.evaluate(() => caches.keys())).includes('conbini-shift-v16'));

    // 1. Service Worker を入れる
    await page.goto(url, { waitUntil: 'networkidle0' });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: 'networkidle0' });
    check('Service Worker が有効', await page.evaluate(() => !!navigator.serviceWorker.controller));
    check('キャッシュ名は conbini-shift だけ（v16 は削除）',
      JSON.stringify(await page.evaluate(() => caches.keys())) === '["conbini-shift"]');
    const cached = await page.evaluate(async () =>
      (await (await caches.open('conbini-shift')).keys()).map(r => new URL(r.url).pathname));
    check('icon.svg も保存', cached.includes('/icon.svg'));

    // 2. サーバーのファイルを更新 → キャッシュ名を変えずに再読み込みだけで新しい版が届く
    fs.appendFileSync(path.join(SITE, 'app.js'), '\nwindow.__ver = 2;\n');
    const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
    fs.writeFileSync(path.join(SITE, 'index.html'), html.replace('<title>コンビニシフト管理</title>', '<title>コンビニシフト管理 v2</title>'));
    await page.reload({ waitUntil: 'networkidle0' });
    check('app.js の更新が届く', await page.evaluate(() => window.__ver === 2));
    check('index.html の更新が届く', (await page.title()) === 'コンビニシフト管理 v2');
    check('キャッシュも新しい版に更新', await page.evaluate(async () =>
      (await (await (await caches.open('conbini-shift')).match('./app.js')).text()).includes('__ver = 2')));

    // 3. オフライン → キャッシュから起動
    await page.setOfflineMode(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.day-tab').length === 7, { timeout: 10000 });
    check('オフラインでも起動（最新版）', (await page.title()) === 'コンビニシフト管理 v2'
      && await page.evaluate(() => window.__ver === 2));
    await page.setOfflineMode(false);

    // 4. 通信が遅い（5秒）→ 約3秒でキャッシュを返し、その後の読み込みも待たない
    server.setDelay(5000);
    const t0 = Date.now();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.day-tab').length === 7 && typeof renderShiftChart === 'function');
    const elapsed = Date.now() - t0;
    check(`通信が遅くても約3秒で表示（${elapsed}ms）`, elapsed < 4800);
    server.setDelay(0);

    check('ページのエラーなし', errors.length === 0);
    if (errors.length) console.log(errors);
  } finally {
    await browser.close();
    await server.close();
    fs.rmSync(SITE, { recursive: true, force: true });
  }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
