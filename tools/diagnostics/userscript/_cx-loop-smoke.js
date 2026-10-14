const projectPaths = require('../project-paths.cjs');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const src = fs.readFileSync(projectPaths.bundle, 'utf8');
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'https://mooc1.chaoxing.com/mycourse/studentcourse?courseId=1&chapterId=2',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const win = dom.window;
win.eval(src);
const FP = win.__CX_FORCE_PLAY;
if (!FP) { console.log('NO __CX_FORCE_PLAY'); process.exit(1); }
// 模拟课程页已收心跳镜像 + 已发题/已回包
FP.DS_STATUS = { connected: true, loggedIn: true, ts: Date.now() - 3000, loop: { received: 7, sent: 6, watchdog: 1, dedupe: 0, qdrop: 0, lastAskAt: Date.now() - 9000, lastAnswerAt: Date.now() - 4000, lastErr: '' } };
const lp = FP._dsLoopStats();
console.log('loopStats:', JSON.stringify(lp));
let txt = null;
if (typeof FP.buildDiagnostics === 'function') txt = FP.buildDiagnostics();
console.log('--- new lines ---');
if (txt) {
  String(txt).split(/\r?\n/).forEach(l => { if (/DS数据循环|应答端循环|应答端:|调度器|视觉截图/.test(l)) console.log(l); });
}