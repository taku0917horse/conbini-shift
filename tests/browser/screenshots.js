// 主要な画面を幅 360px（スマホ）で撮る（見た目を目で確認するための道具）
//   node browser/screenshots.js   → tests/output/screenshots/*.png
const fs = require('fs');
const path = require('path');
const { startServer } = require('../helpers/server');
const { launchChrome } = require('../helpers/chrome');
const { loadSample } = require('../helpers/sample-data');

const OUT = path.join(__dirname, '..', 'output', 'screenshots');
fs.mkdirSync(OUT, { recursive: true });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server  = await startServer();
  const browser = await launchChrome();
  const page    = await browser.newPage();
  const errors  = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 360, height: 740, deviceScaleFactor: 2 });
  const shot = async name => { await wait(200); await page.screenshot({ path: path.join(OUT, `${name}.png`) }); console.log('撮影:', name); };

  try {
    await loadSample(page, server.url);

    // シフトタブ（今日・当欠の日・仮のある日）
    await shot('shift-today');
    await page.click('.day-tab[data-day="水"]');
    await shot('shift-absent');
    await page.click('.day-tab[data-day="金"]');
    await page.click('#btn-hour-size');
    await page.evaluate(() => { document.getElementById('shift-chart-container').scrollTop = 5 * HOUR_H; });
    await shot('shift-tentative');
    await page.click('#btn-mode-toggle');
    await shot('shift-template');
    await page.click('#btn-mode-toggle');

    // 必要人数タブ
    await page.click('.nav-btn[data-view="requirements"]');
    await shot('requirements-shortage');
    await page.click('.req-subtab[data-subtab="tentative"]');
    await shot('requirements-tentative');
    await page.click('.req-subtab[data-subtab="rules"]');
    await shot('requirements-rules');

    // 従業員タブ・週間スケジュール・勤務の入力画面
    await page.click('.nav-btn[data-view="employees"]');
    await shot('employees');
    await page.evaluate(() => openEmpWeekModal('e2')); // 夜勤（日付の列と時刻が並ぶ）
    await shot('employee-week');
    await page.click('#btn-emp-week-close');
    await page.click('#btn-add-employee');
    await shot('employee-modal');
    await page.click('#btn-emp-cancel');
    await page.click('.nav-btn[data-view="shift"]');
    await page.click('#btn-add-shift');
    await shot('shift-modal');
    await page.click('#btn-shift-cancel');

    // 共有・データタブ（手動同期のカードは表示を再現）
    await page.click('.nav-btn[data-view="print"]');
    await page.evaluate(() => {
      document.getElementById('cloud-sync-card').classList.remove('hidden');
      document.getElementById('cloud-last-sync').textContent = '読み込み: 9時05分 ・ 保存: 15時10分';
      document.getElementById('cloud-sync-status').innerHTML =
        '<div class="sync-dirty">この端末に、クラウドへ保存していない変更があります</div>' +
        '<div class="sync-newer">クラウドに新しい変更があります（Bさん 9月24日15時02分・9/21(月)〜9/27(日)の週 ほか1件）。「更新」で読み込めます</div>';
      document.querySelector('.nav-btn[data-view="print"]').classList.add('has-badge');
    });
    await shot('data-tab');

    // 分かれた勤務の結合の案内（起動時に一度だけ出る画面を再現）
    await page.evaluate(() => {
      document.getElementById('merge-count').textContent = '12';
      document.getElementById('modal-merge').classList.remove('hidden');
    });
    await shot('merge-modal');
    await page.evaluate(() => document.getElementById('modal-merge').classList.add('hidden'));

    // 保存できないときの帯
    await page.evaluate(() => notifyStorageError(new Error('screenshot')));
    await shot('storage-error');

    if (errors.length) console.log('ページのエラー:', errors);
    console.log(`\n出力: ${OUT}`);
  } finally {
    await browser.close();
    await server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
