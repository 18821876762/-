// @requires: CONST, CX_KEYS, bestEffort, safeGet
  // ===== DOMAIN: takeover/engine/stats (watch stats, local estimate) =====
  // ===== MODULE: 看播统计 =====
  // 域：核心业务模块 —— 看播统计/进度本地估算。
  // ===== 本地观看时长统计（进度同步·本地估算，非平台上报）=====
  // 把每视频已看毫秒按「视频源」累计到 window.__CX_FORCE_PLAY.watchStats[src]={ms,courseId,updated}，
  // 节流持久化到 localStorage.cx_watch_stats（跨会话累计）。仅供进度面板做"本地估算"展示，
  // 不读取平台回看时长、不发起任何上报（符合只读 GET 章程与合规红线）。
  var _watchStats = {};
  var _watchPersistAt = 0;
  function loadWatchStats() {
    _watchStats = safeGet(function () { return JSON.parse(localStorage.getItem(CX_KEYS.WATCH_STATS) || '{}') || {}; }, {});
    bestEffort(function () { window.__CX_FORCE_PLAY.watchStats = _watchStats; }, 'watchStats.export');
  }
  // 淘汰最旧统计（按 updated 升序），防长时跨课程使用撑爆 localStorage 5MB 配额
  function _watchStatsPrune() {
    bestEffort(function () {
      var ks = Object.keys(_watchStats);
      if (ks.length <= CONST.WATCH_STATS_CAP) return;
      ks.sort(function (a, b) { return (_watchStats[a].updated || 0) - (_watchStats[b].updated || 0); });
      var drop = ks.length - CONST.WATCH_STATS_CAP;
      for (var i = 0; i < drop; i++) delete _watchStats[ks[i]];
    }, '_watchStatsPrune');
  }
  function recordWatchMs(src, dt, courseId) {
    if (!src || dt <= 0) return;
    var e = _watchStats[src] || { ms: 0, courseId: courseId || '', updated: 0 };
    e.ms = (e.ms || 0) + dt;
    e.courseId = courseId || e.courseId || '';
    e.updated = Date.now();
    _watchStats[src] = e;
    bestEffort(function () { window.__CX_FORCE_PLAY.watchStats = _watchStats; }, 'watchStats.sync');
    var now = Date.now();
    if (now - _watchPersistAt > 10000) {   // 10s 节流写盘，避免每 2s 轮询都 JSON.stringify
      _watchPersistAt = now;
      _watchStatsPrune();   // 写盘前先淘汰最旧，避免配额溢出
      bestEffort(function () { localStorage.setItem(CX_KEYS.WATCH_STATS, JSON.stringify(_watchStats)); }, 'watchStats.persist');
    }
  }
