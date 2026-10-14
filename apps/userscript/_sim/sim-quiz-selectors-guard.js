// QUIZ 选择器契约运行时守护（P2-5 第一步「先补 _sim 守护再改」）
// 锁定当前 quiz.js 的 questionSels/stemSels/optionSels/submitSels 仍能「定位题块 + 作答 + 点提交」。
// 目的：后续对 document-wide 宽属性选择器（questionSels 的 li[class*="question"] / [class*="quiz-item"] 等）
// 做收敛时，若误删某个真实站点仍在用的模式，本守护会立刻 FAIL，避免「破坏真机命中」回归。
// 注意：stemSels 在 quizTick 内已按「题块容器 > stem」作用域限定（见 quiz.js _quizSubmit/qEl.querySelector），
// 故收窄收益集中在 document-wide 的 questionSels；真实站点应使用哪个窄模式需 H7 真实 DOM dump 校准。
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
// 用给定 questionSel 模式构造题块，验证 quizTick 能定位并作答 + 点提交
function buildQuestion(window, qTag, qClass) {
  const q = window.document.createElement(qTag);
  q.setAttribute('class', qClass);
  const s = window.document.createElement('div'); s.className = 'stem'; s.textContent = '1+1=?'; q.appendChild(s);
  for (let i = 0; i < 4; i++) {
    const o = window.document.createElement('div'); o.className = 'option-item'; o.textContent = '选项' + i; q.appendChild(o);
  }
  const b = window.document.createElement('button'); b.className = 'submit-btn'; b.textContent = '提交';
  const clicked = { v: false }; b.addEventListener('click', function () { clicked.v = true; }); q.appendChild(b);
  window.document.body.appendChild(q);
  return { q, clicked };
}
console.log('--- QUIZ 选择器契约守护 ---');
// 当前 questionSels 每个模式（含宽属性选择器）都应能定位题块
const cases = [
  { tag: 'div', cls: 'question-item' },
  { tag: 'div', cls: 'quiz-item' },
  { tag: 'div', cls: 'topic-item' },
  { tag: 'div', cls: 'exam-item' },
  { tag: 'li', cls: 'question-nav' },           // 命中 li[class*="question"]
  { tag: 'div', cls: 'quiz-item-box' },         // 命中 [class*="quiz-item"]
  { tag: 'div', cls: 'q-container' }
];
cases.forEach(function (c, i) {
  const { window, ns } = loadAt('https://mooc.xxx.edu.cn/learn/1');
  const { clicked } = buildQuestion(window, c.tag, c.cls);
  const ans = ns.quizTick({
    questionSels: ['.question-item', '.quiz-item', '.topic-item', '.exam-item', 'li[class*="question"]', '[class*="quiz-item"]', '.q-container'],
    stemSels: ['.stem'],
    optionSels: ['.option-item'],
    submitSels: ['.submit-btn']
  });
  assert('模式#' + i + ' (' + c.tag + '.' + c.cls + ') 定位并作答', ans >= 1);
  assert('模式#' + i + ' 提交按钮被点', clicked.v === true);
});
// stemSels / optionSels / submitSels 当前精确类名也应命中（锁默认契约）
{
  const { window, ns } = loadAt('https://mooc.xxx.edu.cn/learn/1');
  const q = window.document.createElement('div'); q.className = 'question-item';
  const s = window.document.createElement('div'); s.className = 'question-title'; s.textContent = '2+2=?'; q.appendChild(s);
  for (let i = 0; i < 3; i++) { const o = window.document.createElement('div'); o.className = 'choice-item'; o.textContent = '项' + i; q.appendChild(o); }
  const b = window.document.createElement('button'); b.className = 'answer-btn'; b.textContent = '作答'; const clicked = { v: false }; b.addEventListener('click', function () { clicked.v = true; }); q.appendChild(b);
  window.document.body.appendChild(q);
  const ans = ns.quizTick({
    questionSels: ['.question-item'],
    stemSels: ['.stem', '.question-title', '.q-title', '.topic-title', '[class*="stem"]', '[class*="title"]'],
    optionSels: ['.option-item', '.q-option', '.choice-item', 'li[class*="option"]', '[class*="choice"]', '.answer-item'],
    submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn', '.next-btn']
  });
  assert('默认 stem/option/submit 类名契约命中', ans >= 1 && clicked.v === true);
}
console.log(fail === 0 ? '结论: PASS — QUIZ 选择器契约锁定' : ('结论: FAIL (' + fail + ')'));
process.exit(fail ? 1 : 0);
