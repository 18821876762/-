// 回归仿真：验证 ninja 窄条可被 mouseup 可靠展开/收起（不再依赖 click/hover）。
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

// 在同域内先把 NINJA_MODE 持久化为 true（模拟“上次开过 n 模式”）
window.eval("localStorage.setItem('cx_panel_cfg', JSON.stringify({NINJA_MODE:true}))");
window.eval(code);

const ev = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true });
document.dispatchEvent(ev);
const p = document.getElementById('__cxPanel');
const bar = p && p.querySelector('.cx-titlebar');
console.log('面板存在            :', !!p);
console.log('进入 ninja 窄条     :', p ? p.classList.contains('ninja') : false);
console.log('标题栏存在          :', !!bar);

function toggle() {
  const e = new window.MouseEvent('mouseup', { bubbles: true, button: 0 });
  bar.dispatchEvent(e);
}
toggle();
const opened = p.classList.contains('ninja-open');
console.log('mouseup 后展开(open):', opened);
toggle();
const closed = !p.classList.contains('ninja-open');
console.log('再 mouseup 后收起   :', closed);

// 退出 n 模式：勾掉复选框
const cbx = p.querySelector('#__cxNinja');
if (cbx) { cbx.checked = false; cbx.dispatchEvent(new window.Event('change')); }
console.log('退出 n 模式后无ninja:', p ? !p.classList.contains('ninja') : false);
console.log('持久化已清 NINJA    :', JSON.parse(window.localStorage.getItem('cx_panel_cfg') || '{}').NINJA_MODE === false);

// --- 回归：焦点在 input(如宽度滑块)上时按 N 仍能退出 Ninja（修复“操作后按 N 无反应、只能刷新”的根因）---
const cbx2 = p.querySelector('#__cxNinja');
if (cbx2) { cbx2.checked = true; cbx2.dispatchEvent(new window.Event('change')); }   // 重新进入 ninja
const ninjaAgain = p.classList.contains('ninja');
const pw2 = p.querySelector('#__cxPanelW');   // <input type=range>，模拟“操作过滑块后焦点停留”
const evN = new window.KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true });
if (pw2) pw2.dispatchEvent(evN);   // target=input，应绕过输入框保护、直接退出
const exitedFromInput = !p.classList.contains('ninja');
console.log('重进 ninja 成功      :', ninjaAgain);
console.log('焦点在滑块时按N退出 :', exitedFromInput);

console.log('\n结论: ' + (p && ninjaAgain && opened && closed && !p.classList.contains('ninja') && exitedFromInput ? 'PASS — 窄条可展开/收起、可退出、input 聚焦时 N 仍生效' : 'CHECK'));
process.exit(0);
