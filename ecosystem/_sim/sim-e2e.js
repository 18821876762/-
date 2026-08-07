// 审查整改 #8「E2E 测试」轻量端到端装配回归（jsdom 环境，非真实浏览器）：
// 在接近真实 DOM 的环境中完整加载构建产物、触发初始化、插入视频，断言：
//   ① 脚本端到端装配不崩溃（零 window error / jsdomError）；
//   ② 面板成功渲染（#__cxPanel 出现在 DOM）；
//   ③ 视频被接管逻辑处理（overrideVideo 触达，__cxForcePaused 被置为布尔）；
//   ④ 诊断块（#__cxPanelInfo，审查整改 #2 的 DOM 化点）刷新后无注入的 <img>/<script> 子节点；
//   ⑤ toolkit.h / setSafeText（#2 助手）已随构建打包可用。
// 说明：jsdom 不执行真实媒体/布局，接管判定依赖内部 FLAGS.__cxForcePaused；真实站点验证仍需浏览器 E2E。
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

const vc = new VirtualConsole();
const jsdomErrors = [];
// 仅统计真实 JS 异常；忽略 jsdom 环境性「Not implemented」错误（如 canvas.getContext 需装 canvas 包，
// 真实浏览器有原生实现，不影响脚本逻辑正确性）。
vc.on('jsdomError', (e) => {
  const raw = e && (e.detail ? (e.detail.stack || e.detail.message || e.detail) : e.message);
  const s = (typeof raw === 'string') ? raw : String(raw);
  if (/Not implemented|getContext|HTMLCanvasElement|HTMLMediaElement|navigation \(except hash changes\)/i.test(s)) return;
  jsdomErrors.push(s);
});

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=123&chapterId=456',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
});
const { window } = dom;

// 注入浏览器 API（jsdom 缺失或 Node 全局未提供）
window.AbortController = window.AbortController || function () { this.signal = {}; this.abort = function () {}; };
window.requestAnimationFrame = window.requestAnimationFrame || function (cb) { return setTimeout(function () { cb(Date.now()); }, 0); };
window.cancelAnimationFrame = window.cancelAnimationFrame || function (id) { clearTimeout(id); };
// 桥离线模拟：fetch 一律 reject，走桥离线兜底（安全，不产生网络请求）
window.fetch = function () { return Promise.reject(new Error('offline-sim')); };
if (typeof window.MutationObserver === 'undefined') {
  window.MutationObserver = function (cb) { this.observe = function () {}; this.disconnect = function () {}; cb && cb([], this); };
}

let loadErr = null;
try { window.eval(code); } catch (e) { loadErr = e; }

let P = 0, F = 0;
function assert(name, cond, extra) {
  if (cond) { P++; console.log('  ✓ ' + name); }
  else { F++; console.log('  ✗ ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

const errors = [];
window.addEventListener('error', (e) => errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message)));

// 插入一个待接管视频（无 opt-out、非用户暂停、可见），触发 walkVideos 接管
const video = window.document.createElement('video');
video.id = 'v1';
video.src = 'https://video.chaoxing.com/abc.mp4';
video.currentTime = 3;
video.duration = 100;
window.document.body.appendChild(video);

// 手动触发 DOMContentLoaded（jsdom 已 complete 时脚本可能已直接 init，此处确保 deferred 构建被触发）
try { window.document.dispatchEvent(new window.Event('DOMContentLoaded')); } catch (e) {}
// 面板由 P 键（keydownHandler → showPanel → ensurePanel）触发，初始化不自动显示；模拟按 P 触发面板渲染
try {
  var kev = new window.KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true, cancelable: true });
  window.document.dispatchEvent(kev);
} catch (e) {}

// 等待主循环/MO/定时器推进
setTimeout(function () {
  try {
    const tk = window.__CX_FORCE_PLAY;
    assert('脚本端到端装配：toolkit 暴露', !!tk);
    assert('toolkit.h 助手随构建打包', !!(tk && tk.toolkit && typeof tk.toolkit.h === 'function'));
    assert('toolkit.setSafeText 助手随构建打包', !!(tk && tk.toolkit && typeof tk.toolkit.setSafeText === 'function'));

    const panel = window.document.getElementById('__cxPanel');
    assert('面板端到端渲染（#__cxPanel 存在）', !!panel);
    assert('面板命令输入存在（#__cxCmd）', !!(panel && panel.querySelector('#__cxCmd')));
    assert('面板诊断块存在（#__cxPanelInfo）', !!(panel && panel.querySelector('#__cxPanelInfo')));

    // 接管判定：overrideVideo 触达视频，__cxForcePaused 被置为布尔（true=强制续播 / false=已释放）
    const fp = video.__cxForcePaused;
    assert('视频被接管逻辑处理（__cxForcePaused 为布尔）', typeof fp === 'boolean', { fp: fp });

    // 审查整改 #2：诊断块刷新后应为纯文本（无注入 DOM 节点）
    const infoEl = panel && panel.querySelector('#__cxPanelInfo');
    if (infoEl) {
      assert('#2 诊断块无注入 <img>', infoEl.querySelector('img') === null);
      assert('#2 诊断块无注入 <script>', infoEl.querySelector('script') === null);
    } else {
      assert('诊断块元素可定位', false);
    }

    assert('零 window error', errors.length === 0, errors.slice(0, 2));
    assert('零 jsdomError', jsdomErrors.length === 0, jsdomErrors.slice(0, 2));

    console.log('\n[sim-e2e] PASS=' + P + ' FAIL=' + F + (loadErr ? (' loadErr=1') : ''));
    if (F > 0 || errors.length > 0 || jsdomErrors.length > 0 || loadErr) {
      console.log('loadErr=' + (loadErr && loadErr.stack));
      errors.slice(0, 3).forEach((e) => console.log('  ' + e));
      jsdomErrors.slice(0, 3).forEach((e) => console.log('  [jsdom] ' + e));
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.log('[sim-e2e] 异常: ' + (e && e.stack || e));
    process.exit(1);
  }
}, 250);
