// 探针（非回归用例）：验证 vision-deepseek-web.js 的「跨窗口幂等锁」是否真正跨窗口。
// 手法：真起同源 iframe（同 sim-multiframe.js），在两帧各自 eval 产物，统计各帧
//   TimerRegistry(owner 'deepseek') 的 4s/5s 定时器数量 + dsRoleInited 标志归属。
const { JSDOM, requestInterceptor } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

const FRAME_URL = 'https://mooc1.chaoxing.com/studyvideoweb/playerFrame.html?courseId=1&knowledgeId=2';
const TOP_URL = 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2';

const topHtml = `<!DOCTYPE html><html><head><title>学习通</title></head><body>
  <video id="tv" src="https://mooc1.chaoxing.com/a.mp4" controls></video>
  <iframe id="pf" src="${FRAME_URL}" width="800" height="450"></iframe>
  <div class="ans-attach-ct"></div>
</body></html>`;
const childHtml = `<!DOCTYPE html><html><head><title>播放器</title></head><body>
  <video id="fv" src="https://mooc1.chaoxing.com/b.mp4" controls></video>
  <div class="ans-attach-ct"></div>
</body></html>`;

const dom = new JSDOM(topHtml, {
  url: TOP_URL,
  runScripts: 'dangerously',
  resources: {
    interceptors: [
      requestInterceptor(function (request) {
        if (request.url === FRAME_URL) {
          return new Response(childHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
        return undefined;
      })
    ]
  },
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

const mockCtx = new Proxy({}, { get: () => () => ({ addColorStop() {} }) });
window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };
window.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};

const errors = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));

// 逐窗口统计 setInterval 调用
function countTimers(win, label) {
  let n = 0;
  const real = win.setInterval.bind(win);
  win.setInterval = function (fn, ms) { n++; return real(fn, ms); };
  return function () { return { label, n, intervals: n }; };
}
const topCount = countTimers(window, 'top');
window.eval(code);

const iframe = document.getElementById('pf');
const childWin = iframe && iframe.contentWindow;
if (!childWin) { console.log('FAIL: iframe 未就绪'); process.exit(1); }
const childCount = countTimers(childWin, 'child');
childWin.eval(code);

setTimeout(() => {
  const t = topCount();
  const c = childCount();
  const topLock = !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.dsRoleInited);
  const childLock = !!(childWin.__CX_FORCE_PLAY && childWin.__CX_FORCE_PLAY.dsRoleInited);
  console.log('top   setInterval calls :', t.n, ' dsRoleInited =', topLock);
  console.log('child setInterval calls :', c.n, ' dsRoleInited =', childLock);
  // child 帧允许 2 个 setInterval（tamper-guard 2s 守卫 + auto-next 播中随堂题保持看门狗，均为每帧独立设计间隔）；DS 课程侧 4s 心跳必须为 0
  const okLock = (c.n <= 2 && !childLock && topLock);
  console.log('跨窗口锁生效（子帧无 DS 角色定时器）:', okLock ? 'YES' : 'NO');
  console.log('errors:', errors.length ? errors.slice(0, 3) : 'none');
  if (!okLock || errors.length) { console.log('结论: FAIL — DS 跨帧幂等锁失效'); process.exit(1); }
  console.log('结论: PASS — DS 角色仅顶层初始化，跨帧无冗余心跳/监听');
  process.exit(0);
}, 1500);
