// 严格 AI 模式回归：开启「用 DeepSeek 网页版作答」(VISION_ENABLED + OCR=deepseek-web) 时，
// 若 DeepSeek 应答端不可用(dsAvailable()===false)，必须「停下报错」——绝不随机点选、绝不自动提交。
// 关键断言：
//   - quizTick 不随机点选任何选项（无 cx-checked / aria-checked）；
//   - 提交按钮不被点击；
//   - quizAIProblems 登记失败题（停下报错），quizStats.strictMode===true。
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
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: url, pretendToBeVisual: true });
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

console.log('--- 严格 AI 模式(用 DeepSeek 网页版作答)回归 ---');
{
  // 非 DS 域（renwei）：DS 应答端不会连接 → dsAvailable()===false（符合「应答端不可用」场景）
  const { window, ns } = loadAt('https://www.renwei.com/course/1');
  ns.CONFIG.QUIZ_VISION_ENABLED = true;          // 开启「用 DeepSeek 网页版作答」
  ns.CONFIG.QUIZ_VISION_OCR = 'deepseek-web';
  const { q, submitted } = makeQuestion(window, '1+1=?', 4);
  const ans = ns.renweiTickQuiz();
  // ① 未随机作答（停下，返回 0）
  assert('严格模式: 未随机作答(返回0)', ans === 0);
  // ② 提交按钮未被点击
  assert('严格模式: 未自动提交', submitted.val !== true);
  // ③ 选项未被随机点选
  var anyChecked = Array.prototype.slice.call(q.querySelectorAll('.option-item')).some(function (o) {
    return o.classList.contains('cx-checked') || o.getAttribute('aria-checked') === 'true';
  });
  assert('严格模式: 选项未被随机点选', !anyChecked);
  // ④ 失败题已登记（停下报错，不静默随机）
  assert('严格模式: 失败题已登记 quizAIProblems', !!ns.quizAIProblems && Object.keys(ns.quizAIProblems).length >= 1);
  // ⑤ stats 暴露 strictMode
  assert('严格模式: quizStats.strictMode===true', !!ns.quizStats && ns.quizStats.strictMode === true);
  // ⑥⑦ 诊断信息必须包含「AI 作答」段落 + 停下报错原因（使报错与诊断结合、可一键复盘）
  var diag = '';
  try { if (typeof ns.buildDevReportText === 'function') diag = ns.buildDevReportText(); } catch (e) { diag = ''; }
  assert('严格模式: 诊断含「AI 作答」段落', diag.indexOf('AI 作答') >= 0);
  assert('严格模式: 诊断含停下报错原因(⛔/DeepSeek 网页版)', diag.indexOf('⛔') >= 0 && diag.indexOf('DeepSeek 网页版') >= 0);
}
console.log(fail === 0 ? '结论: PASS — 严格 AI 模式禁止随机兜底，停下报错' : ('结论: FAIL (' + fail + ')'));
process.exit(fail ? 1 : 0);
