// rev3 卸载还原对称回归（评估清单#7）：验证原型 pause/playbackRate 中性化的「安装/恢复」对称、幂等，
// 以及顶层 uninstall()（cleanupListeners）能把 HTMLMediaElement.prototype 还原为注入前原生描述符。
// 使用 jsdom 的真实 HTMLMediaElement，加载完整 bundle 以驱动 config.js 真实原语（install/restore 已暴露到命名空间）。
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

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.error('FAIL ' + name + (extra != null ? ' → ' + extra : '')); }
}

// 描述符等价比较（data 属性比 value，访问器比 get/set；均比 configurable/writable/enumerable）
function descEq(a, b) {
  if (!a || !b) return false;
  if (a.configurable !== b.configurable || a.writable !== b.writable || a.enumerable !== b.enumerable) return false;
  if (a.get || a.set || b.get || b.set) return a.get === b.get && a.set === b.set;
  return a.value === b.value;
}

// 自定义加载：先捕获原生描述符，再注入 bundle（config.js 加载期即按 usePrototypeNeutralize() 装好）
function loadCapture(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}

  // 捕获注入前原生描述符（install/restore 的单一事实源）
  const nativePause = window.HTMLMediaElement.prototype.pause;
  const nativePauseDesc = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'pause');
  // 注意：playbackRate 在 jsdom 是访问器，原型上读取会抛错，故只取描述符不取值
  const nativeRateDesc = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'playbackRate');

  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY, nativePause, nativePauseDesc, nativeRateDesc };
}

console.log('--- rev3 卸载还原对称(pause/rate)回归 ---');

// 超星域 → usePrototypeNeutralize()=true → 加载期即中性化
const { window, ns, nativePause, nativePauseDesc, nativeRate, nativeRateDesc } = loadCapture('https://mooc.xxx.edu.cn/learn/1');

// 加载后：pause 已中性化
assert('load: pause 已中性化(≠原生)', window.HTMLMediaElement.prototype.pause !== nativePause);
assert('load: probePauseNeutralized()===true', ns.probePauseNeutralized() === true);
assert('load: 命名空间暴露 install/restore 原语',
  typeof ns.installPrototypePauseNeutralize === 'function' &&
  typeof ns.restorePrototypePause === 'function' &&
  typeof ns.installPlaybackRateNeutralize === 'function' &&
  typeof ns.restorePrototypeRate === 'function');

// 多轮 install→restore→install 对称
var CYCLES = 6;
for (var i = 0; i < CYCLES; i++) {
  ns.restorePrototypePause();
  assert('cycle' + i + ': restore → 回到原生函数', window.HTMLMediaElement.prototype.pause === nativePause);
  assert('cycle' + i + ': restore → 描述符完全还原', descEq(Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'pause'), nativePauseDesc));
  assert('cycle' + i + ': restore → probe=null(未装)', ns.probePauseNeutralized() === null);
  ns.installPrototypePauseNeutralize();
  assert('cycle' + i + ': install → 再次中性化(≠原生)', window.HTMLMediaElement.prototype.pause !== nativePause);
  assert('cycle' + i + ': install → probe=true', ns.probePauseNeutralized() === true);
}

// 幂等：连续 restore 两次仍原生（不抛异常、不漂移）
ns.restorePrototypePause(); ns.restorePrototypePause();
assert('幂等: 双 restore 仍原生', window.HTMLMediaElement.prototype.pause === nativePause);
assert('幂等: 双 restore probe=null(未装)', ns.probePauseNeutralized() === null);
// 幂等：连续 install 两次仍中性化（_protoPauseInstalled 不重复计数/泄漏）
ns.installPrototypePauseNeutralize(); ns.installPrototypePauseNeutralize();
assert('幂等: 双 install 仍中性化', ns.probePauseNeutralized() === true);
assert('幂等: 双 install 后 restore → 原生', (ns.restorePrototypePause(), window.HTMLMediaElement.prototype.pause === nativePause));

// playbackRate 对称（jsdom 若未实现则跳过，不误判）
if (nativeRateDesc) {
  assert('rate: load 已中性化', ns.probeRateNeutralized() === true);
  for (var j = 0; j < CYCLES; j++) {
    ns.restorePrototypeRate();
    assert('rate cycle' + j + ': 回到原生描述符', descEq(Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'playbackRate'), nativeRateDesc));
    assert('rate cycle' + j + ': probe=null(未装)', ns.probeRateNeutralized() === null);
    ns.installPlaybackRateNeutralize();
    assert('rate cycle' + j + ': 再次中性化', ns.probeRateNeutralized() === true);
  }
} else {
  console.log('SKIP playbackRate 对称（jsdom 未实现 playbackRate 访问器）');
}

// 顶层 uninstall()（cleanupListeners）还原：先装好，再卸载，断言回到原生
ns.installPrototypePauseNeutralize();
if (nativeRateDesc) ns.installPlaybackRateNeutralize();
ns.uninstall();   // 删除 window.__CX_FORCE_PLAY 前已完成原型还原
assert('uninstall: pause 还原原生', window.HTMLMediaElement.prototype.pause === nativePause);
assert('uninstall: pause 描述符完全还原', descEq(Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'pause'), nativePauseDesc));
if (nativeRateDesc) assert('uninstall: rate 还原原生描述符', descEq(Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'playbackRate'), nativeRateDesc));
assert('uninstall: 命名空间已删除', window.__CX_FORCE_PLAY === undefined);

console.log('\n结论: ' + (fail === 0 ? ('PASS — 卸载对称 ' + pass + ' 断言') : ('FAIL (' + fail + '/' + (pass + fail) + ')')));
process.exit(fail ? 1 : 0);
