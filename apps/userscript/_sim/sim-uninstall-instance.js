// sim-uninstall-instance.js —— 卸载「实例级 hook 还原」回归
//
// 覆盖审计缺陷 R3：uninstall 只还原了原型与 window.ananas.pause，
//   未删除接管时写在**视频实例**上的 own 属性（v.pause=no-op / v.play=no-op / FLAGS.*），
//   导致卸载后视频仍被锁死（用户点暂停无效、已结束视频 play 被吞）。
//
// 断言链：接管 → 实例 own 属性存在 → uninstall → own 属性消失 → 原生行为恢复（行为级证明）。
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
// 原型级媒体 mock：用 _simPaused 记录"真实"播放意图，供卸载后的行为级断言使用
window.HTMLMediaElement.prototype.play = function () { this._simPaused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this._simPaused = true; };
if (!window.HTMLMediaElement.prototype.load) window.HTMLMediaElement.prototype.load = function () {};

const results = [];
let fail = 0;
function ok(name, cond, extra) {
  const pass = !!cond;
  if (!pass) fail++;
  results.push({ name, pass, extra: extra === undefined ? null : extra });
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

let loadErr = null;
try { window.eval(code); } catch (e) { loadErr = e.stack || String(e); }
ok('产物加载无异常', !loadErr, loadErr);

const v1 = document.getElementById('v1');
const v2 = document.getElementById('v2');
// v2 模拟"已播完"：接管走 ended 分支，会额外把 v.play 覆盖为 no-op
Object.defineProperty(v2, 'ended', { configurable: true, get() { return true; } });

// 触发即时接管（document 级 capture 的 play 监听 → overrideVideo）
v1.dispatchEvent(new window.Event('play'));
v2.dispatchEvent(new window.Event('play'));

// v4.19.51：视频标记已全部 Symbol 化（元素属性不再暴露），须经命名空间 FLAGS 访问；
// 卸载后命名空间可能变动，故先取为常量。
const FL = window.__CX_FORCE_PLAY.FLAGS;
const FP = FL.forcePaused;
const NP = FL.np;
const EL = FL.endedLock;

// ── 卸载前：实例级 hook 应已就位（否则本用例失去意义）──
ok('前置：v1 已被接管（实例 own pause 覆盖）', own(v1, 'pause'));
ok('前置：v1 打上 forcePaused 标记(Symbol)', v1[FP] === true);
ok('前置：v1 备份了原生 pause（np·Symbol）', typeof v1[NP] === 'function');
ok('前置：v2(ended) 的 play 被覆盖为 no-op', own(v2, 'play'));

const ns = window.__CX_FORCE_PLAY;
ok('前置：命名空间暴露 uninstall', !!(ns && typeof ns.uninstall === 'function'));

if (ns && typeof ns.uninstall === 'function') {
  ns.uninstall();

  // ── 卸载后：实例 own 属性必须全部还原 ──
  ok('R3-1 v1 实例 pause 覆盖已删除', !own(v1, 'pause'));
  ok('R3-2 v2 实例 pause 覆盖已删除', !own(v2, 'pause'));
  ok('R3-3 v2 实例 play 覆盖已删除', !own(v2, 'play'));
  ok('R3-4 FLAGS 标记已清除(forcePaused·Symbol)', !own(v1, FP));
  ok('R3-5 FLAGS 标记已清除(np·Symbol)', !own(v1, NP));
  ok('R3-6 FLAGS 标记已清除(endedLock·Symbol)', !own(v2, EL));

  // ── 行为级证明：卸载后视频不再被锁死 ──
  v1._simPaused = false;
  v1.pause();
  ok('R3-7 卸载后 pause() 真正生效（不再是 no-op）', v1._simPaused === true, String(v1._simPaused));

  v2._simPaused = true;
  const p = v2.play();
  ok('R3-8 卸载后 play() 真正生效（ended 视频不再被吞）',
    v2._simPaused === false && p && typeof p.then === 'function', String(v2._simPaused));

  ok('R3-9 命名空间已撤销', typeof window.__CX_FORCE_PLAY === 'undefined');
}

console.log('\n=== sim-uninstall-instance ===');
results.forEach(function (r) {
  console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.name + (r.extra ? '   -> ' + r.extra : ''));
});
console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (' + (results.length - fail) + '/' + results.length + ')');
process.exit(fail === 0 ? 0 : 1);
