// 排版探针：真实渲染面板，校验做题区布局（按钮并排/行不重叠/宽度合理）
'use strict';
const projectPaths = require('../project-paths.cjs');
const fs = require('fs');
const path = require('path');
const { chromium } = projectPaths.requireSim('playwright');

const PROD = projectPaths.bundle;
function findChrome() { return projectPaths.browserExecutable(chromium); }

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + ' :: ' + detail); }
}

(async () => {
  const exe = findChrome();
  if (!exe) { console.log('FAIL: chromium not found'); process.exit(2); }
  const code = fs.readFileSync(PROD, 'utf8');
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**://mooc1.chaoxing.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><head><title>学习通</title></head><body><div class="ans-attach-ct"></div><div class="TiMu newTiMu"><div class="Zy_TItle"><span class="newZy_TItle">1【单选题】测试题干？</span></div><ul class="Zy_ulTop"><li class="before-after">A 甲</li><li class="before-after">B 乙</li></ul></div></body></html>' }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message).split('\n')[0]));
  await page.addInitScript(() => {
    window.GM_setValue = function () {};
    window.GM_getValue = function (k, d) { return d; };
    window.GM_addValueChangeListener = function () { return 0; };
    window.GM_removeValueChangeListener = function () {};
    window.GM_deleteValue = function () {};
    window.GM_listValues = function () { return []; };
    if (typeof window.unsafeWindow === 'undefined') window.unsafeWindow = window;
  });
  await page.addInitScript({ content: code });
  await page.goto('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // 打开面板（按 P）并切换到「答题」标签
  await page.keyboard.press('p');
  await page.waitForTimeout(600);
  await page.click('[data-tab="automation"]');
  await page.waitForTimeout(400);

  const layout = await page.evaluate(() => {
    const out = {};
    const ids = ['__cxPanel', '__cxQuizAutoStart', '__cxQuizManualStart', '__cxQuizManualSubmit', '__cxQuizLights', '__cxQuizBlock', '__cxQuizVisionH2c', '__cxQuizVisionCdn', '__cxBtnQuizSubmitAll'];
    const el = (id) => document.getElementById(id);
    const box = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { id: e.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), display: cs.display, flex: cs.flex, flexDirection: cs.flexDirection };
    };
    for (const id of ids) {
      const e = el(id);
      if (e) out[id] = box(e);
    }
    // 做题区 Tab 是否可见
    const tab = el('__cxTab_automation');
    out['__cxTab_automation'] = tab ? box(tab) : null;
    // 面板尺寸
    const panel = el('__cxPanel');
    out.panelRect = panel ? (() => { const r = panel.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })() : null;
    // 面板是否可见
    const panelEl = el('__cxPanel');
    out.panelVisible = panelEl ? (getComputedStyle(panelEl).display !== 'none') : false;
    return out;
  });

  console.log('布局快照:', JSON.stringify(layout, null, 1));

  const b = (k) => layout[k] || null;
  check('面板可见', layout.panelVisible === true, 'panelVisible=' + layout.panelVisible);
  const s = b('__cxQuizManualStart'), sb = b('__cxQuizManualSubmit'), ls = b('__cxQuizLights'), auto = b('__cxQuizAutoStart');
  if (s && sb) {
    check('按钮并排（同一行 y 相等）', s.y === sb.y, JSON.stringify({ s: s.y, sb: sb.y }));
    check('按钮不重叠', (s.x + s.w) <= sb.x + 1, JSON.stringify({ s: [s.x, s.x + s.w], sb: [sb.x, sb.x + sb.w] }));
    check('按钮宽度合理（≥60px）', s.w >= 60 && sb.w >= 60, JSON.stringify({ s: s.w, sb: sb.w }));
    check('按钮行在自动启动行下方', auto && s.y > auto.y, JSON.stringify({ autoY: auto && auto.y, btnY: s.y }));
    check('信号灯行在按钮行下方', ls && s.y < ls.y, JSON.stringify({ btnY: s.y, lsY: ls.y }));
  } else {
    check('按钮渲染', !!(s && sb), JSON.stringify(layout));
  }
  check('无未捕获错误', errors.length === 0, errors[0] || '');

  await browser.close();
  console.log('\nPASS=' + pass + ' FAIL=' + fail);
  process.exit(fail ? 1 : 0);
})();
