// sim-drift-guard.js — 行为回归：进度漂移守卫（应对超星防挂机/反作弊周期性把 currentTime 回拨到开头）。
// 场景：视频正常推进到 8s 后，平台把进度回拨到 0（或重建 <video> 元素）→ 守卫须检测到回拨并回补到上次最大位置(8s)，
// 打破"重置→卡开头"循环。复跑：node scripts/run-sim.js ；或随 `npm run test:sim` 一并执行。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom'); process.exit(7);
}
const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
let pass = 0, fail = 0;
function assert(name, cond) { if (cond) { pass++; } else { fail++; console.log('FAIL: ' + name); } }

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: 'https://mooc1.chaoxing.com/' });
const { window } = dom;
// jsdom 默认 document.visibilityState='prerender'→hidden=true，主循环会被降频到 8s 且接管更保守；
// 注入产物前先把可见性设为 visible，确保主循环按 2s 正常 tick（与真机可见态一致）。
try { Object.defineProperty(window.document, 'hidden', { value: false, configurable: true }); } catch (e) {}
try { Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true }); } catch (e) {}
try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
// jsdom 无布局引擎，getBoundingClientRect 恒返回全 0 → 可见性误判不可见；补一个非零矩形让视频成为前台。
window.Element.prototype.getBoundingClientRect = function () { return { width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, x: 0, y: 0 }; };
window.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); };
window.HTMLMediaElement.prototype.pause = function () { this.paused = true; };

let injectErr = null;
try { const fn = new window.Function(artifact); fn.call(window); } catch (e) { injectErr = e; }
assert('产物在 jsdom 注入无异常', !injectErr);
assert('命名空间已安装', !!(window.__CX_FORCE_PLAY));

const v = window.document.createElement('video');
v.setAttribute('src', 'https://s2.cldisk.com/sv-w2/video/3c/b5/24/adaa2_test.mp4');
v.src = 'https://s2.cldisk.com/sv-w2/video/3c/b5/24/adaa2_test.mp4';
v.duration = 1222;       // 20:22
v.currentTime = 0;
v.readyState = 4;
v.paused = false;
window.document.body.appendChild(v);

function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

(async function () {
  await wait(2500);                                  // 等待主循环接管并首次记录
  console.log('[dbg] 接管后: forcePaused=' + !!v.__cxForcePaused + ' currentTime=' + v.currentTime + ' src=' + v.src);
  v.currentTime = 8;                                 // 模拟正常播放推进到 8s
  await wait(2500);                                  // 守卫记录 max=8
  console.log('[dbg] 推进后: currentTime=' + v.currentTime);
  assert('[drift] 第①阶段进度已到达 8s', Math.abs(v.currentTime - 8) < 1.5);
  v.currentTime = 0;                                // 模拟平台把进度回拨到开头
  await wait(4000);                                  // 等待守卫检测到回拨并回补（至少 1~2 轮 2s tick）
  console.log('[dbg] 回拨后: currentTime=' + v.currentTime + ' driftAt=' + (v.__cxDriftAt ? 'set' : 'unset'));
  assert('[drift] 守卫检测到回拨并回补到最大位置(8s)', Math.abs(v.currentTime - 8) < 1.5);
  console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (pass=' + pass + ' fail=' + fail + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
