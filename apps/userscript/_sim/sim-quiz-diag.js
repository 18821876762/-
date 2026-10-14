// 回归：v4.19.14 逐题 AI 作答诊断——答案解析「失败原因分类」(_quizAnswerParse) 与诊断明细导出(quizAiDiag)。
// 覆盖：字母命中 / 多选多字母 / 字母越界 / 回选项内容 / 判断语义词 / 空令牌，确保诊断能准确定位根因。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.eval(code);
const ns = win.__CX_FORCE_PLAY;

function mkOpts(texts) {
  return texts.map(function (t) { var li = win.document.createElement('li'); li.textContent = t; return li; });
}
const SINGLE = mkOpts(['A 翻阅资料选择', 'B 查阅文献', 'C 实地调研', 'D 网络检索']);   // 4 个单选选项
const JUDGE = mkOpts(['A 正确', 'B 错误']);                                          // 2 个判断选项

let pass = 0, fail = 0;
function assert(name, cond, got) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); }
}

// 1) 字母命中（在范围内）→ letter-ok
var r1 = ns._quizAnswerParse('B', SINGLE, false);
assert('字母命中→letter-ok', r1 && r1.reason === 'letter-ok', r1);
assert('字母命中→下标[1]', r1 && JSON.stringify(r1.idxs) === JSON.stringify([1]), r1 && r1.idxs);

// 2) 多选多字母 → letter-multi-ok
var r2 = ns._quizAnswerParse('AB', SINGLE, true);
assert('多选多字母→letter-multi-ok', r2 && r2.reason === 'letter-multi-ok', r2);
assert('多选多字母→下标[0,1]', r2 && JSON.stringify(r2.idxs) === JSON.stringify([0, 1]), r2 && r2.idxs);
assert('多选多字母→multi=true', r2 && r2.multi === true, r2);

// 3) 字母越界（回 E 但仅 4 项）→ letter-out-of-range（诊断关键：区分“回的是字母但错”）
var r3 = ns._quizAnswerParse('E', SINGLE, false);
assert('字母越界→letter-out-of-range', r3 && r3.reason === 'letter-out-of-range', r3);
assert('字母越界→无下标', r3 && r3.idxs.length === 0, r3);

// 4) 回的是选项内容（非字母）→ no-letter-or-semantic（诊断关键：DeepSeek 把真实选项文本当答案）
var r4 = ns._quizAnswerParse('翻阅资料选择', SINGLE, false);
assert('回选项内容→no-letter-or-semantic', r4 && r4.reason === 'no-letter-or-semantic', r4);

// 5) 判断语义词 → semantic-ok（按选项标签正负极性匹配，不绑定 A=是/B=否）
var r5 = ns._quizAnswerParse('正确', JUDGE, false);
assert('判断语义词→semantic-ok', r5 && r5.reason === 'semantic-ok', r5);
assert('判断语义词→下标[0]', r5 && JSON.stringify(r5.idxs) === JSON.stringify([0]), r5);
var r5b = ns._quizAnswerParse('错误', JUDGE, false);
assert('判断否定词→semantic-ok 下标[1]', r5b && r5b.reason === 'semantic-ok' && JSON.stringify(r5b.idxs) === JSON.stringify([1]), r5b);

// 6) 空令牌 → null（上层走题库回查 / 随机兜底）
assert('空令牌→null', ns._quizAnswerParse('', SINGLE, false) === null);
assert('null令牌→null', ns._quizAnswerParse(null, SINGLE, false) === null);

// 7) _quizAnswerParse 委托语义：越界→reason letter-out-of-range 且 idxs 空；命中→正确下标
assert('越界解析→letter-out-of-range 且 idxs 空', (function () { var x = ns._quizAnswerParse('E', SINGLE, false); return x && x.reason === 'letter-out-of-range' && x.idxs.length === 0; })());
assert('命中解析→idxs[2]', (function () { var x = ns._quizAnswerParse('C', SINGLE, false); return x && x.idxs.length === 1 && x.idxs[0] === 2; })());
// 7b) 散文保护：英文长句里的字母不被误抓（如 "The correct answer is B" 不应把 answer 里的 a 当选项 A）
var rProse = ns._quizAnswerParse('The correct answer is B', SINGLE, false);
assert('散文回复→不误抓字母(no-letter-or-semantic)', rProse && rProse.reason === 'no-letter-or-semantic', rProse);
// 7c) 5~8 选项题：DeepSeek 回正确字母(如 E)应被解析命中（旧版 A–D 会漏→随机兜底）
var EIGHT = mkOpts(['A x', 'B x', 'C x', 'D x', 'E x', 'F x', 'G x', 'H x']);
var r8 = ns._quizAnswerParse('E', EIGHT, false);
assert('8选项题回E→letter-ok 下标[4]', r8 && r8.reason === 'letter-ok' && JSON.stringify(r8.idxs) === JSON.stringify([4]), r8);

// 8) 诊断明细导出已接线（对象存在，供诊断页读取）
assert('quizAiDiag 已导出为对象', ns.quizAiDiag && typeof ns.quizAiDiag === 'object', typeof ns.quizAiDiag);

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
dom.window.close();
process.exit(fail ? 1 : 0);
