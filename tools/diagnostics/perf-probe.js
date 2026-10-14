const projectPaths = require('./project-paths.cjs');
// 性能探针：注入产物到 jsdom，包装 DOM API 统计主循环/面板/MO 等热路径的调用次数与耗时。
// 模拟：60 个主循环周期 + 视频播放事件 + 面板打开 + 高频 DOM 变更 + 大附件白名单。
const fs = require('fs');
const { JSDOM } = projectPaths.requireSim('jsdom');
const artifact = fs.readFileSync(projectPaths.bundle, 'utf8');

// ---------- 构造页面：视频 + 课程页常见 DOM（列表/导航/题目区占位） ----------
let bodyHtml = '<video id="v1" src="https://mooc1.chaoxing.com/video1.mp4" preload="metadata"></video><div class="ans-attach-ct"></div>';
// 课程页常见节点：3000 个列表/卡片节点
for (let i = 0; i < 3000; i++) {
  bodyHtml += `<div class="chapter-item" data-idx="${i}"><span class="title">第 ${i} 节 课程内容</span><span class="time">12:3${i % 10}</span><a href="/chapter/${i}">进入</a></div>`;
}

const dom = new JSDOM('<!DOCTYPE html><html><head><title>学习通</title></head><body>' + bodyHtml + '</body></html>', {
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const win = dom.window;
const doc = win.document;

// 媒体桩
const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
win.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
win.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
win.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!win.HTMLMediaElement.prototype.load) win.HTMLMediaElement.prototype.load = function () {};

// ---------- DOM API 统计包装 ----------
const stats = {
  qsa: { n: 0, ms: 0 }, gqsa: { n: 0, ms: 0 }, getEBTN: { n: 0, ms: 0 }, getEBI: { n: 0, ms: 0 },
  append: { n: 0, ms: 0 }, innerHTML: { n: 0, ms: 0 }, events: { n: 0, ms: 0 },
};
function wrap(proto, name, key) {
  const orig = proto[name];
  proto[name] = function (...args) {
    const t0 = performance.now();
    const r = orig.apply(this, args);
    stats[key].n++; stats[key].ms += performance.now() - t0;
    return r;
  };
}
wrap(doc, 'querySelectorAll', 'qsa');
wrap(doc, 'getElementsByTagName', 'getEBTN');
wrap(doc, 'getElementById', 'getEBI');
const origDispatch = win.EventTarget.prototype.dispatchEvent;
win.EventTarget.prototype.dispatchEvent = function (e) {
  const t0 = performance.now();
  const r = origDispatch.call(this, e);
  stats.events.n++; stats.events.ms += performance.now() - t0;
  return r;
};

// 错误收集
const errors = [];
win.addEventListener('error', (e) => errors.push(String(e.message || e.error)));

// ---------- 注入 ----------
win.eval(artifact);
const ns = win.__CX_FORCE_PLAY;

// 模拟播放状态
const video = doc.getElementById('v1');
video.paused = false;

function resetStats() { for (const k in stats) { stats[k].n = 0; stats[k].ms = 0; } }

function report(label) {
  const row = (k) => `${k}=${stats[k].n}次/${stats[k].ms.toFixed(1)}ms`;
  console.log(`[${label}] qsa=${stats.qsa.n}/${stats.qsa.ms.toFixed(1)}ms gEBTN=${stats.getEBTN.n}/${stats.getEBTN.ms.toFixed(1)}ms getEBI=${stats.getEBI.n} 事件=${stats.events.n}/${stats.events.ms.toFixed(1)}ms`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // A. 稳态 tick 成本（无面板、无题）：等 2 个主循环周期
  resetStats();
  await sleep(4600);
  report('A.稳态60tick等效(2周期)');
  console.log('   errors:', errors.length);

  // B. 视频事件高频（模拟播放中 timeupdate 每 250ms × 8 次）
  resetStats();
  for (let i = 0; i < 8; i++) {
    video.dispatchEvent(new win.Event('timeupdate'));
    video.dispatchEvent(new win.Event('play'));
    await sleep(250);
  }
  report('B.视频事件×16(2s)');

  // C. 面板打开 + 主循环 videos:scanned 渲染
  resetStats();
  const pressP = () => doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
  pressP();
  await sleep(400);           // 面板构建
  report('C1.面板打开');
  resetStats();
  await sleep(2300);          // 一个主循环周期（面板可见 → videos:scanned → 节流渲染）
  report('C2.面板打开后一个tick周期');
  pressP();                   // 关闭面板

  // D. 高频 DOM 变更（模拟弹幕/动态刷新：200 次/秒 节点插入 3s）
  resetStats();
  let inserted = 0;
  const iv = setInterval(() => {
    const el = doc.createElement('div');
    el.className = 'danmaku-item';
    el.textContent = '弹幕内容' + inserted;
    doc.body.appendChild(el);
    inserted++;
  }, 5);
  await sleep(3000);
  clearInterval(iv);
  report(`D.高频DOM变更3000次插入(3s) → 实际${inserted}次`);
  console.log('   moQueue 大小:', ns.kvs ? '(n/a)' : '', 'ended:', 'n/a');

  // E. 大附件白名单 videoBelongsToTask 成本（模拟 500 键白名单）
  resetStats();
  try {
    if (ns.toolkit && ns.toolkit.collectAttachmentIds) {
      const big = [];
      for (let i = 0; i < 500; i++) big.push({ property: { objectid: 'obj_' + i, type: 'video' } });
      ns.toolkit.collectAttachmentIds(big);
    }
  } catch (e) { console.log('   E 注入白名单跳过:', e.message); }
  // 触发全量扫描（visibility 切回）
  doc.dispatchEvent(new win.Event('visibilitychange'));
  await sleep(400);
  report('E.500键白名单+全量重扫');
  console.log('   errors:', errors.length ? errors.slice(0, 3) : 'none');

  dom.window.close();
  console.log('\n探针结束');
  process.exit(0);
})();
