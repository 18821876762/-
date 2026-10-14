// 按课程单视频回归：SINGLE_VIDEO_COURSES 名单 + singleVideoActive()
// 验证并发续播风控根因对应能力：仅命中课程/全局开启时 singleVideoActive=true（_ovForegroundGate 据此暂停非前台视频）
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); }
catch (e) { console.log('SKIP — 缺少 jsdom'); console.log('结论: SKIP（缺 jsdom 依赖）'); process.exit(0); }

const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

let fail = 0;
function assert(name, cond) { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fail++; }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function runScenario(preCfg, url) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
    '<video class="cx-video" src="https://mooc1.chaoxing.com/1.mp4"></video>' +
    '<div id="cx-ext-root"></div></body></html>',
    { runScripts: 'outside-only', url: url || 'https://mooc1.chaoxing.com/mycourse/studentcourse?courseId=1&clazzid=100', pretendToBeVisual: true }
  );
  const { window } = dom;
  const sandbox = window;
  sandbox.window = window; sandbox.self = window; sandbox.top = window; sandbox.parent = window;
  sandbox.globalThis = window; sandbox.console = console;
  sandbox.setTimeout = setTimeout; sandbox.clearTimeout = clearTimeout;
  sandbox.setInterval = setInterval; sandbox.clearInterval = clearInterval;
  sandbox.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
  sandbox.cancelAnimationFrame = (id) => clearTimeout(id);
  if (preCfg) window.localStorage.setItem('cx_panel_cfg', JSON.stringify(preCfg));
  vm.createContext(sandbox);
  vm.runInContext(artifact, sandbox, { filename: 'cx-artifact.js' });
  return sandbox;
}

(async function () {
  // 1) 默认非单视频
  let a = runScenario(null);
  assert('默认 singleVideoActive=false', a.window.__CX_FORCE_PLAY.singleVideoActive() === false);
  assert('默认 SINGLE_VIDEO_COURSES 空', (a.window.__CX_FORCE_PLAY.CONFIG.SINGLE_VIDEO_COURSES || []).length === 0);

  // 2) 全局 SINGLE_VIDEO=true → 单视频生效（无视课程）
  let b = runScenario({ SINGLE_VIDEO: true });
  assert('全局 SINGLE_VIDEO=true → singleVideoActive=true', b.window.__CX_FORCE_PLAY.singleVideoActive() === true);

  // 3) 按课程开启（当前 courseId=1）
  let c = runScenario(null);
  const added = c.window.__CX_FORCE_PLAY.toggleCourseSingleVideo(); // 无参 → 当前课程 1
  assert('toggleCourseSingleVideo() → true(加入)', added === true);
  assert('命中课程 → singleVideoActive=true', c.window.__CX_FORCE_PLAY.singleVideoActive() === true);
  const persisted = JSON.parse(c.window.localStorage.getItem('cx_panel_cfg') || '{}');
  assert('SINGLE_VIDEO_COURSES 已持久化', Array.isArray(persisted.SINGLE_VIDEO_COURSES) && persisted.SINGLE_VIDEO_COURSES.indexOf('1') !== -1);
  const removed = c.window.__CX_FORCE_PLAY.toggleCourseSingleVideo();
  assert('再 toggle → false(移出)', removed === false);
  assert('移出名单 → singleVideoActive=false', c.window.__CX_FORCE_PLAY.singleVideoActive() === false);

  // 4) 载入即课程在名单 → 单视频生效
  let d = runScenario({ SINGLE_VIDEO_COURSES: ['1'] });
  assert('载入 SINGLE_VIDEO_COURSES=["1"] → singleVideoActive=true', d.window.__CX_FORCE_PLAY.singleVideoActive() === true);

  // 5) 指定课程号（非当前页）不影响当前课程判定
  let e = runScenario(null);
  e.window.__CX_FORCE_PLAY.toggleCourseSingleVideo('999');
  assert('toggleCourseSingleVideo("999") 后当前课(1)仍非单视频', e.window.__CX_FORCE_PLAY.singleVideoActive() === false);

  // 6) 实时生效：开启后下一轮主循环对当前页已接管视频重扫（不抛错）
  let f = runScenario(null);
  f.window.__CX_FORCE_PLAY.toggleCourseSingleVideo(); // 当前课 1 加入
  assert('开启后 singleVideoActive=true', f.window.__CX_FORCE_PLAY.singleVideoActive() === true);
  await sleep(2600);
  assert('开启态下主循环未崩溃（仍 singleVideoActive）', f.window.__CX_FORCE_PLAY.singleVideoActive() === true);

  console.log('====');
  console.log(fail === 0 ? ('结论: PASS（按课程单视频场景全部通过）') : ('结论: FAIL（' + fail + ' 项未通过）'));
  process.exit(fail === 0 ? 0 : 1);
})();
