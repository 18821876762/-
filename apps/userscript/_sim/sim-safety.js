// 安全停机回归（fail-safe）：检测到验证码/风控验证 → 立即停机 + 提示，且可人工恢复。
//   与"压在触发阈值之下继续运行"相反：命中即停机并交还控制权，由真人完成验证。
// 覆盖：① 默认配置 ② 选择器命中停机 ③ 人工恢复 ④ 开关关闭时不介入 ⑤ 弹层关键词命中
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
  console.log((cond ? 'PASS ' : 'FAIL ') + name);
  if (!cond) fail++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runScenario(preCfg, extraHtml) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><video id="v1"></video><div class="ans-attach-ct"></div>' + (extraHtml || '') + '</body></html>',
    { url: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const { window } = dom;
  if (preCfg) {
    try { window.localStorage.setItem('cx_panel_cfg', JSON.stringify(preCfg)); } catch (e) { /* ignore */ }
  }
  try { window.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; } catch (e) { /* ignore */ }
  const ctx = dom.getInternalVMContext();
  vm.runInContext(artifact, ctx, { filename: 'artifact.user.js' });
  return { window: window, ns: window.__CX_FORCE_PLAY };
}

(async () => {
  // ① 默认配置：开启安全停机、默认不自动恢复、无验证控件时不误停机
  const a = runScenario(null, '');
  assert('命名空间已安装', !!(a.ns && typeof a.ns.safetyResume === 'function'));
  assert('默认 SAFETY_STOP_ON_CHALLENGE=true', a.ns.CONFIG.SAFETY_STOP_ON_CHALLENGE === true);
  assert('默认 SAFETY_AUTO_RESUME=false（须人工确认）', a.ns.CONFIG.SAFETY_AUTO_RESUME === false);
  assert('无验证控件时不误停机', a.ns.SAFETY.tripped === false);
  assert('暴露 stopLoopTimer', typeof a.ns.stopLoopTimer === 'function');
  assert('暴露 safetyDetect/safetyTrip', typeof a.ns.safetyDetect === 'function' && typeof a.ns.safetyTrip === 'function');

  // ② 注入易盾验证控件 → 主循环 tick 应检出并停机
  const b = runScenario(null, '<div class="yidun_popup">请完成安全验证</div>');
  assert('初始未停机', b.ns.SAFETY.tripped === false);
  await sleep(2600);   // 等主循环 tick（RESCAN_INTERVAL 默认 2000ms）
  assert('检测到验证控件后已停机', b.ns.SAFETY.tripped === true);
  assert('停机原因包含"验证"字样', /验证/.test(b.ns.SAFETY.reason || ''));
  assert('停机后主循环已停（EventBus.state._loopTimer 置空）', !b.window.EventBus.state._loopTimer);

  // ③ 人工恢复
  const resumed = b.ns.safetyResume();
  assert('safetyResume 返回 true', resumed === true);
  assert('恢复后 tripped=false', b.ns.SAFETY.tripped === false);
  assert('恢复后主循环重启（_loopTimer 非空）', !!b.window.EventBus.state._loopTimer);

  // ④ 开关关闭时不介入（不强制停机）
  const c = runScenario({ SAFETY_STOP_ON_CHALLENGE: false }, '<div class="yidun_popup">请完成安全验证</div>');
  await sleep(2600);
  assert('开关关闭时不执行安全停机', c.ns.SAFETY.tripped === false);

  // ⑤ 关键词路径：弹层内出现「验证码」
  const d = runScenario(null, '<div class="modal">请输入验证码</div>');
  await sleep(2600);
  assert('弹层关键词「验证码」触发停机', d.ns.SAFETY.tripped === true);
  assert('关键词停机原因含「验证码」', /验证码/.test(d.ns.SAFETY.reason || ''));

  // ⑥ 答题闸门：停机后 quizTick 不再作答（返回 0）
  assert('停机后 quizTick 被闸门短路', d.ns.quizTick && d.ns.quizTick() === 0);

  console.log(fail === 0 ? '结论: PASS — 安全停机(fail-safe)' : '结论: ' + fail + ' FAIL');
  process.exit(fail === 0 ? 0 : 1);
})();
