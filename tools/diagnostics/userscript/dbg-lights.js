const projectPaths = require('../project-paths.cjs');
// 调试：追踪 quiz.js 信号灯登记/同步过程（注入日志，不修改源码）
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let code = fs.readFileSync(projectPaths.bundle, 'utf8');

// 在登记块后注入日志（带调用栈前 3 帧定位来源）
const regBlock = "          _quizLightFp[fp] = _quizLights.length;\n          _quizLights.push({ seq: _quizLights.length + 1, fp: fp, state: 'idle' });";
const regLog = regBlock + "\n          try { console.log('[LIGHT-REG] fp=' + fp.slice(0, 60) + ' len=' + _quizLights.length + ' tick=' + _quizTickCount + ' gen=' + _quizDirtyGen + ' had=' + _quizLastHadQuestions + ' | ' + (new Error().stack || '').split('\\n').slice(1, 4).join(' < ').slice(0, 300)); } catch (e) {}";
if (code.indexOf(regBlock) < 0) { console.error('REG BLOCK NOT FOUND'); process.exit(2); }
code = code.split(regBlock).join(regLog);

// 在 _quizSyncLights 状态循环里注入每灯状态日志
const syncBlock = "      l.state = st;";
const syncLog = syncBlock + "\n      try { console.log('[LIGHT-SYNC] fp=' + fp.slice(0, 40) + ' st=' + st + ' handled=' + !!_quizHandled[fp] + ' pending=' + !!_quizAIPending[fp]); } catch (e) {}";
if (code.indexOf(syncBlock) < 0) { console.error('SYNC BLOCK NOT FOUND'); process.exit(2); }
code = code.split(syncBlock).join(syncLog);

// 在 _quizBumpDirty 里注入日志
const bumpBlock = "    if (_now - _quizDirtyAt >= 2000) { _quizDirtyAt = _now; _quizDirtyGen++; }";
const bumpLog = bumpBlock + "\n    try { console.log('[DIRTY-BUMP] gen=' + _quizDirtyGen + ' | ' + (new Error().stack || '').split('\\n').slice(1, 3).join(' < ').slice(0, 200)); } catch (e) {}";
if (code.indexOf(bumpBlock) < 0) { console.error('BUMP BLOCK NOT FOUND'); process.exit(2); }
code = code.split(bumpBlock).join(bumpLog);

const examHtml = `<!DOCTYPE html><html><head><title>作业</title></head><body>
<div class="ans-attach-ct"></div>
<div class="TiMu newTiMu">
  <div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】中国的首都是？</span></div>
  <ul class="Zy_ulTop">
    <li class="before-after-checkbox" role="checkbox" aria-label="A 北京">A 北京</li>
    <li class="before-after-checkbox" role="checkbox" aria-label="B 上海">B 上海</li>
  </ul>
</div>
<div class="TiMu newTiMu">
  <div class="Zy_TItle"><span class="newZy_TItle">2 【判断题】地球是圆的</span></div>
  <ul class="Zy_ulTop">
    <li class="before-after-checkbox" role="checkbox" aria-label="A 正确">A 正确</li>
    <li class="before-after-checkbox" role="checkbox" aria-label="B 错误">B 错误</li>
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
win.localStorage.setItem('cx_quiz_auto', '1');
win.localStorage.setItem('cx_quiz_autosubmit', '1');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== phase A: wait 2500ms (main-loop static detect) ===');
  await sleep(2500);
  console.log('A lights:', JSON.stringify(ns.quizLights.map((l) => ({ seq: l.seq, fp: l.fp, state: l.state }))));
  console.log('=== phase B: append q3, wait 1500ms ===');
  const q3 = win.document.createElement('div');
  q3.className = 'TiMu newTiMu';
  q3.innerHTML = '<div class="Zy_TItle"><span class="newZy_TItle">3 【单选题】动态题</span></div><ul class="Zy_ulTop"><li class="before-after-checkbox">A 甲</li><li class="before-after-checkbox">B 乙</li></ul>';
  win.document.body.appendChild(q3);
  await sleep(1500);
  console.log('B lights:', JSON.stringify(ns.quizLights.map((l) => ({ seq: l.seq, fp: l.fp, state: l.state }))));
  dom.window.close();
  process.exit(0);
})();
