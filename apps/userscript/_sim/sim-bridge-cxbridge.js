'use strict';
/*
 * 回归：修复⑧ bridge ?cxbridge= 未限制回环 → SSRF 来源面收窄(仅接受 127.0.0.1/localhost/[::1])
 * 行为校验：构造不同 ?cxbridge= 的页面 URL，驱动 bridgeInit → resolveBridgeBase → bridgeFetch 发往 base；
 * 用桩 window.fetch 捕获真实请求 URL，断言：
 *   - 恶意远程主机：绝不发往攻击主机，且回退到默认回环 127.0.0.1:7531（SSRF 阻断但仍可用）；
 *   - 回环 IPv4+端口 / 纯端口 / 裸回环主机：均被正确接受。
 * 注：URL 查询串使用原始值（不 encode），否则 & 被吞导致 courseId/chapterId 解析失败、桥不发起请求。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PRODUCT = require('../scripts/project-paths.cjs').personalProduct;
if (!fs.existsSync(PRODUCT)) { console.error('FAIL: 产物不存在', PRODUCT); process.exit(1); }
const code = fs.readFileSync(PRODUCT, 'utf8');

function runCase(cxbridge) {
  // 原始查询串：&courseId/&chapterId 必须保持为独立参数，供 bridgeInit 读取
  const url = 'https://study.chaoxing.com/x/?cxbridge=' + cxbridge + '&courseId=1&chapterId=2';
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', url: url });
  const win = dom.window;
  if (typeof win.GM_setValue !== 'function') win.GM_setValue = function () {};
  if (typeof win.GM_getValue !== 'function') win.GM_getValue = function (k, d) { return d; };
  const captured = [];
  win.fetch = function (u) { captured.push(String(u)); return Promise.resolve({ ok: false, json: function () { return Promise.resolve(null); } }); };
  win.eval(code);
  const ns = win.__CX_FORCE_PLAY;
  if (ns && ns.toolkit && ns.toolkit.bridge && typeof ns.toolkit.bridge.bridgeInit === 'function') {
    ns.toolkit.bridge.bridgeInit();
  }
  return captured;
}

let ok = true;
function assert(c, m) { if (!c) { console.error('FAIL:', m); ok = false; } }

// 恶意远程主机：必须被拒绝（请求绝不发往攻击主机，且回退到默认回环 127.0.0.1:7531）
const evil = runCase('http://attacker.example.com');
assert(!evil.some(function (u) { return u.indexOf('attacker.example.com') !== -1; }), '恶意主机 attacker.example.com 出现在请求 URL（修复⑧ 回环收窄失效）');
assert(evil.some(function (u) { return u.indexOf('127.0.0.1:7531') !== -1; }), '恶意主机未回退到默认回环 127.0.0.1:7531（修复⑧ 拒绝路径未生效）');
assert(evil.every(function (u) { return /127\.0\.0\.1/.test(u); }), '恶意主机用例出现非回环请求（SSRF 面未收窄）');

// 回环 IPv4+端口：必须被接受
const loop = runCase('http://127.0.0.1:9999');
assert(loop.some(function (u) { return u.indexOf('127.0.0.1:9999') !== -1; }), '回环地址 127.0.0.1:9999 未被接受（修复⑧ 误杀合法回环）');

// 纯端口(回环兜底)：?cxbridge=9999 → http://127.0.0.1:9999
const portOnly = runCase('9999');
assert(portOnly.some(function (u) { return u.indexOf('127.0.0.1:9999') !== -1; }), '纯端口 9999 未兜底为回环 127.0.0.1:9999（修复⑧ 端口分支失效）');

// 裸回环主机(无协议)：127.0.0.1:7777 → http://127.0.0.1:7777
const bare = runCase('127.0.0.1:7777');
assert(bare.some(function (u) { return u.indexOf('127.0.0.1:7777') !== -1; }), '裸回环 127.0.0.1:7777 未被接受（修复⑧ 裸主机分支失效）');

console.log(ok ? 'PASS sim-bridge-cxbridge (修复⑧)' : 'FAIL sim-bridge-cxbridge (修复⑧)');
process.exit(ok ? 0 : 1);
