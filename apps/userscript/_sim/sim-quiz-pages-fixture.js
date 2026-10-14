// 答题页 fixture 校准回归：用模拟的真实站点答题页结构，断言 src 内实际选择器并集能命中。
// 与 sim-dump-elements.js 同模式，但选择器**从源文件提取**（而非构建产物），避免拼接后重名误匹配：
//   - 超星：chaoxing-exam.js 的 CHAOXING_EXAM（真实 doHomeWorkNew 校准结构 .Zy_ulTop / li.font-cxsecret）
//   - 智慧树：zhihuishu-exam.js 的 CFG（best-effort 并集 .question-item / .option-item）
// 目的：把「面板报检测到 0 题 / 选择器待校准」这类真机问题，转成可自动回归的断言。
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const fx = require('./fixtures-quiz-pages.js');

const srcDir = path.resolve(__dirname, '..', 'src', 'chaoxing-force-play', 'sites');
const srcCx = fs.readFileSync(path.join(srcDir, 'chaoxing-exam.js'), 'utf8');
const srcZh = fs.readFileSync(path.join(srcDir, 'zhihuishu-exam.js'), 'utf8');

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

// 从源码文本中提取对象字面量（CHAOXING_EXAM / CFG），保证测试与源码同源。
function grabObj(code, name) {
  const m = code.match(new RegExp('var ' + name + ' = \\{([\\s\\S]*?)\\n[ ]{2,4}\\};'));
  if (!m) return null;
  try { return new Function('return ({' + m[1] + '});')(); } catch (e) { return { __err: e.message }; }
}

// 统计选择器并集在 doc 中的命中总数。
function countHits(doc, sels) {
  let n = 0;
  for (const s of sels) { try { n += doc.querySelectorAll(s).length; } catch (e) { /* 非法选择器跳过 */ } }
  return n;
}

const CHAOXING = grabObj(srcCx, 'CHAOXING_EXAM');
const ZH = grabObj(srcZh, 'CFG');
assert('fixture 能从源文件提取 CHAOXING_EXAM', !!CHAOXING && !CHAOXING.__err, CHAOXING && CHAOXING.__err);
assert('fixture 能从源文件提取 zhihuishu CFG', !!ZH && !ZH.__err, ZH && ZH.__err);

// ============ C) 超星学习通作业/考试页（真实校准结构） ============
console.log('\n==================== C) 超星作业/考试页 ====================');
{
  const dom = new JSDOM(fx.chaoxingQuizHtml(), {
    url: 'https://mooc1.chaoxing.com/mooc-ans/knowledge/work/doHomeWorkNew',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { document } = dom.window;

  if (CHAOXING && !CHAOXING.__err) {
    const q = countHits(document, CHAOXING.questionSels);
    const o = countHits(document, CHAOXING.optionSels);
    const s = countHits(document, CHAOXING.submitSels);
    assert('C1 questionSels 并集命中题目容器(div.TiMu) >= 2', q >= 2, q);
    assert('C2 optionSels 并集命中选项 li.before-after-checkbox >= 4', o >= 4, o);
    assert('C5 submitSels 命中 .submit-btn', s >= 1, s);
  }

  const checked = document.querySelector('li[aria-checked="true"]');
  assert('C3 已选标记 li[aria-checked=true] 命中', !!checked);
  const marked = document.querySelector('.num_option.check_answer');
  assert('C4 已选样式 .num_option.check_answer 命中', !!marked, marked && marked.textContent);
}

// ============ D) 智慧树作业/考试页（best-effort 结构） ============
console.log('\n==================== D) 智慧树作业/考试页 ====================');
{
  const dom = new JSDOM(fx.zhihuishuExamHtml(), {
    url: 'https://online.zhihuishu.com/onlineExam/webExamList',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { document } = dom.window;

  if (ZH && !ZH.__err) {
    const q = countHits(document, ZH.questionSels);
    const o = countHits(document, ZH.optionSels);
    const n = countHits(document, ZH.nextSels);
    const s = countHits(document, ZH.submitSels);
    assert('D1 questionSels 并集命中 .question-item >= 2', q >= 2, q);
    assert('D2 optionSels 并集命中 .option-item >= 5', o >= 5, o);
    assert('D4 nextSels 命中 .next-page', n >= 1, n);
    assert('D4 submitSels 命中 .submit-btn', s >= 1, s);
  }

  const qs = document.querySelectorAll('.question-item');
  assert('D3 每题选项内含 input[type=radio/checkbox]', qs.length >= 2 &&
    !!qs[0].querySelector('input[type="radio"]') && !!qs[1].querySelector('input[type="checkbox"]'));
  const sel = document.querySelector('.option-item.active');
  assert('D6 已选 .option-item.active 命中（对应 _zheOptions/anySel）', !!sel);
}

console.log('\n==================== 答题页 fixture 结论 ====================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
console.log('结论: PASS — 答题页真实结构模拟已就位，src 内选择器并集命中通过（真机 dump 后替换 fixture 即可长期回归）');
process.exit(0);
