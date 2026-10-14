// sim-toolkit-toast.js —— 修复 #1.1：toolkit.toast 静默丢弃回归
//
// 覆盖 2026-08-10 审查发现的 P0 缺陷 1.1：
//   auto-next 调 window.__CX_FORCE_PLAY.toolkit.toast(msg) 不带 level，
//   旧实现直接暴露裸 toast()（仅浮层、level 缺失早退，且不进洞察页提示流），
//   导致 auto-next 的"自动跳转"反馈被静默丢弃。
//
// 修复：toolkit.toast 改为经 EventBus.emit('ui:toast', m, lv || 'info') 路由，
//   洞察页订阅者 _onToastForFeed 经 panel-toast-feed.js 用 createTextNode 安全回显。
//
// 断言链：加载 → 暴露 toolkit.toast 与 window.EventBus → spy emit →
//   调 toolkit.toast('...') 应触发 EventBus.emit('ui:toast', msg, 'info')
//   → 带 level 调用应透传该 level（不走早退）。
'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const html = `<!DOCTYPE html>
<html><head><title>学习通</title></head>
<body>
  <video id="v1" src="https://mooc1.chaoxing.com/a1.mp4" preload="metadata"></video>
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
window.HTMLMediaElement.prototype.pause = function () { this._simPaused = true; };
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

// 触发一次接管，确保 toolkit / EventBus 已完整初始化
try { document.getElementById('v1').dispatchEvent(new window.Event('play')); } catch (e) { /* ignore */ }

const ns = window.__CX_FORCE_PLAY;
ok('前置：命名空间暴露 toolkit.toast', !!(ns && typeof ns.toolkit === 'object' && typeof ns.toolkit.toast === 'function'));
// EventBus 暴露为 window.EventBus（见 state.js: window.EventBus = EventBus）
ok('前置：window.EventBus.emit 可用', !!(window.EventBus && typeof window.EventBus.emit === 'function'));

// ── 探针：包裹 window.EventBus.emit，记录调用且不因订阅者（无面板 jsdom 下仅缓冲）影响断言 ──
const emitCalls = [];
const origEmit = window.EventBus.emit;
window.EventBus.emit = function (name, a, b) {
  emitCalls.push([name, a, b]);
  try { return origEmit.apply(this, arguments); } catch (e) { /* 订阅者副作用隔离：1.1 仅断言路由发生 */ }
};

// ── 核心断言：toolkit.toast(msg) 应经 EventBus 路由（旧实现直接调 toast() 绕过，洞察页收不到）──
emitCalls.length = 0;
ns.toolkit.toast('自动跳转第 5 集');
const routedInfo = emitCalls.some(function (c) { return c[0] === 'ui:toast' && c[1] === '自动跳转第 5 集' && c[2] === 'info'; });
ok('1.1-1 toolkit.toast(msg) 经 EventBus.emit("ui:toast", msg, "info") 路由', routedInfo, JSON.stringify(emitCalls));
ok('1.1-2 未带 level 时补足默认 level="info"', routedInfo);

// ── 透传断言：显式 level 应透传（不早退、不篡改）──
emitCalls.length = 0;
ns.toolkit.toast('作答异常', 'error');
const routedErr = emitCalls.some(function (c) { return c[0] === 'ui:toast' && c[1] === '作答异常' && c[2] === 'error'; });
ok('1.1-3 toolkit.toast(msg, "error") 透传 level="error"', routedErr, JSON.stringify(emitCalls));

console.log('\n=== sim-toolkit-toast ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
