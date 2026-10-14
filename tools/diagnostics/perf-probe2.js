const projectPaths = require('./project-paths.cjs');
// 性能探针 2：无题页 quizTick 成本 + 面板打开时 renderDashboard 成本分解
const fs = require('fs');
const { JSDOM } = projectPaths.requireSim('jsdom');
const artifact = fs.readFileSync(projectPaths.bundle, 'utf8');

let bodyHtml = '<video id="v1" src="https://mooc1.chaoxing.com/video1.mp4" preload="metadata"></video><div class="ans-attach-ct"></div>';
for (let i = 0; i < 3000; i++) {
  bodyHtml += `<div class="chapter-item" data-idx="${i}"><span class="title">第 ${i} 节</span><a href="/c/${i}">进入</a></div>`;
}

const dom = new JSDOM('<!DOCTYPE html><html><head><title>学习通</title></head><body>' + bodyHtml + '</body></html>', {
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;
const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};

const stats = { qsa: { n: 0, ms: 0 }, qsaBySel: {} };
const origQSA = doc.querySelectorAll.bind(doc);
doc.querySelectorAll = function (sel) {
  const t0 = performance.now();
  const r = origQSA(sel);
  const dt = performance.now() - t0;
  stats.qsa.n++; stats.qsa.ms += dt;
  const key = String(sel).slice(0, 60);
  if (!stats.qsaBySel[key]) stats.qsaBySel[key] = { n: 0, ms: 0 };
  stats.qsaBySel[key].n++; stats.qsaBySel[key].ms += dt;
  return r;
};

win.eval(artifact);
const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message || e.error)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // F. 无题页 quizTick（MO 驱动的 quizObserveDispatch）10 次
  stats.qsa.n = 0; stats.qsa.ms = 0; stats.qsaBySel = {};
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    win.__CX_FORCE_PLAY.quizObserveDispatch();
    const dt = performance.now() - t0;
    if (i === 0) console.log('   F.quizObserveDispatch 首次耗时:', dt.toFixed(1) + 'ms');
  }
  console.log('F.quizObserveDispatch×10:', stats.qsa.n + '次 qsa /', stats.qsa.ms.toFixed(1) + 'ms');
  const top = Object.entries(stats.qsaBySel).sort((a, b) => b[1].ms - a[1].ms).slice(0, 5);
  top.forEach(([sel, s]) => console.log(`   qsa[${sel}] ${s.n}次/${s.ms.toFixed(1)}ms`));

  // G. 面板打开后 renderDashboard 单次成本（手动触发 panel:refresh 一次）
  stats.qsa.n = 0; stats.qsa.ms = 0; stats.qsaBySel = {};
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
  await sleep(500);
  stats.qsa.n = 0; stats.qsa.ms = 0; stats.qsaBySel = {};
  const t0 = performance.now();
  win.EventBus.emit('panel:refresh');
  const dt = performance.now() - t0;
  console.log('G.单次 panel:refresh:', dt.toFixed(1) + 'ms,', stats.qsa.n + '次 qsa /', stats.qsa.ms.toFixed(1) + 'ms');
  const top2 = Object.entries(stats.qsaBySel).sort((a, b) => b[1].ms - a[1].ms).slice(0, 6);
  top2.forEach(([sel, s]) => console.log(`   qsa[${sel}] ${s.n}次/${s.ms.toFixed(1)}ms`));

  // H. 面板打开时 videos:scanned（节流 150ms）连续 5 次触发
  stats.qsa.n = 0; stats.qsa.ms = 0; stats.qsaBySel = {};
  for (let i = 0; i < 5; i++) {
    win.EventBus.emit('videos:scanned');
    await sleep(180);
  }
  await sleep(200);
  console.log('H.videos:scanned×5(尾沿节流):', stats.qsa.n + '次 qsa /', stats.qsa.ms.toFixed(1) + 'ms');

  console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
  dom.window.close();
  process.exit(0);
})();
