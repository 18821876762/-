'use strict';
/*
 * 抓包收集端 —— 接收浏览器钩子 tools/capture/cx-capture.user.js 上报的请求/响应事件。
 * 零运行时依赖（仅 Node 内置 http/fs/path）。
 *
 * 用法：
 *   node tools/capture/capture-server.js [--port=9531] [--focus=<正则>] [--quiet]
 *   node tools/capture/capture-server.js --selftest        # 自检：起服务→上报→查统计→退出
 *
 * 端点：
 *   POST /ingest   接收事件（JSON 数组或单个对象），落盘 JSONL
 *   GET  /stats    聚合统计（按 method+path 分组）
 *   GET  /health   健康检查
 *   POST /clear    清空内存统计（不清空日志）
 *
 * 日志：tools/capture/logs/capture-<时间戳>.jsonl（每行一个事件）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
// 同时支持 `--name=value` 与 `--name value` 两种写法
function argOf(name, def) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--' + name) {
      const v = argv[i + 1];
      return (v && !String(v).startsWith('--')) ? v : def;
    }
    if (String(a).startsWith('--' + name + '=')) return String(a).slice(name.length + 3);
  }
  return def;
}
const PORT = parseInt(argOf('port', '9531'), 10);
const QUIET = argv.indexOf('--quiet') >= 0;
const SELFTEST = argv.indexOf('--selftest') >= 0;
const focusRaw = argOf('focus', '');
const FOCUS = focusRaw ? new RegExp(focusRaw, 'i') : null;

const LOG_DIR = path.join(__dirname, 'logs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '600'
};

// ---------------- 统计 ----------------
/** @type {Map<string,{method:string,path:string,count:number,status:Object,sumMs:number,maxMs:number,lastAt:number,sample:Object}>} */
const stats = new Map();

function pathOf(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch (e) {
    return String(url).split('?')[0];
  }
}

function kb(n) {
  const v = Number(n) || 0;
  return v >= 1024 ? (v / 1024).toFixed(1) + 'KB' : v + 'B';
}

function record(ev) {
  if (!ev || typeof ev !== 'object') return;
  const key = (ev.method || 'GET') + ' ' + pathOf(ev.url || '');
  let s = stats.get(key);
  if (!s) {
    s = { method: ev.method || 'GET', path: pathOf(ev.url || ''), count: 0, status: {}, sumMs: 0, maxMs: 0, lastAt: 0, sample: null };
    stats.set(key, s);
  }
  s.count++;
  const st = String(ev.status || 0);
  s.status[st] = (s.status[st] || 0) + 1;
  const ms = Number(ev.ms) || 0;
  s.sumMs += ms;
  if (ms > s.maxMs) s.maxMs = ms;
  s.lastAt = Date.now();
  if (!s.sample) s.sample = ev;

  if (!QUIET) {
    const hit = !FOCUS || FOCUS.test(String(ev.url || ''));
    if (hit) {
      const size = ((ev.resBody || '').length) + ((ev.reqBody || '').length);
      console.log(
        '[' + (ev.kind || '?') + '] ' + st + ' ' + s.method + ' ' + String(ev.url || '').slice(0, 140) +
        '  (' + ms + 'ms, ' + kb(size) + ')' + (ev.error ? ' ERR=' + ev.error : '')
      );
    }
  }
}

// ---------------- 落盘 ----------------
let logStream = null;
let logPath = '';

function openLog() {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch (e) {
    console.error('[capture] 无法创建日志目录: ' + e.message);
    return;
  }
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  logPath = path.join(LOG_DIR, 'capture-' + stamp + '.jsonl');
  try {
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    console.log('[capture] 日志 → ' + logPath);
  } catch (e) {
    console.error('[capture] 无法打开日志文件: ' + e.message);
  }
}

function persist(ev) {
  if (!logStream) return;
  try {
    logStream.write(JSON.stringify(ev) + '\n');
  } catch (e) { /* 忽略落盘失败，不影响抓包 */ }
}

// ---------------- HTTP ----------------
const MAX_BODY = 32 * 1024 * 1024; // 32MB

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  req.on('error', (e) => cb(e, ''));
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }, CORS));
  res.end(body);
}

function ingest(events) {
  const list = Array.isArray(events) ? events : [events];
  let n = 0;
  for (const ev of list) { if (ev && typeof ev === 'object') { record(ev); persist(ev); n++; } }
  return n;
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }

  if (req.method === 'POST' && url === '/ingest') {
    return readBody(req, (err, raw) => {
      if (err || !raw) return sendJSON(res, 400, { ok: false, error: 'bad body' });
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch (e) { return sendJSON(res, 400, { ok: false, error: 'invalid json' }); }
      const n = ingest(parsed);
      return sendJSON(res, 200, { ok: true, accepted: n });
    });
  }

  if (req.method === 'GET' && url === '/stats') {
    const rows = Array.from(stats.values()).map((s) => ({
      method: s.method,
      path: s.path,
      count: s.count,
      status: s.status,
      avgMs: s.count ? Math.round(s.sumMs / s.count) : 0,
      maxMs: s.maxMs,
      lastAt: s.lastAt
    })).sort((a, b) => b.count - a.count);
    return sendJSON(res, 200, { ok: true, total: rows.reduce((a, r) => a + r.count, 0), rows: rows });
  }

  if (req.method === 'GET' && url === '/health') {
    return sendJSON(res, 200, { ok: true, port: PORT, log: logPath });
  }

  if (req.method === 'POST' && url === '/clear') {
    stats.clear();
    return sendJSON(res, 200, { ok: true, cleared: true });
  }

  return sendJSON(res, 404, { ok: false, error: 'not found' });
});

// ---------------- 启动 ----------------
function start(port, onReady) {
  openLog();
  server.listen(port, '127.0.0.1', () => {
    console.log('[capture] 收集端已启动 → http://127.0.0.1:' + port);
    console.log('[capture] 请在浏览器中启用 cx-capture.user.js（@run-at document-start）');
    if (onReady) onReady();
  });
  server.on('error', (e) => {
    console.error('[capture] 监听失败: ' + e.message);
    process.exit(1);
  });
}

function shutdown(code) {
  try { if (logStream) logStream.end(); } catch (e) { /* ignore */ }
  try { server.close(); } catch (e) { /* ignore */ }
  if (typeof code === 'number') process.exit(code);
}

process.on('SIGINT', () => { console.log('\n[capture] 收到 SIGINT，正在收尾…'); shutdown(0); });

// ---------------- 自检 ----------------
if (SELFTEST) {
  const testPort = 9531 + Math.floor(Math.random() * 500);
  start(testPort, () => {
    const payload = JSON.stringify([
      { kind: 'xhr', url: 'https://mooc1.chaoxing.com/ananas/status/123?k=1', method: 'GET', status: 200, ms: 42, reqBody: null, resBody: '{"ok":true}', frame: 'https://mooc1.chaoxing.com/learn/x' },
      { kind: 'fetch', url: 'https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/456', method: 'POST', status: 200, ms: 88, reqBody: 'playingTime=12', resBody: '{"result":1}', frame: 'https://mooc1.chaoxing.com/learn/x' }
    ]);
    const req = http.request({ host: '127.0.0.1', port: testPort, path: '/ingest', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (r) => {
      let b = '';
      r.on('data', (c) => { b += c; });
      r.on('end', () => {
        let ok1 = false;
        try { ok1 = JSON.parse(b).accepted === 2; } catch (e) { /* ignore */ }
        http.get({ host: '127.0.0.1', port: testPort, path: '/stats' }, (r2) => {
          let b2 = '';
          r2.on('data', (c) => { b2 += c; });
          r2.on('end', () => {
            let ok2 = false;
            try { const j = JSON.parse(b2); ok2 = j.ok && j.total === 2 && j.rows.length === 2; } catch (e) { /* ignore */ }
            console.log(ok1 ? 'PASS 上报 /ingest 接收 2 条' : 'FAIL /ingest');
            console.log(ok2 ? 'PASS /stats 聚合正确（2 条 / 2 个端点）' : 'FAIL /stats');
            const logged = logPath && fs.existsSync(logPath) && fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).length === 2;
            console.log(logged ? 'PASS JSONL 落盘 2 行' : 'FAIL JSONL 落盘');
            shutdown(ok1 && ok2 && logged ? 0 : 1);
          });
        }).on('error', (e) => { console.error('FAIL /stats 请求: ' + e.message); shutdown(1); });
      });
    });
    req.on('error', (e) => { console.error('FAIL /ingest 请求: ' + e.message); shutdown(1); });
    req.end(payload);
  });
} else {
  start(PORT);
}
