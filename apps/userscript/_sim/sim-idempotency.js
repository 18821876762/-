// 幂等性回归：验证主脚本重复注入、工具库项重复注册、内置命令重复注册、面板重复渲染
// 均不产生副作用翻倍（定时器不双倍、addon 不重复、命令不重复、面板行数不翻倍）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

const html = `<!DOCTYPE html><html><head><title>学习通</title></head><body>
  <video id="video" src="https://mooc1.chaoxing.com/video.mp4" controls preload="metadata"></video>
  <div class="ans-attach-ct"></div>
</body></html>`;

const dom = new JSDOM(html, {
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

const mockCtx = new Proxy({}, { get: (t, p) => {
  if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (p === 'getImageData') return () => ({ data: [] });
  return () => {};
}});
window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
window.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};

// spy setInterval：统计主脚本重复注入是否产生双倍定时器
let setIntervalCalls = 0;
const realSetInterval = window.setInterval.bind(window);
window.setInterval = function (fn, ms) { setIntervalCalls++; return realSetInterval(fn, ms); };

const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message)));
const origConsoleError = console.error;
console.error = (...a) => { const s = a.map(String).join(' '); if (/Not implemented:/i.test(s)) return; errors.push('console.error: ' + s); };
window.console = console;

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

// ===== 场景1：主脚本重复注入（Tampermonkey 热重载）=====
let injectErr = null;
try { window.eval(code); } catch (e) { injectErr = e; }
const siAfterFirst = setIntervalCalls;
try { window.eval(code); } catch (e) { injectErr = (injectErr ? injectErr + '; ' : '') + e; }  // 第二次应被 started 守卫跳过
const siAfterSecond = setIntervalCalls;

assert('场景1 首次注入无异常', injectErr === null, injectErr && injectErr.message);
assert('场景1 命名空间 started=true', window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.started === true);
assert('场景1 重复注入不产生双倍 setInterval（幂等守卫生效）', siAfterSecond === siAfterFirst,
  { siAfterFirst, siAfterSecond });
assert('场景1 第二次注入不抛异常（因 started 跳过）', injectErr === null, injectErr && injectErr.message);

// ===== 场景2：工具库项重复注册同一 id =====
// 注册两次相同 id 的 toggle，再多次调用 __cxRegisterAddon
function makeAddon() {
  return { id: 'demo-tool', type: 'toggle', label: '演示工具', get: () => true, set: () => {} };
}
(window.__cxAddonQueue = window.__cxAddonQueue || []).length = 0;
window.__cxAddonQueue.push(makeAddon());
window.__cxAddonQueue.push(makeAddon());   // 重复 id
let regErr = null;
try {
  if (window.__cxRegisterAddon) window.__cxRegisterAddon();
  if (window.__cxRegisterAddon) window.__cxRegisterAddon();  // 再调一次
} catch (e) { regErr = e; }
assert('场景2 重复注册无异常', regErr === null, regErr && regErr.message);

// 触发面板渲染（按 P 呼出）
function pressP() {
  const ev = new window.KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true });
  document.dispatchEvent(ev);
}
pressP();
const addonBox = document.querySelector('#__cxAddons');
const rows = addonBox ? addonBox.querySelectorAll('div') : [];
// 统计包含 label 文本的行数
let demoCount = 0;
if (addonBox) addonBox.querySelectorAll('label').forEach(l => { if (l.textContent.indexOf('演示工具') >= 0) demoCount++; });
assert('场景2 重复 id 仅渲染 1 次（去重）', demoCount === 1, { demoCount, totalRows: rows.length });
assert('场景2 面板已渲染', !!addonBox, null);

// 再多次渲染，行数不应翻倍
const before = demoCount;
pressP(); pressP();   // 关闭再打开
pressP();            // 重新打开
let demoCount2 = 0;
const addonBox2 = document.querySelector('#__cxAddons');
if (addonBox2) addonBox2.querySelectorAll('label').forEach(l => { if (l.textContent.indexOf('演示工具') >= 0) demoCount2++; });
assert('场景2 多次渲染仍仅 1 项（不翻倍）', demoCount2 === before && demoCount2 === 1, { demoCount2, before });

// ===== 场景3：内置命令重复注册 =====
let cmdErr = null;
// 幂等性修复(审查 A10)：用 listCommands() 长度做真实前后对比——旧断言只查「无异常」，同名覆盖即使
// 累积成翻倍也判 PASS（且 __cxRegisterCommand 缺失时空转恒真）。现补「不翻倍」与「入口存在」双断言。
const _listLen = () => (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.listCommands === 'function')
  ? window.__CX_FORCE_PLAY.listCommands().length : -1;
const cmdBefore = _listLen();
let cmdOk = true;
try {
  // 同名重复注册不应抛错且不应翻倍（通过命令表长度前后对比可证）
  if (window.__cxRegisterCommand) {
    const before2 = document.querySelectorAll('#__cxPanel').length;
    window.__cxRegisterCommand('__probe__', 'probe', false, () => {});
    window.__cxRegisterCommand('__probe__', 'probe2', false, () => {});  // 同名覆盖
    window.__cxRegisterCommand('__probe__', 'probe3', false, () => {});
  }
} catch (e) { cmdOk = false; cmdErr = e; }
const cmdAfter = _listLen();
assert('场景3 命令同名重复注册无异常', cmdOk, cmdErr && cmdErr.message);
assert('场景3 命令注册入口存在（防空转）', typeof window.__cxRegisterCommand === 'function' && cmdBefore >= 0,
  { cmdBefore });
// 同名注册 3 次：首次新增 +1，后两次覆盖不增长 → 期望 cmdBefore+1（若覆盖失效会 +3）
assert('场景3 命令同名重复注册不翻倍（同名覆盖语义）', cmdOk && cmdBefore >= 0 && cmdAfter === cmdBefore + 1,
  { cmdBefore, cmdAfter });

// ===== 场景4：整体错误检查 =====
assert('全局 无运行时错误', errors.length === 0, errors.slice(0, 3));

console.log('\n================ 幂等性结论 ================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) { console.log('结论: FAIL — 存在幂等性缺陷'); process.exit(1); }
console.log('结论: PASS — 主脚本重复注入/工具库项重复注册/命令重复注册 均幂等，无副作用翻倍');
process.exit(0);
