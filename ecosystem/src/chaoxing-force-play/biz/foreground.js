  // ===== DOMAIN: biz/foreground (foreground detection + display helpers) =====
  // ===== MODULE: 用户暂停开关 =====
  // 域：核心业务模块 —— 用户暂停开关闸门。
  // —— 用户暂停开关（手动暂停键 + 自动停止计时器）——
  // v.__cxUserPaused：用户主动暂停锁。置位后 overrideVideo 不再施加 noop 覆盖、各兜底监听与正常续播均避让，
  // 视频可正常暂停/播放；与原先 __cxReleased（定向跳过/桥避让的"交还平台"语义）分离，避免被重新接管逻辑误清除。


  // ===== MODULE: 前台判定（修复"多个视频同时播放"）=====
  // 域：核心业务模块 —— 前台判定（修复多视频同播）。
  // 仅在"明确可见且面积最大"的视频上强制续播，其余视频交还平台并主动压下，避免一页多视频同时播放。
  // 可见性以 getBoundingClientRect 面积判断：display:none / 零尺寸预加载预览会被排除；
  // 滚动出视口但仍布局的视频面积仍为正，视为前台（不希望因滚动就释放当前任务）。
  function foregroundVideo() {
    // 前台锁定：用户强制指定前台视频，忽略自动面积计算
    if (_lockFg) {
      try {
        if (_lockFg.isConnected && !_lockFg.ended) {
          var lr = _lockFg.getBoundingClientRect();
          if ((lr.width || 0) * (lr.height || 0) > 4) return _lockFg;
        }
      } catch (e) { swallow(e); }
      _lockFg = null; // 锁定视频已失效（脱离 DOM / 已结束 / 不可见），自动解锁
    }
    var vs = allVideos(), best = null, bestScore = -1;
    for (var i = 0; i < vs.length; i++) {
      try {
        var r = vs[i].getBoundingClientRect();
        var area = (r.width || 0) * (r.height || 0);
        if (area <= 4) continue;                       // 不可见（隐藏/零尺寸）
        var score = area + (vs[i].paused ? 0 : 1e7);   // 同面积时优先"正在播放"者
        if (score > bestScore) { bestScore = score; best = vs[i]; }
      } catch (e) { swallow(e); }
    }
    return best;
  }
  // HTML 转义：防止动态内容经 innerHTML 注入（XSS）。与 progress-panel.escapeHTML 实现一致。
  function escapeHTML(s) {
    return ('' + (s == null ? '' : s)).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function shortSrc(v) {
    var s = (v && (v.currentSrc || v.src)) || '';
    if (!s) return '(未知源)';
    try { s = decodeURIComponent(s); } catch (e) {}
    return s.length > 76 ? (s.slice(0, 48) + '…' + s.slice(-26)) : s;
  }
