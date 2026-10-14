// 回归仿真：面板宽度改造（2026-08-12 随专业工具 UI 规范更新：默认宽度 460px → 340px）
// 验证 (1) 默认宽度 340px 而非旧 288px/460px；(2) 宽度滑块实时生效并持久化；
//      (3) Ninja 展开宽度跟随同一 CSS 变量（不再与正常态"一样窄"导致无法分辨）。
//      (4) Ninja 折叠态为品牌色实心圆球（40×40），规范明确「无呼吸动效」。
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const userJs = require('../scripts/project-paths.cjs').personalProduct;
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
check('默认 --cx-panel-w', p.style.getPropertyValue('--cx-panel-w').trim(), '340px');
check('基础宽度声明走变量', /width:\s*var\(--cx-panel-w,\s*340px\)/.test(p.style.cssText || ''), true);
check('基础宽度不再硬编码 288px', /width:\s*288px/.test(p.style.cssText || ''), false);

// Ninja 注入样式：呼吸点 CSS 实际随组件样式并入 STYLES.ANIM，注入到 __cxPanelAnimStyle
// （__cxPanelNinjaStyle 仅承载 NINJA_DEFAULT/NINJA_STYLE，当前为空）
const ninjaCss = (document.getElementById('__cxPanelAnimStyle') || {}).textContent || '';
check('Ninja 呼吸点 FAB 存在', /cx-ninja-fab/.test(ninjaCss), true);
check('Ninja 展开跟随变量', /ninja-open\{[^}]*width:var\(--cx-panel-w,340px\)!important/.test(ninjaCss), true);
check('Ninja 展开不再固定 288px', /ninja-open\{[^}]*width:288px!important/.test(ninjaCss), false);
// 布局回归：悬停/展开态容器须为 flex 列布局，且标题栏由原生 .cx-header{display:flex} 保证横向排布，
// 不再强制 display:block（否则分段导航竖排、底部堆叠、标题栏变形等排版错乱）。
check('Ninja 展开为 flex 列布局', /ninja-open\{[^}]*display:flex!important;flex-direction:column!important/.test(ninjaCss), true);
check('Ninja 展开对齐还原(stretch/顶对齐,图表不再过大)', /ninja-open\{[^}]*align-items:stretch!important;justify-content:flex-start!important/.test(ninjaCss), true);
check('Ninja 展开标题栏保持 flex', /cx-header\{[^}]*display:flex/.test(ninjaCss), true);
// 折叠态外观：品牌色实心圆球 40×40 + 白色 18px 图标（规范：无呼吸动效）
check('Ninja 折叠态含圆点容器(.cx-ninja-dot)', /cx-ninja-dot/.test(ninjaCss), true);
check('Ninja 折叠态无呼吸动画(cx-breath)', /cx-ninja-dot\{[^}]*animation:cx-breath/.test(ninjaCss), false);
check('Ninja 折叠态隐藏面板内部', /ninja:not\(\.ninja-open\) \.cx-header/.test(ninjaCss), true);
check('Ninja 折叠态隐藏标题栏', /ninja:not\(\.ninja-open\) \.cx-titlebar\{display:none!important/.test(ninjaCss), true);
check('Ninja 展开态沿用浅色主题(--cx-bg 令牌)', /--cx-bg:#FFFFFF/.test(ninjaCss), true);

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
