// 纯函数单测：答案决策融合 + 置信度分级（quiz-merge.js）
// 直接加载源码（无 DOM/网络依赖），验证 mergeAnswers / decisionFor / QUIZ_SRC_WEIGHT 契约。
// 运行：node tests/quiz-merge.test.js
var fs = require('fs');
var path = require('path');
var src = fs.readFileSync(path.join(__dirname, '..', 'src', 'chaoxing-force-play', 'takeover', 'engine', 'quiz-merge.js'), 'utf8');
// 在隔离作用域 eval 出函数（源码用 var 声明 + try 挂 window，node 无 window 会静默跳过挂载，但函数本身已定义）
var sandbox = {};
var vm = require('vm');
vm.createContext(sandbox);
vm.runInContext(src + '\nthis.__m = { mergeAnswers: mergeAnswers, decisionFor: decisionFor, QUIZ_SRC_WEIGHT: QUIZ_SRC_WEIGHT };', sandbox);
var M = sandbox.__m;

var pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.error('  FAIL: ' + name + (extra != null ? '  → ' + extra : '')); }
}

// ---- decisionFor 分级阈值 ----
assert('confidence 1.0 → auto', M.decisionFor(1.0) === 'auto', M.decisionFor(1.0));
assert('confidence 0.9 → auto (边界)', M.decisionFor(0.9) === 'auto', M.decisionFor(0.9));
assert('confidence 0.6 → confirm (边界)', M.decisionFor(0.6) === 'confirm', M.decisionFor(0.6));
assert('confidence 0.59 → review', M.decisionFor(0.59) === 'review', M.decisionFor(0.59));
assert('confidence 0 → review', M.decisionFor(0) === 'review', M.decisionFor(0));
assert('NaN confidence → review', M.decisionFor(NaN) === 'review', M.decisionFor(NaN));
assert('autoTh 可配 (0.8 边界)', M.decisionFor(0.8, 0.8, 0.5) === 'auto', M.decisionFor(0.8, 0.8, 0.5));

// ---- mergeAnswers 融合 ----
// 单来源 bank（权重 1.0）→ confidence 1.0，分级 auto
var r1 = M.mergeAnswers([{ idx: 2, source: 'bank' }]);
assert('single bank → index 2', r1 && r1.index === 2, JSON.stringify(r1));
assert('single bank → confidence 1.0', r1 && r1.confidence === 1.0, r1 && r1.confidence);
assert('single bank → auto', r1 && M.decisionFor(r1.confidence) === 'auto', r1 && r1.confidence);

// 单来源 random（权重 0.3）→ confidence 0.3，分级 review
var r2 = M.mergeAnswers([{ idx: 1, source: 'random' }]);
assert('single random → confidence 0.3', r2 && r2.confidence === 0.3, r2 && r2.confidence);
assert('single random → review', r2 && M.decisionFor(r2.confidence) === 'review', r2 && r2.confidence);

// 多来源一致（bank + ai 同选 idx 0）→ 高置信 auto
var r3 = M.mergeAnswers([{ idx: 0, source: 'bank' }, { idx: 0, source: 'ai' }]);
assert('multi consistent → index 0', r3 && r3.index === 0, JSON.stringify(r3));
assert('multi consistent → confidence>0.9 (auto)', r3 && r3.confidence > 0.9, r3 && r3.confidence);
assert('multi consistent → sources=[bank,ai]', r3 && r3.sources.indexOf('bank') >= 0 && r3.sources.indexOf('ai') >= 0, JSON.stringify(r3));

// 多来源分歧（bank→0, ai→1）→ 置信度 < 0.9（不盲目 auto），按加权占比下降
var r4 = M.mergeAnswers([{ idx: 0, source: 'bank' }, { idx: 1, source: 'ai' }]);
assert('multi split → best idx 0 (bank 权重大)', r4 && r4.index === 0, JSON.stringify(r4));
assert('multi split → confidence < 0.9 (非 auto)', r4 && r4.confidence < 0.9, r4 && r4.confidence);

// 空/非法输入 → null
assert('empty answers → null', M.mergeAnswers([]) === null);
assert('null answers → null', M.mergeAnswers(null) === null);
assert('all invalid idx → null', M.mergeAnswers([{ idx: undefined, source: 'bank' }]) === null);

// 权重表契约：本地库最可信，随机兜底最低
assert('weight bank=1.0', M.QUIZ_SRC_WEIGHT.bank === 1.0);
assert('weight deepseek=0.9', M.QUIZ_SRC_WEIGHT.deepseek === 0.9);
assert('weight ai=0.7', M.QUIZ_SRC_WEIGHT.ai === 0.7);
assert('weight ocr=0.5', M.QUIZ_SRC_WEIGHT.ocr === 0.5);
assert('weight random=0.3', M.QUIZ_SRC_WEIGHT.random === 0.3);

console.log('\nquiz-merge: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
