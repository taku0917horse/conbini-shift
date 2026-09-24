// 描画の記録・比較（リファクタリングの前後で見た目が変わっていないかを確かめる道具）
//   node browser/render-snapshot.js save before       … 今の描画を記録（tests/output/snapshots/before.json）
//   （コードを変更）
//   node browser/render-snapshot.js save after
//   node browser/render-snapshot.js compare before after  … 違う項目だけを表示
// 記録するもの: 画面のシフト表（全曜日）・不足リスト / 募集中リスト（絞り込み4種）・印刷プレビュー4種・画像保存の画像
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { startServer } = require('../helpers/server');
const { launchChrome } = require('../helpers/chrome');
const { loadSample } = require('../helpers/sample-data');

const DIR  = path.join(__dirname, '..', 'output', 'snapshots');
const DAYS = ['月', '火', '水', '木', '金', '土', '日'];

async function save(name) {
  fs.mkdirSync(DIR, { recursive: true });
  const server  = await startServer();
  const browser = await launchChrome();
  const page    = await browser.newPage();
  const out = { errors: [] };
  page.on('pageerror', e => out.errors.push(e.message));
  await page.setViewport({ width: 400, height: 900 });
  try {
    await loadSample(page, server.url);
    for (const d of DAYS) {
      await page.click(`.day-tab[data-day="${d}"]`);
      out['chart-' + d] = await page.evaluate(() => ({
        bars: [...document.querySelectorAll('#shift-lanes .shift-bar')]
          .map(b => [b.style.cssText, b.className, b.innerText.replace(/\s+/g, ' '), b.innerHTML.includes('tentative')]),
        reqs: [...document.querySelectorAll('#requirement-overlay .req-block')]
          .map(b => [b.style.cssText, b.className, b.textContent]),
      }));
    }
    await page.click('.nav-btn[data-view="requirements"]');
    for (const f of ['all', 'dawn', 'day', 'night']) {
      await page.click(`.shortage-filter-btn[data-band="${f}"]`);
      out['shortage-' + f] = await page.evaluate(() => document.getElementById('shortage-list').innerHTML);
      await page.click('.req-subtab[data-subtab="tentative"]');
      await page.click(`.tentative-filter-btn[data-band="${f}"]`);
      out['tentative-' + f] = await page.evaluate(() => document.getElementById('tentative-list').innerHTML);
      await page.click('.req-subtab[data-subtab="shortage"]');
    }
    await page.click('.nav-btn[data-view="print"]');
    const cases = [['shift', 0, 1440, 1, 'portrait'], ['shift', 360, 840, 2, 'landscape'], ['shift', 1140, 1440, 1, 'portrait'], ['help', 0, 1440, 1, 'portrait']];
    for (const [kind, s, e, w, o] of cases) {
      out[`print-${kind}-${s}-${e}-${w}w-${o}`] = await page.evaluate((kind, s, e, w, o) => {
        Object.assign(printSettings, { kind, startMin: s, endMin: e, weeks: w, orient: o });
        renderPrintPreview();
        return document.getElementById('print-preview').innerHTML.replace(/transform: scale\([^)]*\)/g, '');
      }, kind, s, e, w, o);
    }
    const png = await page.evaluate(() => generateChartCanvas().toDataURL('image/png'));
    out.canvas = crypto.createHash('sha1').update(png).digest('hex');
    fs.writeFileSync(path.join(DIR, `${name}-canvas.png`), Buffer.from(png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(out, null, 1));
    console.log(`記録しました: ${path.join(DIR, name + '.json')}（${Object.keys(out).length}項目、ページのエラー ${out.errors.length}件）`);
  } finally {
    await browser.close();
    await server.close();
  }
}

function compare(a, b) {
  const A = JSON.parse(fs.readFileSync(path.join(DIR, `${a}.json`), 'utf8'));
  const B = JSON.parse(fs.readFileSync(path.join(DIR, `${b}.json`), 'utf8'));
  let diffs = 0;
  for (const k of Object.keys(A)) {
    const x = JSON.stringify(A[k]), y = JSON.stringify(B[k]);
    if (x === y) continue;
    diffs++;
    console.log(`\n違い: ${k}`);
    if (k.startsWith('chart-')) {
      A[k].bars.forEach((bar, i) => {
        if (JSON.stringify(bar) !== JSON.stringify(B[k].bars[i])) console.log(`  前: ${JSON.stringify(bar)}\n  後: ${JSON.stringify(B[k].bars[i])}`);
      });
      if (JSON.stringify(A[k].reqs) !== JSON.stringify(B[k].reqs)) console.log('  不足の表示が違う');
    } else if (k === 'canvas') {
      console.log(`  画像が違う（${a}-canvas.png と ${b}-canvas.png を見比べてください）`);
    } else {
      let i = 0;
      while (x[i] === y[i]) i++;
      console.log(`  前: …${x.slice(Math.max(0, i - 80), i + 80)}…\n  後: …${y.slice(Math.max(0, i - 80), i + 80)}…`);
    }
  }
  console.log(diffs === 0 ? '\n違いはありません' : `\n${diffs}項目に違いがあります`);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'save' && a) save(a).catch(e => { console.error(e); process.exit(1); });
else if (cmd === 'compare' && a && b) compare(a, b);
else console.log('使い方: node browser/render-snapshot.js save <名前> / compare <名前A> <名前B>');
