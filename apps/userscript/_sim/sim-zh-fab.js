// 智慧树 FAB 信息架构(IA)重组回归：
//   1) 视频页与题目页浮层均渲染（场景自适应未破坏）；
//   2) 头部场景徽标区分两种模式（视频=绿「视频续播」/题目=蓝「题目作答」）；
//   3) 区块化结构：状态/控制/动作三段 section 存在；
//   4) 视频页「强制续播」为统一开关（.cx-switch），题目页保留自动作答/自动交卷勾选 + 确认交卷。
// 注：站点隔离 detectSite()==='zhihuishu'，测试强制覆盖 detectSite 以在 jsdom 下引导 bootstrap。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

let fail = 0;
function assert(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  // 强制站点隔离为 zhihuishu，引导 FAB bootstrap
  try { window.detectSite = function () { return 'zhihuishu'; }; } catch (e) {}
  const fn = new window.Function(code);
  fn.call(window);
  return window;
}

function tick(window) {
  const ns = window.__CX_FORCE_PLAY;
  if (ns && typeof ns.zhihuishuFabTick === 'function') ns.zhihuishuFabTick(0);
}

console.log('--- 智慧树 FAB 信息架构重组回归 ---');

// ===== 视频页 =====
(function () {
  const w = loadAt('https://studyh5.zhihuishu.com/college/play?courseId=1');
  tick(w);
  const doc = w.document;
  const fab = doc.getElementById('__cxZhsFab');
  const pop = doc.getElementById('__cxZhsPop');
  assert('视频页 FAB 已渲染', !!fab);
  assert('视频页 浮层已渲染', !!pop);
  assert('视频页 头部场景徽标=视频续播', /视频续播/.test(pop.textContent || ''));
  assert('视频页 绿色视频徽标', !!pop.querySelector('.cx-badge-video'));
  assert('视频页 含收起按钮', !!pop.querySelector('#__cxZhsClose'));
  assert('视频页 三段分区(状态/控制/动作)', pop.querySelectorAll('.cx-zhs-sec').length >= 3);
  assert('视频页 强制续播为统一开关', !!pop.querySelector('#__cxZhsToggle.cx-switch'));
  assert('视频页 状态含「本次自动作答」', /本次自动作答/.test(pop.textContent || ''));
})();

// ===== 题目页 =====
(function () {
  const w = loadAt('https://www.zhihuishu.com/dohomework/studentHomework/dohomework?courseId=1');
  tick(w);
  const doc = w.document;
  const pop = doc.getElementById('__cxZhsPop');
  assert('题目页 FAB 浮层已渲染', !!pop);
  assert('题目页 头部场景徽标=题目作答', /题目作答/.test(pop.textContent || ''));
  assert('题目页 蓝色题目徽标', !!pop.querySelector('.cx-badge-exam'));
  assert('题目页 三段分区(状态/控制/动作)', pop.querySelectorAll('.cx-zhs-sec').length >= 3);
  assert('题目页 含 DeepSeek 状态行', !!pop.querySelector('#__cxZheDsRow'));
  assert('题目页 含自动作答勾选', !!pop.querySelector('#__cxZheAns'));
  assert('题目页 含自动交卷勾选', !!pop.querySelector('#__cxZheSub'));
  assert('题目页 含确认交卷按钮', !!pop.querySelector('#__cxZheConfirm'));
})();

// ===== 模式互斥：同一窗口切换 URL 场景，只渲染一种徽标 =====
(function () {
  const w = loadAt('https://studyh5.zhihuishu.com/college/play?courseId=2');
  tick(w);
  const doc = w.document;
  const pop = doc.getElementById('__cxZhsPop');
  assert('互斥 视频页仅显示视频徽标(无题目徽标)', !!pop.querySelector('.cx-badge-video') && !pop.querySelector('.cx-badge-exam'));
})();

console.log(fail === 0 ? '结论: PASS（FAB IA 重组生效，双模式渲染正常）' : '结论: FAIL（' + fail + ' 项未通过）');
process.exit(fail === 0 ? 0 : 1);
