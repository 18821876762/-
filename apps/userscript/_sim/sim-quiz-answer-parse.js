// 回归：quiz.js _quizAnswerParse —— v4.19.16 修复「纯选项字母串 ABCD 被散文保护误判丢弃 → 整题解析失败变红」。
// 复现用户诊断：DeepSeek 回传 answer=ABCD（多选全选），旧版 /[A-Za-z]{3,}/ 把 ABCD 当散文 → letters=null → 红灯。
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
win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
win.eval(code);
const ns = win.__CX_FORCE_PLAY;

let pass = 0, fail = 0;
function assert(name, cond, got) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); }
}

// 4 选项（多选）opts 桩
const mkOpts = (n) => Array.from({ length: n }, function (_, i) {
  const li = win.document.createElement('li');
  li.textContent = String.fromCharCode(65 + i) + ' 选项' + String.fromCharCode(65 + i);
  return li;
});
const opts4 = mkOpts(4);
const opts5 = mkOpts(5);

const PA = ns._quizAnswerParse;

// 关键回归：ABCD 在 4 选项多选题 → [0,1,2,3]
(function () {
  const r = PA('ABCD', opts4, true);
  assert('ABCD(4选项多选)→idxs[0,1,2,3]', r && r.idxs.join(',') === '0,1,2,3' && r.reason === 'letter-multi-ok', r);
})();
// ABC 在 5 选项多选 → [0,1,2]
(function () {
  const r = PA('ABC', opts5, true);
  assert('ABC(5选项多选)→idxs[0,1,2]', r && r.idxs.join(',') === '0,1,2' && r.reason === 'letter-multi-ok', r);
})();
// 普通散文仍被保护：答案里混英文单词 "answer"，不应误抓字母
(function () {
  const r = PA('The answer is not A', opts4, false);
  // 含 I-Z 字母 → 散文 → 仅按规则取单字母（此处 "A" 在否定/散文中，应取不到干净字母→no-letter）
  assert('散文含 answer 不被当纯选项串误抓', !r || (r.idxs.length === 0) || r.reason !== 'letter-multi-ok', r);
})();
// 思考态前缀串（模拟 _dsLatestReply 剥离前）经 _dsParseAnswer 提取仍正确（_dsParseAnswer 已隔离）
(function () {
  const a = ns._dsParseAnswer('已思考（用时 3 秒）答案：ABCD');
  assert('_dsParseAnswer 剥离思考前缀后取 ABCD', a === 'ABCD', a);
})();
// 单选 ABCD（multi=false）→ 仍解析多字母但下游只点首个（此处仅验证解析不丢）
(function () {
  const r = PA('ABCD', opts4, false);
  assert('单选 ABCD 解析不丢字母(下游取首个)', r && r.idxs.length === 4, r);
})();

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
dom.window.close();
process.exit(fail ? 1 : 0);
