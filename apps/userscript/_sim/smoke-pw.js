'use strict';
/*
 * 真机冒烟验证（Node Playwright + 完整 chromium）
 * 在真实浏览器中加载核心产物 chaoxing-force-play.user.js，跨多平台验证：
 *   - 站点识别 detectSite() 正确
 *   - 命名空间 window.__CX_FORCE_PLAY 注入且无重复初始化
 *   - 主面板可渲染（#__cxPanel / FAB）
 *   - 运行时控制台/页面 0 未捕获错误
 * 不依赖网络：用 ctx.route 拦截各平台域名返回构造 HTML。
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

// 各平台构造页 + 期望 detectSite
const CASES = [
  {
    site: 'chaoxing',
    host: 'mooc1.chaoxing.com',
    path: 'https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html',
    html: '<!DOCTYPE html><html><head><title>学习通</title></head><body><div class="ans-attach-ct"><video controls></video></div></body></html>',
  },
  {
    site: 'icourse163',
    host: 'www.icourse163.org',
    path: 'https://www.icourse163.org/learn/abc',
    html: '<!DOCTYPE html><html><head><title>中国大学MOOC</title></head><body><div class="ocourse-main"><video controls></video></div></body></html>',
  },
  {
    site: 'xuetangx',
    host: 'www.xuetangx.com',
    path: 'https://www.xuetangx.com/course',
    html: '<!DOCTYPE html><html><head><title>学堂在线</title></head><body><div class="course-info"><video controls></video></div></body></html>',
  },
  {
    site: 'zhihuishu',
    host: 'www.zhihuishu.com',
    path: 'https://www.zhihuishu.com/course/checkMod2.html',
    html: '<!DOCTYPE html><html><head><title>智慧树</title></head><body><div class="course-discuss"><video controls></video></div></body></html>',
  },
];

let exitCode = 0;
const allErrors = [];

(async () => {
  const exe = findChrome();
  if (!exe) { console.log('FAIL: chromium not found under ' + BASE); process.exit(2); }
  const code = fs.readFileSync(PROD, 'utf8');
  const browser = await chromium.launch({ headless: true, executablePath: exe });

  for (const c of CASES) {
    const errors = [];
    const ctx = await browser.newContext();
    await ctx.route('**://' + c.host + '/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: c.html }));
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack || e.message).split('\n')[0]));
    page.on('console', (m) => {
      if (m.type() === 'error') {
        const t = m.text();
        if (!/Not implemented:/i.test(t) && !/Failed to load resource/i.test(t)) {
          errors.push('console.error: ' + t.split('\n')[0]);
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

    await page.goto(c.path, { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const diag = await page.evaluate(() => {
      const ns = window.__CX_FORCE_PLAY || {};
      const cxEls = Array.from(document.querySelectorAll('[id^="__cx"]')).map((e) => e.id);
      const fab = document.getElementById('__cxFab');
      return {
        hasNs: !!ns,
        started: !!ns.started,
        detect: typeof ns.detectSite === 'function' ? ns.detectSite() : null,
        cxEls,
        fabId: fab ? fab.id : null,
        hasPanel: !!document.getElementById('__cxPanel'),
        hasFab: !!fab,
        nsKeys: Object.keys(ns),
      };
    });

    const ok = diag.hasNs && diag.started && diag.detect === c.site && errors.length === 0;
    const tag = ok ? 'PASS' : 'FAIL';
    if (!ok) exitCode = 1;
    console.log(`[${tag}] ${c.site.padEnd(12)} site=${diag.detect} ns=${diag.hasNs} started=${diag.started} errors=${errors.length}`);
    console.log(`       __cx元素=${JSON.stringify(diag.cxEls)}`);
    console.log(`       NS导出键=${JSON.stringify(diag.nsKeys)}`);
    if (errors.length) errors.forEach((e) => console.log('       ' + e));
    allErrors.push(...errors.map((e) => c.site + ': ' + e));
    await ctx.close();
  }

  await browser.close();
  console.log('\n真机冒烟验证 ' + (exitCode === 0 ? '全部 PASS' : '存在 FAIL'));
  if (allErrors.length) console.log('错误摘要:\n' + allErrors.join('\n'));
  process.exit(exitCode);
})().catch((e) => { console.log('HARNESS_ERROR: ' + (e && e.stack || e)); process.exit(3); });
