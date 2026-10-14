// 本地查看指定的依赖关系 HTML；仅提供输入文件所在目录的静态资源。
const http = require('http');
const fs = require('fs');
const path = require('path');
if (!process.argv[2]) {
  console.error('用法：node tools/diagnostics/serve-dep.js <依赖关系HTML> [端口，默认8137]');
  process.exit(2);
}
const input = path.resolve(process.argv[2]);
if (!fs.statSync(input).isFile()) throw new Error('输入必须是已有 HTML 文件');
const ROOT = path.dirname(input);
const port = Number(process.argv[3] || 8137);
http.createServer((q, s) => {
  let url;
  try { url = decodeURIComponent(q.url.split('?')[0]); }
  catch (_) { s.statusCode = 400; s.end('invalid URL'); return; }
  const p = url === '/' ? input : path.resolve(ROOT, '.' + url);
  const relative = path.relative(ROOT, p);
  if (path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)) {
    s.statusCode = 403; s.end('forbidden'); return;
  }
  fs.readFile(p, (e, d) => {
    if (e) { s.statusCode = 404; s.end('not found'); return; }
    const ext = path.extname(p);
    s.setHeader('Content-Type', ext === '.html' ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8');
    s.end(d);
  });
}).listen(port, '127.0.0.1', () => console.log('dep-graph: http://127.0.0.1:' + port + '/ -> ' + input));
