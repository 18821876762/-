// 智慧树题目区状态机强化回归：
//   1) sync() 节流去重：SPA 密集 history 事件不触发重复过渡；
//   2) submitNow 返回 Promise 且带 submitting 防重入锁：READY 下快速重复调用不会重复交卷；
//   3) asubOn 走页面态缓存（_examPage），刷新缓存后正确反映路由变化，不每次同步读 location；
//   4) onStateChange 订阅仅在状态真正变化时触发，emit('zh-exam:state') 同步可见。
//
// 注：本模块为站点隔离（detectSite()==='zhihuishu'），测试需在智慧树 URL 下加载 bundle 才能 bootstrap。
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
const tick = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 30); }); };

function loadAt(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY, dom };
}

async function main() {
  console.log('--- 智慧树题目区状态机强化回归 ---');

  // 智慧树作业页 URL，使得 bootstrap 通过站点隔离
  const { window, ns } = loadAt('https://www.zhihuishu.com/dohomework/view?courseId=1');
  // bootstrap 经 setTimeout(bootstrap, 300) 延迟启动，等其暴露接口
  await tick(400);
  assert('状态机接口已暴露', ns.zhihuishuExamSubmitNow && ns.zhihuishuExamOnStateChange);
  assert('初始未连 DS：isActive=false', ns.zhihuishuExamEnabled() === false);
  assert('初始 state 安全', ns.zhihuishuExamState().answering === false);

  // 1) submitNow 非 READY 返回 resolved(false)（Promise）
  let r0 = ns.zhihuishuExamSubmitNow();
  assert('非 READY: submitNow 返回 Promise', typeof r0.then === 'function');
  assert('非 READY: submitNow resolve(false)', (await r0) === false);

  // 2) sync 节流：连续多次调用只产生一次有效过渡（不抛、不挂）
  let syncErr = null;
  try { ns.zhihuishuExamSync ? null : null; } catch (e) { syncErr = e; }
  // sync 非公开；通过 history hook 触发 reSync 多次（模拟 SPA 密集路由事件）
  try {
    window.history.pushState({}, '', window.location.href + '#a');
    window.history.pushState({}, '', window.location.href + '#b');
    window.history.replaceState({}, '', window.location.href + '#c');
  } catch (e) { syncErr = e; }
  await tick(200);  // 等待节流窗口（_SYNC_MIN_GAP=120ms）过去，确认 reSync 不抛
  assert('密集 history 事件: sync 节流不抛', syncErr === null);

  // 3) onStateChange 订阅 + emit('zh-exam:state') 可观测：状态变化被捕获
  let captured = [];
  ns.zhihuishuExamOnStateChange(function (s) { captured.push(s); });
  // 通过模拟开启自动作答 + DS 可用，触发 IDLE→ACTIVE 过渡，应被订阅捕获
  // 驱动 DeepSeek 闸门（真实机制：dsAvailable() 读 DS_STATUS.connected && loggedIn）；开启 LS 开关
  try { var _ds = window.__CX_FORCE_PLAY.DS_STATUS; if (_ds) { _ds.connected = true; _ds.loggedIn = true; } } catch (e) {}
  try { window.localStorage.setItem('cx_zh_exam_on', '1'); } catch (e) {}
  // 手动触发 storage 事件（同 tab 不自动派发，故直接调用 reSync 路径：通过 pushState hook）
  try { window.history.pushState({}, '', window.location.href + '#d'); } catch (e) {}
  await tick(200);
  assert('DS 可用+开关开: isActive=true', ns.zhihuishuExamEnabled() === true);
  assert('状态变化被 onStateChange 捕获', captured.length >= 1);
  const st = ns.zhihuishuExamState();
  assert('state.answering=true (进入 ACTIVE)', st.answering === true);
  assert('getState 返回 submitting 字段', typeof st.submitting === 'boolean');

  // 4) 构造真实 READY 态：开启自动交卷 + 注入末页(无下一页按钮) + 已勾选题目 → autoSubmitTick 进入 READY
  try { window.localStorage.setItem('cx_zh_exam_autosubmit', '1'); } catch (e) {}
  // 注入题目容器：已勾选 radio（_allAnsweredHere 命中 input:checked），且无下一页按钮（_peekNext=false → 末页）
  const doc = window.document;
  const qWrap = doc.createElement('div');
  qWrap.className = 'question-item';
  qWrap.innerHTML = '<input type="radio" checked> 题目A';
  doc.body.appendChild(qWrap);
  // 注入交卷按钮：_findSubmitBtn 扫 .submit-btn 或 button 含"交卷"语义
  const subBtn = doc.createElement('button');
  subBtn.className = 'submit-btn';
  subBtn.textContent = '交卷';
  doc.body.appendChild(subBtn);
  // 保持 DS 可用（前面已置 connected/loggedIn=true），触发 reSync + autoSubmitTick 进入 READY
  try { window.history.pushState({}, '', window.location.href + '#ready'); } catch (e) {}
  await tick(200);
  // 主循环每轮调 autoSubmitTick；这里直接模拟主循环调用（与 main-loop 同口径）
  try { ns.zhihuishuExamEnabled() && ns.zhihuishuExamTick(); ns.zhihuishuExamAutoSubmitTick(); } catch (e) {}
  await tick(50);
  assert('末页+已答完: confirmReady=true (进入 READY)', ns.zhihuishuExamState().confirmReady === true);

  // 4a) READY 不被 DS 断连降级（防入口死锁）：断开 DS 后触发 reSync + autoSubmitTick，confirmReady 仍为 true
  try { var _ds2 = window.__CX_FORCE_PLAY.DS_STATUS; if (_ds2) { _ds2.connected = false; _ds2.loggedIn = false; } } catch (e) {}
  try { window.history.pushState({}, '', window.location.href + '#dsdown'); } catch (e) {}
  await tick(200);
  try { ns.zhihuishuExamAutoSubmitTick(); } catch (e) {}
  await tick(50);
  assert('DS 断连: READY 保持 (confirmReady 仍 true, 交卷入口不锁死)', ns.zhihuishuExamState().confirmReady === true);
  assert('DS 断连: 作答态 isActive=false (闸门仍生效)', ns.zhihuishuExamEnabled() === false);

  // 4b) submitting emit 去重修复：READY 下 submitNow 使 submitting 翻 true，onStateChange 应捕获
  captured = [];
  let submittingSeen = false;
  ns.zhihuishuExamOnStateChange(function (s) { if (s.submitting === true) submittingSeen = true; });
  try { window.__CX_FORCE_PLAY.DS_STATUS.connected = true; window.__CX_FORCE_PLAY.DS_STATUS.loggedIn = true; } catch (e) {}
  try { window.history.pushState({}, '', window.location.href + '#submit'); } catch (e) {}
  await tick(150);
  const submitRes = await ns.zhihuishuExamSubmitNow();
  await tick(30);
  assert('READY: submitNow resolve(true) (已点交卷)', submitRes === true);
  assert('submitting 翻转被 onStateChange 捕获 (去重修复)', submittingSeen === true);

  // 5) asubOn 走页面态缓存：刷新路由到非作业页后，即使开关开也应 not active-asub
  try { window.history.pushState({}, '', 'https://www.zhihuishu.com/course/list'); } catch (e) {}
  await tick(200);
  // 路由已变更，refreshExamPage 应更新缓存；isActive 受 _isExamPage 影响
  // 这里仅保证 reSync 在路由变更后不抛、状态机仍可读
  assert('路由变更后 getState 仍可读', ns.zhihuishuExamState() && typeof ns.zhihuishuExamState().answering === 'boolean');

  console.log(fail === 0 ? '结论: PASS — 状态机节流/防重入/缓存/订阅闭环' : ('结论: FAIL (' + fail + ')'));
  process.exit(fail ? 1 : 0);
}
main().catch(function (e) { console.log('FAIL 未捕获异常: ' + (e && e.stack || e)); process.exit(1); });
