// 调试：TiMu 题目的灯指纹与检测
const { JSDOM } = require('jsdom');
const fs = require('fs');
const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
const html = '<!DOCTYPE html><html><head><title>作业</title></head><body><div class="TiMu newTiMu"><div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】A</span></div><ul class="Zy_ulTop"><li class="before-after-checkbox">A 甲</li><li class="before-after-checkbox">B 乙</li></ul></div><div class="TiMu newTiMu"><div class="Zy_TItle"><span class="newZy_TItle">2 【判断题】B</span></div><ul class="Zy_ulTop"><li class="before-after-checkbox">A 对</li><li class="before-after-checkbox">B 错</li></ul></div></body></html>';
const dom = new JSDOM(html, { url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2&api=1', runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
win.eval(code);
const ns = win.__CX_FORCE_PLAY;
win.localStorage.setItem('cx_quiz_auto', '1');
win.localStorage.setItem('cx_quiz_autosubmit', '1');
setTimeout(() => {
  ns.quizObserveDispatch();
  setTimeout(() => {
    console.log('lights:', JSON.stringify(ns.quizLights.map((l) => ({ seq: l.seq, fp: l.fp.slice(0, 34), state: l.state }))));
    console.log('quizStats:', JSON.stringify(ns.quizStats));
    process.exit(0);
  }, 150);
}, 100);
