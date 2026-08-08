// 复现 ninja 面板「切到非主控 tab 内容空白」的 CSS 级联问题。
// jsdom 不实现 :hover，因此 :not(:hover) 恒为真 —— 完美模拟「折叠态」(未悬停)。
// 只需切换 .ninja-open 类即可模拟「展开态」。
const { JSDOM } = require('jsdom');

const html = `<!DOCTYPE html><html><body>
<div id="__cxPanel" class="ninja">
  <div class="cx-titlebar"><div><span id="__cxPanelBadge"></span></div></div>
  <div class="cx-title">title</div>
  <div id="__cxPanelClose">x</div>
  <div class="cx-cmd-wrap">cmd</div>
  <div class="cx-nav">
    <button class="cx-nav-item" data-tab="control">主控</button>
    <button class="cx-nav-item" data-tab="automation">自动化</button>
    <button class="cx-nav-item" data-tab="insight">洞察</button>
    <button class="cx-nav-item" data-tab="system">系统</button>
  </div>
  <div id="__cxTab_control" class="cx-tab"><p>MAIN content</p></div>
  <div id="__cxTab_automation" class="cx-tab"><p>AUTO content</p></div>
  <div id="__cxTab_insight" class="cx-tab"><p>INSIGHT content</p></div>
  <div id="__cxTab_system" class="cx-tab"><p>SYSTEM content</p></div>
</div>
</body></html>`;

// 从 styles.js 逐字摘出的 ninja 相关规则（颜色值无关级联，用占位）。
const ST = { surface:'#fff', primary:'#3b82f6', primary2:'#22d3ee' };
const baseNinja = '#__cxPanel.ninja{position:fixed;display:none!important;}';
const openNinja = '#__cxPanel.ninja:hover,#__cxPanel.ninja.ninja-open{display:block!important;overflow-y:auto!important;}';
// 折叠态隐藏规则（修复前：含 .cx-tab）
const foldWithTab = '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-title,' +
  '#__cxPanel.ninja:not(:hover):not(.ninja-open) #__cxPanelClose,' +
  '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-cmd-wrap,' +
  '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-nav,' +
  '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-tab{display:none!important;}';
// 折叠态隐藏规则（修复后：移除 .cx-tab，仅隐藏标题/关闭/命令/导航）
const foldNoTab = '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-title,' +
  '#__cxPanel.ninja:not(:hover):not(.ninja-open) #__cxPanelClose,' +
  '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-cmd-wrap,' +
  '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-nav{display:none!important;}';

function switchTab(doc, id) {
  doc.querySelectorAll('.cx-tab').forEach(el => { el.style.display = 'none'; });
  doc.getElementById('__cxTab_' + id).style.display = 'block';
}

function run(label, foldRule) {
  const dom = new JSDOM(html, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const style = doc.createElement('style');
  style.textContent = baseNinja + openNinja + foldRule;
  doc.head.appendChild(style);
  const panel = doc.getElementById('__cxPanel');
  const cs = (id) => dom.window.getComputedStyle(doc.getElementById(id)).display;
  const out = {};

  // —— 场景1：折叠态（无 ninja-open，模拟未悬停/未展开）下，switchTab 到 automation ——
  switchTab(doc, 'automation');
  out.folded_panel = cs('__cxPanel');
  out.folded_tab_automation = cs('__cxTab_automation');   // 期望：修复前 none（bug），修复后 block
  out.folded_tab_control = cs('__cxTab_control');

  // —— 场景2：展开态（加 ninja-open）下，switchTab 到 automation ——
  panel.classList.add('ninja-open');
  switchTab(doc, 'automation');
  out.open_panel = cs('__cxPanel');
  out.open_tab_automation = cs('__cxTab_automation');     // 期望：block
  out.open_tab_control = cs('__cxTab_control');           // 期望：none
  out.open_nav = cs(doc.querySelector('.cx-nav').id || '__cxPanel') ; // 占位

  console.log('=== ' + label + ' ===');
  console.log(JSON.stringify(out, null, 0));
  return out;
}

const before = run('修复前(折叠规则含 .cx-tab)', foldWithTab);
const after = run('修复后(折叠规则移除 .cx-tab)', foldNoTab);

console.log('\n==== 结论 ====');
console.log('修复前 折叠态切到 automation 的 tab display =', before.folded_tab_automation, '(none=被!important吞掉=空白bug)');
console.log('修复后 折叠态切到 automation 的 tab display =', after.folded_tab_automation, '(block=switchTab生效)');
console.log('修复前 展开态切到 automation 的 tab display =', before.open_tab_automation, '(block)');
