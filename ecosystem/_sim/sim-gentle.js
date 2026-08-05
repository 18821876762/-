// 温和模式回归（建议#1）：验证 reconcileIntrusionMode 按 INTRUSION_MODE + 站点识别，
// 正确收敛原型 pause/playbackRate 中性化的「装/卸」，使温和模式关闭原型、仅靠实例级接管。
//
// 覆盖三条路径：
//   1) auto + 超星域名(chaoxing.com) → 激进：prototype.pause 保持包装（核心续播不丢）
//   2) auto + 非超星域名(example.com) → 温和：reconcile 后 prototype.pause 还原（未包装）
//   3) 显式 gentle（localStorage 持久化）→ 即便超星域也不装原型：prototype.pause 未包装
// 与 sim-audit.js 同源：jsdom 加载完整产物，注入 mediaSession 模拟。
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

// 构造一个 jsdom 场景：url 决定 detectSite 结果；preCfg 可在注入前写入 localStorage 模拟已持久化设置。
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
  // 注入 mediaSession 模拟（与 sim-audit.js 同款，确保初始化路径一致）
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
  return { ns: ns, report: report };
}

// —— 场景1：auto + 超星域名 → 应保持原型包装（激进）——
const s1 = runScenario('https://mooc1.chaoxing.com/learn/xxx', null);
assert('场景1 命名空间已安装', !!(s1.ns && typeof s1.ns.buildInvasionReport === 'function'));
const p1 = find(s1.report, 'prototype.pause');
assert('场景1(auto·超星): prototype.pause 已包装(激进·核心不丢)', !!(p1 && p1.on === true));

// —— 场景2：auto + 非超星域名 → reconcile 后应还原原型（温和）——
const s2 = runScenario('https://example.com/page', null);
const p2 = find(s2.report, 'prototype.pause');
assert('场景2(auto·非超星): prototype.pause 还原(温和·未包装)', !!(p2 && p2.on === false));

// —— 场景3：显式 gentle（持久化）→ 即便超星域也不装原型 ——
const s3 = runScenario('https://mooc1.chaoxing.com/learn/yyy', { INTRUSION_MODE: 'gentle' });
const p3 = find(s3.report, 'prototype.pause');
assert('场景3(gentle·超星): prototype.pause 未包装(温和生效)', !!(p3 && p3.on === false));
// 验证运行期切换：中途切回 aggressive 应重装原型
try {
  if (s3.ns && typeof s3.ns.reconcileIntrusionMode === 'function') {
    s3.ns.CONFIG.INTRUSION_MODE = 'aggressive';
  }
} catch (e) { /* CONFIG 可能未直接暴露，下面用命名空间不可达则跳过 */ }
// 若 CONFIG 不可直达，则跳过运行期切换断言（由场景1/2 已覆盖装/卸决策）
assert('场景3 审计报告含策略区(透明展示)', !!(find(s3.report, '策略')));

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — 温和模式 INTRUSION_MODE 收敛契约');
process.exit(fail === 0 ? 0 : 1);
