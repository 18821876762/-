const projectPaths = require('../project-paths.cjs');
// 复现 S11：翻页清理
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(projectPaths.bundle, 'utf8');

const html = `<!DOCTYPE html><html><head><title>作业</title></head><body>
<div class="ans-attach-ct"></div>
<div class="TiMu newTiMu"><div class="Zy_TItle"><span class="newZy_TItle">1 【单选题】旧的题一？</span></div><ul class="Zy_ulTop"><li class="before-after">A 甲</li><li class="before-after">B 乙</li></ul></div>
<div class="TiMu newTiMu"><div class="Zy_TItle"><span class="newZy_TItle">2 【单选题】旧的题二？</span></div><ul class="Zy_ulTop"><li class="before-after">A 甲</li><li class="before-after">B 乙</li></ul></div>
</body></html>`;
const dom = new JSDOM(html, { url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2&api=1', runScripts: 'dangerously', pretendToBeVisual: true });
const win = dom.window;
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};
win.HTMLCanvasElement.prototype.getContext = function () { return { addColorStop() {} }; };
win.eval(code);
const ns = win.__CX_FORCE_PLAY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dump = () => ns.quizLights.map((l) => ({ fp: l.fp.slice(0, 24), st: l.state, rm: !!l.remote }));

(async () => {
  await sleep(2200);
  console.log('初始:', JSON.stringify(dump()));
  // 模拟翻页：移除旧题，插入 3 新题
  Array.from(win.document.querySelectorAll('div.TiMu')).forEach((q) => q.remove());
  for (let n = 1; n <= 3; n++) {
    const q = win.document.createElement('div');
    q.className = 'TiMu newTiMu';
    q.innerHTML = `<div class="Zy_TItle"><span class="newZy_TItle">${n} 【单选题】第${n}页新题？</span></div><ul class="Zy_ulTop"><li class="before-after">A 甲</li><li class="before-after">B 乙</li></ul>`;
    win.document.body.appendChild(q);
  }
  console.log('DOM 题数:', win.document.querySelectorAll('div.TiMu').length);
  ns.quizObserveDispatch();
  await sleep(80);
  console.log('翻页后:', JSON.stringify(dump()));
  const qs = win.document.documentElement.querySelectorAll('div.TiMu');
  for (const q of qs) {
    const fp = (ns._quizAnswerParse) ? null : null;
  }
  dom.window.close();
  process.exit(0);
})();
