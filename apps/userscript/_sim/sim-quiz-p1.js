// P1 回归：quiz.js 指纹碰撞(P1-7) 与 合法去重不回退。
// 复用 sim-quiz.js 的 harness（loadAt / makeQuestion）。
// 关键断言：
//   - 两道「题干前 120 字完全相同、但选项不同」的题，应各自独立作答（旧指纹只取 stem 前缀会碰撞，只答 1 题）；
//   - 两道「题干与选项完全相同」的题，应被合法去重为 1 题（P1-7 修复不能破坏正常去重）。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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

function makeQuestion(window, stemText, nOpts) {
  const q = window.document.createElement('div'); q.className = 'question-item';
  const stem = window.document.createElement('div'); stem.className = 'stem'; stem.textContent = stemText;
  q.appendChild(stem);
  var submitted = { val: null };
  for (var i = 0; i < nOpts; i++) {
    const opt = window.document.createElement('div'); opt.className = 'option-item'; opt.textContent = '选项' + i;
    opt.addEventListener('click', function () {});
    q.appendChild(opt);
  }
  const btn = window.document.createElement('button'); btn.className = 'submit-btn'; btn.textContent = '提交';
  btn.addEventListener('click', function () { submitted.val = true; });
  q.appendChild(btn);
  window.document.body.appendChild(q);
  return { q: q, submitted: submitted };
}

// 120+ 字完全相同的题干前缀，用于触发旧指纹的碰撞分支
const base = '题干相同前缀用于测试指纹碰撞'.repeat(30);

console.log('--- P1 回归(quiz 指纹 / 去重) ---');
{
  const { window, ns } = loadAt('https://www.renwei.com/course/1');
  ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
  // P1-7 回归：题干完全相同、选项数量不同 → 旧指纹(仅 stem 前缀)会碰撞，只答 1 题；
  // 新指纹含「选项数量 + 首/尾选项采样」→ 两题应各自作答。
  makeQuestion(window, base, 3);
  makeQuestion(window, base, 4); // 多一个选项 '选项3'，首/尾采样不同 → 指纹不同
  const ans = ns.renweiTickQuiz();
  assert('P1-7: 同前缀不同选项的两题均作答(不碰撞)', ans === 2);
}
{
  const { window, ns } = loadAt('https://www.renwei.com/course/1');
  ns.CONFIG.QUIZ_ANSWER_SOURCE = 'random';
  // 合法去重：题干与选项完全相同 → 同一指纹 → 只答 1 题（P1-7 修复不能破坏正常去重）。
  makeQuestion(window, base, 3);
  makeQuestion(window, base, 3);
  const ans = ns.renweiTickQuiz();
  assert('去重: 完全相同的两题只答 1 题', ans === 1);
}

console.log(fail === 0 ? '结论: PASS — P1 指纹/去重回归' : ('结论: FAIL (' + fail + ')'));
process.exit(fail ? 1 : 0);
