// sim-video-list-index.js —— 视频列表「渲染索引对齐」回归
//
// 覆盖审计缺陷 R2：renderVideoList 逐项 bestEffort 吞错时，出错项整行不追加，
//   导致 DOM 行序与 _lastVideoList 索引脱节（列表少一行、后续行视觉位置前移），
//   用户点到的行与实际操作的视频不一致。
//
// 手法：把第 2 个视频（idx=1）的状态属性改成"读取即抛"（模拟跨域/已失效媒体元素），
//   断言：① 行数仍等于视频数；② data-vi 严格递增 0,1,2；③ 出错行为占位行；
//         ④ 点击 data-vi=2 的开关操作到的是第 3 个视频（索引映射未错位）。
'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const html = `<!DOCTYPE html>
<html><head><title>学习通</title></head>
<body>
  <video id="v1" src="https://mooc1.chaoxing.com/a1.mp4" preload="metadata"></video>
  <video id="v2" src="https://mooc1.chaoxing.com/a2.mp4" preload="metadata"></video>
  <video id="v3" src="https://mooc1.chaoxing.com/a3.mp4" preload="metadata"></video>
  <div class="ans-attach-ct"></div>
</body></html>`;

const dom = new JSDOM(html, {
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

const mockCtx = new Proxy({}, { get: (t, p) => {
  if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (p === 'getImageData') return () => ({ data: [] });
  return () => {};
} });
window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () {};
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};

const results = [];
let fail = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) fail++;
  results.push({ name, pass, extra: extra === undefined ? null : extra });
}

let loadErr = null;
try { window.eval(code); } catch (e) { loadErr = e.stack || String(e); }
ok('产物加载无异常', !loadErr, loadErr);

const v1 = document.getElementById('v1');
const v2 = document.getElementById('v2');
const v3 = document.getElementById('v3');

// 让第 2 个视频"读状态即抛"——模拟跨域/已失效元素（真实站点上 iframe 内视频被回收时会出现）
// v4.19.51：userPaused 已 Symbol 化，须经命名空间 FLAGS 取键
const UP = window.__CX_FORCE_PLAY.FLAGS.userPaused;
Object.defineProperty(v2, UP, {
  configurable: true,
  get() { throw new Error('sim: cross-origin video state unreadable'); },
  set() { /* 静默吞掉写入，避免核心逻辑 strict 模式赋值抛错干扰本用例 */ },
});

function press(key) {
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}
press('p');

const panel = document.getElementById('__cxPanel');
ok('按 P 后面板已创建', !!panel);

if (panel) {
  const rows = panel.querySelectorAll('.cx-video-item[data-vi]');
  const order = Array.prototype.map.call(rows, (r) => r.getAttribute('data-vi'));

  ok('R2-1 出错项未丢行：行数 == 视频数(3)', rows.length === 3, 'rows=' + rows.length);
  ok('R2-2 data-vi 严格按 0,1,2 递增（索引与 _lastVideoList 对齐）',
    order.join(',') === '0,1,2', order.join(','));

  const failedRow = panel.querySelector('.cx-video-item-failed');
  ok('R2-3 不可读视频渲染为占位行', !!failedRow);
  ok('R2-4 占位行占据其真实索引 1', failedRow && failedRow.getAttribute('data-vi') === '1',
    failedRow ? failedRow.getAttribute('data-vi') : 'none');
  ok('R2-5 占位行不提供开关（不可读视频禁止误操作）',
    !!failedRow && !failedRow.querySelector('.cx-video-toggle'));

  // 索引映射端到端：点 data-vi=2 的开关必须命中第 3 个视频
  const toggle2 = panel.querySelector('.cx-video-toggle[data-vi="2"]');
  ok('R2-6 索引 2 的开关存在', !!toggle2);
  if (toggle2) {
    toggle2.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    ok('R2-7 点击索引 2 命中第 3 个视频（未点错）', v3[UP] === true, String(v3[UP]));
    ok('R2-8 第 1 个视频未被误操作', v1[UP] !== true, String(v1[UP]));
  }
}

console.log('\n=== sim-video-list-index ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
