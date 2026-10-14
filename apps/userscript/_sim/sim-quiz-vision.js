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

const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

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
    try { if (!ns.quizBank) ns.quizBank = {}; ns.quizBank['光合作用的过程'] = 2; } catch (e) {}
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

  // 3b. 严格 AI 模式（deepseek-web）下视觉识别失败 → 停下不点选、不提交、不随机兜底
  //   （对应「末题视口外截空白→空白图拒绝→严格模式不误答不误随机」的修复闭环）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.CONFIG.QUIZ_VISION_OCR = 'deepseek-web';
    ns.DS_STATUS.connected = true; ns.DS_STATUS.loggedIn = true;   // dsAvailable()=true，走视觉路径
    ns.setQuizRecoverOverride(function () { return Promise.reject(new Error('题目截图疑似空白（已拒绝）')); });  // 模拟空白检测 reject
    const { sel, submitted } = makeQuestion(window, '末题在视口外', 4);
    let threw = false;
    try { ns.renweiTickQuiz(); } catch (e) { threw = true; }
    await tick();
    assert('严格AI失败: tick 不抛异常', threw === false);
    assert('严格AI失败: 未点选任何项(停下不误随机)', sel.idx === -1);
    assert('严格AI失败: 未提交(留待重试)', submitted.val === false);
  }

  // 3c. 视口内化前置：_quizEnsureVisible 在 jsdom 下 resolve 且不抛错（jsdom scrollIntoView 为 no-op，修复路径可用）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    let ok = false;
    try {
      const p = ns._quizEnsureVisible(window.document.body);
      assert('视口内化: 返回 Promise', !!p && typeof p.then === 'function');
      await p;
      ok = true;
    } catch (e) { ok = false; }
    assert('视口内化: resolve 且不抛错', ok === true);
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

  // 6. DeepSeek 登录态探测 + 状态徽标（未连接时不渲染，避免噪声弹窗）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    // 未连接：不应创建/展示徽标（用户未开启答题时课程页不得出现 DeepSeek 弹窗）
    ns._dsRenderStatus();
    let badge = window.document.getElementById('cx-ds-status');
    assert('DS状态: 未连接不渲染徽标(无噪声弹窗)', !badge);
    assert('DS状态: 未连接 dsAvailable=false', ns.dsAvailable() === false);
    // 模拟已连接+已登录：徽标应出现并显示可用
    ns.DS_STATUS.connected = true; ns.DS_STATUS.loggedIn = true;
    ns._dsRenderStatus();
    badge = window.document.getElementById('cx-ds-status');
    assert('DS状态: 已连接渲染徽标', !!badge);
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

  // 7. 完成度校验：5 题序号 1~5 → 第二轮全部作答后 maxSeq=5、seqConsistent=true、doneAll=true
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';   // 非严格：随机兜底保不卡，用于验证"作答+完成度统计"
    ['1 单选', '2 多选', '3 判断', '4 单选', '5 单选'].map(function (s) { makeQuestion(window, s, 4); });
    ns.renweiTickQuiz(); await tick();          // 第一轮：作答
    ns.renweiTickQuiz(); await tick();          // 第二轮：所有题已 handled → done=5（序号收集已上移循环开头，不受 continue 影响）
    const st = window.__CX_FORCE_PLAY.quizStats;
    assert('完成度: 扫描到 5 题', st.scanned === 5);
    assert('完成度: 序号最大=5', st.maxSeq === 5);
    assert('完成度: 序号与题数一致', st.seqConsistent === true);
    assert('完成度: 全部作答 doneAll=true', st.doneAll === true && st.remaining === 0);
  }

  // 8. 完成度校验异常：序号 1,2,3,5,6（最大6≠5）→ seqConsistent=false（可能漏题/解析异常）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ['1 单选', '2 单选', '3 单选', '5 单选', '6 单选'].map(function (s) { makeQuestion(window, s, 4); });
    ns.renweiTickQuiz(); await tick();
    const st = window.__CX_FORCE_PLAY.quizStats;
    assert('完成度异常: 扫描到 5 题', st.scanned === 5);
    assert('完成度异常: 序号最大=6', st.maxSeq === 6);
    assert('完成度异常: 不一致(seqConsistent=false)', st.seqConsistent === false);
  }

  console.log(fail === 0 ? '结论: PASS — 视觉识别层闭环' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
