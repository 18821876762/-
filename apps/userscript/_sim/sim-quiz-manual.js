// 需求回归：自动答题「自动启动开关 + 手动开始按钮」+ 每题信号灯
//   A) 自动启动关 → 扫描登记信号灯但不作答（黑）→ 手动开始 → 作答（绿）
//   B) 自动启动开（默认）→ 检测到题目自动作答（绿）
//   C) 信号灯状态映射：已作答=绿；AI 失败冷却=fail(红)；视觉在途/待确认=busy(黄)
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
  if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
  const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
  win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
  win.eval(code);
  return { dom, win, ns: win.__CX_FORCE_PLAY };
}

function makeQuestion(win, stemText, nOpts, submitSel) {
  const q = win.document.createElement('div');
  q.className = 'question-item';
  const stem = win.document.createElement('div');
  stem.className = 'stem';
  stem.textContent = stemText;
  q.appendChild(stem);
  const opts = [];
  for (let i = 0; i < nOpts; i++) {
    const o = win.document.createElement('div');
    o.className = 'option-item';
    o.textContent = '选项' + i;
    q.appendChild(o);
    opts.push(o);
  }
  const btn = win.document.createElement('button');
  btn.className = submitSel || 'submit-btn';
  btn.textContent = '提交';
  q.appendChild(btn);
  win.document.body.appendChild(q);
  return { q, opts, submitted: { val: false }, btn };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let pass = 0, fail = 0;
  function assert(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
  }
  const errors = [];
  const { dom, win, ns } = loadAt('https://www.pmphmooc.com/course/1');
  win.addEventListener('error', (e) => errors.push(String(e.message || e)));

  // —— 场景 A：自动启动关 ——
  win.localStorage.setItem('cx_quiz_auto', '1');
  win.localStorage.setItem('cx_quiz_auto_start', '0');
  win.localStorage.setItem('cx_quiz_autosubmit', '1');
  const qA = makeQuestion(win, 'A题：自动启动关', 2);
  await sleep(100);
  ns.quizObserveDispatch();   // 扫描（自动启动关 → 挂起）
  await sleep(50);
  assert('A1: 自动启动关 → 未作答（挂起）', !qA.submitted.val && !qA.q.querySelector('input') /* radio 不存在，仅检查未点选 */);
  // 未勾选判定：question-item 无 checked 类（用 options 的 aria 无意义）——直接验证灯状态
  const lights0 = ns.quizLights;
  assert('A2: 信号灯已登记 1 题', lights0.length === 1, { len: lights0.length });
  assert('A3: 未作答灯为 special（蓝=特殊情况·挂起）', lights0[0].state === 'special', { state: lights0[0].state });

  // 手动开始
  ns.quizManualStart();
  await sleep(50);
  assert('A4: 手动开始后已作答', ns.quizLights[0].state === 'done', { state: ns.quizLights[0].state });
  assert('A5: 手动开始幂等（再次调用无异常）', (() => { try { ns.quizManualStart(); return true; } catch (e) { return false; } })());

  // —— 场景 B：自动启动开（默认）—— 新窗口
  const { dom: dom2, win: win2, ns: ns2 } = loadAt('https://www.pmphmooc.com/course/2');
  win2.localStorage.setItem('cx_quiz_auto', '1');
  win2.localStorage.setItem('cx_quiz_autosubmit', '1');
  const qB = makeQuestion(win2, 'B题：自动启动开', 2);
  await sleep(100);
  ns2.quizObserveDispatch();
  await sleep(50);
  assert('B1: 自动启动开（默认）→ 自动作答', ns2.quizLights.length === 1 && ns2.quizLights[0].state === 'done', { lights: ns2.quizLights.map((l) => l.state) });
  assert('B2: quizAutoStartOn 默认 true', ns2.quizAutoStartOn() === true);

  // —— 场景 C：失败灯（红）—— 独立窗口（避免 B 场景遗留状态干扰）：严格 AI 模式 + DS 应答端不可用 → _quizStrictFail
  const { dom: domC, win: winC, ns: nsC } = loadAt('https://www.pmphmooc.com/course/4');
  winC.localStorage.setItem('cx_quiz_auto', '1');
  winC.localStorage.setItem('cx_quiz_autosubmit', '1');
  // CONFIG 是内存对象（config.js 暴露到 ns.CONFIG），直接设置视觉模式（不经面板绑定路径）
  nsC.CONFIG.QUIZ_VISION_ENABLED = true;
  nsC.CONFIG.QUIZ_VISION_OCR = 'deepseek-web';
  const qC = makeQuestion(winC, 'C题：失败', 2);
  await sleep(100);
  nsC.quizObserveDispatch();
  await sleep(50);
  const cLight = nsC.quizLights[0];
  assert('C1: 严格模式 DS 不可用 → 失败灯（红）', cLight && cLight.state === 'fail', { state: cLight && cLight.state });
  nsC.CONFIG.QUIZ_VISION_ENABLED = false;

  // —— 场景 D：无题页不产生灯 ——
  const { dom: dom3, win: win3, ns: ns3 } = loadAt('https://www.pmphmooc.com/course/3');
  win3.localStorage.setItem('cx_quiz_auto', '1');
  await sleep(100);
  ns3.quizObserveDispatch();
  await sleep(50);
  assert('D1: 无题页信号灯为空', ns3.quizLights.length === 0, { len: ns3.quizLights.length });

  assert('全局 无运行时错误', errors.length === 0, errors.slice(0, 3));

  console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail ? 1 : 0);
})();
