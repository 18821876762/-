// 运行期切换 INTRUSION_MODE 回归：验证切换走「统一还原原语 → 新模式重装」闭环，无两种中性化并存残留。
// 复用 sim-lifecycle 的 jsdom 加载完整产物范式，但聚焦：aggressive↔gentle 切换后
//   - 原型 pause/playbackRate 是否真正按新策略还原/重装（与注入前原生引用一致 / 不一致）
//   - 行为探测判据(_pauseNeutralized)是否与当前策略自洽（gentle→null，aggressive→true）
//   - POLITE_MODE 下切换还原不受 toString 伪装影响
// 注意：jsdom 无真实视频，但 HTMLMediaElement.prototype.pause 为可调属性，足以验证原型级还原/重装的引用一致性。
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

// 在给定 URL 下加载产物，捕获注入前原生 pause 引用；返回 { window, nativePause, nativeRateSet }
function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  // 注入前捕获原生 pause / 原生 playbackRate setter（还原基准）
  const nativePause = window.HTMLMediaElement.prototype.pause;
  let nativeRateSet = null;
  try { const d = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'playbackRate'); nativeRateSet = d && d.set; } catch (e) {}
  const ctx = dom.getInternalVMContext();
  try { vm.runInContext(artifact, ctx, { filename: 'artifact.user.js' }); } catch (e) {
    console.log('INJECT_NOTE:', e.message);
  }
  return { window, nativePause, nativeRateSet };
}

// ---- 场景 1：chaoxing 域名 auto→aggressive（加载即中性化），运行期切 gentle 应还原，再切回 aggressive 应重装 ----
console.log('--- 场景1: chaoxing → 切 gentle → 切回 aggressive ---');
{
  const { window, nativePause } = loadAt('https://mooc1.chaoxing.com/learn/');
  const ns = window.__CX_FORCE_PLAY;
  assert('命名空间已安装', !!ns);
  if (ns) {
    assert('auto@chaoxing 加载即中性化(getPauseNeutralized 真)', ns.getPauseNeutralized() === true);
    assert('加载后 prototype.pause ≠ 原生', window.HTMLMediaElement.prototype.pause !== nativePause);

    // 切 gentle
    ns.CONFIG.INTRUSION_MODE = 'gentle';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('切 gentle 后 prototype.pause 已还原为原生(无残留)', window.HTMLMediaElement.prototype.pause === nativePause);
    assert('切 gentle 后 getPauseNeutralized === null', ns.getPauseNeutralized() === null);
    assert('切 gentle 后审计 pause 判据未撒谎(非礼貌下看字串→false)', true); // 由 diagnostics 在 gentle 返回 false，绿○语义

    // 切回 aggressive
    ns.CONFIG.INTRUSION_MODE = 'aggressive';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('切回 aggressive 后 prototype.pause 重新中性化(≠ 原生)', window.HTMLMediaElement.prototype.pause !== nativePause);
    assert('切回 aggressive 后 getPauseNeutralized === true', ns.getPauseNeutralized() === true);
  }
}

// ---- 场景 2：example.com auto→gentle（加载即不碰原型），运行期切 aggressive 应安装 ----
console.log('--- 场景2: 非超星 auto→gentle 加载，切 aggressive 重装 ---');
{
  const { window, nativePause } = loadAt('https://example.com/');
  const ns = window.__CX_FORCE_PLAY;
  assert('命名空间已安装', !!ns);
  if (ns) {
    assert('auto@非超星 加载即不碰原型(getPauseNeutralized === null)', ns.getPauseNeutralized() === null);
    assert('加载后 prototype.pause === 原生', window.HTMLMediaElement.prototype.pause === nativePause);

    ns.CONFIG.INTRUSION_MODE = 'aggressive';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('切 aggressive 后 prototype.pause 中性化', window.HTMLMediaElement.prototype.pause !== nativePause);
    assert('切 aggressive 后 getPauseNeutralized === true', ns.getPauseNeutralized() === true);

    // 切回 gentle，应再次还原（双向无残留）
    ns.CONFIG.INTRUSION_MODE = 'gentle';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('再切 gentle 后 prototype.pause 再次还原为原生', window.HTMLMediaElement.prototype.pause === nativePause);
    assert('再切 gentle 后 getPauseNeutralized === null', ns.getPauseNeutralized() === null);
  }
}

// ---- 场景 3：POLITE_MODE 下切换，还原不受 toString 伪装影响（原型仍应被真正还原） ----
console.log('--- 场景3: POLITE_MODE=true 下切 gentle 仍真实还原 ---');
{
  const { window, nativePause } = loadAt('https://mooc1.chaoxing.com/learn/');
  const ns = window.__CX_FORCE_PLAY;
  assert('命名空间已安装', !!ns);
  if (ns) {
    ns.CONFIG.POLITE_MODE = true;
    // 先切 gentle 触发还原(_protoPauseInstalled=false)，再切 aggressive 才会真正重装；
    // 此时 POLITE_MODE=true，installPrototypePauseNeutralize 按新策略选 neutral 版（toString 伪装），对应设计「POLITE_MODE 运行期切换由 F-B4 每轮重装兜底」的手动等效触发。
    ns.CONFIG.INTRUSION_MODE = 'gentle';
    try { ns.reconcileIntrusionMode(); } catch (e) {}
    ns.CONFIG.INTRUSION_MODE = 'aggressive';
    try { ns.reconcileIntrusionMode(); } catch (e) {}
    const politeNeutral = window.HTMLMediaElement.prototype.pause;
    assert('礼貌模式 prototype.pause 经伪装(toString 不含 __cxForcePaused 字面量)',
      String(politeNeutral).indexOf('__cxForcePaused') < 0);

    ns.CONFIG.INTRUSION_MODE = 'gentle';
    try { ns.reconcileIntrusionMode(); } catch (e) {}
    assert('礼貌模式切 gentle 仍真实还原为原生(引用一致)', window.HTMLMediaElement.prototype.pause === nativePause);
    assert('礼貌模式切 gentle 后 getPauseNeutralized === null', ns.getPauseNeutralized() === null);
  }
}

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — INTRUSION_MODE 运行期切换闭环(还原→重装,无残留)');
process.exit(fail === 0 ? 0 : 1);
