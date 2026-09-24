// 印刷（時間帯別シフト表・ヘルプ募集一覧）: Chrome で実際に PDF にして、ページ数・用紙の向き・時間帯の丸めを確かめる
// PDF・プレビュー画像（カラー / グレースケール）は tests/output/print/ に残るので、見た目は目で確認できる
const fs = require('fs');
const path = require('path');
const { check, finish } = require('../helpers/harness');
const { startServer } = require('../helpers/server');
const { launchChrome } = require('../helpers/chrome');
const { loadSample } = require('../helpers/sample-data');

const OUT = path.join(__dirname, '..', 'output', 'print');
fs.mkdirSync(OUT, { recursive: true });

// [種類, 時間帯ボタン（null なら start/end を入力）, start, end, 週数, 向き, 期待するページ数]
const CASES = [
  ['shift', '日勤', null,    null,    1, 'portrait',  1],
  ['shift', '全日', null,    null,    2, 'portrait',  2], // 24時間分なので1週1ページ
  ['shift', null,   '17:10', '21:50', 3, 'portrait',  1], // 15分単位に丸め → 17:15〜21:45。3週が1枚に収まる
  ['shift', '夜勤', null,    null,    2, 'landscape', 2], // 横は1日の行 = 不足の帯5mm + 人数×6.5mm。1週約93mm なので2週は入らない
  ['shift', '全日', null,    null,    1, 'landscape', 1],
  ['help',  '全日', null,    null,    1, 'portrait',  1],
  ['help',  '全日', null,    null,    4, 'portrait',  2], // 行が多いので2ページ（4週目は未作成で注記）
  ['help',  '夕勤', null,    null,    2, 'portrait',  1],
];

// PDF のページ数と用紙サイズ（pt）
function pdfInfo(file) {
  const pdf = fs.readFileSync(file, 'latin1');
  const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) || []).length;
  const box = (pdf.match(/\/MediaBox\s*\[([^\]]+)\]/) || [])[1].trim().split(/\s+/).map(Number);
  return { pages, portrait: box[3] > box[2] };
}

(async () => {
  const server  = await startServer();
  const browser = await launchChrome();
  const page    = await browser.newPage();
  const errors  = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 400, height: 900, deviceScaleFactor: 2 });

  try {
    await loadSample(page, server.url);
    await page.click('.nav-btn[data-view="print"]');
    await page.evaluate(() => { window.print = () => {}; }); // 印刷ダイアログは開かない

    for (const [kind, preset, st, en, weeks, orient, expectPages] of CASES) {
      await page.click(`#print-kind-seg button[data-kind="${kind}"]`);
      if (preset) {
        await page.click(`#print-preset-seg button[data-preset="${preset}"]`);
      } else {
        await page.evaluate((st, en) => {
          document.getElementById('print-start').value = st;
          document.getElementById('print-end').value = en;
          document.getElementById('print-end').dispatchEvent(new Event('change'));
        }, st, en);
      }
      await page.click(`#print-weeks-seg button[data-weeks="${weeks}"]`);
      if (kind === 'shift') await page.click(`#print-orient-seg button[data-orient="${orient}"]`);
      const tag = `${kind}-${preset || `${st}-${en}`.replace(/:/g, '')}-${weeks}w-${orient}`;

      const preview = await page.$('#print-preview');
      await preview.screenshot({ path: path.join(OUT, `preview-${tag}.png`) });
      await page.evaluate(() => { document.getElementById('print-preview').style.filter = 'grayscale(1)'; });
      await preview.screenshot({ path: path.join(OUT, `gray-${tag}.png`) });
      await page.evaluate(() => { document.getElementById('print-preview').style.filter = ''; });

      const previewPages = await page.evaluate(() => document.querySelectorAll('#print-preview .sheet').length);
      await page.evaluate(() => printSheet());
      await page.emulateMediaType('print');
      const pdfPath = path.join(OUT, `print-${tag}.pdf`);
      await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
      await page.emulateMediaType('screen');

      const info = pdfInfo(pdfPath);
      check(`${tag}: ${expectPages}ページ（PDF ${info.pages} / プレビュー ${previewPages}）`,
        info.pages === expectPages && previewPages === expectPages);
      check(`${tag}: 用紙は A4 ${orient === 'portrait' ? '縦' : '横'}`, info.portrait === (kind === 'help' || orient === 'portrait'));
      if (!preset) {
        const range = await page.evaluate(() => document.getElementById('print-range-info').textContent);
        check(`${tag}: 15分単位に丸める（${range}）`, range.startsWith('17:15〜21:45'));
      }
    }
    check('ページのエラーなし', errors.length === 0);
    if (errors.length) console.log(errors);
    console.log(`\n出力: ${OUT}`);
  } finally {
    await browser.close();
    await server.close();
  }
  finish();
})().catch(e => { console.error(e); process.exit(1); });
