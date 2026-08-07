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

const artifact = fs.readFileSync(path.join(__dirname, '..', 'chaoxing-force-play.user.js'), 'utf8');

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

// —— 场景2：auto + 超星 + 非礼貌(默认) → 字面量基线零回归 ——
const s2 = runScenario('https://mooc1.chaoxing.com/learn/yyy', null);
const s2pauseStr = String(s2.window.HTMLMediaElement.prototype.pause);
assert('场景2(默认): prototype.pause.toString 仍含 "__cxForcePaused"(零回归)', s2pauseStr.indexOf('__cxForcePaused') >= 0);
assert('场景2(默认): 行为探测 getPauseNeutralized===true', s2.ns.getPauseNeutralized() === true);
const p2 = find(s2.report, 'prototype.pause');
assert('场景2(默认): 审计 prototype.pause.on===true', !!(p2 && p2.on === true));

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
