// 置信→行为分级落点回归（v4.19.32）：验证 _dsParseAnswer / _dsReadConfidence / _dsConfToNum / _quizVisConfAction
// 联合构成「解析答案 + 抽置信 + 数值化 + 决策」链路，确保视觉作答错答不再无条件直交。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=1', runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
win.eval(code);
const ns = win.__CX_FORCE_PLAY;
let pass = 0, fail = 0;
function assert(name, cond, got) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + ' :: got=' + JSON.stringify(got)); } }

// 1) 解析 + 置信 联合：DS 回复含「答案：X｜置信：Y」
assert('_dsParseAnswer 抽字母(高置信格式)', ns._dsParseAnswer('经核对 B 正确。答案：B｜置信：高') === 'B');
assert('_dsReadConfidence 抽 high', ns._dsReadConfidence('答案：B｜置信：高') === 'high');
assert('_dsReadConfidence 抽 mid', ns._dsReadConfidence('答案：AB｜置信：中') === 'mid');
assert('_dsReadConfidence 抽 low', ns._dsReadConfidence('答案：A｜置信：低') === 'low');

// 2) 数值映射
assert('high→0.95', ns._dsConfToNum('high') === 0.95);
assert('mid→0.65', ns._dsConfToNum('mid') === 0.65);
assert('low→0.4', ns._dsConfToNum('low') === 0.4);

// 3) 置信→行为决策（落点分级）
assert('high→submit', ns._quizVisConfAction('high') === 'submit');
assert('mid→hold(点选不提交)', ns._quizVisConfAction('mid') === 'hold');
assert('low→random(兜底+复核)', ns._quizVisConfAction('low') === 'random');

// 4) 隐式置信：无格式但含犹豫词
assert('单犹豫词→mid', ns._dsReadConfidence('可能是 B') === 'mid');
assert('自相矛盾→low', ns._dsReadConfidence('我选 C，但仔细看其实 C 不对') === 'low');
assert('无信号默认 high(保持旧行为)', ns._dsReadConfidence('答案：D') === 'high');

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
dom.window.close();
process.exit(fail ? 1 : 0);
