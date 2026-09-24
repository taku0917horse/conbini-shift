// ブラウザのテストで使う Chrome（または Edge / Chromium）を探して起動する
// 見つからないときは環境変数 CHROME_PATH に実行ファイルのパスを指定する
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  const found = CANDIDATES.find(p => p && fs.existsSync(p));
  if (!found) throw new Error('Chrome が見つかりません。環境変数 CHROME_PATH に実行ファイルのパスを指定してください。');
  return found;
}

// プロファイルは puppeteer の既定（短い一時フォルダ）に任せる。
// 深いフォルダを指定すると Windows のパス長の上限で Cache Storage が使えなくなることがある
function launchChrome(options = {}) {
  return puppeteer.launch({ executablePath: findChrome(), headless: true, protocolTimeout: 30000, ...options });
}

module.exports = { findChrome, launchChrome };
