// 卸载清理回归 · mediaSession 还原：在 jsdom 中模拟 navigator.mediaSession
// （getActionHandler / setActionHandler / playbackState），加载完整产物，让初始扫描接管一个 <video>
// （_ovEnforce 最先执行 mediaSession 保存+劫持），再触发 uninstall()，断言 pause handler 被还原为
// 注入前的原始 handler（而非盲目置 null），对应沙箱独立性审查高优先级#3「mediaSession 原 handler 还原」。
//
// 此回归闭环了 sim-lifecycle.js 注释里标记的已知限制——「jsdom 无 mediaSession，分支被跳过，需真实浏览器
// 实机回归」。原因是：保存/还原逻辑是纯 JS，仅 mediaSession API 被模拟，与真实浏览器行为等价；故用 jsdom
// 注入模拟即可在不依赖真实浏览器的前提下验证该契约。
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
// 脚本接管时应懒保存此 handler 并在卸载时还原为它，而非置 null（避免破坏站点媒体按键交互）。
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
  injected = !!window.__CX_FORCE_PLAY;
} catch (e) {
  console.log('INJECT_NOTE — 产物在 jsdom 注入阶段异常:', e.message);
}

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

assert('命名空间已安装', injected);
if (injected) {
  // 初始扫描（main-loop.js 同步执行）应已接管 #v1 → mediaSession 被懒保存原始 handler 并劫持为 no-op。
  const hijack = msCalls.find(function (c) { return c.action === 'pause' && c.handler !== SENTINEL; });
  assert('接管时劫持 mediaSession.pause 为 no-op（说明已执行保存路径）', !!hijack);
  assert('接管后 playbackState 标为 playing', ms._state === 'playing');

  // 触发卸载
  try { window.__CX_FORCE_PLAY.uninstall(); } catch (e) { console.log('UNINSTALL_ERROR', e.message); }

  // 卸载后 pause handler 应还原为注入前的 SENTINEL，而非置 null（审查高优先级#3）。
  const restore = msCalls.filter(function (c) { return c.action === 'pause'; }).pop();
  assert('卸载后 mediaSession.pause 还原为注入前原始 handler', !!restore && restore.handler === SENTINEL);
  assert('卸载后未盲目置 null', !!restore && restore.handler !== null);
  // playbackState 还原为注入前语义（原 'none'）。
  assert('卸载后 playbackState 还原为 none', ms._state === 'none');
}

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — mediaSession 原 handler 保存/还原闭环');
process.exit(fail === 0 ? 0 : 1);
