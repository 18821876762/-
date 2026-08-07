// DeepSeek 应答端控制台特化回归：
// 1) chat.deepseek.com 页 → 面板特化为「DeepSeek 应答端控制台」（标题/状态区/应答端开关/工具库区），
//    且 ensurePanel 不因通用控件缺失而抛错（5 处未守卫 querySelector 已加 null 守卫）。
// 2) 超星页 → 仍是通用「强制续播·主控面板」（回归，未受影响）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

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

let pass = 0, fail = 0;
function assert(name, cond, extra) { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + (extra ? ' :: ' + JSON.stringify(extra) : '')); } }

// ===== 1) DeepSeek 页 =====
const dsHtml = '<!DOCTYPE html><html><head><title>DeepSeek</title></head><body><div class="ds-chat"></div></body></html>';
const ds = loadAt('https://chat.deepseek.com/', dsHtml);
assert('DS 页 注入无异常（ensurePanel 不因缺控件崩溃）', ds.err === null, ds.err && ds.err.message);

function pressP(win, doc) { doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })); }
pressP(ds.window, ds.document);
const dsPanel = ds.document.getElementById('__cxPanel');
assert('DS 页 面板已创建', !!dsPanel);
const dsHTML = dsPanel ? dsPanel.innerHTML : '';
assert('DS 页 标题为「DeepSeek 应答端控制台」', /DeepSeek 应答端控制台/.test(dsHTML), { hasGeneric: /强制续播·主控面板/.test(dsHTML) });
assert('DS 页 不显示通用主控面板', !/强制续播·主控面板/.test(dsHTML));
assert('DS 页 含联动状态区(__cxDsLogin/__cxDsChannel)', /__cxDsLogin/.test(dsHTML) && /__cxDsChannel/.test(dsHTML));
assert('DS 页 含应答端开关 __cxDsEnable', /__cxDsEnable/.test(dsHTML));
assert('DS 页 含工具库区 __cxAddons', /__cxAddons/.test(dsHTML));
assert('DS 页 默认应答端启用（DS_RESPONDER_ENABLED !== false）', ds.window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED !== false);

// 应答端开关切换
const en = ds.document.getElementById('__cxDsEnable');
if (en) {
  en.checked = false; en.dispatchEvent(new ds.window.Event('change', { bubbles: true }));
  assert('DS 页 关闭应答端 → 标志位 false', ds.window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED === false);
  en.checked = true; en.dispatchEvent(new ds.window.Event('change', { bubbles: true }));
  assert('DS 页 重新启用 → 标志位 true', ds.window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED === true);
}

// ===== 2) 超星页回归 =====
const cxHtml = '<!DOCTYPE html><html><head><title>学习通</title></head><body><video id="v" src="x.mp4" controls></video></body></html>';
const cx = loadAt('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html', cxHtml);
assert('超星页 注入无异常', cx.err === null, cx.err && cx.err.message);
pressP(cx.window, cx.document);
const cxPanel = cx.document.getElementById('__cxPanel');
const cxHTML = cxPanel ? cxPanel.innerHTML : '';
assert('超星页 仍是通用主控面板', /强制续播·主控面板/.test(cxHTML));
assert('超星页 不含 DS 控制台标题', !/DeepSeek 应答端控制台/.test(cxHTML));
assert('超星页 detectSite()===\'chaoxing\'（未误判 deepseek）', cx.window.__CX_FORCE_PLAY.detectSite() === 'chaoxing');

console.log('\n================ DS 控制台特化结论 ================');
console.log('PASS=' + pass + ' FAIL=' + fail);
if (fail > 0) { console.log('结论: FAIL'); process.exit(1); }
console.log('结论: PASS — DeepSeek 页特化为应答端控制台且不破坏通用面板');
process.exit(0);
