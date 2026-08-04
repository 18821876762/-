// 更忠实的仿真：把 <video> 放进嵌套同源 iframe（贴近真实超星播放器），
// 模拟“焦点在播放器 iframe 内”时，P 键（顶层面板）与续播（iframe 内视频）是否仍生效。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

const html = `<!DOCTYPE html>
<html><head><title>学习通</title></head>
<body>
  <div class="ans-attach-ct">
    <iframe id="player" src="https://mooc1.chaoxing.com/playvideo.html"></iframe>
  </div>
</body></html>`;

const dom = new JSDOM(html, {
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;
const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message)));
const ce = console.error;
console.error = (...a) => { const s = a.map(String).join(' '); if (/Not implemented:/i.test(s)) return; errors.push('console.error: ' + s); };
window.console = console;

const mockCtx = new Proxy({}, { get: (t, p) => p === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {} });
function stubMedia(w) {
  try { w.HTMLCanvasElement.prototype.getContext = () => mockCtx; } catch (e) {}
  try { w.HTMLMediaElement.prototype.play = function () { this.paused = false; if (!this.__playCalls) this.__playCalls = 0; this.__playCalls++; return Promise.resolve(); }; } catch (e) {}
  try { w.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); }; } catch (e) {}
}

stubMedia(window);
// 把视频放进 iframe 的 contentDocument（模拟动态创建的播放器 iframe）
let iframeWin = null, iframeDoc = null, iframeVideo = null;
try {
  const iframe = document.getElementById('player');
  iframeDoc = iframe.contentDocument;
  if (iframeDoc) {
    iframeDoc.body.innerHTML = '<video id="v2" src="https://mooc1.chaoxing.com/v.mp4" controls></video>';
    iframeVideo = iframeDoc.getElementById('v2');
    iframeWin = iframe.contentWindow;
    stubMedia(iframeWin);
  }
} catch (e) { errors.push('iframe setup threw: ' + (e.stack || e)); }

console.log('iframe supported by jsdom :', !!iframeDoc);

function runIn(w, label) {
  try { w.eval(code); }
  catch (e) { errors.push('load threw in ' + label + ': ' + (e.stack || e)); }
}
// 顶层实例
runIn(window, 'top');
// 若 jsdom 提供了 iframe 的 contentWindow，则模拟“脚本也被注入到 iframe 实例”
if (iframeWin) runIn(iframeWin, 'iframe');

// 场景：焦点在播放器 iframe 内，按 P
let pErr = null;
try {
  if (iframeDoc) {
    const ev = new iframeWin.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
    iframeDoc.dispatchEvent(ev);
  }
} catch (e) { pErr = e.stack || String(e); }

const topPanel = document.getElementById('__cxPanel');
console.log('\n=== 焦点在 iframe 内按 P ===');
console.log('pressThrew        :', !!pErr, pErr || '');
console.log('顶层面板已出现    :', !!topPanel, topPanel ? ('display=' + (topPanel.style.display || '(unset)')) : '');
console.log('iframe 视频被续播  :', iframeVideo ? ('playCalls=' + (iframeVideo.__playCalls || 0)) : 'n/a (jsdom 无 iframe 支持)');
console.log('errors            :', errors.length);
errors.forEach((e, i) => console.log('  [' + (i + 1) + '] ' + e.split('\n')[0]));

// 兜底：焦点在顶层按 P（对照）
try {
  const ev = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
  document.dispatchEvent(ev);
} catch (e) {}
console.log('\n=== 焦点在顶层按 P（对照）===');
console.log('顶层面板 display  :', topPanel ? (topPanel.style.display || '(unset)') : 'none');

window.close();
process.exit(0);
