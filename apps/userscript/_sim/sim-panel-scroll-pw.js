'use strict';
/*
 * 真机复现：控制面板滚动失效（非 n 模式无法上下滚动）
 * 在真实 chromium 中注入构建产物，构造"视频列表+长内容"，对比：
 *   A) 正常模式（无 .ninja）
 *   B) n 模式展开（.ninja + .ninja-open）
 * 分别测量 .cx-body / .cx-video-list 的溢出情况、滚轮后 scrollTop 变化、
 * 以及 elementFromPoint 是否命中覆盖层（事件拦截根因检测）。
 * 不依赖网络：ctx.route 拦截 mooc1.chaoxing.com。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PROD = require('../scripts/project-paths.cjs').personalProduct;
const BASE = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'ms-playwright')
  : '';

function findChrome() {
  let exe = '';
  try {
    for (const d of fs.readdirSync(BASE)) {
      if (/^chromium-\d+$/.test(d)) {
        const cand = path.join(BASE, d, 'chrome-win64', 'chrome.exe');
        if (fs.existsSync(cand)) { exe = cand; break; }
      }
    }
  } catch (e) {}
  return exe;
}

const HOST = 'mooc1.chaoxing.com';
const PAGE_HTML = '<!DOCTYPE html><html><head><title>学习通</title></head>' +
  '<body><div class="ans-attach-ct"><video controls></video></div></body></html>';

let exitCode = 0;

(async () => {
  const exe = findChrome();
  if (!exe) { console.log('FAIL: chromium not found under ' + BASE); process.exit(2); }
  const code = fs.readFileSync(PROD, 'utf8');
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const ctx = await browser.newContext();
  await ctx.route('**://' + HOST + '/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: PAGE_HTML }));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('PAGE_ERROR: ' + (e.stack || e.message).split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (!/Not implemented:/i.test(t) && !/Failed to load resource/i.test(t)) {
        console.log('CONSOLE_ERROR: ' + t.split('\n')[0]);
      }
    }
  });

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

  await page.goto('https://' + HOST + '/studyvideoweb/studyVideo.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  let hasPanel = await page.evaluate(() => !!document.getElementById('__cxPanel'));
  if (!hasPanel) {
    // 面板由按 P 触发创建（keydown 监听在 document 上）
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true, cancelable: true }));
    });
    await page.waitForTimeout(800);
    hasPanel = await page.evaluate(() => !!document.getElementById('__cxPanel'));
  }
  if (!hasPanel) {
    const diag = await page.evaluate(() => {
      const ns = window.__CX_FORCE_PLAY || {};
      return {
        hasNs: !!ns,
        started: !!ns.started,
        detect: typeof ns.detectSite === 'function' ? ns.detectSite() : 'no-fn',
        cxEls: Array.from(document.querySelectorAll('[id^="__cx"]')).map((e) => e.id),
        bodyHTML: (document.body.innerHTML || '').slice(0, 200),
      };
    });
    console.log('FAIL: 按键 P 后面板仍未出现。诊断=' + JSON.stringify(diag, null, 2));
    await browser.close(); process.exit(2);
  }
  console.log('面板已出现（模拟按 P 后）。填充长内容（40 视频项 + 20 填充行）...');

  await page.evaluate(() => {
    const list = document.getElementById('__cxVideoList');
    if (list) {
      list.innerHTML = '';
      for (let i = 0; i < 40; i++) {
        const d = document.createElement('div');
        d.className = 'cx-video-item';
        d.textContent = '测试视频项 ' + i;
        list.appendChild(d);
      }
    }
    const body = document.querySelector('#__cxPanel > .cx-body');
    if (body) {
      for (let i = 0; i < 20; i++) {
        const d = document.createElement('div');
        d.style.height = '44px';
        d.style.margin = '4px 0';
        d.style.background = '#f2f2f7';
        d.style.borderRadius = '8px';
        d.textContent = '填充行 ' + i;
        body.appendChild(d);
      }
    }
  });

  async function probe(mode) {
    const geo = await page.evaluate(() => {
      const panel = document.getElementById('__cxPanel');
      const body = panel.querySelector(':scope > .cx-body');
      const list = document.getElementById('__cxVideoList');
      const r = body.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const dump = (sel, elm) => {
        if (!elm) return null;
        const cs = getComputedStyle(elm);
        return {
          sel, clientH: elm.clientHeight,
          display: cs.display, flex: cs.flexGrow + '/' + cs.flexShrink + '/' + cs.flexBasis,
          minH: cs.minHeight, height: cs.height, overflowY: cs.overflowY,
        };
      };
      return {
        panelClientH: panel.clientHeight,
        bodyScrollH: body.scrollHeight,
        bodyClientH: body.clientHeight,
        bodyOverflow: getComputedStyle(body).overflowY,
        listScrollH: list ? list.scrollHeight : -1,
        listClientH: list ? list.clientHeight : -1,
        atPoint: el ? (el.tagName + '.' + (String(el.className || '').split(' ')[0] || '') + (el.id ? '#' + el.id : '')) : 'null',
        panel: dump('panel', panel),
        kids: Array.from(panel.children).map((c, i) => dump('child[' + i + '].' + String(c.className || '').split(' ')[0], c)),
      };
    });
    // 滚轮测试：悬停主 body 中心，滚动 300px
    const box = await page.locator('#__cxPanel > .cx-body').boundingBox();
    if (!box) return { mode, geo, wheel: { before: -1, after: -1, delta: 0 }, box: null };
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
    const before = await page.evaluate(() => document.querySelector('#__cxPanel > .cx-body').scrollTop);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => document.querySelector('#__cxPanel > .cx-body').scrollTop);
    return { mode, geo, wheel: { before, after, delta: after - before }, box };
  }

  // A) 正常模式
  await page.evaluate(() => {
    const panel = document.getElementById('__cxPanel');
    panel.classList.remove('ninja', 'ninja-open');
  });
  await page.waitForTimeout(300);
  const a = await probe('A:正常模式');

  // B) n 模式展开
  await page.evaluate(() => {
    const panel = document.getElementById('__cxPanel');
    panel.classList.add('ninja', 'ninja-open');
  });
  await page.waitForTimeout(300);
  const b = await probe('B:n模式展开');

  for (const r of [a, b]) {
    const g = r.geo;
    const overflow = g.bodyScrollH > g.bodyClientH;
    const wheelOk = r.wheel.delta > 0;
    const tag = overflow && wheelOk ? 'OK' : 'FAIL';
    if (tag === 'FAIL') exitCode = 1;
    console.log(`[${tag}] ${r.mode}`);
    console.log(`      panelH=${g.panelClientH} bodyScrollH=${g.bodyScrollH} bodyClientH=${g.bodyClientH} overflow=${g.bodyOverflow} -> 溢出=${overflow}`);
    console.log(`      视频列表 scrollH=${g.listScrollH} clientH=${g.listClientH}`);
    console.log(`      elementFromPoint(body中心)=${g.atPoint}`);
    console.log(`      wheel: scrollTop ${r.wheel.before} -> ${r.wheel.after} (Δ${r.wheel.delta})`);
    if (g.panel) console.log(`      panel: ${JSON.stringify(g.panel)}`);
    for (const k of (g.kids || [])) if (k) console.log(`      ${k.sel}: ${JSON.stringify({ clientH: k.clientH, display: k.display, flex: k.flex, minH: k.minH, height: k.height, overflowY: k.overflowY })}`);
  }

  await browser.close();
  console.log('\n面板滚动复现 ' + (exitCode === 0 ? '全部正常' : '存在滚动失效'));
  process.exit(exitCode);
})().catch((e) => { console.log('HARNESS_ERROR: ' + (e && e.stack || e)); process.exit(3); });
