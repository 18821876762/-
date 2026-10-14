// ============================================================
// 学习通卡顿诊断脚本 v2（独立运行，无需安装）
// 用法：在卡顿的学习通页面按 F12 → Console，粘贴本脚本后回车，
//       等待约 14 秒，把输出的 JSON 完整复制回来。
// v2 新增：longtask 归属帧（attribution）、自动按 P 测面板响应、
//          顶层 + 播放器帧双 rAF 掉帧采样、脚本状态经 unsafeWindow 读取。
// ============================================================
(function () {
  'use strict';
  var out = { ts: new Date().toISOString(), url: location.href.slice(0, 300) };
  out.ua = navigator.userAgent;

  // 脚本状态：TM @grant 沙箱下主世界 window 看不到 → 经 unsafeWindow 读
  function scriptState(w) {
    var uw = null;
    try { uw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : null; } catch (e) {}
    var ns = (w && w.__CX_FORCE_PLAY) || (uw && uw.__CX_FORCE_PLAY) || null;
    return {
      version: (ns && ns.version) || null,
      started: !!(ns && ns.started),
      hasLoop: !!(ns && typeof ns.restartLoopTimer === 'function')
    };
  }
  out.script = scriptState(window);

  // 帧结构
  out.frames = [];
  function walk(w, depth) {
    if (depth > 4 || !w || !w.document || !w.document.documentElement) return;
    try {
      var st = scriptState(w);
      out.frames.push({
        depth: depth,
        href: (w.location.href || '').slice(0, 130),
        nodes: w.document.getElementsByTagName('*').length,
        videos: w.document.getElementsByTagName('video').length,
        scriptVersion: st.version,
        started: st.started
      });
      var fs = w.document.querySelectorAll('iframe');
      for (var i = 0; i < fs.length; i++) { try { if (fs[i].contentWindow) walk(fs[i].contentWindow, depth + 1); } catch (e) {} }
    } catch (e) {}
  }
  walk(window, 0);

  // longtask 归属：每个长任务记录 duration + 归属帧（attribution containerSrc/name）
  out.longTasks = [];
  try {
    var obs = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        var attr = [];
        try {
          (e.attribution || []).forEach(function (a) {
            attr.push((a.containerSrc || '').slice(0, 60) || a.containerName || '?');
          });
        } catch (err) {}
        out.longTasks.push({ dur: Math.round(e.duration), frame: attr.slice(0, 2) });
      });
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch (e) { out.longTasks = 'PerformanceObserver 不可用'; }

  // 顶层 rAF 掉帧
  var rafCount = 0, rafMaxGap = 0, rafPrev = 0, rafGaps = [];
  var rafT0 = performance.now();

  // 面板响应测试（自动按 P 三次，测同步耗时）
  out.panelPressMs = [];
  function pressP() {
    var t = performance.now();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', bubbles: true }));
    return Math.round(performance.now() - t);
  }
  out.panelPressMs.push(pressP());

  out.pageErrors = [];
  function onErr(e) { out.pageErrors.push(String(e.message || e).slice(0, 150)); }
  window.addEventListener('error', onErr);

  function finish() {
    window.removeEventListener('error', onErr);
    out.rafCount = rafCount;
    out.rafMaxGapMs = Math.round(rafMaxGap);
    out.rafGapsOver50ms = rafGaps.slice(0, 25);
    out.rafGapCount = rafGaps.length;
    out.panelPressMs.push(pressP());
    out.panelPressMs.push(pressP());
    try { if (performance.memory) { out.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } } catch (e) {}
    console.log('===== 学习通卡顿诊断 v2（复制以下 JSON 贴回） =====');
    console.log(JSON.stringify(out, null, 2));
  }
  function rafLoop() {
    var now = performance.now();
    if (rafPrev) { var gap = now - rafPrev; if (gap > rafMaxGap) rafMaxGap = gap; if (gap > 50) rafGaps.push(Math.round(gap)); }
    rafPrev = now;
    rafCount++;
    if (now - rafT0 < 13000) requestAnimationFrame(rafLoop);
    else finish();
  }
  requestAnimationFrame(rafLoop);
})();
