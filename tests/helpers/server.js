// ブラウザのテスト用の簡易サーバー（指定フォルダを配信する）
// 返り値の setDelay / setCacheControl で、通信の遅さやキャッシュ指定を途中で変えられる
const fs = require('fs');
const path = require('path');
const http = require('http');
const { ROOT } = require('./harness');

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml',
};

function startServer(root = ROOT) {
  let delayMs = 0;
  let cacheControl = 'no-cache';
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(root, p.endsWith('/') ? p + 'index.html' : p);
    setTimeout(() => {
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cacheControl });
      res.end(fs.readFileSync(file));
    }, delayMs);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        url: `http://localhost:${server.address().port}/`,
        setDelay: ms => { delayMs = ms; },
        setCacheControl: v => { cacheControl = v; },
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

module.exports = { startServer };
