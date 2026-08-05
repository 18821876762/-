// rev2 多平台续播回归：验证学银/中国大学MOOC/学堂在线/智慧职教 的站点路由与弹窗随机作答。
// 关键断言：
//   - detectSite() 对各域返回正确站点标识（学银并入 chaoxing）；
//   - auto 模式各平台均激进原型中性化（无白名单/无 ananas，靠原型兜底）；
//   - 构造假弹窗后对应 tick 函数能随机选→答题→删除弹窗。
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
    runScripts: 'outside-only', url: url, pretendToBeVisual: true,
  });
  const { window } = dom;
  try { Object.defineProperty(window.navigator, 'mediaSession', { value: undefined, configurable: true }); } catch (e) {}
  const nativePause = window.HTMLMediaElement.prototype.pause;
  const fn = new window.Function(artifact);
  fn.call(window);
  return { window, ns: window.__CX_FORCE_PLAY, nativePause };
}

function makePopup(window, cls) {
  const dlg = window.document.createElement('div');
  dlg.className = cls;
  const o1 = window.document.createElement('div'); o1.className = 'option-item'; o1.textContent = 'A';
  const o2 = window.document.createElement('div'); o2.className = 'option-item'; o2.textContent = 'B';
  const btn = window.document.createElement('button'); btn.className = 'submit-btn'; btn.textContent = '提交';
  dlg.appendChild(o1); dlg.appendChild(o2); dlg.appendChild(btn);
  window.document.body.appendChild(dlg);
  return dlg;
}

console.log('--- rev2 多平台(续播)适配回归 ---');
// 学银在线 → 并入 chaoxing
{
  const { window, ns, nativePause } = loadAt('https://www.xueyinonline.com/course/123');
  assert('学银: detectSite()==="chaoxing"(并入超星)', ns.detectSite() === 'chaoxing');
  assert('学银: auto 模式 prototype.pause 已中性化', window.HTMLMediaElement.prototype.pause !== nativePause);
  assert('学银: 并入超星策略(attachmentsKey="attachments" 白名单键)', ns.siteAttachmentsKey() === 'attachments');
}
// 中国大学MOOC
{
  const { window, ns } = loadAt('https://www.icourse163.org/learn/123');
  assert('MOOC: detectSite()==="icourse163"', ns.detectSite() === 'icourse163');
  const dlg = makePopup(window, 'question-pop');
  const h = ns.icourse163TickQuestions();
  assert('MOOC: 弹窗随机作答且删除', h >= 1 && !window.document.body.contains(dlg));
}
// 学堂在线
{
  const { window, ns } = loadAt('https://www.xuetangx.com/learn/123');
  assert('学堂: detectSite()==="xuetangx"', ns.detectSite() === 'xuetangx');
  const dlg = makePopup(window, 'modal');
  const h = ns.xuetangxTickQuestions();
  assert('学堂: 弹窗随机作答且删除', h >= 1 && !window.document.body.contains(dlg));
}
// 智慧职教
{
  const { window, ns } = loadAt('https://sso.icve.com.cn/learn/123');
  assert('职教: detectSite()==="icve"', ns.detectSite() === 'icve');
  const dlg = makePopup(window, 'question-pop');
  const h = ns.icveTickQuestions();
  assert('职教: 弹窗随机作答且删除', h >= 1 && !window.document.body.contains(dlg));
}

console.log(fail === 0 ? '结论: PASS — 多平台(续播)路由+弹窗作答闭环' : ('结论: FAIL (' + fail + ')'));
process.exit(fail ? 1 : 0);
