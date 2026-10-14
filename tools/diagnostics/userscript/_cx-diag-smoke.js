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
FP.quizStats = { scanned: 12, answered: 8, remaining: 4, answerSource: 'bank+ai', confidence: 0.82, levels: 'auto+confirm', pendingSubmit: 1, reviewCount: 2, strictMode: true, offline: false, ts: Date.now() };
FP.quizAiDiag = { 'quiz:a:1:b#2:c': { last: { imgSkipped: true } }, 'quiz:a:2:b#2:c': { last: { imgSkipped: false } } };
console.log('schedStats:', JSON.stringify(FP._quizSchedStats ? FP._quizSchedStats() : null));
console.log('secretDecodeStats:', JSON.stringify(FP._secretDecodeStats ? FP._secretDecodeStats() : null));
console.log('dsResponderState:', JSON.stringify(FP._dsResponderState ? FP._dsResponderState() : null));
console.log('TimerRegistry.stats:', JSON.stringify(FP.TimerRegistry ? FP.TimerRegistry.stats() : null));
let txt = null;
if (typeof FP.buildDiagnostics === 'function') txt = FP.buildDiagnostics();
else if (FP.buildDevReportText) txt = FP.buildDevReportText();
else if (FP.buildFeatureSelfTest) txt = FP.buildFeatureSelfTest();
console.log('--- new diagnostics lines ---');
if (txt) {
  String(txt).split(/\r?\n/).forEach(l => { if (/答题引擎|调度器|混淆字体解码|应答端|视觉截图/.test(l)) console.log(l); });
} else {
  console.log('no diagnostics fn; keys:', Object.keys(FP).filter(k => /diag|report/i.test(k)).join(','));
}