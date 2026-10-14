// 礼貌模式回归（建议#1）：验证 POLITE_MODE 真实抗检测行为(P2) ——
//   pause/rate setter 的 toString() 不再含 '__cxForcePaused' 字面量（抗平台 toString 字串扫描），
//   且改用行为/引用探测(probePauseNeutralized)作为「中性化是否在位」判据，供审计面板/工具库项 tamper-guard 使用；
//   故即使 toString 伪装，审计不撒谎、被平台还原仍可检出。
// 与 sim-gentle.js / sim-audit.js 同源：jsdom 加载完整产物，注入 mediaSession 模拟。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch (e) {
  console.log('SKIP — 缺少 jsdom');
  console.log('结论: SKIP（缺 jsdom 依赖）');
  process.exit(0);
}

const artifact = fs.readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}
function find(rows, area) { for (var i = 0; i < rows.length; i++) if (rows[i].area === area) return rows[i]; return null; }

function runScenario(url, preCfg) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><video id="v1"></video></body></html>', {
    runScripts: 'outside-only',
    url: url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  if (preCfg) {
    try { window.localStorage.setItem('cx_panel_cfg', JSON.stringify(preCfg)); } catch (e) { /* ignore */ }
  }
  // 注入 mediaSession 模拟（与 sim-gentle.js / sim-audit.js 同款，确保初始化路径一致）
  const SENTINEL = function __cxSitePauseHandler() {};
  const ms = {
    _pause: SENTINEL, _state: 'none',
    getActionHandler(a) { return a === 'pause' ? this._pause : null; },
    setActionHandler(a, h) { if (a === 'pause') this._pause = h; },
    get playbackState() { return this._state; },
    set playbackState(v) { this._state = v; },
  };
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: ms, configurable: true }); } catch (e) { /* ignore */ }

  const ctx = dom.getInternalVMContext();
  vm.runInContext(artifact, ctx, { filename: 'artifact.user.js' });
  const ns = window.__CX_FORCE_PLAY;
  const bir = ns && ns.buildInvasionReport ? ns.buildInvasionReport : null;
  const report = bir ? bir() : [];
  return { window: window, ns: ns, report: report };
}

// —— 场景1：auto + 超星 + 礼貌模式 → toString 伪装 + 行为探测在位 ——
const s1 = runScenario('https://mooc1.chaoxing.com/learn/xxx', { POLITE_MODE: true });
assert('场景1 命名空间已安装', !!(s1.ns && typeof s1.ns.getPauseNeutralized === 'function'));
const s1pauseStr = String(s1.window.HTMLMediaElement.prototype.pause);
assert('场景1(礼貌): prototype.pause.toString 不含 "__cxForcePaused" 字面量(抗字串扫描)', s1pauseStr.indexOf('__cxForcePaused') < 0);
assert('场景1(礼貌): 行为探测 getPauseNeutralized===true(中性化在位)', s1.ns.getPauseNeutralized() === true);
const p1 = find(s1.report, 'prototype.pause');
assert('场景1(礼貌): 审计 prototype.pause.on===true(不撒谎)', !!(p1 && p1.on === true));

// —— 场景2：auto + 超星 + 显式关闭礼貌(POLITE_MODE:false) ——
// v4.19.51：forcePaused 已 Symbol 化，原「礼貌/字面量」两版原型体合并，
//   故无论是否礼貌都不再含该字面量；旧契约「非礼貌保留字面量」随 Symbol 化作废
//   （tamper-guard 与审计面板已同步改为引用/行为探测）。
const s2 = runScenario('https://mooc1.chaoxing.com/learn/yyy', { POLITE_MODE: false });
const s2pauseStr = String(s2.window.HTMLMediaElement.prototype.pause);
assert('场景2(显式关闭礼貌): prototype.pause.toString 亦不含 "__cxForcePaused"(Symbol 化后两版一致)', s2pauseStr.indexOf('__cxForcePaused') < 0);
assert('场景2(显式关闭礼貌): 行为探测 getPauseNeutralized===true', s2.ns.getPauseNeutralized() === true);
const p2 = find(s2.report, 'prototype.pause');
assert('场景2(显式关闭礼貌): 审计 prototype.pause.on===true(引用探测不撒谎)', !!(p2 && p2.on === true));

// —— 场景2b：默认配置（POLITE_MODE 默认 true）+ 本轮抗检测审查三项修复的回归守卫 ——
const s2b = runScenario('https://mooc1.chaoxing.com/learn/yyy2', null);
assert('场景2b(默认): POLITE_MODE 默认为 true(抗检测默认开启)', s2b.ns.CONFIG.POLITE_MODE === true);
const protoPause = s2b.window.HTMLMediaElement.prototype.pause;
const s2bPauseStr = String(protoPause);
assert('场景2b(默认): prototype.pause.toString 不含 "__cxForcePaused"', s2bPauseStr.indexOf('__cxForcePaused') < 0);

// (一) P0-1 守卫：不得再全局改写 Function.prototype.toString。
//   若守卫仍在，对原型 pause 会返回 '[native code]'；撤销后应返回真实源码。
const s2bStrict = s2b.window.Function.prototype.toString.call(protoPause);
assert('场景2b(P0-1): Function.prototype.toString 未被全局改写(不再返回 [native code])', s2bStrict.indexOf('[native code]') < 0);
assert('场景2b(P0-1): Function.prototype.toString 对函数仍返回真实源码(未被破坏)', s2bStrict.indexOf('function') >= 0);

// (二) P1 守卫：原型体改方法简写 → 自有属性恰为 ['length','name']（与原生一致）
const own = Object.getOwnPropertyNames(protoPause).sort();
assert('场景2b(P1): 自有属性恰为 length,name(无 prototype)', own.join(',') === 'length,name');
assert('场景2b(P1): 无自有 toString(与原生一致)', !Object.getOwnPropertyDescriptor(protoPause, 'toString'));
assert('场景2b(P1): name 为 "pause"(与原生一致)', protoPause.name === 'pause');

// (三) P0-2 守卫：forcePaused 改 Symbol → video 元素上不再有 '__cxForcePaused' 字符串键
const v1 = s2b.window.document.getElementById('v1');
const v1Names = v1 ? Object.getOwnPropertyNames(v1) : [];
assert('场景2b(P0-2): video 元素无 "__cxForcePaused" 字符串键(元素属性暴露已修)', v1Names.indexOf('__cxForcePaused') < 0);

assert('场景2b(默认): 行为探测 getPauseNeutralized===true', s2b.ns.getPauseNeutralized() === true);
const p2b = find(s2b.report, 'prototype.pause');
assert('场景2b(默认): 审计 prototype.pause.on===true', !!(p2b && p2b.on === true));

// —— 场景3：gentle + 礼貌 → 未装原型，行为探测不适用(null) ——
const s3 = runScenario('https://mooc1.chaoxing.com/learn/zzz', { INTRUSION_MODE: 'gentle', POLITE_MODE: true });
assert('场景3(gentle·礼貌): getPauseNeutralized===null(未接管原型·不适用)', s3.ns.getPauseNeutralized() === null);
const p3 = find(s3.report, 'prototype.pause');
assert('场景3(gentle·礼貌): 审计 prototype.pause.on===false(未包装)', !!(p3 && p3.on === false));

// —— 场景4：auto + 超星 + 礼貌，模拟平台还原原型 pause → 行为探测检出 false ——
const s4 = runScenario('https://mooc1.chaoxing.com/learn/qqq', { POLITE_MODE: true });
try { s4.window.HTMLMediaElement.prototype.pause = function __cxFakeNativePause() {}; } catch (e) { /* ignore */ }
assert('场景4(模拟还原): toString 覆盖后 getPauseNeutralized===false(检出被还原)', s4.ns.getPauseNeutralized() === false);
const p4 = find(s4.window.__CX_FORCE_PLAY.buildInvasionReport(), 'prototype.pause');
assert('场景4(模拟还原): 审计 prototype.pause.on===false(诚实反映还原)', !!(p4 && p4.on === false));

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — 礼貌模式 POLITE_MODE 抗检测行为契约');
process.exit(fail === 0 ? 0 : 1);
