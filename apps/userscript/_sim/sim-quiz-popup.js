// 弹窗题目关闭回归：验证 popupQuizTick 对「弹窗内题目」真正作答+关闭 + 同指纹去重 + 不同弹窗可重复处理
// + 开关语义(cx_popup_quiz=0 / cx_popup_block=1 静默关闭不作答) + 非允许站点/非弹窗 DOM 零副作用。
// 架构说明：当前弹窗作答由站点无关的 popupQuizTick（popup-quiz.js 骨架）承担，由各 MOOC 平台模块经
// registerPopupQuizSite 注册后调用（默认允许站点 zhihuishu/icourse163/xuetangx/icve）；超星作业/考试
// 真答题走 chaoxingTickQuiz(quizTick) 而非弹窗路径。故本回归直接测 popupQuizTick（允许站点 zhihuishu），
// 以当前 POPUP_QUIZ 选择器 + _pqIsDialogCandidate 候选判定为准（2026-08-14 重写，对齐 rev 后架构）。
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
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY };
}
// 弹窗内题目：.question-pop 容器(命中 dialogSels + 候选类名) + .topic-item 选项 + 提交 + 关闭按钮（匹配 POPUP_QUIZ）
function makePopupQuestion(window, stemText, nOpts) {
  const popup = window.document.createElement('div'); popup.className = 'question-pop'; popup.setAttribute('data-stem', stemText);
  for (var i = 0; i < nOpts; i++) {
    const opt = window.document.createElement('div'); opt.className = 'topic-item'; opt.textContent = (stemText + '选项' + i); popup.appendChild(opt);
  }
  const submit = window.document.createElement('button'); submit.className = 'submit-btn'; submit.textContent = '提交';
  const submitted = { val: false }; submit.addEventListener('click', function () { submitted.val = true; });
  popup.appendChild(submit);
  const closeBtn = window.document.createElement('button'); closeBtn.className = 'close'; closeBtn.textContent = '关闭';
  popup.appendChild(closeBtn);
  window.document.body.appendChild(popup);
  return { popup, submitted };
}
// 非弹窗普通节点：不含弹窗类名、选项/按钮文本均不匹配候选语义（_pqIsDialogCandidate 返回 false）
function makePlainNode(window) {
  const box = window.document.createElement('div'); box.className = 'plain-box';
  for (var i = 0; i < 3; i++) { const o = window.document.createElement('div'); o.className = 'opt-x'; o.textContent = '项' + i; box.appendChild(o); }
  const btn = window.document.createElement('button'); btn.className = 'plain-submit'; btn.textContent = '保存';
  box.appendChild(btn);
  window.document.body.appendChild(box);
  return { box };
}

console.log('--- 弹窗题目关闭(popupQuizTick)回归 ---');
// 1. 允许站点(zhihuishu)弹窗题：随机作答 + 点击提交 + 弹窗被真正关闭
{
  const { window, ns } = loadAt('https://www.zhihuishu.com/learn/1');
  assert('zhihuishu 页 detectSite()==="zhihuishu"', ns.detectSite() === 'zhihuishu');
  const { popup, submitted } = makePopupQuestion(window, '弹窗题1+1=?', 4);
  const ans = ns.popupQuizTick();
  assert('弹窗题被作答', ans >= 1);
  assert('提交按钮被点击', submitted.val === true);
  assert('弹窗被真正关闭(已从 DOM 移除)', popup.parentNode === null);
}
// 2. 同指纹重弹（新节点、同题）：幂等修复后每轮静默关闭(不卡死挡播放)但不重复作答(不翻答案)
//    旧实现 _pqHandled[fp] 置位即永久阻塞、同指纹重弹的弹窗被"保留且不处理" → 卡死挡播放(用户报的死锁)。
//    修复后：首次随机作答+关闭；重弹同指纹每轮被静默关闭(幂等 dismiss)以保续播不被挡，但不重复点击 submit(不翻答案)。
{
  const { window, ns } = loadAt('https://www.zhihuishu.com/learn/1');
  const { popup, submitted } = makePopupQuestion(window, '弹窗题1+1=?', 4);
  const ans1 = ns.popupQuizTick();
  assert('首次作答', ans1 >= 1 && submitted.val === true);
  assert('首次弹窗被关', popup.parentNode === null);
  const r2 = makePopupQuestion(window, '弹窗题1+1=?', 4);   // 平台重弹的新节点、同题
  const ans2 = ns.popupQuizTick();
  // 重弹同指纹：应被静默关闭(返回>=1、弹窗移除)以保续播不被挡；但 submit 按钮不点(不重复作答/不翻答案)
  assert('重弹同指纹: 每轮静默关闭且不重复作答', ans2 >= 1 && r2.submitted.val === false && r2.popup.parentNode === null);
}
// 3. 不同指纹弹窗：可再次作答并关闭（验证可处理多个不同弹窗）
{
  const { window, ns } = loadAt('https://www.zhihuishu.com/learn/1');
  const { popup, submitted } = makePopupQuestion(window, '弹窗题第一题', 3);
  ns.popupQuizTick();
  const r2 = makePopupQuestion(window, '弹窗题另一题(不同指纹)', 3);
  const ans2 = ns.popupQuizTick();
  assert('不同指纹弹窗: 再次作答并关闭', ans2 >= 1 && r2.submitted.val === true && r2.popup.parentNode === null);
}
// 4. 关闭「弹窗自动作答」开关(cx_popup_quiz=0)：仅静默关闭、不作答（popupQuizBlock 返回已关闭计数）
{
  const { window, ns } = loadAt('https://www.zhihuishu.com/learn/1');
  try { window.localStorage.setItem('cx_popup_quiz', '0'); } catch (e) {}
  const { popup, submitted } = makePopupQuestion(window, '关开关弹窗题', 4);
  const ans = ns.popupQuizTick();
  assert('关开关: 弹窗被静默关闭(返回>=1)', ans >= 1);
  assert('关开关: 提交按钮未被点(不作答)', submitted.val === false);
  assert('关开关: 弹窗已从 DOM 移除', popup.parentNode === null);
}
// 5. 彻底取消弹窗开关(cx_popup_block=1)：仅静默关闭、不作答
{
  const { window, ns } = loadAt('https://www.zhihuishu.com/learn/1');
  try { window.localStorage.setItem('cx_popup_block', '1'); window.localStorage.setItem('cx_popup_quiz', '1'); } catch (e) {}
  const { popup, submitted } = makePopupQuestion(window, '彻底取消弹窗题', 4);
  const ans = ns.popupQuizTick();
  assert('彻底取消: 弹窗被静默关闭(返回>=1)', ans >= 1);
  assert('彻底取消: 提交按钮未被点(不作答)', submitted.val === false);
  assert('彻底取消: 弹窗已从 DOM 移除', popup.parentNode === null);
}
// 6. 非允许站点(chaoxing)：popupQuizTick 站点隔离 → 不作答、不关闭、零副作用
{
  const { window, ns } = loadAt('https://mooc.xxx.edu.cn/learn/1');
  assert('非允许站点 detectSite()==="chaoxing"', ns.detectSite() === 'chaoxing');
  const { popup, submitted } = makePopupQuestion(window, '非允许站点弹窗题', 4);
  const ans = ns.popupQuizTick();
  assert('非允许站点: 返回0不处理', ans === 0);
  assert('非允许站点: 提交按钮未被点', submitted.val === false);
  assert('非允许站点: 弹窗未被关闭(零副作用)', popup.parentNode !== null);
}
// 7. 非弹窗普通节点：popupQuizTick 不应误删/误作答
{
  const { window, ns } = loadAt('https://www.zhihuishu.com/learn/1');
  const { box } = makePlainNode(window);
  const before = window.document.body.children.length;
  const ans = ns.popupQuizTick();
  assert('非弹窗节点: 返回0不处理', ans === 0);
  assert('非弹窗节点: 页面不被误删', window.document.body.children.length === before);
  assert('非弹窗节点: 节点保留在页面', box.parentNode !== null);
}

console.log(fail === 0 ? '结论: PASS — 弹窗关闭+去重+开关语义+站点隔离闭环' : ('结论: FAIL (' + fail + ')'));
process.exit(fail ? 1 : 0);
