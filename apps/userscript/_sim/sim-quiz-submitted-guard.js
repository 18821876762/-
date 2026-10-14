// 回归：_quizPageSubmitted 两个过宽信号的误判防护（v4.19.10 之后收窄）
// 直接调用导出的 ns.quizPageSubmitted(sels) 断言「已提交」判定，避免依赖灯态间接推断。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const examHtml = `<!DOCTYPE html><html><head><title>作业</title></head><body>
<div class="TiMu newTiMu">
  <div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】占位题</span></div>
  <ul class="Zy_ulTop">
    <li class="before-after-checkbox" role="checkbox" aria-label="A 甲">A 甲</li>
    <li class="before-after-checkbox" role="checkbox" aria-label="B 乙">B 乙</li>
  </ul>
</div>
</body></html>`;

const dom = new JSDOM(examHtml, {
  url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2&api=1',
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
// submitSels 用不存在选择器 → 触发「无提交按钮」分支；questionSels 命中 div.TiMu
const sels = { questionSels: ['div.TiMu', '.questionLi', '.questionBox', '.examPaper'], submitSels: ['.__cxNoSuchSubmitBtn'] };

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

// 钩子必须已导出
assert('H: quizPageSubmitted 钩子已导出', typeof ns.quizPageSubmitted === 'function', { t: typeof ns.quizPageSubmitted });

// 基线：普通作业页（无结果元素、无已勾选）不应判已提交
assert('G0: 普通作业页（无结果元素）不误判为已提交', ns.quizPageSubmitted(sels) === false);

// 信号② 误判防护：含 score-*/grade-* 普通元素不应判已提交（此前裸 score/grade 子串会误命中）
const scoreEl = win.document.createElement('div');
scoreEl.className = 'score-detail'; scoreEl.textContent = '本次得分：未完成';
win.document.body.appendChild(scoreEl);
assert('G1: 含 score-* 普通元素不误判为已提交（信号②收窄）', ns.quizPageSubmitted(sels) === false);
scoreEl.remove();

const gradeEl = win.document.createElement('div');
gradeEl.className = 'grade-badge'; gradeEl.textContent = '评级';
win.document.body.appendChild(gradeEl);
assert('G2: 含 grade-* 普通元素不误判为已提交（信号②收窄）', ns.quizPageSubmitted(sels) === false);
gradeEl.remove();

// 信号② 正向：结果页专属 class 仍判已提交
const mr = win.document.createElement('div'); mr.className = 'markResult'; mr.textContent = '已提交';
win.document.body.appendChild(mr);
assert('G3: 结果页 markResult 仍判为已提交（信号②正向）', ns.quizPageSubmitted(sels) === true);
mr.remove();

// 信号③ 正向：自动提交 ON + 无提交按钮 + 全题勾选 → 已提交
win.localStorage.setItem('cx_quiz_autosubmit', '1');
const li = win.document.querySelector('li.before-after-checkbox');
li.classList.add('cur'); // 模拟已勾选（_quizQSelected 识别 li[class*=cur]）
assert('G4: 自动提交ON + 无提交按钮 + 全题勾选 → 已提交（信号③正向）', ns.quizPageSubmitted(sels) === true);

// 信号③ 误判防护：自动提交 OFF（二次确认模式）同态不判已提交
win.localStorage.setItem('cx_quiz_autosubmit', '0');
assert('G5: 自动提交OFF + 无提交按钮 + 全题勾选 → 不误判（信号③门控）', ns.quizPageSubmitted(sels) === false);

console.log('\n' + pass + ' PASS / ' + fail + ' FAIL');
dom.window.close();
process.exit(fail ? 1 : 0);
