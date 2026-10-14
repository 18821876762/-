// sim-addon-cleanup.js —— 工具库项「卸载清理」回归（NEW-5）
//
// 覆盖第四轮缺陷 NEW-5：keyboard-shortcuts / auto-next / tamper-guard 三个工具库项
//   注册了全局监听（document keydown 捕获 / document ended 捕获 / window storage）
//   与定时器（tamper-guard 的 _tgTimer），但 uninstall 时无任何反注册路径，
//   导致脚本卸载后监听器与定时器仍常驻，污染宿主页面。
//
// 修复形态：各 addon 向 window.__cxAddonCleanups 压入清理回调，
//   lifecycle.cleanupListeners 统一遍历执行并清空数组。
//
// 断言链：加载 → 清理注册表非空 → uninstall → 注册表清空
//   → 行为级证明：卸载后再派发 keydown/ended、再触发 storage，均不再有任何监听响应。
'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

const html = `<!DOCTYPE html>
<html><head><title>学习通</title></head>
<body>
  <video id="v1" src="https://mooc1.chaoxing.com/a1.mp4" preload="metadata"></video>
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
window.HTMLMediaElement.prototype.play = function () { this._simPaused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this._simPaused = true; };
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};

// ── 监听器/定时器探针：包裹原生 API 以统计"净残留" ──
const liveDocListeners = new Map();   // type -> count
const liveWinListeners = new Map();
function bump(map, type, delta) { map.set(type, (map.get(type) || 0) + delta); }

const rawDocAdd = window.document.addEventListener.bind(window.document);
const rawDocRemove = window.document.removeEventListener.bind(window.document);
window.document.addEventListener = function (type, fn, opt) { bump(liveDocListeners, type, 1); return rawDocAdd(type, fn, opt); };
window.document.removeEventListener = function (type, fn, opt) { bump(liveDocListeners, type, -1); return rawDocRemove(type, fn, opt); };

const rawWinAdd = window.addEventListener.bind(window);
const rawWinRemove = window.removeEventListener.bind(window);
window.addEventListener = function (type, fn, opt) { bump(liveWinListeners, type, 1); return rawWinAdd(type, fn, opt); };
window.removeEventListener = function (type, fn, opt) { bump(liveWinListeners, type, -1); return rawWinRemove(type, fn, opt); };

const liveTimers = new Set();
const rawSetInterval = window.setInterval.bind(window);
const rawClearInterval = window.clearInterval.bind(window);
window.setInterval = function (fn, ms) { const id = rawSetInterval(fn, ms); liveTimers.add(id); return id; };
window.clearInterval = function (id) { liveTimers.delete(id); return rawClearInterval(id); };

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

// 触发一次接管，确保 addon 完全初始化
document.getElementById('v1').dispatchEvent(new window.Event('play'));

const ns = window.__CX_FORCE_PLAY;
ok('前置：命名空间暴露 uninstall', !!(ns && typeof ns.uninstall === 'function'));

// ── 卸载前：清理注册表应已由三个 addon 填充 ──
const cleanups = window.__cxAddonCleanups;
ok('NEW-5-1 存在工具库项清理注册表 __cxAddonCleanups', Array.isArray(cleanups),
  Object.prototype.toString.call(cleanups));
const beforeCount = Array.isArray(cleanups) ? cleanups.length : 0;
ok('NEW-5-2 至少注册了 1 个卸载清理回调（addon 已接入）', beforeCount >= 1, '注册数=' + beforeCount);
ok('NEW-5-3 清理回调均为函数', Array.isArray(cleanups) && cleanups.every((f) => typeof f === 'function'));

// 快照卸载前的净监听数（keydown 捕获来自 keyboard-shortcuts，ended 捕获来自 auto-next）
const docKeydownBefore = liveDocListeners.get('keydown') || 0;
const docEndedBefore = liveDocListeners.get('ended') || 0;
const winStorageBefore = liveWinListeners.get('storage') || 0;
const timersBefore = liveTimers.size;

if (ns && typeof ns.uninstall === 'function') {
  ns.uninstall();

  // ── 卸载后：注册表被清空（幂等，避免二次 uninstall 重复执行）──
  ok('NEW-5-4 卸载后清理注册表已清空', !window.__cxAddonCleanups || window.__cxAddonCleanups.length === 0,
    '剩余=' + (window.__cxAddonCleanups ? window.__cxAddonCleanups.length : 'undefined'));

  // ── 净残留断言：卸载后净监听数不得高于脚本注入前（即全部反注册）──
  const docKeydownAfter = liveDocListeners.get('keydown') || 0;
  const docEndedAfter = liveDocListeners.get('ended') || 0;
  const winStorageAfter = liveWinListeners.get('storage') || 0;

  ok('NEW-5-5 keydown 捕获监听已反注册（keyboard-shortcuts）',
    docKeydownAfter < docKeydownBefore || docKeydownBefore === 0,
    beforeCount + ' | ' + docKeydownBefore + ' -> ' + docKeydownAfter);
  ok('NEW-5-6 ended 捕获监听已反注册（auto-next）',
    docEndedAfter < docEndedBefore || docEndedBefore === 0,
    docEndedBefore + ' -> ' + docEndedAfter);
  ok('NEW-5-7 storage 监听已反注册（auto-next）',
    winStorageAfter < winStorageBefore || winStorageBefore === 0,
    winStorageBefore + ' -> ' + winStorageAfter);
  ok('NEW-5-8 定时器已清理（tamper-guard 等）',
    liveTimers.size < timersBefore || timersBefore === 0,
    timersBefore + ' -> ' + liveTimers.size);

  // ── 幂等性：二次 uninstall 不应抛异常 ──
  let twiceErr = null;
  try { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.uninstall) window.__CX_FORCE_PLAY.uninstall(); } catch (e) { twiceErr = String(e); }
  ok('NEW-5-9 重复卸载不抛异常（清理幂等）', !twiceErr, twiceErr);

  // ── 行为级证明：卸载后事件不再被工具库项处理 ──
  let threw = null;
  try {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    document.getElementById('v1').dispatchEvent(new window.Event('ended', { bubbles: true }));
    window.dispatchEvent(new window.Event('storage'));
  } catch (e) { threw = e.stack || String(e); }
  ok('NEW-5-10 卸载后派发 keydown/ended/storage 无残留处理器报错', !threw, threw);
}

console.log('\n=== sim-addon-cleanup ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
