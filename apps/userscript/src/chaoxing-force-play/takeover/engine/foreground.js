// @provides: foregroundVideo, shortSrc
// @requires: allVideos, bestEffort
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
  // 【清理·M2】原为裸魔法数 1e7：8K 屏视频面积可达 ~3.3e7 会越过该加分使"正在播放优先"失效。
  //   提为常量并抬到 1e9（远超任何可能的像素面积），语义 = "在播放者绝对优先于未播放者"。
  var _FG_PLAYING_BONUS = 1e9;
  var _fgCache, _fgAt = 0;      // 前台判定短窗缓存（避免 MO flush 高频触发同步 layout）
  // 性能修复(卡顿排查)：缓存窗口 150ms → 1000ms——播放中 timeupdate 每 ~250ms 触发视频事件链，
  // 旧窗口使 foregroundVideo→allVideos→walkVideos 全树遍历以 150ms 粒度反复执行（大页面每次 O(N) QSA）；
  // 前台视频归属在秒级内变化极罕见（滚动/切课才变），1s 窗口的语义损失可忽略，
  // 播放中 walkVideos 频率从 ~4 次/秒 降到 ~1 次/秒。失效条件不变（缓存视频脱离文档立即失效；
  // 新视频插入最迟 1s 参与前台竞争，MO flush 期间用旧前台对旧视频操作，语义安全）。
  var _FG_TTL_MS = 1000;
  function foregroundVideo() {
    // 前台锁定：用户强制指定前台视频，忽略自动面积计算
    if (_lockFg) {
      var _locked = false;
      bestEffort(function () {
        if (_lockFg.isConnected && !_lockFg.ended) {
          var lr = _lockFg.getBoundingClientRect();
          if ((lr.width || 0) * (lr.height || 0) > 4) _locked = true;
        }
      }, 'fg.lock');
      if (_locked) return _lockFg;
      _lockFg = null; // 锁定视频已失效（脱离 DOM / 已结束 / 不可见），自动解锁
    }
    // 【性能修复·P2/P3】foregroundVideo 会在 scanVideos(每 2s) 与 MutationObserver flush(高频) 中被反复调用，
    //   每次都对每个视频做 getBoundingClientRect → 同步 layout，弹幕/进度条批量更新期造成主线程抖动。
    //   此处加与 allVideos 同量级的极短窗口缓存：窗口内直接复用上次判定结果（前台归属的变化频率远低于该窗口）。
    var _now = Date.now();
    if (_fgCache !== undefined && (_now - _fgAt) < _FG_TTL_MS) {
      var _cacheHit = false;
      bestEffort(function () { if (_fgCache === null || _fgCache.isConnected) _cacheHit = true; }, 'fg.cache');
      if (_cacheHit) return _fgCache;
    }
    var vs = allVideos(), best = null, bestScore = -1;
    for (var i = 0; i < vs.length; i++) {
      bestEffort(function () {
        var r = vs[i].getBoundingClientRect();
        var area = (r.width || 0) * (r.height || 0);
        if (area > 4) {                                 // 不可见（隐藏/零尺寸）
          var score = area + (vs[i].paused ? 0 : _FG_PLAYING_BONUS);   // 同面积时优先"正在播放"者
          if (score > bestScore) { bestScore = score; best = vs[i]; }
        }
      }, 'fg.score');
    }
    _fgCache = best; _fgAt = _now;
    return best;
  }
  // HTML 转义复用核心 toolkit.escapeHTML（utils.js 单一实现，避免重复轮子；含 '→&#39;）。
  function shortSrc(v) {
    var s = (v && (v.currentSrc || v.src)) || '';
    if (!s) return '(未知源)';
    bestEffort(function () { s = decodeURIComponent(s); }, 'shortSrc.decode');
    return s.length > 76 ? (s.slice(0, 48) + '…' + s.slice(-26)) : s;
  }
