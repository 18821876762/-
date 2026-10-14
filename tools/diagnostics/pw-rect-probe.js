const projectPaths = require('./project-paths.cjs');
// 定位按键路径的 getBoundingClientRect 调用者（注入前 patch 原型 + 调用栈采样）
const fs = require('fs');
const path = require('path');
const { chromium } = projectPaths.requireSim('playwright');

const CUR = fs.readFileSync(projectPaths.latestBundle, 'utf8');
let topHtml = fs.readFileSync(projectPaths.chaoxingFixture, 'utf8');
topHtml = topHtml.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<link[^>]*>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');

const PATCH = `
(function () {
  if (window.__rectPatched) return;
  window.__rectPatched = true;
  window.__rectStats = {};
  var orig = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    try {
      var caller = '?';
      try {
        var st = new Error().stack.split('\\n')[2] || '';
        var m = st.match(/at\\s+([\\w$]+)/);
        if (m) caller = m[1];
      } catch (e) {}
      var k = caller + (this && this.id ? '#' + this.id : '');
      if (!window.__rectStats[k]) window.__rectStats[k] = { n: 0, ms: 0 };
      var t0 = performance.now();
      var r = orig.call(this);
      window.__rectStats[k].n++;
      window.__rectStats[k].ms += performance.now() - t0;
      return r;
    } catch (e) { return orig.call(this); }
  };
})();
`;

(async () => {
  const execPath = projectPaths.browserExecutable(chromium);
  const browser = await chromium.launch({ headless: true, executablePath: execPath, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  await ctx.route('**/*', (route) => {
    const u = route.request().url();
    if (u.includes('studyVideo.html')) return route.fulfill({ status: 200, contentType: 'text/html', body: topHtml });
    if (u.includes('/ananas/')) return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body><video id="v"></video></body></html>' });
    if (u.endsWith('.mp4')) return route.abort();
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!DOCTYPE html><html><body></body></html>' });
  });
  const page = await ctx.newPage();
  await page.goto('https://mooc1.chaoxing.com/studyvideoweb/studyVideo.html?courseId=1&knowledgeId=2', { waitUntil: 'load' });
  await page.addScriptTag({ content: PATCH });
  await page.addScriptTag({ content: CUR });
  await page.waitForTimeout(1500);

  // 模拟按键 ×3
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true })));
    await page.waitForTimeout(120);
  }
  const stats = await page.evaluate(() => window.__rectStats);
  const sorted = Object.entries(stats).sort((a, b) => b[1].ms - a[1].ms);
  console.log('=== getBoundingClientRect 调用分布（3 次按键） ===');
  sorted.forEach(([k, v]) => console.log(v.ms.toFixed(1) + 'ms ×' + v.n + '  <- ' + k));
  await browser.close();
  process.exit(0);
})();
