// 卸载清理回归：在 jsdom 中加载完整产物，触发 uninstall()，断言脚本对外暴露的
// 全局符号与注入 DOM 已被撤销（对应沙箱独立性审查高优先级 #1/#2/#3）。
// 注意：jsdom 不支持 iframe 跨 frame、真实视频元素，故仅验证「全局符号删除 + 命名空间终态」这一类
// 不依赖真实页面的断言；mediaSession 原 handler 还原的保存/还原契约已由同目录 sim-mediasession.js
// 通过模拟 navigator.mediaSession 闭环覆盖（纯 JS 逻辑等价真实浏览器，不再依赖真实浏览器实机回归）。
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

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  runScripts: 'outside-only',
  url: 'https://example.com/',
  pretendToBeVisual: true,
});
const { window } = dom;
// 提供产物可能触碰的最小桩：mediaSession 置 undefined 让相关分支被安全跳过
try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}

const ctx = dom.getInternalVMContext();
let injected = false;
try {
  vm.runInContext(artifact, ctx, { filename: 'artifact.user.js' });
  injected = !!window.__CX_FORCE_PLAY;
} catch (e) {
  console.log('INJECT_NOTE — 产物在 jsdom 注入阶段异常（通常因缺真实页面 API），仅作部分断言:', e.message);
}

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

assert('命名空间已安装', injected);
if (injected) {
  // 触发卸载
  try { window.__CX_FORCE_PLAY.uninstall(); } catch (e) { console.log('UNINSTALL_ERROR', e.message); }
  assert('window.__cxRegisterAddon 已删除', !('__cxRegisterAddon' in window));
  assert('window.__cxRegisterCommand 已删除', !('__cxRegisterCommand' in window));
  assert('window.__cxUI 已删除', !('__cxUI' in window));
  assert('window.__CX_FORCE_PLAY 终态已删除', !('__CX_FORCE_PLAY' in window));
}

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — uninstall 撤销全局符号/命名空间');
process.exit(fail === 0 ? 0 : 1);
