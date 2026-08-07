// rev3 抗题目文本混淆·视觉识别层回归：验证 biz/quiz-vision.js + quiz.js 视觉路径。
// 关键断言（jsdom 无 Canvas/OCR，经 setQuizRecoverOverride 注入假 recover 模拟识别结果）：
//   - vision+bank：恢复文本命中题库 → 回填正确项并点提交；
//   - vision+endpoint：端点直接给 answer 索引 → 回填该索引；
//   - vision 失败：recover reject → 随机兜底作答（不抛异常、不卡进度）；
//   - 去重：同一题第二次 tick 返回 0（已占坑）；
//   - 隔离：超星页开启视觉识别后调用答题平台 tick 仍零副作用。
const fs = require('fs');
const path = require('path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}

const artifact = fs.readFileSync(path.join(__dirname, '..', 'chaoxing-force-play.user.js'), 'utf8');

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}
const tick = function () { return new Promise(function (r) { setTimeout(r, 40); }); };

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
}

// 选项记录被选中的下标（验证回填的是"正确项"而非随机）
function makeQuestion(window, stemText, nOpts) {
  const q = window.document.createElement('div'); q.className = 'question-item';
  const stem = window.document.createElement('div'); stem.className = 'stem'; stem.textContent = stemText;
  q.appendChild(stem);
  const sel = { idx: -1 };
  for (let i = 0; i < nOpts; i++) {
    const opt = window.document.createElement('div'); opt.className = 'option-item'; opt.textContent = '选项' + i;
    (function (idx) { opt.addEventListener('click', function () { sel.idx = idx; }); })(i);
    q.appendChild(opt);
  }
  const submitted = { val: false };
  const btn = window.document.createElement('button'); btn.className = 'submit-btn'; btn.textContent = '提交';
  btn.addEventListener('click', function () { submitted.val = true; });
  q.appendChild(btn);
  window.document.body.appendChild(q);
  return { q, sel, submitted };
}

async function main() {
  console.log('--- rev3 抗题目文本混淆·视觉识别层回归 ---');

  // 1. vision + bank：恢复文本命中题库 → 回填正确项(索引2) + 提交
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1'); // renwei
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'bank';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    // DOM 文本是"混淆"的（与题库不一致），但视觉恢复出真实文本
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: '光合作用的过程', answer: null }); });
    try { window.__CX_QUIZ_BANK = { '光合作用的过程': 2 }; } catch (e) {}
    const { sel, submitted } = makeQuestion(window, '混淆题干看不出', 4);
    ns.renweiTickQuiz();
    await tick();
    assert('视觉+bank: 回填正确项索引2', sel.idx === 2);
    assert('视觉+bank: 点击提交', submitted.val === true);
  }

  // 2. vision + endpoint 直接给 answer 索引
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: null, answer: 1 }); });
    const { sel, submitted } = makeQuestion(window, '又一混淆题', 4);
    ns.renweiTickQuiz();
    await tick();
    assert('视觉+endpoint: 回填端点给的索引1', sel.idx === 1);
    assert('视觉+endpoint: 点击提交', submitted.val === true);
  }

  // 3. vision 失败（recover reject）→ 随机兜底作答，不抛异常、不卡进度
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.reject(new Error('ocr fail')); });
    const { sel, submitted } = makeQuestion(window, '识别会失败', 4);
    let threw = false;
    try { ns.renweiTickQuiz(); } catch (e) { threw = true; }
    await tick();
    assert('视觉失败: tick 不抛异常', threw === false);
    assert('视觉失败: 仍随机选中某项(>=0)', sel.idx >= 0 && sel.idx < 4);
    assert('视觉失败: 仍点提交', submitted.val === true);
  }

  // 4. 去重：视觉路径异步作答，先同步占坑；异步回填生效后再 tick 同题返回 0
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: null, answer: 0 }); });
    const { sel, submitted } = makeQuestion(window, '去重题', 3);
    const first = ns.renweiTickQuiz();   // 异步作答，先占坑（同步返回 0 符合设计）
    await tick();                         // 等异步回填
    assert('去重: 异步回填生效(选中索引0)', sel.idx === 0);
    assert('去重: 异步已提交', submitted.val === true);
    assert('去重: 首次 tick 同步返回 0(异步作答)', first === 0);
    const second = ns.renweiTickQuiz();   // 同指纹应被跳过
    assert('去重: 二次 tick 返回 0', second === 0);
  }

  // 5. 隔离：超星页开启视觉识别后调用答题平台 tick 仍零副作用
  {
    const { window, ns } = loadAt('https://mooc.xxx.edu.cn/learn/1'); // chaoxing
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    const before = window.document.body.children.length;
    let threw = false;
    try { const r = ns.unipusTickQuiz(); assert('隔离: 超星页答题 tick 返回 0', r === 0); }
    catch (e) { threw = true; }
    assert('隔离: 超星页不抛异常', threw === false);
    assert('隔离: 超星页 DOM 不变', window.document.body.children.length === before);
  }

  // 6. DeepSeek 登录态探测 + 不可用状态徽标
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns._dsRenderStatus();
    const badge = window.document.getElementById('cx-ds-status');
    assert('DS状态: 徽标元素存在', !!badge);
    assert('DS状态: 未连接显示不可用', /未连接/.test(badge.textContent));
    assert('DS状态: 未连接 dsAvailable=false', ns.dsAvailable() === false);
    // 模拟已连接+已登录
    ns.DS_STATUS.connected = true; ns.DS_STATUS.loggedIn = true;
    ns._dsRenderStatus();
    assert('DS状态: 已登录显示可用', /已登录/.test(badge.textContent));
    assert('DS状态: 已登录 dsAvailable=true', ns.dsAvailable() === true);
    // 登录探测：有登录按钮→未登录；追加头像→已登录
    const lb = window.document.createElement('div'); lb.className = 'ds-login-btn'; lb.textContent = '登录';
    window.document.body.appendChild(lb);
    ns.DEEPSEEK.loginBtnSel = '.ds-login-btn';
    assert('DS登录探测: 有登录按钮→未登录(false)', ns._dsIsLoggedIn() === false);
    const av = window.document.createElement('div'); av.className = 'ds-avatar';
    window.document.body.appendChild(av);
    ns.DEEPSEEK.avatarSel = '.ds-avatar';
    assert('DS登录探测: 有头像→已登录(true)', ns._dsIsLoggedIn() === true);
  }

  console.log(fail === 0 ? '结论: PASS — 视觉识别层闭环' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
