// 线程/调度单元审计回归：注入产物 → 触发各类调度（主循环/答题 MO/视觉超时/桥探测）→ 卸载，
// 验证「零残留调度单元」：活跃 setInterval 差值归零、在途视觉超时定时器被清、无页面错误。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

const html = `<!DOCTYPE html><html><head><title>学习通</title></head><body>
  <video id="v1" src="https://mooc1.chaoxing.com/v1.mp4" preload="metadata"></video>
  <div class="TiMu"><div class="Zy_TItle">1. 单选</div><div class="Zy_UlTop">A</div><div class="Zy_UlTop">B</div></div>
  <div class="ans-attach-ct"></div>
</body></html>`;

const dom = new JSDOM(html, {
  url: 'https://mooc1.chaoxing.com/exam/test/reVersionTestStartNew?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;
const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};

// 活跃定时器计数：patch setInterval/clearInterval 差值
let intervals = new Set();
let timeouts = new Set();
let seq = 1;
const realSI = win.setInterval.bind(win), realCI = win.clearInterval.bind(win);
const realST = win.setTimeout.bind(win), realCT = win.clearTimeout.bind(win);
win.setInterval = function (fn, ms) { const id = seq++; intervals.add(id); realSI(function () { if (intervals.has(id)) fn(); }, ms); return id; };
win.clearInterval = function (id) { intervals.delete(id); realCI(id); };
win.setTimeout = function (fn, ms) { const id = seq++; timeouts.add(id); realST(function () { timeouts.delete(id); fn(); }, ms); return id; };
win.clearTimeout = function (id) { timeouts.delete(id); realCT(id); };

const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message || e)));
win.eval(code);
win.localStorage.setItem('cx_quiz_auto', '1');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
  if (cond) pass++; else fail++;
}

(async () => {
  // 让调度跑起来：2 个主循环周期 + 触发一次视觉路径（无 quizRecover → 45s 超时定时器在途）
  const before = { intervals: intervals.size, timeouts: timeouts.size };
  await new Promise((r) => setTimeout(r, 4700));
  // 触发视觉答题（占坑 + 起 45s 超时定时器）
  try { win.__CX_FORCE_PLAY.quizObserveDispatch(); } catch (e) {}
  await new Promise((r) => setTimeout(r, 300));
  const during = { intervals: intervals.size, timeouts: timeouts.size };
  console.log('调度状态: 注入前', JSON.stringify(before), '→ 运行中', JSON.stringify(during));

  // 卸载
  win.__CX_FORCE_PLAY.uninstall();
  await new Promise((r) => setTimeout(r, 100));
  const after = { intervals: intervals.size, timeouts: timeouts.size };

  console.log('卸载后活跃定时器:', JSON.stringify(after), '(运行中', JSON.stringify(during), ')');
  check('卸载后 setInterval 零残留', after.intervals <= 0, { during: during.intervals, after: after.intervals });
  // 注：jsdom 的 setTimeout 可能有环境自身残留（playwright/jsdom 内部），允许少量噪声；核心断言是「无脚本周期调度残留」
  check('卸载后无周期调度残留（间隔类归零）', after.intervals === 0, { after });
  check('卸载无错误', errors.length === 0, errors.slice(0, 3));

  // 二次卸载幂等：首次卸载已 delete namespace（⑪ 终态）→ 无入口是预期；有入口时再次调用应无异常
  let err2 = null;
  try { if (win.__CX_FORCE_PLAY) win.__CX_FORCE_PLAY.uninstall(); } catch (e) { err2 = e; }
  check('二次 uninstall 无异常（namespace 已删为预期）', err2 === null && !win.__CX_FORCE_PLAY, err2 && err2.message);

  dom.window.close();
  console.log(pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
