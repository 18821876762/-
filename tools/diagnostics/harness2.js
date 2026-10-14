const projectPaths = require('./project-paths.cjs');
// 用 jsdom 加载真实打包后的 userscript，在仿真超星页面上复现 ninja 面板 bug。
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const SCRIPT = fs.readFileSync(projectPaths.bundle, 'utf8');
// 去掉 Tampermonkey 元数据头（// ==UserScript== ... // ==/UserScript==），否则 jsdom 当作注释无碍；保留脚本体。
const body = SCRIPT.replace(/\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==/, '');

const html = `<!DOCTYPE html><html><head></head><body>
<video src="https://mooc1.chaoxing.com/x.mp4" controls></video>
<div id="main"></div>
</body></html>`;

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.log('JSDOM_ERR:', e.message));
['log', 'error', 'warn', 'debug', 'info'].forEach(k => vc.on(k, (...a) => console.log('PAGE_' + k + ':', ...a)));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'https://mooc1.chaoxing.com/',
  virtualConsole: vc,
  beforeParse(window) {
    // 提供脚本可能用到的全局
    window.GM_info = { script: { version: 'x' } };
    window.localStorage.clear();
  }
});

const { window } = dom;
// 注入脚本
const s = window.document.createElement('script');
s.textContent = body;
try { window.document.body.appendChild(s); } catch (e) { console.log('INJECT_ERR', e.message); }

// 给一点时间让脚本自运行（脚本是同步的，但防御性）
setTimeout(() => {
  const doc = window.document;
  const panel = doc.getElementById('__cxPanel');
  console.log('面板存在:', !!panel, 'class:', panel && panel.className);
  if (!panel) { console.log('>> 面板未创建，无法继续'); return; }

  // 模拟按 P 打开面板
  function pressP() {
    const ev = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true });
    doc.dispatchEvent(ev);
  }
  pressP();
  console.log('按P后: display=', window.getComputedStyle(panel).display, 'ninja-open=', panel.classList.contains('ninja-open'), 'ninja=', panel.classList.contains('ninja'));

  // 切到 automation tab
  const cs = (id) => window.getComputedStyle(doc.getElementById(id)).display;
  // 找 nav 按钮 automation
  const btns = panel.querySelectorAll('.cx-nav-btn');
  let autoBtn = null;
  btns.forEach(b => { if (b.getAttribute('data-tab') === 'automation') autoBtn = b; });
  console.log('nav 按钮数量:', btns.length, '找到 automation 按钮:', !!autoBtn);
  if (autoBtn) autoBtn.click();
  console.log('点 automation 后: tab_automation display=', cs('__cxTab_automation'), 'tab_control display=', cs('__cxTab_control'));

  // 切到 insight
  let insBtn = null; btns.forEach(b => { if (b.getAttribute('data-tab') === 'insight') insBtn = b; });
  if (insBtn) insBtn.click();
  console.log('点 insight 后: tab_insight display=', cs('__cxTab_insight'));

  // 切到 system
  let sysBtn = null; btns.forEach(b => { if (b.getAttribute('data-tab') === 'system') sysBtn = b; });
  if (sysBtn) sysBtn.click();
  console.log('点 system 后: tab_system display=', cs('__cxTab_system'));

  // 内容填充检查
  const addons = doc.getElementById('__cxAddons');
  const info = doc.getElementById('__cxPanelInfo');
  console.log('--- 内容填充 ---');
  console.log('__cxAddons 子节点数:', addons ? addons.children.length : 'N/A', ' text:', addons ? JSON.stringify(addons.textContent.slice(0,40)) : 'N/A');
  console.log('__cxPanelInfo text:', info ? JSON.stringify(info.textContent.slice(0,80)) : 'N/A');
  const vidList = doc.getElementById('__cxVideoList');
  console.log('__cxVideoList text:', vidList ? JSON.stringify(vidList.textContent.slice(0,60)) : 'N/A');
  process.exit(0);
}, 300);
