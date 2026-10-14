// ============================================================
// 学习通卡顿诊断脚本 v1（独立运行，无需安装）
// 用法：在卡顿的学习通页面按 F12 → Console，粘贴本脚本后回车，
//       等待约 12 秒，把输出的 JSON 完整复制回来。
// ============================================================
(function () {
  'use strict';
  var out = { ts: new Date().toISOString(), url: location.href.slice(0, 200) };

  // 1. 环境
  out.ua = navigator.userAgent;
  try {
    out.gm = (typeof GM_info !== 'undefined') ? { scriptName: GM_info.script.name, version: GM_info.script.version } : '无 GM_info（可能非用户脚本管理器注入）';
  } catch (e) { out.gm = 'GM_info 读取失败'; }
  out.script = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.version) || '未注入';
  out.started = !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.started);
  out.quizzes = {
    auto: (localStorage.getItem('cx_quiz_auto') || '(默认)'),
    vision: (localStorage.getItem('cx_quiz_vision_enabled') || '(默认)'),
    popup: (localStorage.getItem('cx_popup_quiz') || '(默认)'),
    debug: (localStorage.getItem('cx_panel_cfg') || '').slice(0, 200)
  };

  // 2. 帧结构（顶层 + 可达同源 iframe）
  out.frames = [];
  function walk(w, depth) {
    if (depth > 4 || !w || !w.document || !w.document.documentElement) return;
    try {
      out.frames.push({
        depth: depth,
        href: (w.location.href || '').slice(0, 100),
        nodes: w.document.getElementsByTagName('*').length,
        videos: w.document.getElementsByTagName('video').length,
        iframes: w.document.getElementsByTagName('iframe').length,
        started: !!(w.__CX_FORCE_PLAY && w.__CX_FORCE_PLAY.started),
        version: (w.__CX_FORCE_PLAY && w.__CX_FORCE_PLAY.version) || null
      });
      var fs = w.document.querySelectorAll('iframe');
      for (var i = 0; i < fs.length; i++) {
        try { if (fs[i].contentWindow) walk(fs[i].contentWindow, depth + 1); } catch (e) {}
      }
    } catch (e) {}
  }
  walk(window, 0);

  // 3. 长任务采样（12 秒）
  out.longTasks = [];
  var totalLong = 0;
  try {
    var obs = new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        out.longTasks.push(Math.round(e.duration));
        totalLong += e.duration;
      });
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch (e) { out.longTasks = 'PerformanceObserver 不可用'; }

  // 4. rAF 掉帧采样（12 秒：期望 ~720 帧@60fps，headless/后台会少）
  var rafCount = 0, rafMaxGap = 0, rafPrev = 0, rafGaps = [];
  var rafT0 = performance.now();
  function rafLoop() {
    var now = performance.now();
    if (rafPrev) { var gap = now - rafPrev; if (gap > rafMaxGap) rafMaxGap = gap; if (gap > 50) rafGaps.push(Math.round(gap)); }
    rafPrev = now;
    rafCount++;
    if (now - rafT0 < 12000) requestAnimationFrame(rafLoop);
    else finish();
  }

  // 5. 错误捕获（12 秒）
  out.pageErrors = [];
  function onErr(e) { out.pageErrors.push(String(e.message || e).slice(0, 200)); }
  window.addEventListener('error', onErr);

  function finish() {
    window.removeEventListener('error', onErr);
    out.rafCount = rafCount;
    out.rafExpected = 720;
    out.rafMaxGapMs = Math.round(rafMaxGap);
    out.rafGapsOver50ms = rafGaps.slice(0, 30);
    out.rafGapCount = rafGaps.length;
    out.longTaskTotalMs = Math.round(totalLong);   // 长任务累计阻塞毫秒：须在采样窗口结束后读取（原实现注册 observer 后立即同步赋值导致恒为 0）
    try {
      if (performance.memory) { out.heapMB = Math.round(performance.memory.usedJSHeapSize / 1048576); }
    } catch (e) {}
    // 脚本侧定时器粗估：主循环是否在跑（通过诊断暴露的 restartLoopTimer 存在性）
    out.hasRestartLoopTimer = !!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.restartLoopTimer === 'function');
    console.log('===== 学习通卡顿诊断结果（复制以下 JSON 贴回） =====');
    console.log(JSON.stringify(out, null, 2));
  }
  requestAnimationFrame(rafLoop);
})();
