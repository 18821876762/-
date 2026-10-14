// sim-popup-block.js — 智慧树等 MOOC 弹窗「彻底取消」回归
// 覆盖：
//  1) cx_popup_block=1 → 弹窗被静默关闭(移除)、不作答(不点选项/提交)
//  2) cx_popup_quiz=0(关闭自动作答) → 弹窗仍被静默关闭(不再"关了还冒出")
//  3) 默认(两开关都未设/自动作答开) → 作答+关闭(原行为)
//  4) 重弹循环：block 模式下连续多轮调用，弹窗每轮都被清(打断删→弹)
const fs = require('fs');
const path = require('path');
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

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'outside-only', url: url, pretendToBeVisual: true });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
}
function clearLS(window) { try { window.localStorage.clear(); } catch (e) {} }
function makeDialog(window) {
  const d = window.document.createElement('div');
  d.className = 'dialog-wrap';   // 唯一命中 dialogSels[0]='.dialog-wrap'，内部 class 避开 [class*=topic/question/answer/popup] 等宽泛选择器，避免被当多个弹窗误统计
  d.innerHTML = '<div class="opt-x">选项A</div><div class="opt-x">选项B</div>' +
    '<button class="btn-submit-x">提交</button><button class="btn-skip-x">跳过</button>';
  window.document.body.appendChild(d);
  return d;
}

async function main() {
  // 场景1：彻底取消 cx_popup_block=1 → 弹窗被移除、不作答
  {
    const { window, ns } = loadAt('https://www.zhihuishu.com/learn/');
    clearLS(window);
    window.localStorage.setItem('cx_popup_block', '1');
    const d = makeDialog(window);
    let answered = false;
    d.querySelector('.btn-submit-x').addEventListener('click', function () { answered = true; });
    const r = ns.popupQuizTick();
    assert('彻底取消: 弹窗被移除', !d.isConnected);
    assert('彻底取消: 不作答(未点提交)', answered === false);
    assert('彻底取消: tick 返回移除数=1', r === 1);
  }

  // 场景2：cx_popup_quiz=0(关闭自动作答) → 弹窗仍被静默关闭(不再"关了还冒出")
  {
    const { window, ns } = loadAt('https://www.zhihuishu.com/learn/');
    clearLS(window);
    window.localStorage.setItem('cx_popup_quiz', '0');
    const d = makeDialog(window);
    let answered = false;
    d.querySelector('.btn-submit-x').addEventListener('click', function () { answered = true; });
    const r = ns.popupQuizTick();
    assert('关闭自动作答: 弹窗仍被移除(静默关闭)', !d.isConnected);
    assert('关闭自动作答: 不作答', answered === false);
    assert('关闭自动作答: tick 返回=1', r === 1);
  }

  // 场景3：默认(自动作答开) → 作答+关闭(原行为保持)
  {
    const { window, ns } = loadAt('https://www.zhihuishu.com/learn/');
    clearLS(window);
    const d = makeDialog(window);
    let answered = false;
    d.querySelector('.btn-submit-x').addEventListener('click', function () { answered = true; });
    const r = ns.popupQuizTick();
    assert('默认自动作答: 弹窗被移除', !d.isConnected);
    assert('默认自动作答: 已作答(点了提交)', answered === true);
    assert('默认自动作答: tick 返回=1', r === 1);
  }

  // 场景4：重弹循环(彻底取消模式) → 多轮调用每轮都清，打断删→弹
  {
    const { window, ns } = loadAt('https://www.zhihuishu.com/learn/');
    clearLS(window);
    window.localStorage.setItem('cx_popup_block', '1');
    let totalRemoved = 0;
    for (let round = 0; round < 5; round++) {
      const d = makeDialog(window);   // 模拟平台每轮重弹
      totalRemoved += ns.popupQuizTick();
    }
    assert('重弹循环: 5 轮共移除 5 个弹窗', totalRemoved === 5);
    assert('重弹循环: 末尾无残留弹窗', window.document.querySelectorAll('.dialog-wrap').length === 0);
  }

  console.log(fail === 0 ? '结论: PASS — 彻底取消弹窗闭环' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
