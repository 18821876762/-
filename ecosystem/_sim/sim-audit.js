// 安全审计回归（建议#10）：验证 buildInvasionReport 在「接管态」正确标记侵入点，
// 在 uninstall() 后正确反映「已还原」。覆盖原型包装 / 全局符号 / mediaSession 接管 / 卸载钩子 四类关键侵入面。
//
// 与 sim-mediasession.js 同源：在 jsdom 中加载完整产物并模拟 navigator.mediaSession，
// 让初始扫描接管 <video>，触发 _ovEnforce → mediaSession 保存+劫持，再 uninstall() 还原。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}

const artifact = fs.readFileSync(path.join(__dirname, '..', 'chaoxing-force-play.user.js'), 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><video id="v1"></video></body></html>', {
  runScripts: 'outside-only',
  url: 'https://example.com/',
  pretendToBeVisual: true,
});
const { window } = dom;

// 模拟「注入前」站点自有的 mediaSession：pause action 已注册一个原生 handler（SENTINEL）。
const SENTINEL = function __cxSitePauseHandler() {};
const msCalls = [];
const ms = {
  _pause: SENTINEL,
  _state: 'none',
  getActionHandler(action) { return action === 'pause' ? this._pause : null; },
  setActionHandler(action, handler) {
    msCalls.push({ action: action, handler: handler });
    if (action === 'pause') this._pause = handler;
  },
  get playbackState() { return this._state; },
  set playbackState(v) { this._state = v; msCalls.push({ action: 'playbackState', handler: v }); },
};
try {
  Object.defineProperty(window.navigator, 'mediaSession', { value: ms, configurable: true });
} catch (e) {
  console.log('SKIP — 无法在 jsdom 注入 mediaSession 模拟:', e.message);
  console.log('结论: SKIP');
  process.exit(0);
}

const ctx = dom.getInternalVMContext();
let injected = false;
try {
  vm.runInContext(artifact, ctx, { filename: 'artifact.user.js' });
  injected = !!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.buildInvasionReport === 'function');
} catch (e) {
  console.log('INJECT_NOTE — 产物在 jsdom 注入阶段异常:', e.message);
}

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

assert('命名空间与审计 API 已安装', injected);
if (injected) {
  const bir = window.__CX_FORCE_PLAY.buildInvasionReport;   // 先捕获引用，避免 uninstall 删除命名空间后无法调用
  function find(rows, area) { for (var i = 0; i < rows.length; i++) if (rows[i].area === area) return rows[i]; return null; }

  // —— 接管态 ——
  const r1 = bir();
  assert('返回结构化清单数组', Array.isArray(r1) && r1.length > 0);
  const protoPause = find(r1, 'prototype.pause');
  assert('接管态: prototype.pause 标记为已包装', !!(protoPause && protoPause.on === true));
  const globals = find(r1, '全局符号');
  assert('接管态: 暴露 window.__CX_FORCE_PLAY 命名空间', !!(globals && /__CX_FORCE_PLAY/.test(globals.detail)));
  const msRow = find(r1, 'navigator.mediaSession');
  assert('接管态: mediaSession 接管标记为真', !!(msRow && msRow.on === true));
  const hookRow = find(r1, '事件监听');
  assert('接管态: 卸载钩子已安装', !!(hookRow && hookRow.on === true));

  // —— 卸载态 ——
  try { window.__CX_FORCE_PLAY.uninstall(); } catch (e) { console.log('UNINSTALL_ERROR', e.message); }
  const r2 = bir();
  const protoPause2 = find(r2, 'prototype.pause');
  assert('卸载态: prototype.pause 还原(标记关闭)', !!(protoPause2 && protoPause2.on === false));
  const globals2 = find(r2, '全局符号');
  assert('卸载态: 全局符号已撤回(__CX_FORCE_PLAY 不再列出)', !!(globals2 && globals2.detail.indexOf('__CX_FORCE_PLAY') === -1));
  const msRow2 = find(r2, 'navigator.mediaSession');
  assert('卸载态: mediaSession 接管标记复位', !!(msRow2 && msRow2.on === false));
  const hookRow2 = find(r2, '事件监听');
  assert('卸载态: 卸载钩子已摘除', !!(hookRow2 && hookRow2.on === false));
}

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — 安全审计清单(接管态/卸载态)契约闭环');
process.exit(fail === 0 ? 0 : 1);
