const projectPaths = require('./project-paths.cjs');
// 沙箱独立性·全局泄漏面探针：
//   ① 注入产物后枚举 window 新增全局属性（对比基线），分类：契约命名空间 / 工具库契约 / 设计内导出 / 裸全局泄漏；
//   ② 触发 uninstall() 后再次枚举，验证「回到注入前状态」的还原完整性（零残留）；
//   ③ 原型面（HTMLMediaElement.prototype.pause/playbackRate）注入前先放置「平台原生」桩，卸载后验证还原为桩。
const fs = require('fs');
const { JSDOM } = projectPaths.requireSim('jsdom');

const artifact = fs.readFileSync(projectPaths.bundle, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  runScripts: 'outside-only',
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2',
  pretendToBeVisual: true,
});
const win = dom.window;

// ③ 原型面：先放置「平台原生」桩（jsdom 无媒体实现，pause/playbackRate 原生缺失——模拟真实浏览器）
const NATIVE_PAUSE_STUB = function nativePauseStub() {};
const NATIVE_RATE_SET_STUB = function nativeRateSetStub(v) {};
const NATIVE_RATE_DESC_STUB = { configurable: true, enumerable: true, get: function () { return 1; }, set: NATIVE_RATE_SET_STUB };
try { win.HTMLMediaElement.prototype.pause = NATIVE_PAUSE_STUB; } catch (e) {}
try { Object.defineProperty(win.HTMLMediaElement.prototype, 'playbackRate', NATIVE_RATE_DESC_STUB); } catch (e) {}

function ownGlobals(w) {
  const out = [];
  for (const k of Object.getOwnPropertyNames(w)) {
    try { if (!/^[a-zA-Z_$]/.test(k)) continue; out.push(k); } catch (e) {}
  }
  return out.sort();
}
function diff(before, after) {
  const set = new Set(before);
  return after.filter((k) => !set.has(k));
}

const base = ownGlobals(win);
const fn = new win.Function(artifact);
fn.call(win);
const afterInject = diff(base, ownGlobals(win));

const CONTRACT_NS = (k) => k === '__CX_FORCE_PLAY';
const TOOLKIT_CONTRACT = (k) => /^__cx/.test(k);
// 设计内裸全局白名单：均为「有意导出/站点契约钩子」，且 uninstall 时必须全部清除（下方断言）
const INTENTIONAL = ['dsAvailable', '_dsIsLoggedIn', 'EventBus', 'Store', 'attachments'];
const leaked = afterInject.filter((k) => !CONTRACT_NS(k) && !TOOLKIT_CONTRACT(k));

console.log('=== 注入后 window 新增全局 ===');
afterInject.forEach((k) => {
  const tag = CONTRACT_NS(k) ? '[契约命名空间]' : (TOOLKIT_CONTRACT(k) ? '[工具库契约]' : (INTENTIONAL.includes(k) ? '[设计内导出/钩子]' : '[裸全局泄漏]'));
  console.log('  ' + tag + ' ' + k);
});

// 触发卸载，验证还原
const cleanupErr = [];
win.addEventListener('error', (e) => cleanupErr.push(String(e.message)));
try { win.__CX_FORCE_PLAY.uninstall(); } catch (e) { cleanupErr.push(String(e)); }
const afterUninstall = diff(base, ownGlobals(win));

console.log('=== uninstall() 后仍残留的 window 全局 ===');
afterUninstall.forEach((k) => console.log('  残留 ' + k));

let ok = true;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) ok = false; }
check('注入后命名空间存在', afterInject.includes('__CX_FORCE_PLAY'));
check('工具库契约全局存在（__cxRegisterAddon/__cxRegisterCommand/__cxUI/__cxAddonQueue）',
  ['__cxRegisterAddon', '__cxRegisterCommand', '__cxUI', '__cxAddonQueue'].every((k) => afterInject.includes(k)));
check('注入后裸全局全部为设计内导出/钩子（无意外泄漏）', leaked.every((k) => INTENTIONAL.includes(k)), { leaked });
check('卸载后无错误', cleanupErr.length === 0, cleanupErr.slice(0, 3));
check('卸载后 window 完全回到注入前状态（零残留）', afterUninstall.length === 0, { afterUninstall });

// ③ 原型面还原验证
const protoPauseAfter = win.HTMLMediaElement.prototype.pause;
const rateDescAfter = Object.getOwnPropertyDescriptor(win.HTMLMediaElement.prototype, 'playbackRate');
check('卸载后 prototype.pause 还原为平台原生桩', protoPauseAfter === NATIVE_PAUSE_STUB,
  { got: typeof protoPauseAfter });
check('卸载后 prototype.playbackRate setter 还原为平台原生桩', !!rateDescAfter && rateDescAfter.set === NATIVE_RATE_SET_STUB,
  { gotSet: rateDescAfter && typeof rateDescAfter.set });

dom.window.close();
console.log(ok ? '\n结论: PASS — 沙箱泄漏面收敛于已知清单' : '\n结论: FAIL');
process.exit(ok ? 0 : 1);
