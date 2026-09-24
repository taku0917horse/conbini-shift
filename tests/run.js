// テストをまとめて実行する
//   node run.js          … unit（jsdom で動くテスト）
//   node run.js browser  … browser（Chrome で動くテスト）
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const suite = process.argv[2] || 'unit';
const dir = path.join(__dirname, suite);
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();

const failed = [];
for (const file of files) {
  console.log(`\n===== ${suite}/${file} =====`);
  const r = spawnSync(process.execPath, [path.join(dir, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(file);
}

console.log(`\n===== ${suite}: ${files.length - failed.length}/${files.length} files passed =====`);
if (failed.length) {
  console.log('失敗: ' + failed.join(', '));
  process.exit(1);
}
