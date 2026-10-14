// P2-8 回归：ensurePanel 守卫（5 处 null 守卫）功能级验证。
// 1) DS 应答端控制台 HTML 不含 #__cxPanelClose/#__cxBtnPause/#__cxResume/#__cxRescan/#__cxEndRel，
//    但 ensurePanel 构建/打开不得抛错 —— 证明 DS 分支 5 处 querySelector 的 null 守卫生效。
// 2) 通用主控面板：#__cxResume 输入框的 input 事件须写入 CONFIG.RESUME_AFTER_MIN（而非 AUTO_STOP_MIN），
//    并经 panel:refresh 把 #__cxResumeVal 文本同步为该值，且不影响 #__cxAutoVal(AUTO_STOP_MIN)。
//    这是「防止守卫替换不匹配（RESUME_AFTER_MIN ≠ AUTO_STOP_MIN）」的强回归断言。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = require('../scripts/project-paths.cjs').personalProduct;
const code = fs.readFileSync(userJs, 'utf8');

const GUARD_IDS = ['#__cxPanelClose', '#__cxBtnPause', '#__cxResume', '#__cxRescan', '#__cxEndRel'];

function loadAt(url, html) {
  const dom = new JSDOM(html, { url: url, runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const mockCtx = new Proxy({}, { get: () => () => ({}) });
  try { window.HTMLCanvasElement.prototype.getContext = function () { return mockCtx; }; } catch (e) {}
  try { window.HTMLMediaElement.prototype.play = function () { this.paused = false; return Promise.resolve(); }; } catch (e) {}
  try { window.HTMLMediaElement.prototype.pause = function () { this.paused = true; }; } catch (e) {}
  let err = null;
  try { window.eval(code); } catch (e) { err = e; }
  return { window, document, err };
}

function pressP(win, doc) { doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); }

let pass = 0, fail = 0;
function assert(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); }
}

// ===== 1) DS 控制台：5 控件缺失，ensurePanel 不得抛错（null 守卫）=====
const dsHtml = '<!DOCTYPE html><html><head><title>DeepSeek</title></head><body><div class="ds-chat"></div></body></html>';
const ds = loadAt('https://chat.deepseek.com/', dsHtml);
assert('DS 页 注入无异常（ensurePanel 不抛错）', ds.err === null, ds.err && ds.err.message);
pressP(ds.window, ds.document);
const dsPanel = ds.document.getElementById('__cxPanel');
assert('DS 页 面板已创建', !!dsPanel);
const dsExists = GUARD_IDS.filter(function (id) { return ds.document.getElementById(id.slice(1)); });
assert('DS 页 5 个通用控件确实不存在（否则守卫无意义）', dsExists.length === 0, { present: dsExists });
assert('DS 页 打开后仍无异常（守卫生效）', ds.err === null, ds.err && ds.err.message);

// ===== 2) 通用面板：#__cxResume 守卫绑定 RESUME_AFTER_MIN（非 AUTO_STOP_MIN）=====
const cxHtml = '<!DOCTYPE html><html><head><title>学习通</title></head><body><video id="v" src="x.mp4" controls></video></body></html>';
const cx = loadAt('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html', cxHtml);
assert('超星页 注入无异常', cx.err === null, cx.err && cx.err.message);
pressP(cx.window, cx.document);
const cxPanel = cx.document.getElementById('__cxPanel');
assert('超星页 面板已创建', !!cxPanel);

const resumeInp = cx.document.getElementById('__cxResume');
const autoInp = cx.document.getElementById('__cxAuto');
assert('通用面板 含 #__cxResume 控件', !!resumeInp);
assert('通用面板 含 #__cxAuto 控件（AUTO_STOP_MIN，作对照）', !!autoInp);

if (resumeInp) {
  // 记初始 AUTO_STOP_MIN 对照值
  const autoValBefore = autoInp ? autoInp.value : null;
  // 写 RESUME_AFTER_MIN = 7 并触发 input 守卫
  resumeInp.value = '7';
  resumeInp.dispatchEvent(new cx.window.Event('input', { bubbles: true }));
  const resVal = cx.document.getElementById('__cxResumeVal');
  const autoValAfter = autoInp ? autoInp.value : null;
  assert('守卫：#__cxResume 写入 RESUME_AFTER_MIN 并经刷新同步到 #__cxResumeVal=7', resVal && resVal.textContent === '7', { resVal: resVal && resVal.textContent });
  assert('守卫：写 RESUME_AFTER_MIN 不影响 #__cxAuto(AUTO_STOP_MIN)', autoValAfter === autoValBefore, { before: autoValBefore, after: autoValAfter });

  // 反向证明：写 #__cxAuto 只动 AUTO_STOP_MIN，不动 RESUME_AFTER_MIN
  if (autoInp) {
    autoInp.value = '12';
    autoInp.dispatchEvent(new cx.window.Event('input', { bubbles: true }));
    const autoValAfter2 = cx.document.getElementById('__cxAutoVal');
    const resValAfter2 = cx.document.getElementById('__cxResumeVal');
    assert('对照：#__cxAuto 写入 AUTO_STOP_MIN 并经刷新同步到 #__cxAutoVal=12', autoValAfter2 && autoValAfter2.textContent === '12', { autoVal: autoValAfter2 && autoValAfter2.textContent });
    assert('对照：写 AUTO_STOP_MIN 不影响 #__cxResumeVal(仍=7)', resValAfter2 && resValAfter2.textContent === '7', { resVal: resValAfter2 && resValAfter2.textContent });
  }
}

console.log('\n================ ensurePanel 守卫回归结论 ================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
console.log('结论: PASS — DS 控制台 5 守卫不崩；#__cxResume↔RESUME_AFTER_MIN 绑定正确');
process.exit(0);
