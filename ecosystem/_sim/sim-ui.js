// 真实 DOM 仿真：用 jsdom 加载 user.js，模拟超星页面，按下 P 键，验证面板能否无错渲染。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

const html = `<!DOCTYPE html>
<html>
<head><title>学习通</title></head>
<body>
  <video id="video" src="https://mooc1.chaoxing.com/video.mp4" controls preload="metadata"></video>
  <div class="ans-attach-ct"></div>
</body>
</html>`;

const dom = new JSDOM(html, {
  url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;

// 模拟真实浏览器的 canvas 2D 上下文（jsdom 不实现，真实浏览器有），让仪表盘/走势图绘制路径真正跑通
const mockCtx = new Proxy({}, { get: (t, p) => {
  if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
  if (p === 'getImageData') return () => ({ data: [] });
  return () => {};
}});
window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; };

// 模拟真实浏览器的媒体播放 API（jsdom 仅打 'Not implemented' 噪声），让续播路径真正执行
window.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.paused = true; return Promise.resolve(); };
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};

// 收集所有运行时错误
const errors = [];
window.addEventListener('error', (e) => {
  errors.push('window.error: ' + (e.error && e.error.stack ? e.error.stack : e.message));
});
const origConsoleError = console.error;
console.error = (...a) => {
  const s = a.map(String).join(' ');
  if (/Not implemented:/i.test(s)) return; // 忽略 jsdom 环境噪声（canvas/媒体等），只看真实错误
  errors.push('console.error: ' + s);
};
window.console = console;

function report(tag, obj) {
  console.log('\n=== ' + tag + ' ===');
  console.log(JSON.stringify(obj, null, 2));
}

let loadErr = null;
try {
  window.eval(code);
} catch (e) {
  loadErr = e.stack || String(e);
}

report('LOAD', {
  loadThrew: !!loadErr,
  loadError: loadErr,
  errorsSoFar: errors,
});

// 触发 P 键（document 上注册的 keydown）
let pErr = null;
try {
  const ev = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
  document.dispatchEvent(ev);
} catch (e) {
  pErr = e.stack || String(e);
}

const panel = document.getElementById('__cxPanel');
let panelInfo = { present: !!panel };
if (panel) {
  const cs = window.getComputedStyle ? null : null;
  panelInfo = {
    present: true,
    id: panel.id,
    className: panel.className,
    inlineDisplay: panel.style.display,
    childCount: panel.children.length,
    titleText: (panel.querySelector('.cx-title') || {}).textContent || null,
    hasCloseBtn: !!panel.querySelector('#__cxPanelClose'),
    hasCmdInput: !!panel.querySelector('input.cx-cmd-input, #__cxCmdInput, input'),
    hasVideoList: !!panel.querySelector('.cx-video-list, #__cxVideoList'),
    innerHTMLLen: panel.innerHTML.length,
    innerHTMLSnippet: panel.innerHTML.slice(0, 400),
  };
}
report('AFTER_PRESS_P', {
  pressThrew: !!pErr,
  pressError: pErr,
  panel: panelInfo,
  errorsSoFar: errors,
});

// —— 命令框回归：新增命令端到端验证（/width /ninja /tab /only /resumeall）——
const cmdResults = {};
const cmdInp = document.getElementById('__cxCmd');
if (cmdInp) {
  function runCmd(expr) {
    cmdInp.value = expr;
    cmdInp.dispatchEvent(new window.Event('input', { bubbles: true }));
    cmdInp.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  try {
    runCmd('/width 600');
    cmdResults.width600 = (panel.style.getPropertyValue('--cx-panel-w') || '').trim();
    runCmd('/ninja on'); cmdResults.ninjaOn = panel.classList.contains('ninja');
    runCmd('/ninja off'); cmdResults.ninjaOff = !panel.classList.contains('ninja');
    runCmd('/tab system');
    var sysTab = document.getElementById('__cxTab_system');
    var ctlTab = document.getElementById('__cxTab_control');
    cmdResults.tabSystemShown = !!(sysTab && sysTab.style.display === 'block');
    cmdResults.tabControlHidden = !!(ctlTab && ctlTab.style.display === 'none');
    runCmd('/only'); runCmd('/resumeall');   // 单视频场景不应抛错
    cmdResults.cmdNoThrow = true;
  } catch (e) { cmdResults.cmdThrew = e.stack || String(e); }
} else { cmdResults.inputMissing = true; }
report('COMMAND_TESTS', cmdResults);

// 再次按 P 应关闭/隐藏面板（toggle）
try {
  const ev2 = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
  document.dispatchEvent(ev2);
} catch (e) { errors.push('second P threw: ' + (e.stack || e)); }

const panelAfter2 = document.getElementById('__cxPanel');
report('AFTER_PRESS_P_AGAIN', {
  panelStillInDom: !!panelAfter2,
  panelDisplay: panelAfter2 ? (panelAfter2.style.display || '(none-set)') : null,
  errorsTotal: errors,
});

console.log('\n================ SUMMARY (load + P) ================');
console.log('loadThrew       :', !!loadErr);
console.log('panelRendered   :', !!(panel && panel.children.length > 0));

// 让主循环真正跑几拍（续播 + 仪表盘渲染），然后复检真实错误
setTimeout(() => {
  const loopPanel = document.getElementById('__cxPanel');
  report('AFTER_LOOP_TICKS', {
    loopRan: true,
    panelDisplayAfterLoop: loopPanel ? (loopPanel.style.display || '(unset)') : null,
    errorsAfterLoop: errors,
  });
  console.log('\n================ SUMMARY ================');
  console.log('loadThrew       :', !!loadErr);
  console.log('panelRendered   :', !!(panel && panel.children.length > 0));
  console.log('totalErrors     :', errors.length);
  errors.forEach((e, i) => console.log('  [' + (i + 1) + '] ' + e.split('\n')[0]));
  window.close();
  process.exit(0);
}, 500);
