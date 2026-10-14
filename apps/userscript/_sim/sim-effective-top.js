// 回归：main-loop.js isEffectiveTopFrame —— v4.19.18 修复「LMS 跨域嵌入时主循环在任意帧都不启动 → 续播失效」。
// 旧版门控：主循环仅在 window.self===window.top(顶层帧) 启动。LMS 将超星嵌在跨域 iframe 时，所有同源帧都不是 window.top，
// 主循环在「任何帧」都不启动 → 视频失去周期接管/漂移守卫/全局暂停中和 → 诊断表现「主循环=已停·轮次=0」、续播失效。
// 修复：isEffectiveTopFrame() 沿 window.parent 上探，若上方无「运行本脚本的同源帧」则本帧为有效顶层、应启动主循环。
// 用真实嵌套 iframe 模拟（jsdom 不允许重定义 top/parent）：子帧的 window.parent/window.top 为真实对象，可区分三类场景。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

function loadInto(win) {
  win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
  if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
  win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
  win.eval(code);
  return win.__CX_FORCE_PLAY;
}

const URL = 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1';
let pass = 0, fail = 0;
function assert(name, cond, got) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); }
}

// 场景①：真正顶层（单窗口，top===self）
{
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: URL, runScripts: 'dangerously', pretendToBeVisual: true });
  const ns = loadInto(dom.window);
  assert('场景① 真正顶层 → 有效顶层(true)', ns.isEffectiveTopFrame() === true, ns.isEffectiveTopFrame());
}

// 场景③：嵌套 iframe，父帧不运行脚本（模拟 LMS 跨域嵌入：上方无 __CX_FORCE_PLAY）→ 本帧应为有效顶层
{
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: URL, runScripts: 'dangerously', pretendToBeVisual: true });
  const parentWin = dom.window;                       // 父帧未加载产品（无 __CX_FORCE_PLAY）
  const frameEl = parentWin.document.createElement('iframe');
  parentWin.document.body.appendChild(frameEl);
  const childWin = frameEl.contentWindow;
  const ns = loadInto(childWin);
  assert('场景③ 嵌套帧·父无脚本(LMS嵌入) → 有效顶层(true)', ns.isEffectiveTopFrame() === true, ns.isEffectiveTopFrame());
}

// 场景②：嵌套 iframe，父帧运行脚本（模拟超星壳帧包裹视频 iframe）→ 应由父帧统一编排，本帧不自起
{
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: URL, runScripts: 'dangerously', pretendToBeVisual: true });
  const parentWin = dom.window;
  loadInto(parentWin);                               // 父帧运行产品 → 置 __CX_FORCE_PLAY
  const frameEl = parentWin.document.createElement('iframe');
  parentWin.document.body.appendChild(frameEl);
  const childWin = frameEl.contentWindow;
  const ns = loadInto(childWin);
  assert('场景② 嵌套帧·父运行脚本(超星壳) → 非有效顶层(false)', ns.isEffectiveTopFrame() === false, ns.isEffectiveTopFrame());
}

console.log('\n' + (fail ? ('FAILED ' + fail) : 'PASSED') + '  sim-effective-top  pass=' + pass + ' fail=' + fail);
process.exit(fail ? 1 : 0);
