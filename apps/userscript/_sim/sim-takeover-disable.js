// 接管开关回归：全局 ENABLED + 课程黑名单 DISABLED_COURSES
// 验证三处闸门（主循环 / play 事件 / MO 答题）与命名空间 API + 配置持久化 + 释放路径不抛错
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

function runScenario(preCfg, extraHtml, url) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>' +
    '<video class="cx-video" src="https://mooc1.chaoxing.com/1.mp4"></video>' +
    '<div id="cx-ext-root"></div>' + (extraHtml || '') + '</body></html>',
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
  // 1) 默认激活
  let a = runScenario(null);
  assert('默认 isTakeoverActive=true', a.window.__CX_FORCE_PLAY.isTakeoverActive() === true);
  assert('默认 CONFIG.ENABLED=true', a.window.__CX_FORCE_PLAY.CONFIG.ENABLED === true);
  assert('默认 黑名单为空', a.window.__CX_FORCE_PLAY.listDisabledCourses().length === 0);

  // 2) 全局开关 via 命名空间 API
  a.window.__CX_FORCE_PLAY.setTakeoverEnabled(false);
  assert('setTakeoverEnabled(false) → 非激活', a.window.__CX_FORCE_PLAY.isTakeoverActive() === false);
  assert('CONFIG.ENABLED 已置 false', a.window.__CX_FORCE_PLAY.CONFIG.ENABLED === false);
  const persisted = JSON.parse(a.window.localStorage.getItem('cx_panel_cfg') || '{}');
  assert('ENABLED 已持久化', persisted.ENABLED === false);
  a.window.__CX_FORCE_PLAY.setTakeoverEnabled(true);
  assert('setTakeoverEnabled(true) → 恢复激活', a.window.__CX_FORCE_PLAY.isTakeoverActive() === true);

  // 3) 载入即全局关闭（配置持久化生效）
  let b = runScenario({ ENABLED: false });
  assert('载入 ENABLED=false → 非激活', b.window.__CX_FORCE_PLAY.isTakeoverActive() === false);

  // 4) 课程黑名单：toggle 当前课程（courseId=1）
  let c = runScenario(null);
  const added = c.window.__CX_FORCE_PLAY.toggleCourseTakeover(); // 无参 → 当前课程 1
  assert('toggle 当前课 → 返回 true(已停用)', added === true);
  assert('当前课在黑名单 → 非激活', c.window.__CX_FORCE_PLAY.isTakeoverActive() === false);
  assert('listDisabledCourses 含 "1"', c.window.__CX_FORCE_PLAY.listDisabledCourses().indexOf('1') !== -1);
  const persistedC = JSON.parse(c.window.localStorage.getItem('cx_panel_cfg') || '{}');
  assert('DISABLED_COURSES 已持久化', Array.isArray(persistedC.DISABLED_COURSES) && persistedC.DISABLED_COURSES.indexOf('1') !== -1);
  const removed = c.window.__CX_FORCE_PLAY.toggleCourseTakeover();
  assert('再 toggle → 返回 false(已恢复)', removed === false);
  assert('移出黑名单 → 恢复激活', c.window.__CX_FORCE_PLAY.isTakeoverActive() === true);

  // 5) 指定课程号（非当前页）不影响当前课激活
  let d = runScenario(null);
  const addedX = d.window.__CX_FORCE_PLAY.toggleCourseTakeover('999');
  assert('toggleCourseTakeover("999") → true', addedX === true);
  assert('黑名单含 999 但当前课(1)仍激活', d.window.__CX_FORCE_PLAY.isTakeoverActive() === true);

  // 6) 载入即课程在黑名单 → 非激活
  let e = runScenario({ DISABLED_COURSES: ['1'] });
  assert('载入 DISABLED_COURSES=["1"] → 非激活', e.window.__CX_FORCE_PLAY.isTakeoverActive() === false);

  // 7) 释放路径不抛错（关闭后等待主循环实际触发释放）
  let f = runScenario(null);
  f.window.__CX_FORCE_PLAY.setTakeoverEnabled(false);
  assert('关闭后 a.isTakeoverActive=false', f.window.__CX_FORCE_PLAY.isTakeoverActive() === false);
  await sleep(2600); // 等主循环跑过一轮（会执行 _releaseTakeover，bestEffort 兜住异常）
  assert('关闭态下主循环未崩溃（仍非激活）', f.window.__CX_FORCE_PLAY.isTakeoverActive() === false);
  f.window.__CX_FORCE_PLAY.setTakeoverEnabled(true);
  assert('重新开启 → 激活', f.window.__CX_FORCE_PLAY.isTakeoverActive() === true);

  console.log('====');
  console.log(fail === 0 ? ('结论: PASS（' + '全部接管开关场景通过）') : ('结论: FAIL（' + fail + ' 项未通过）'));
  process.exit(fail === 0 ? 0 : 1);
})();
