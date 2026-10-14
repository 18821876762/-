// 回归仿真：验证 ninja 窄条可被 mouseup 可靠展开/收起（不再依赖 click/hover）。
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

// --- 回归：FAB 拖拽移动（Pointer Events + setPointerCapture，修复视频 iframe 吞事件 / left/top 每帧重排卡顿）---
// jsdom 无 PointerEvent 原生构造，用合成 Event 注入 clientX/button/pointerId；setPointerCapture 缺失被 try/catch 忽略。
let dragOK = false;
// 重新进入 Ninja（上面「焦点在滑块按 N 退出」测试已把 ninja 关掉；拖拽仅在 ninja 折叠态生效）
const _cbx3 = p.querySelector('#__cxNinja');
if (_cbx3 && !p.classList.contains('ninja')) { _cbx3.checked = true; _cbx3.dispatchEvent(new window.Event('change')); }
const _fab2 = p.querySelector('.cx-ninja-fab');
if (_fab2 && p.classList.contains('ninja')) {
  function _pe(type, x, y) {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    // jsdom 的 Event 将 clientX/clientY 实现为只读 getter，普通赋值无效，须用 defineProperty 强制注入
    Object.defineProperty(e, 'clientX', { value: x, configurable: true });
    Object.defineProperty(e, 'clientY', { value: y, configurable: true });
    Object.defineProperty(e, 'button', { value: 0, configurable: true });
    Object.defineProperty(e, 'pointerId', { value: 1, configurable: true });
    return e;
  }
  _fab2.dispatchEvent(_pe('pointerdown', 100, 100));
  _fab2.dispatchEvent(_pe('pointermove', 160, 140)); // 超 5px 阈值 → 标记 moved
  _fab2.dispatchEvent(_pe('pointermove', 200, 180)); // 累计位移 delta(100,80)
  _fab2.dispatchEvent(_pe('pointerup', 200, 180));     // 提交 left/top 并持久化
  const _left = parseInt(p.style.left, 10);
  const _top = parseInt(p.style.top, 10);
  const _stored = JSON.parse(window.localStorage.getItem('cx_ninja_pos') || '{}');
  // jsdom 无布局：getBoundingClientRect 为 0，故 left/top 应等于位移量(100,80)
  dragOK = (_left === 100 && _top === 80 && _stored.left === 100 && _stored.top === 80 && p.style.transform === '');
}
console.log('FAB 拖拽更新位置并持久化:', dragOK);

// —— 回归：「点击冻结」根因——pointerup 丢失后捕获残留，下一次点击自愈解锁（修复“按钮/tab 点击全失效、按 P 正常、刷新才恢复”）——
let healOK = false;
const _fab4 = p.querySelector('.cx-ninja-fab');
if (_fab4 && p.classList.contains('ninja') && !p.classList.contains('ninja-open')) {
  function _pe2(type, x, y, tgt) {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clientX', { value: x, configurable: true });
    Object.defineProperty(e, 'clientY', { value: y, configurable: true });
    Object.defineProperty(e, 'button', { value: 0, configurable: true });
    Object.defineProperty(e, 'pointerId', { value: 2, configurable: true });
    (tgt || _fab4).dispatchEvent(e);
    return e;
  }
  // 1) 拖拽开始但 pointerup 丢失（指针拖出窗口/失焦中断）→ 捕获残留，_nxDrag.active 卡 true
  _pe2('pointerdown', 100, 100);
  _pe2('pointermove', 160, 140);          // 超 5px 阈值 → moved=true，但此后没有 pointerup
  // 2) 用户回来点“面板外任意处”（document.body）：全局兜底在 capture 阶段解锁残留
  _pe2('pointerdown', 800, 600, document.body);
  // 3) 残留后首击 FAB：killed 被消费，不吞事件、不误 toggle
  const _before = p.classList.contains('ninja-open');
  _pe2('pointerdown', 100, 100);
  _pe2('pointerup', 100, 100);
  const _after1 = p.classList.contains('ninja-open');
  // 4) 再击 FAB：完全恢复正常展开
  _pe2('pointerdown', 100, 100);
  _pe2('pointerup', 100, 100);
  const _after2 = p.classList.contains('ninja-open');
  healOK = (_before === _after1) && (_after2 !== _before);
}
console.log('pointerup 丢失后自愈解锁:', healOK);

// —— FAB 增强回归：播放图标 / 状态角标 / aria-expanded ——
const _fab = p.querySelector('.cx-ninja-fab');
const _icon = _fab && _fab.querySelector('.cx-ninja-icon');
const _badge = _fab && _fab.querySelector('.cx-ninja-badge');
const _aria = _fab && _fab.getAttribute('aria-expanded') !== null;
console.log('悬浮球含播放图标  :', !!_icon);
console.log('悬浮球含状态角标  :', !!_badge);
console.log('aria-expanded 属性 :', _aria);

// P1-4 修复：上述所有断言任一失败 → 退出码 1，杜绝「结论 CHECK 但整体绿灯」的假绿灯。
// 注：不纳入末尾的 !contains('ninja') —— 脚本末尾为测 FAB 拖拽会故意重新进入 ninja，该子句设计上必为 false，属误判来源（原 CHECK 也不 gate 它）。
const allOK = !!(p && ninjaAgain && opened && closed && exitedFromInput && dragOK && healOK && _icon && _badge && _aria);
if (!allOK) {
  console.log('结论: FAIL — 窄条/退出/输入聚焦 N 逃生/FAB 拖拽/pointerup丢失自愈/增强(图标·角标·aria) 任一未达标');
  process.exit(1);
}
console.log('结论: PASS — 窄条可展开/收起、可退出、input 聚焦时 N 仍生效、FAB 可拖拽、pointerup丢失后自愈、增强完整');
process.exit(0);
