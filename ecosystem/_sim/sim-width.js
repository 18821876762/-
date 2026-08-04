// 回归仿真：面板宽度改造
// 验证 (1) 默认宽度 460px 而非旧 288px；(2) 宽度滑块实时生效并持久化；
//      (3) Ninja 展开宽度跟随同一 CSS 变量（不再与正常态"一样窄"导致无法分辨）。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const userJs = path.resolve(__dirname, '..', 'chaoxing-force-play.user.js');
const code = fs.readFileSync(userJs, 'utf8');

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><video id="v" src="x.mp4" controls></video></body></html>',
  { url: 'https://mooc1.chaoxing.com/study', runScripts: 'dangerously', pretendToBeVisual: true });
const { window } = dom; const { document } = window;
window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
window.HTMLMediaElement.prototype.play = () => Promise.resolve();
window.HTMLMediaElement.prototype.pause = () => Promise.resolve();

window.eval(code);
document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true }));

const p = document.getElementById('__cxPanel');
const results = [];
function check(name, actual, expect) {
  const ok = actual === expect;
  results.push(ok);
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ' => ' + JSON.stringify(actual) + (ok ? '' : ' (期望 ' + JSON.stringify(expect) + ')'));
}

check('面板已渲染', !!p, true);
check('默认 --cx-panel-w', p.style.getPropertyValue('--cx-panel-w').trim(), '460px');
check('基础宽度声明走变量', /width:\s*var\(--cx-panel-w,\s*460px\)/.test(p.style.cssText || ''), true);
check('基础宽度不再硬编码 288px', /width:\s*288px/.test(p.style.cssText || ''), false);

// Ninja 注入样式：展开态宽度必须跟随变量，而非固定 288px
const ninjaCss = (document.getElementById('__cxPanelNinjaStyle') || {}).textContent || '';
check('Ninja 折叠为玻璃胶囊(44x50)', /#__cxPanel\.ninja\{[^}]*width:44px!important/.test(ninjaCss), true);
check('Ninja 展开跟随变量', /ninja-open\{[^}]*width:var\(--cx-panel-w,460px\)!important/.test(ninjaCss), true);
check('Ninja 展开不再固定 288px', /ninja-open\{[^}]*width:288px!important/.test(ninjaCss), false);
// 布局回归：悬停/展开态必须恢复块级布局，且标题栏高度重置，否则内部开关被 .ninja 折叠态的 display:flex 拉伸变形
check('Ninja 展开恢复块级布局', /ninja-open\{[^}]*display:block!important/.test(ninjaCss), true);
check('Ninja 展开标题栏高度重置', /ninja-open \.cx-titlebar\{[^}]*height:auto!important/.test(ninjaCss), true);
// 折叠态外观：播放三角图标 + 蓝渐变浮标（替代朴素圆点）
check('Ninja 折叠态含播放三角图标', /cx-ninja-glyph/.test(ninjaCss), true);
check('Ninja 折叠态全息玻璃磨砂', /backdrop-filter:blur\(10px\)!important/.test(ninjaCss), true);
check('Ninja 折叠态半透明白底', /background:rgba\(255,255,255,\.22\)!important/.test(ninjaCss), true);
check('Ninja 折叠态圆角矩形(非正圆)', /border-radius:14px!important/.test(ninjaCss), true);
check('Ninja 折叠态双状态图标(play/pause 切换)', /cx-ninja-glyph\.cx-playing .cx-glyph-pause\{display:none!important;?\}/.test(ninjaCss), true);
check('Ninja 折叠态图标为白色 SVG', /cx-ninja-glyph .cx-glyph\{[^}]*fill:#fff!important/.test(ninjaCss), true);
check('Ninja 展开态恢复浅色底', /ninja-open\{[^}]*background:#FFFFFF!important/.test(ninjaCss), true);

// 宽度滑块：实时生效 + 持久化
const pw = p.querySelector('#__cxPanelW');
check('宽度滑块存在', !!pw, true);
pw.value = '520';
pw.dispatchEvent(new window.Event('input', { bubbles: true }));
check('滑块后变量更新', p.style.getPropertyValue('--cx-panel-w').trim(), '520px');
check('滑块后标签更新', (p.querySelector('#__cxPanelWVal') || {}).textContent, '520');
check('宽度已持久化', JSON.parse(window.localStorage.getItem('cx_panel_cfg') || '{}').PANEL_W, 520);

// 越界钳制
pw.value = '9999';
pw.dispatchEvent(new window.Event('input', { bubbles: true }));
check('超上限被钳制到 760', p.style.getPropertyValue('--cx-panel-w').trim(), '760px');

// 开关 Ninja：折叠/展开与正常态共用同一变量宽度
const cbx = p.querySelector('#__cxNinja');
cbx.checked = true; cbx.dispatchEvent(new window.Event('change'));
check('开 Ninja 后有 ninja class', p.classList.contains('ninja'), true);
check('Ninja 下变量宽度保持', p.style.getPropertyValue('--cx-panel-w').trim(), '760px');
cbx.checked = false; cbx.dispatchEvent(new window.Event('change'));
check('退出 Ninja 后无 ninja class', p.classList.contains('ninja'), false);

// 跨刷新：新窗口读取持久化宽度
const dom2 = new JSDOM('<!DOCTYPE html><html><head></head><body><video id="v2" src="y.mp4"></video></body></html>',
  { url: 'https://mooc1.chaoxing.com/study', runScripts: 'dangerously', pretendToBeVisual: true });
const w2 = dom2.window;
w2.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
w2.HTMLMediaElement.prototype.play = () => Promise.resolve();
w2.HTMLMediaElement.prototype.pause = () => Promise.resolve();
w2.eval("localStorage.setItem('cx_panel_cfg', JSON.stringify({PANEL_W:520}))");
w2.eval(code);
w2.document.dispatchEvent(new w2.KeyboardEvent('keydown', { key: 'p', bubbles: true }));
const p2 = w2.document.getElementById('__cxPanel');
check('刷新后恢复持久化宽度', p2 ? p2.style.getPropertyValue('--cx-panel-w').trim() : null, '520px');

const failed = results.filter(r => !r).length;
console.log('\n合计: ' + results.length + ' 项，失败 ' + failed);
console.log('结论: ' + (failed === 0 ? 'PASS — 面板宽度可调、持久化、Ninja 同步' : 'FAIL'));
process.exit(failed === 0 ? 0 : 1);
