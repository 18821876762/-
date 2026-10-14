// 自检：jsdom 加载 cx-capture 钩子 → 触发 fetch → 验证事件经 GM 通道到达 capture-server 并被聚合。
// 运行：node tools/capture/selftest-hook.cjs   （或 npm run selftest:capture-hook）
// 依赖：jsdom（已在 devDependencies）。会临时拉起 capture-server 子进程，结束/异常时均会清理。
// 价值：曾据此发现 capture-server 的 --name=value 参数被解析器忽略的真实缺陷，故保留为回归守卫。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { JSDOM } = require('jsdom');

const PORT = 9611;
const BASE = 'http://127.0.0.1:' + PORT;

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(BASE + p, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => resolve(b)); }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try { const b = await get('/health'); if (JSON.parse(b).ok) return true; } catch (e) { /* retry */ }
    await sleep(150);
  }
  return false;
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, 'capture-server.js'), '--port=' + PORT, '--quiet'], { stdio: 'ignore' });
  let fail = 0;
  const assert = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };

  try {
    assert('收集端启动', await waitReady());

    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
      url: 'https://mooc1.chaoxing.com/learn/123', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const win = dom.window;

    // 桩：页面原生 fetch（返回可被 clone 的响应）
    win.fetch = function () {
      const res = {
        status: 200,
        clone: function () { return { text: function () { return Promise.resolve('{"ok":true}'); } }; }
      };
      return Promise.resolve(res);
    };
    const _origOpen = win.XMLHttpRequest.prototype.open;
    const _origSend = win.XMLHttpRequest.prototype.send;

    // jsdom 未实现 navigator.sendBeacon，先打桩以便验证钩子的包装分支
    try {
      Object.defineProperty(win.navigator, 'sendBeacon', { value: function () { return true; }, configurable: true, writable: true });
    } catch (e) { /* ignore */ }

    // 桩：GM_xmlhttpRequest → 真实转发到收集端
    win.GM_xmlhttpRequest = function (opts) {
      const body = opts.data || '';
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/ingest', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => {
        let b = ''; r.on('data', (c) => { b += c; });
        r.on('end', () => { if (opts.onload) opts.onload({ status: 200, responseText: b }); });
      });
      req.on('error', () => { if (opts.onerror) opts.onerror({}); });
      req.end(body);
    };

    // 加载钩子（UserScript 头部为注释，可直接 eval）
    const hookSrc = fs.readFileSync(path.join(__dirname, 'cx-capture.user.js'), 'utf8');
    win.eval(hookSrc);

    assert('fetch 已被包装', win.fetch.toString().indexOf('__cx') >= 0 || win.fetch.toString().indexOf('shouldCapture') >= 0);
    assert('XHR.prototype.open 已被包装', win.XMLHttpRequest.prototype.open !== _origOpen);
    assert('XHR.prototype.send 已被包装', win.XMLHttpRequest.prototype.send !== _origSend);
    assert('sendBeacon 已被包装', String(win.navigator.sendBeacon).indexOf('shouldCapture') >= 0);
    assert('WebSocket 已被替换', String(win.WebSocket).indexOf('shouldCapture') >= 0);

    // 触发一次真实 fetch（走钩子 → 缓冲 → GM 上报 → 服务端）
    await win.fetch('https://mooc1.chaoxing.com/mooc-ans/multimedia/log/a/999', { method: 'POST', body: 'playingTime=7' });
    await sleep(900); // 等待批量上报(flushMs=400)

    const stats = JSON.parse(await get('/stats'));
    assert('服务端收到上报', stats.ok && stats.total >= 1);
    const row = (stats.rows || []).find((r) => String(r.path).indexOf('multimedia/log') >= 0);
    assert('聚合出 multimedia/log 端点', !!row);
    if (row) {
      assert('方法为 POST', row.method === 'POST');
      assert('状态码 200', !!(row.status && row.status['200']));
    }
  } catch (e) {
    console.log('FAIL 异常: ' + (e && e.stack || e));
    fail++;
  } finally {
    try { srv.kill(); } catch (e) { /* ignore */ }
  }

  console.log(fail === 0 ? '结论: PASS — 浏览器钩子端到端' : '结论: ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})();
