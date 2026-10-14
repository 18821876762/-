// sim-ended-mute-restore.js —— 工具库项「视频结束通知」静音还原回归
//
// 覆盖审计缺陷 R6：video-ended-notify 在视频 ended 时 muteAll() 静音全部视频，
//   但 restoreAll/restoreIfNeeded 在源码中**无任何调用点** → 一旦触发过一次结束通知，
//   页面视频将永久静音（用户继续看下一节也没有声音），且 __cxEndedMuted 标记残留。
//
// 断言链：ended → 全部静音并打标 → 任意视频重新 play → 自动还原音量并清标。
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

// 工具库项在 DOMContentLoaded 后才 start()（注册 ended/play 监听），故断言需等文档就绪
function whenReady(cb) {
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', function () { setTimeout(cb, 20); });
  else setTimeout(cb, 20);
}

whenReady(function () {
run();
console.log('\n=== sim-ended-mute-restore ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
});

function run() {
ok('前置：工具库项已启动（超星站点隔离通过）', window.__cxEndedNotifyStarted === true);
ok('前置：开关默认开启', !!(window.__cxEndedNotifyStatus && window.__cxEndedNotifyStatus().enabled));
ok('前置：初始未静音', v1.muted === false && v2.muted === false);

// ── 触发视频结束：应静音全部视频并打标 ──
v1.dispatchEvent(new window.Event('ended'));

ok('R6-1 结束后当前视频被静音', v1.muted === true, String(v1.muted));
ok('R6-2 结束后同页其他视频一并静音', v2.muted === true, String(v2.muted));
ok('R6-3 静音打上可还原标记', v1.__cxEndedMuted === true && v2.__cxEndedMuted === true);

// ── 重新播放：必须自动还原（修复前 restoreAll 无调用点 → 此处永远失败）──
v2.dispatchEvent(new window.Event('play'));

ok('R6-4 重新播放后静音被还原(v1)', v1.muted === false, String(v1.muted));
ok('R6-5 重新播放后静音被还原(v2)', v2.muted === false, String(v2.muted));
ok('R6-6 还原后标记被清除（不残留脏状态）',
  !v1.__cxEndedMuted && !v2.__cxEndedMuted,
  String(v1.__cxEndedMuted) + '/' + String(v2.__cxEndedMuted));

// ── 幂等：未静音状态下再次触发 play 不应产生副作用 ──
let secondErr = null;
try { v1.dispatchEvent(new window.Event('play')); } catch (e) { secondErr = e.stack || String(e); }
ok('R6-7 再次 play 不抛错且保持未静音',
  !secondErr && v1.muted === false && v2.muted === false, secondErr);
}
