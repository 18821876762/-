// rev3 抗题目文本混淆·视觉识别层回归（选择题三型）：验证单选/多选/判断 三类均被正确回填。
// 关键断言（jsdom 经 setQuizRecoverOverride 注入假 recover 模拟 DeepSeek 回传）：
//   - 单选：answer='B' → 回填索引1；
//   - 多选：option role=checkbox + answer='AB' → 回填索引0与1（点击多个选项）；
//   - 判断(语义)：answer='正确' → 按选项标签内容命中"正确"项；answer='否' → 命中"否"项；
//   - 判断(字母·是/否不绑定A/B)：answer='B' 且 B 是"是"项 → 点索引1（证明按位置映射，不假设A=是/B=否）。
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

// 构造题目：labels=选项文本数组；roles=每选项 role（多选传 ['checkbox',...]）
function makeChoiceQuestion(window, labels, roles) {
  const q = window.document.createElement('div'); q.className = 'question-item';
  const stem = window.document.createElement('div'); stem.className = 'stem'; stem.textContent = '题';
  q.appendChild(stem);
  const sel = { idx: -1, clicked: new Set() };
  for (let i = 0; i < labels.length; i++) {
    const opt = window.document.createElement('div');
    opt.className = 'option-item';
    opt.textContent = labels[i];
    if (roles && roles[i]) opt.setAttribute('role', roles[i]);
    (function (idx) { opt.addEventListener('click', function () { sel.idx = idx; sel.clicked.add(idx); }); })(i);
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
  console.log('--- rev3 视觉识别层·选择题三型(单选/多选/判断)回归 ---');

  // 1. 单选：answer='B' → 索引1
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1'); // renwei
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: null, answer: 'B' }); });
    const { sel, submitted } = makeChoiceQuestion(window, ['选项A', '选项B', '选项C', '选项D']);
    ns.renweiTickQuiz();
    await tick();
    assert('单选: answer=B → 回填索引1', sel.idx === 1);
    assert('单选: 点击提交', submitted.val === true);
  }

  // 2. 多选：role=checkbox + answer='AB' → 点击索引0与1
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: null, answer: 'AB' }); });
    const { sel, submitted } = makeChoiceQuestion(
      window, ['选项A', '选项B', '选项C'], ['checkbox', 'checkbox', 'checkbox']);
    ns.renweiTickQuiz();
    await tick();
    assert('多选: answer=AB → 点击索引0', sel.clicked.has(0));
    assert('多选: answer=AB → 点击索引1', sel.clicked.has(1));
    assert('多选: answer=AB → 不点击索引2', !sel.clicked.has(2));
    assert('多选: 点击提交', submitted.val === true);
  }

  // 3. 判断(语义)：answer='正确' → 按标签命中"正确"项(索引0)
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: null, answer: '正确' }); });
    const { sel, submitted } = makeChoiceQuestion(window, ['正确', '错误']);
    ns.renweiTickQuiz();
    await tick();
    assert('判断(语义): answer=正确 → 命中"正确"项(索引0)', sel.idx === 0);
    assert('判断(语义): 点击提交', submitted.val === true);
  }

  // 4. 判断(语义·否)：answer='否' → 命中"否"项(索引1)
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: null, answer: '否' }); });
    const { sel, submitted } = makeChoiceQuestion(window, ['是', '否']);
    ns.renweiTickQuiz();
    await tick();
    assert('判断(语义): answer=否 → 命中"否"项(索引1)', sel.idx === 1);
  }

  // 5. 判断(字母·是/否不绑定A/B)：answer='B' 且 B 是"是"项 → 点索引1
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
    ns.CONFIG.QUIZ_VISION_ENABLED = true;
    ns.setQuizRecoverOverride(function () { return Promise.resolve({ text: null, answer: 'B' }); });
    // A=否, B=是（证明不假设 A=是/B=否）
    const { sel, submitted } = makeChoiceQuestion(window, ['否', '是']);
    ns.renweiTickQuiz();
    await tick();
    assert('判断(字母): answer=B 且 B=是 → 点索引1', sel.idx === 1);
  }

  // 6. 多选·文本/题库路径：role=checkbox + 题库存字母串'AB' → 点击索引0与1（验证本次修复：文本路径不再只点1项）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'bank';
    ns.CONFIG.QUIZ_VISION_ENABLED = false;   // 走文本/题库路径，不经视觉识别
    ns.quizBank = ns.quizBank || {};
    ns.quizBank['题'] = 'AB';                 // 题库以字母串存储多选答案
    const { sel, submitted } = makeChoiceQuestion(
      window, ['选项A', '选项B', '选项C'], ['checkbox', 'checkbox', 'checkbox']);
    ns.renweiTickQuiz();
    await tick();
    assert('多选·题库路径: 题库存AB → 点击索引0', sel.clicked.has(0));
    assert('多选·题库路径: 题库存AB → 点击索引1', sel.clicked.has(1));
    assert('多选·题库路径: 题库存AB → 不点击索引2', !sel.clicked.has(2));
    assert('多选·题库路径: 点击提交', submitted.val === true);
  }

  // 7. 单选·题库路径：题库存单值 → 仅点击索引1（回归：单选不被多选逻辑误伤）
  {
    const { window, ns } = loadAt('https://www.pmphmooc.com/course/1');
    ns.CONFIG.QUIZ_ANSWER_SOURCE = 'bank';
    ns.CONFIG.QUIZ_VISION_ENABLED = false;
    ns.quizBank = ns.quizBank || {};
    ns.quizBank['题'] = 1;
    const { sel, submitted } = makeChoiceQuestion(window, ['选项A', '选项B', '选项C']);
    ns.renweiTickQuiz();
    await tick();
    assert('单选·题库路径: 题库存1 → 仅点索引1', sel.idx === 1 && sel.clicked.size === 1);
    assert('单选·题库路径: 点击提交', submitted.val === true);
  }

  console.log(fail === 0 ? '结论: PASS（选择题三型均正确处理 + 题库路径多选回归）' : '结论: FAIL(' + fail + ')');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(function (e) { console.error(e); process.exit(1); });
