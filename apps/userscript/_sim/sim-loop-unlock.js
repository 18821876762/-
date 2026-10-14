// sim-loop-unlock.js —— 验证「循环播放」开关对已 ended 锁死视频的即时解除与从头重播
// 场景：视频在 LOOP_PLAY=false 时自然播完被锁死(endedLock=true, play=noop, currentTime=duration)，
//       之后用户开启「循环播放」开关 → 锁应被解除、视频从头重播（而非永远卡在末尾）。
//
// 对应修复：dom.js _ovEndedLock（LOOP_PLAY=true 时主动解除旧锁）+ config.js applyLoopAll（开开关即时解除锁）。
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function assert(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ FAIL: ' + name); } }
const wait = (ms) => new Promise(r => setTimeout(r, ms));

(async function () {
  const bundle = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { runScripts: 'outside-only', url: 'https://mooc1.chaoxing.com/' });
  const { window } = dom;
  try { Object.defineProperty(window.document, 'hidden', { value: false, configurable: true }); } catch (e) {}
  try { Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true }); } catch (e) {}
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}

  // 构造一个"已播完"的视频：先以正常态被接管，再手动置为 endedLock 锁死态
  const v = window.document.createElement('video');
  v.setAttribute('src', 'https://s2.cldisk.com/sv-w2/video/3c/b5/24/adaa2_loop_test.mp4');
  v.src = 'https://s2.cldisk.com/sv-w2/video/3c/b5/24/adaa2_loop_test.mp4';
  Object.defineProperty(v, 'duration', { value: 1222, configurable: true });   // 20:22
  Object.defineProperty(v, 'ended', { value: false, configurable: true });
  v.currentTime = 0;
  v.readyState = 4;
  v.paused = false;
  window.document.body.appendChild(v);

  // v4.19.51：视频标记已全部 Symbol 化，统一经 window.__CX_FORCE_PLAY.FLAGS 访问（下方 NS.FLAGS.xxx）

  // 注入产物
  try { window.eval(bundle); } catch (e) { console.log('[inject error] ' + e.message); }
  await wait(2600);   // 等待主循环接管

  const NS = window.__CX_FORCE_PLAY;
  assert('[loop] 命名空间与 CONFIG 暴露', !!NS && !!NS.CONFIG);
  assert('[loop] 视频已被接管(forcePaused=true)', !!v[window.__CX_FORCE_PLAY.FLAGS.forcePaused]);
  assert('[loop] 默认 LOOP_PLAY=false', NS.CONFIG.LOOP_PLAY === false);

  // 手动将视频置为「已 ended 锁死」态（复现用户诊断：EndedLock=true, currentTime=duration, play=noop）
  v[NS.FLAGS.endedLock] = true;
  v.play = function () { return Promise.resolve(); };
  Object.defineProperty(v, 'ended', { value: true, configurable: true });
  v.currentTime = 1222;
  await wait(2600);   // 主循环应在 LOOP_PLAY=false 下持续维持锁

  assert('[loop] LOOP_PLAY=false 时 ended 锁被持续维持', v[NS.FLAGS.endedLock] === true);
  assert('[loop] LOOP_PLAY=false 时 play 仍是 no-op（阻断重播）', String(v.play) === String(function () { return Promise.resolve(); }));

  // 用户开启「循环播放」开关（等价：面板勾选 → CONFIG.LOOP_PLAY=true + applyLoopAll()，已暴露到 NS）
  NS.CONFIG.LOOP_PLAY = true;
  assert('[loop] applyLoopAll 已暴露可驱动', typeof NS.applyLoopAll === 'function');
  NS.applyLoopAll();   // 模拟面板勾选循环开关的即时链路
  await wait(1200);    // 给 bestEffort 异步解除锁/seek0 生效的时间

  assert('[loop] 开启循环后 ended 锁被解除', v[NS.FLAGS.endedLock] !== true);
  assert('[loop] 开启循环后 play 恢复为原函数（不再 no-op）', String(v.play) !== String(function () { return Promise.resolve(); }));
  assert('[loop] 开启循环后视频从头重播(currentTime 回到 0 附近)', v.currentTime < 5);
  assert('[loop] 开启循环后 v.loop 属性已置 true', v.loop === true);

  console.log('结论: ' + (fail === 0 ? 'PASS' : 'FAIL') + ' (pass=' + pass + ' fail=' + fail + ')');
  process.exit(fail === 0 ? 0 : 1);
})();
