// 智慧树网(zhihuishu)适配回归：验证站点路由收口 SITES 映射后，智慧树分支能正确启动且强制续播生效。
// 关键断言：
//   - detectSite() 对 zhihuishu.com 返回 'zhihuishu'；
//   - auto 模式在智慧树同样激进原型中性化（智慧树无 window.ananas 可依赖，必须原型级拦截）；
//   - 切 gentle 真实还原原生 pause（无残留），切回 auto 再次中性化；
//   - 全程加载/运行不抛异常（空键守卫生效：无 window.attachments 白名单全局也不 defineProperty('') 崩溃）。
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

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only',
    url: url,
    pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const nativePause = window.HTMLMediaElement.prototype.pause;
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY, nativePause };
}

console.log('--- 智慧树网(zhihuishu)适配回归 ---');
{
  const { window, ns, nativePause } = loadAt('https://www.zhihuishu.com/course/learn/123');
  assert('智慧树: 脚本加载无异常且命名空间存在', !!ns);
  if (ns) {
    assert('智慧树: detectSite() === "zhihuishu"', ns.detectSite() === 'zhihuishu');
    assert('智慧树(auto): prototype.pause 已中性化（≠ 原生）', window.HTMLMediaElement.prototype.pause !== nativePause);
    assert('智慧树(auto): getPauseNeutralized() === true（激进）', ns.getPauseNeutralized() === true);

    // 切 gentle 应真实还原原生 pause（无残留）
    ns.CONFIG.INTRUSION_MODE = 'gentle';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('智慧树 切 gentle: prototype.pause 还原为原生', window.HTMLMediaElement.prototype.pause === nativePause);
    assert('智慧树 切 gentle: getPauseNeutralized() === null', ns.getPauseNeutralized() === null);

    // 切回 auto 应再次中性化
    ns.CONFIG.INTRUSION_MODE = 'auto';
    try { ns.reconcileIntrusionMode(); } catch (e) { console.log('RECONCILE_ERR', e.message); }
    assert('智慧树 切回 auto: prototype.pause 再次中性化', window.HTMLMediaElement.prototype.pause !== nativePause);
  }
}

console.log('结论: ' + (fail === 0 ? 'PASS' : fail + ' FAIL') + ' — 智慧树网适配分支启动/对齐/还原闭环');
process.exit(fail ? 1 : 0);
