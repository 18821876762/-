'use strict';
const projectPaths = require('../project-paths.cjs');
const fs = require('fs');
const path = require('path');
const { chromium } = projectPaths.requireSim('playwright');
const PROD = projectPaths.bundle;
function findChrome() { return projectPaths.browserExecutable(chromium); }
(async () => {
  const exe = findChrome();
  const code = fs.readFileSync(PROD, 'utf8');
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route('**://mooc1.chaoxing.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><html><head><title>学习通</title></head><body><div class="ans-attach-ct"></div><div class="TiMu newTiMu"><div class="Zy_TItle"><span class="newZy_TItle">1【单选题】测试题干？</span></div><ul class="Zy_ulTop"><li class="before-after">A 甲</li><li class="before-after">B 乙</li></ul></div></body></html>' }));
  const page = await ctx.newPage();
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
  await page.keyboard.press('p');
  await page.waitForTimeout(500);
  await page.click('[data-tab="automation"]');
  await page.waitForTimeout(500);
  const panel = await page.locator('#__cxPanel').boundingBox();
  await page.screenshot({ path: projectPaths.writableFile(path.join(projectPaths.outputRoot, 'panel-layout.png')), clip: { x: Math.max(0, panel.x - 10), y: Math.max(0, panel.y - 10), width: Math.min(1280 - panel.x + 20, panel.width + 20), height: Math.min(800 - panel.y + 20, panel.height + 20) } });
  console.log('screenshot saved');
  await browser.close();
})();