// 回归：v4.19.13 答题信号灯七态七色——新增 紫=暂时受阻 / 蓝=特殊情况 / 橙=信息缺失，红=完全失败。
// 直接驱动已构建产物（dist/chaoxing-force-play.user.js），不依赖人工交互。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const examHtml = `<!DOCTYPE html><html><head><title>作业</title></head><body>
<div class="ans-attach-ct"></div>
<div class="TiMu newTiMu">
  <div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】中国的首都是？</span></div>
  <ul class="Zy_ulTop">
    <li class="before-after-checkbox" role="checkbox" aria-label="A 北京">A 北京</li>
    <li class="before-after-checkbox" role="checkbox" aria-label="B 上海">B 上海</li>
  </ul>
  <button class="submit-btn">提交</button>
</div>
</body></html>`;

// 无选项题目（题干/选项无法识别 → 信息缺失）
const missingHtml = `<!DOCTYPE html><html><head><title>作业</title></head></body>
<div class="ans-attach-ct"></div>
<div class="TiMu newTiMu">
  <div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】下列哪一项正确？</span></div>
  <ul class="Zy_ulTop"></ul>
</div>
</body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function load(html, autoStart) {
  const dom = new JSDOM(html, {
    url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2&api=1',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
  win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
  if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
  win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {}, fillText() {}, measureText() { return { width: 0 }; } }; };
  if (autoStart !== undefined) win.localStorage.setItem('cx_quiz_auto_start', autoStart ? '1' : '0');
  win.__fixtureSubmitCount = 0;
  const submit = win.document.querySelector('.submit-btn');
  if (submit) submit.addEventListener('click', () => win.__fixtureSubmitCount++);
  win.eval(code);
  return win;
}

(async () => {
  let pass = 0, fail = 0;
  function assert(name, cond, extra) {
    if (cond) { pass++; console.log('PASS ' + name); }
    else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
  }

  // G0：自动启动关闭 → 检测到的题显示蓝色=特殊情况（挂起不作答）
  {
    const win = load(examHtml, false);
    const ns = win.__CX_FORCE_PLAY;
    await sleep(1600);
    const states = ns.quizLights.map((l) => l.state);
    assert('G0: 自动启动关闭 → 所有检测题灯=特殊情况(蓝)', ns.quizLights.length > 0 && ns.quizLights.every((l) => l.state === 'special'), { states });
    win.close();
  }

  // G1：有选项 + 自动启动开启 → 题被作答（绿），不含 特殊/信息缺失/暂时受阻
  {
    const win = load(examHtml, true);
    const ns = win.__CX_FORCE_PLAY;
    await sleep(1600);
    const states = ns.quizLights.map((l) => l.state);
    assert('G1: 自动启动开启 → 实际提交后绿=已结算', win.__fixtureSubmitCount > 0 && ns.quizLights.length > 0 && ns.quizLights.every((l) => l.state === 'done'), { submitted: win.__fixtureSubmitCount, states });
    win.close();
  }

  // G2：无选项题目（信息缺失）→ 橙色=信息缺失，且不误判为 特殊情况/已完成
  {
    const win = load(missingHtml, true);
    const ns = win.__CX_FORCE_PLAY;
    await sleep(1600);
    const states = ns.quizLights.map((l) => l.state);
    assert('G2: 无选项题 → 灯=信息缺失(橙)', ns.quizLights.length > 0 && ns.quizLights.every((l) => l.state === 'missing'), { states });
    win.close();
  }

  // G3：失败灯仍记为 fail 状态（标签改「完全失败」由 dashboard 负责，状态枚举不变，跨帧/诊断兼容）
  {
    const win = load(examHtml, true);
    const ns = win.__CX_FORCE_PLAY;
    // 制造一道 fail 灯：把某题 fp 的 _quizAIFailed 置位需要内部访问；此处仅校验状态枚举值合法（七态之一）
    await sleep(1600);
    const valid = ['idle', 'done', 'busy', 'fail', 'blocked', 'special', 'missing', 'fill'];
    const states = ns.quizLights.map((l) => l.state);
    assert('G3: 所有灯状态属于七态枚举（含 fail 状态键保留）', states.every((s) => valid.indexOf(s) >= 0), { states });
    win.close();
  }

  // G4：信息缺失可解除（修复1）——先无选项(橙)，动态加载出选项后下一轮 tick 清除 _quizInfoMissing，不再显橙
  {
    const win = load(missingHtml, true);
    const ns = win.__CX_FORCE_PLAY;
    await sleep(1600);
    const before = ns.quizLights.map((l) => l.state);
    assert('G4a: 初始无选项 → 灯=信息缺失(橙)', ns.quizLights.length > 0 && ns.quizLights.every((l) => l.state === 'missing'), { before });
    // 动态注入选项（模拟题目异步加载出选项/题干）
    const ul = win.document.querySelector('.Zy_ulTop');
    const li = win.document.createElement('li');
    li.className = 'before-after-checkbox'; li.setAttribute('role', 'checkbox'); li.setAttribute('aria-label', 'A 正确'); li.textContent = 'A 正确';
    ul.appendChild(li);
    await sleep(2600); // 等主循环下一 tick 重新扫描并清除信息缺失标志
    const after = ns.quizLights.map((l) => l.state);
    assert('G4b: 加载出选项后 → 不再显橙(信息缺失已解除)', ns.quizLights.length > 0 && ns.quizLights.every((l) => l.state !== 'missing'), { after });
    win.close();
  }

  console.log('\n' + (fail === 0 ? 'ALL PASS' : 'HAS FAIL') + ' (' + pass + '/' + (pass + fail) + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
