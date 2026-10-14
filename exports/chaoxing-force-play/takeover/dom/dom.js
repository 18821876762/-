// @provides: allVideos, currentVideo, markDomDirty, scanVideos
// @requires: BRIDGE, CONFIG, CONST, CoreState, DEBUG, ENDED_SRCS, EventBus, FLAGS, NATIVE_PAUSE, SELECTORS, TARGET, bestEffort, cxState, dbg, detectSite, foregroundVideo, releaseVideo, safeGet, safePlay, shortSrc, singleVideoActive, videoDriftStableKeys, videoSrcOf
  // ===== DOMAIN: dom module-08-10-15 =====
  // ===== MODULE: 接管引擎(overrideVideo) =====
  // 域：DOM监听与注入层 —— 接管引擎(overrideVideo)。
  /**
   * 接管单个视频元素：按 opt-out / 用户暂停 / 非任务 / 前台闸门等依次短路，决定是否注入强制续播。
   * @param {HTMLVideoElement} v - 视频元素
   * @param {boolean} [fg] - 是否前台视频（前台闸门判断依据）
   */
  function overrideVideo(v, fg) {
    if (!CoreState.canRun()) return;
    if (!v) return;
    // edu 站也接管视频：SITES.edu 为安全基线（空 attachmentsKey/ananasKey，不钩 window.attachments/ananas 私有全局），
    // 仅全量扫描 + 原型级 pause 中性化、无私有全局副作用。原「完全惰性 return」违反 #1 回归(edu.cn 视为 chaoxing 须接管视频)、
    // 且误伤真实超星高校镜像视频 → 移除 return 让 edu 也走接管（与 main-loop 注释及 #1 回归一致；#19 收窄由 SITES.edu 空键满足，不靠惰性跳过）。
    if (cxVideoOptOut(v)) return;   // 元素级 opt-out：data-cx-force-skip 的视频不接管
    if (BRIDGE.skipResume) return;
    // 定向归属：一次祖先遍历，供 matchedAny 登记与 _ovSkipNonTask 复用（避免同一视频同一 tick 重复上溯祖先链）。
    //   定向关闭时恒视为归属(true)，与旧语义一致（disable 时两处均不触发）。
    var _belongs = TARGET.enabled ? videoBelongsToTask(v) : true;
    // 定向命中统计：即便视频被用户暂停（上方 _ovUserPaused 提前 return）也要计入，否则全部暂停时 matchedAny 恒 false → 误触 fallback 回退全量（复审确认）
    if (TARGET.enabled && !TARGET.matchedAny && _belongs) TARGET.matchedAny = true;
    if (_ovUserPaused(v)) return;
    if (_ovSkipNonTask(v, _belongs)) return;
    if (_ovForegroundGate(v, fg)) return;
    if (_ovNearEnd(v)) return;
    if (cxState(v).released) { v[FLAGS.forcePaused] = true; cxState(v).released = false; }   // F-B1：曾被释放、现重新归属任务点 → 重新接管
    if (_ovEndedLock(v)) return;
    if (_ovRebuild(v)) return;
    _ovEnforce(v);
  }

  // —— overrideVideo 子阶段（P2 拆分，零行为回归）——
  // 每个 _ovX 返回 true 表示「本阶段已接管/应终止，overrideVideo 据此 return」。
  // 子函数与主函数同处一个 IIFE 闭包，直接捕获 BRIDGE/TARGET/CONFIG/safePlay 等，无需提升状态。

  function _ovUserPaused(v) {
    if (!v[FLAGS.userPaused]) return false;
    bestEffort(function () { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; }, 'ov.pauseRestore');
    bestEffort(function () { if (!v.paused) (v[FLAGS.np] || NATIVE_PAUSE).call(v); }, 'ov.pauseCall');
    return true;
  }

  function _ovSkipNonTask(v, _belongs) {
    if (!(TARGET.enabled && !_belongs)) return false;
    dbg('跳过非任务点视频（广告/插播）');
    releaseVideo(v);   // F-B1：撤销全量阶段已施加的接管，交还平台（否则广告/插播被永久强制续播）
    return true;
  }

  function _ovForegroundGate(v, fg) {
    if (!fg || v === fg) return false;   // 无前台或本视频即前台：不接管，交主流程
    if (!singleVideoActive() && cxState(v).userKeep) return false;   // 非单视频模式（全局或本门课）：用户显式保留的视频不干预
    // 单视频模式：忽略 userKeep，强制暂停所有非前台视频（无论是否已 forcePaused）
    bestEffort(function () { releaseVideo(v); }, 'ov.fg.release');
    bestEffort(function () { if (!v.paused) (v[FLAGS.np] || NATIVE_PAUSE).call(v); }, 'ov.fg.pause');
    v[FLAGS.forcePaused] = true;
    return true;   // 非前台视频已强制暂停，由本 gate 接管；true=跳过主 override 管线
  }

  function _ovNearEnd(v) {
    if (!(nearEnd(v) && !CONFIG.LOOP_PLAY)) return false;
    bestEffort(function () { if (!v[FLAGS.endedLock]) releaseVideo(v); }, 'ov.nearEnd.release');
    // P0 修复（v4.7.replay）：releaseVideo 将 play 恢复为原生后，视频 ended 时页面可能立即调用 play() 导致重播。
    // 必须安装 ended 事件监听器，在页面 ended handler 之前（捕获阶段）将 play 重新封锁，消除竞赛窗口。
    if (!v[FLAGS.nearEndEndedGuard]) {
      v[FLAGS.nearEndEndedGuard] = true;
      bestEffort(function () {
        // v4.19.20：具名 handler 保存到 FLAGS.nearEndGuard，供释放/卸载路径拆除（旧实现匿名无法移除）
        v[FLAGS.nearEndGuard] = function nearEndEndedGuard() {
          if (CONFIG.LOOP_PLAY) return;   // 循环已开：交给 _ovEnforce 的循环分支处理
          if (v[FLAGS.endedLock]) return; // 已被其他路径锁住（如 _ovEnforce ended 分支）
          bestEffort(function () {
            v.play = function () { return Promise.resolve(); };     // 封锁 play
            v.pause = pauseNoop;                                    // 封锁 pause
            v[FLAGS.endedLock] = true;                              // 后续扫描由 _ovEndedLock 维护
            v[FLAGS.forcePaused] = true;                            // 原型级 no-op 同步生效
            cxState(v).endedSrc = (videoSrcOf(v) || '');             // 换源识别用
            bestEffort(function () { _markEnded(videoSrcOf(v)); }, 'ov.end.mark');
            bestEffort(function () { _endedPrune(); }, 'ov.end.prune');
            bestEffort(function () { if (isFinite(v.duration)) v.currentTime = v.duration; }, 'ov.end.seek');
            dbg('nearEnd·ended 锁：平台 ended handler 前封锁 play，阻断重播');
          }, 'ov.nearEnd.guard');
        };
        v.addEventListener('ended', v[FLAGS.nearEndGuard], true);
      }, 'ov.nearEnd.addListener');
    }
    dbg('进度到底（剩 ' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's）：已关闭续播');
    bestEffort(function () { if (typeof _bxLog === 'function') _bxLog('ov:NearEnd', 'rem=' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's'); }, 'bxlog');
    return true;
  }

  // 站点隔离放行：智慧树「同页自动续播」（视频结束由平台自动切下一集），由 plugins/addons/zhihuishu-auto-next.js
  //   工具库项开关驱动 window.__CX_FORCE_PLAY.zhsAllowEndedReplay；默认 undefined(假)→锁死 ended 防重播（与超星一致）。
  function _zhsAllowEndedReplay() {
    return safeGet(function () { return (detectSite() === 'zhihuishu' && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.zhsAllowEndedReplay) ? true : false; }, false);
  }

  // v4.19.20 审查修复(P0/P1)：统一拆除已接管视频的监听与守卫——ended 锁解锁路径/释放路径/卸载路径三处复用。
  // 修复：ended 锁的 LOOP_PLAY/换源解锁分支此前不拆 seeking 守卫 → 循环播放/换源场景新课被钉回结尾（seek 活锁）。
  function _disarmSeekGuard(v) {
    if (!v) return;
    if (v.__seekArmed && v.__seekHandler) {
      bestEffort(function () { v.removeEventListener('seeking', v.__seekHandler, true); }, 'ov.disarm.seek');
      bestEffort(function () { delete v.__seekHandler; delete v.__seekArmed; }, 'ov.disarm.seekDel');
    }
  }
  function _disarmVideoListeners(v) {
    if (!v) return;
    _disarmSeekGuard(v);
    if (v[FLAGS.nearEndGuard]) {
      bestEffort(function () { v.removeEventListener('ended', v[FLAGS.nearEndGuard], true); }, 'ov.disarm.nearEnd');
      bestEffort(function () { delete v[FLAGS.nearEndGuard]; }, 'ov.disarm.nearEndDel');
    }
    if (Array.isArray(v[FLAGS.listeners])) {
      for (var _li = 0; _li < v[FLAGS.listeners].length; _li++) {
        (function (_l) {
          if (_l && _l.type) bestEffort(function () { v.removeEventListener(_l.type, _l.fn, _l.cap); }, 'ov.disarm.lst');
        })(v[FLAGS.listeners][_li]);
      }
      v[FLAGS.listeners].length = 0;
    }
  }

  function _ovEndedLock(v) {
    if (!v[FLAGS.endedLock]) return false;
    // 【循环播放·开开关即时生效】当 CONFIG.LOOP_PLAY=true 时，已锁死的 ended 视频必须解除锁、允许重播——
    // 否则用户勾选「循环播放」开关后，因 v.play 仍是 no-op、endedLock 仍为真，视频永远卡在末尾无法循环。
    // 解除后落到下方 _ovEnforce 的 v.ended 分支(LOOP_PLAY=true)从头重播，语义零回归（防重播仅在 LOOP_PLAY=false 生效）。
    if (CONFIG.LOOP_PLAY) {
      v[FLAGS.endedLock] = false;
      bestEffort(function () { delete v.play; }, 'ov.endLock.loopDelPlay');
      bestEffort(function () { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; }, 'ov.endLock.loopPauseRestore');
      _disarmSeekGuard(v);   // v4.19.20：不拆则 seeking 守卫把 currentTime 钉回结尾 → 循环重播 seek 活锁
      dbg('循环播放已开：解除旧 ended 锁，交由 _ovEnforce 从头重播');
      return false;   // 不维持锁，落到下方正常续播/循环
    }
    // 复用同元素跨"下一节"换源：旧 ended 锁会误锁新一课，使新视频停在末尾无法播放。
    // 判定当前 src 与当初被锁死的源不同 → 解除旧锁并重新接管（不 return，落到下方正常续播）。
    safeGet(function () {
      var _cur = videoSrcOf(v) || '';
      if (_cur && cxState(v).endedSrc && _cur !== cxState(v).endedSrc) {
        v[FLAGS.endedLock] = false;
        bestEffort(function () { delete v.play; }, 'ov.end.delPlay');
        bestEffort(function () { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; }, 'ov.end.pauseRestore');
        _disarmSeekGuard(v);   // v4.19.20：不拆则换源后漂移守卫回拨 seek 被钉回结尾 → 新一课被判 ended 锁死
        dbg('复用元素换源(new lesson)：解除旧 ended 锁，重新接管「' + shortSrc(v) + '」');
      }
    });
    if (v[FLAGS.endedLock]) {   // 仍是同一已结束视频 → 持续维持锁，阻断重播
      bestEffort(function () { v.pause = pauseNoop; }, 'ov.endLock.pause');
      v[FLAGS.forcePaused] = true;   // 原型级 no-op 也生效（即便实例 own 属性被重置）
      v.play = function () { return Promise.resolve(); };
      bestEffort(function () { if (v.duration && isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; }, 'ov.endLock.seek');
      dbg('ended 锁持续维持，阻断重播');
      return true;
    }
    return false;
  }

  function _ovRebuild(v) {
    if (!(v.ended && !v[FLAGS.endedLock] && isRebuildFinished(v))) return false;
    if (CONFIG.LOOP_PLAY) {
      dbg('循环播放：允许已结束任务的重建 video 重播');  // 不锁死，交给 _ovEnforce 正常续播 + loop 属性实现重播
      return false;   // 不终止：交给 _ovEnforce 正常续播
    }
    bestEffort(function () { v.pause = pauseNoop; v.play = function () { return Promise.resolve(); }; v.loop = false; cxState(v).rebuild = true; }, 'ov.rebuild');
    v[FLAGS.forcePaused] = true;
    dbg('跳过已结束任务的重建 video（防整元素重播）');
    return true;
  }

  // 进度漂移守卫（应对超星防挂机/反作弊）：平台会周期性把 currentTime 回拨到开头，或重建 <video> 元素使进度归零，
  // 导致视频永远卡在开头附近、反复"循环"回起点（诊断表现为：playing 且 rate=1，但 1 分钟只推进约 8 秒）。
  // 按视频源(src)记录已到达的最大进度；检测到回拨(进度往回拉>1.5s)或重建元素(新元素从 0 开始)时，回补到最大位置并恢复播放，
  // 打破"重置→卡开头"循环。仅操作公开 <video> 元素，不触碰 window.ananas/attachments 私有全局（符合 #19 收窄）。
  // 同时检测播放停滞（在播但连续多 tick 不推进）→ 重新 play() 并轻推进度，应对平台缓冲/状态机失稳。
  var _srcMaxTime = {};
  var _srcStallSince = {};
  var _srcMaxCount = 0;   // _srcMaxTime 键计数（超限淘汰用，避免每 tick Object.keys 全量）
  function _ovDriftGuard(v) {
    bestEffort(function () {
      var key0 = videoSrcOf(v) || '';
      if (v.ended || v[FLAGS.endedLock] || cxState(v).released || v[FLAGS.userPaused] || v[FLAGS.anHold]) { _srcStallSince[key0] = null; return; }
      var d = (typeof v.duration === 'number' && isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
      var t = (typeof v.currentTime === 'number' && isFinite(v.currentTime)) ? v.currentTime : 0;
      // v4.19.17：keys 额外并入「不依赖定向的稳定键」(videoDriftStableKeys)，使进度在 blob: 源再生 / 元素重建后存活，打破「跳回开头反复播」循环。
      // 性能优化：祖先链(iframe/宿主)派生键仅在换源时重算（videoIframeSrcsOf/videoDriftStableKeys 均沿祖先链上溯，逐 tick 重算是重复遍历）；
      //   src 未变时复用缓存键，仅 key0 始终实时更新（src 再生由下方 driftSrc 比对捕获）。iframe 归属仅在换课/换任务时变化，届时 src 必变，语义零回归。
      var _stKey = cxState(v).driftStableKeys;
      if (!_stKey || cxState(v).driftSrc !== key0) {
        _stKey = videoIframeSrcsOf(v).concat(videoDriftStableKeys(v)).filter(function (k) { return !!k; });
        cxState(v).driftStableKeys = _stKey;
      }
      var keys = [key0].concat(_stKey);
      if (!keys.length) return;
      // 性能修复(卡顿排查)：换源检测——currentSrc(易变 blob) 变化时只清掉该易变 key 的进度记录（避免误判回拨），
      // 不再整组删除所有 keys：稳定键(videoDriftStableKeys)跨重建存活，回拨守卫才能正确 seek 回 max 打破循环（v4.19.17）。
      if (cxState(v).driftSrc && cxState(v).driftSrc !== key0) {
        if (Object.prototype.hasOwnProperty.call(_srcMaxTime, cxState(v).driftSrc)) _srcMaxCount--;
        delete _srcMaxTime[cxState(v).driftSrc];
        delete _srcStallSince[cxState(v).driftSrc];
      }
      cxState(v).driftSrc = key0;
      cxState(v).driftKeys = keys;
      var max = 0; for (var i = 0; i < keys.length; i++) { var m = _srcMaxTime[keys[i]] || 0; if (m > max) max = m; }
      if (t > max) {
        for (var j = 0; j < keys.length; j++) { if (!_srcMaxTime[keys[j]]) _srcMaxCount++; _srcMaxTime[keys[j]] = t; }
        if (t > 0) _srcStallSince[key0] = Date.now();
        // 键上限淘汰（防超长会话换源累积；超限时按插入序淘汰最旧键，与 ENDED_SRCS 同策略）
        if (_srcMaxCount > 5000) {
          var _sk = Object.keys(_srcMaxTime);
          if (_sk.length > 5000) {
            var _dropN = _sk.length - 5000;
            for (var _dp = 0; _dp < _dropN; _dp++) { delete _srcMaxTime[_sk[_dp]]; delete _srcStallSince[_sk[_dp]]; _srcMaxCount--; }
          }
        }
        return;
      }      if (t < max - 1.5) {   // 回拨超过 1.5s：判定为平台重置/重建元素，回补到最大位置（仍小于时长）
        // 性能修复(卡顿排查)：回拨回补冷却——上次回补后 5s 内不再重复 seek（学习通防挂机可能高频回拨，
        // 连续 seek 使播放器反复重定位造成持续卡顿）。冷却期仅维持 stall 记录、不 seek 不改 max，
        // 冷却后若仍落后再回补一次。单次回拨场景零影响；持续回拨场景把 seek 频率从每 2s 降到每 5s。
        if (Date.now() - (v.__cxDriftAt || 0) < 5000) { _srcStallSince[key0] = Date.now(); return; }
        var target = d > 0 ? Math.min(max, d - 0.5) : max;
        if (target > t + 0.3 && target > 0) {
          bestEffort(function () { v.currentTime = target; }, 'ov.drift.seek');
          v[FLAGS.forcePaused] = true;
          v.__cxDriftAt = Date.now();
          if (v.paused) safePlay(v);
          dbg('进度漂移守卫：检测到回拨(当前 ' + t.toFixed(1) + 's→回补至 ' + target.toFixed(1) + 's)，恢复播放');
        }
        for (var k = 0; k < keys.length; k++) { if (!_srcMaxTime[keys[k]]) _srcMaxCount++; _srcMaxTime[keys[k]] = target; }
        _srcStallSince[key0] = Date.now();
        return;
      }
      // 停滞检测：在播且未回拨，但连续 ~6s 进度无推进（误差<0.25s）→ 重新 play 并轻推进度
      if (t >= max - 0.25) {
        var since = _srcStallSince[key0];
        if (since == null) { _srcStallSince[key0] = Date.now(); }
        else if (Date.now() - since > 6000) {
          bestEffort(function () {
            if (v.paused) { safePlay(v); }
            else { try { var nt = t + 0.5; if (d > 0 && nt > d - 0.5) nt = t; v.currentTime = nt; } catch (e) {} }
          }, 'ov.stall.nudge');
          dbg('进度漂移守卫：检测到播放停滞(>6s 无推进)，重新 play 并轻推进度');
          _srcStallSince[key0] = Date.now();
        }
      }
    }, '_ovDriftGuard');
  }

  // 每轮主循环调用：对所有已发现视频跑进度漂移守卫（独立于接管扫描，因 scanVideos(incremental) 会跳过已稳定接管的视频，
  // 若守卫只放在 _ovEnforce 内则只在首次接管时跑一次，无法在挂机过程中检测到平台的周期性回拨/重建元素）。
  function tickDriftGuards() {
    if (!CoreState.canRun()) return;
    bestEffort(function () {
      var vs = allVideos();
      for (var i = 0; i < vs.length; i++) { _ovDriftGuard(vs[i]); }
    }, 'loop.driftGuards');
  }

  function _ovEnforce(v) {
    bestEffort(function () {
      // MediaSession 劫持提到最前面：所有状态都执行（含 ended），应对锁屏界面续播。
      bestEffort(function () {
        if (navigator.mediaSession) {
          // 懒保存注入前原始 pause handler 与 playbackState（仅首次），供 cleanupListeners ④ 还原（审查高优先级#3）。
          if (!_mediaSessionSaved) {
            bestEffort(function () { _origMediaSessionPause = (typeof navigator.mediaSession.getActionHandler === 'function') ? navigator.mediaSession.getActionHandler('pause') : null; }, 'ov.ms.origPause');
            bestEffort(function () { _origMediaSessionState = navigator.mediaSession.playbackState; }, 'ov.ms.origState');
            _mediaSessionSaved = true;
            safeCall(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._mediaSessionHooked = true; }, 'ov:mediaSession');   // 安全审计(建议#10)：标记 mediaSession 已接管，供面板实时盘点（评审#11：safeCall 收口）
          }
          navigator.mediaSession.setActionHandler('pause', function () {});
          navigator.mediaSession.playbackState = 'playing';   // 视频实则在播，状态标 playing 与"劫持 pause 为 no-op"语义一致，锁屏不误发暂停
        }
      }, 'ov.mediaSession');

      if (!cxState(v).init) {
        v[FLAGS.np] = NATIVE_PAUSE;
        v[FLAGS.forcePaused] = true;
        v.loop = CONFIG.LOOP_PLAY;
        // v4.19.20：监听注册表（__cxListeners），卸载/释放时 _disarmVideoListeners 统一拆除（旧实现匿名无法移除）
        var _ovAddListener = function (type, fn, cap) {
          v.addEventListener(type, fn, cap);
          if (!Array.isArray(v[FLAGS.listeners])) v[FLAGS.listeners] = [];
          v[FLAGS.listeners].push({ type: type, fn: fn, cap: !!cap });
        };
        _ovAddListener('pause', function () {
          bestEffort(function () { if (!v[FLAGS.anHold] && !BRIDGE.skipResume && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); }, 'ov.pauseEv');
        }, true);
        _ovAddListener('ratechange', function () {
          bestEffort(function () { if (CoreState.canRun() && !cxState(v).released && !v[FLAGS.anHold] && !v[FLAGS.userPaused] && v.playbackRate <= CONST.PSEUDO_PAUSE_RATE) v.playbackRate = (CONFIG.USER_RATE || 1); }, 'ov.rateEv');
        }, true);
        _ovAddListener('canplay', function () {
          bestEffort(function () { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused] && v.paused && v.readyState >= 2) safePlay(v); }, 'ov.canplayEv');
        }, true);
        _ovAddListener('waiting', function () {
          bestEffort(function () { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); }, 'ov.waitingEv');
        }, true);
        _ovAddListener('stalled', function () {
          bestEffort(function () { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); }, 'ov.stalledEv');
        }, true);
        // P0 脏检查：任一视频事件触发后标记活动，使主循环下一 tick 对该视频复核接管态(ended 锁/前台门/近尾/rate)。
        _ovAddListener('play', function () { _videoActivity = true; }, true);
        _ovAddListener('pause', function () { _videoActivity = true; }, true);
        _ovAddListener('ended', function () { _videoActivity = true; }, true);
        _ovAddListener('timeupdate', function () { _videoActivity = true; }, true);
        cxState(v).init = true;
        safeCall(function () { EventBus.emit('video:state', { src: shortSrc(v), action: 'takeover' }); }, 'ov:state');
        safeCall(function () { if (typeof _bxLog === 'function') _bxLog('ov:Takeover', 'init video ' + (shortSrc(v) || '?')); }, 'ov:bxLog');
      }
      v.pause = pauseNoop;
      v.loop = CONFIG.LOOP_PLAY;

      if (v.ended) {
        if (CONFIG.LOOP_PLAY) {
          bestEffort(function () { v[FLAGS.endedLock] = false; }, 'ov.loop.endedLock');
          bestEffort(function () { v.loop = true; }, 'ov.loop.set');
          bestEffort(function () { v.pause = pauseNoop; }, 'ov.loop.pause');
          bestEffort(function () { v.currentTime = 0; }, 'ov.loop.seek');
          v[FLAGS.forcePaused] = true;
          if (v.paused) safePlay(v);
          dbg('循环播放：视频播完，从头重播');
          return true;   // 终止 enforce（即 overrideVideo 终止；下方正常续播不再执行）
        }
        // 【智慧树·同页自动续播】站点隔离 + 工具库项开关控制：智慧树视频结束由平台自动切下一集，
        //   此处放行不锁死 ended；超星/其他站点默认 false → 走下方锁死逻辑，防重播语义零回归。
        if (_zhsAllowEndedReplay(v)) {
          bestEffort(function () { releaseVideo(v); }, 'ov.zhs.release');
          dbg('智慧树·放行 ended：交还平台自动续播下一集（不锁死）');
          return true;   // 交还平台；平台切下一集后新 src 触发 _ovEndedLock 换源解除 + 重新接管续播
        }
        v.play = function () { return Promise.resolve(); };  /* !!! 必须先封锁 play，再调原生 pause：否则 pause 事件监听器里的 safePlay 会调用尚未被替换的原生 play，导致已结束视频被打断→重播（swallow-all 循环） */
        bestEffort(function () { if (v[FLAGS.np]) v[FLAGS.np](); }, 'ov.ended.npCall');
        bestEffort(function () { v[FLAGS.endedLock] = true; }, 'ov.ended.lock');
        bestEffort(function () { cxState(v).endedSrc = (videoSrcOf(v) || ''); }, 'ov.ended.src');
        bestEffort(function () { cxState(v).userKeep = false; }, 'ov.ended.keep');
        safeCall(function () { _markEnded(videoSrcOf(v)); }, 'ov:markEnded');
        safeCall(function () { var _iss = videoIframeSrcsOf(v); for (var _i = 0; _i < _iss.length; _i++) _markEnded(_iss[_i]); }, 'ov:markEndedIframe');
        _endedPrune();
        bestEffort(function () { if (isFinite(v.duration)) v.currentTime = v.duration; }, 'ov.ended.seek');
        if (!v.__seekArmed) {
          v.__seekArmed = true;
          // 保存引用以便 userResume 时拆除（否则恢复播放后 seeking 守卫又把 currentTime 钉回结尾）
          v.__seekHandler = function () {
            bestEffort(function () { if (isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; }, 'ov.seek.seek');
          };
          v.addEventListener('seeking', v.__seekHandler, true);
        }
        dbg('ended：已锁定 currentTime 并覆盖 play 为 no-op，阻断重播');
        return true;   // 终止 enforce
      }

      // 进度漂移守卫：应对超星周期性回拨进度/重建元素导致视频卡在开头反复循环（详见 _ovDriftGuard）
      _ovDriftGuard(v);

      if (v.paused && !v[FLAGS.anHold] && !cxState(v).released && !v[FLAGS.userPaused] && v.readyState >= 2) { safePlay(v); }
      if (v.playbackRate <= CONST.PSEUDO_PAUSE_RATE && !cxState(v).released && !v[FLAGS.anHold] && !v[FLAGS.userPaused]) { v.playbackRate = (CONFIG.USER_RATE || 1); }
      else if (CONFIG.USER_RATE && CONFIG.USER_RATE !== 1 && v[FLAGS.forcePaused] && !cxState(v).released && !v[FLAGS.anHold] && !v[FLAGS.userPaused] && v.playbackRate > CONST.PSEUDO_PAUSE_RATE && v.playbackRate !== CONFIG.USER_RATE) { v.playbackRate = CONFIG.USER_RATE; }
    }, '_ovEnforce');
  }

  // 中和平台暴露的全局暂停封装（如 window.ananas.pause）。
  // 'use strict' 下若属性不可写/不可配置，直接赋值会抛 TypeError 被静默吞掉导致中和失效。
  // 故优先用 defineProperty 在实例上创建 own 属性遮蔽——无论 pause 是自有还是原型继承都能遮蔽（吸收评审#2/#D）；
  // 仅当 defineProperty 失败（自有属性 non-configurable）再回退普通赋值，仍失败则 dbg 暴露。
  /**
   * 中和平台暴露的全局暂停封装（如 window.ananas.pause），使平台"强制暂停"失效。
   * 优先 defineProperty 在实例上创建 own 属性遮蔽（无论自有/原型继承都能遮蔽），失败再回退普通赋值。
   * @param {Window} win - 目标 window（含同源 iframe）
   */
  var _ananasPauseNoop = function () {
    if (!CoreState.canRun() && this && typeof this.__cxAnanasNativePause === 'function' && this.__cxAnanasNativePause !== _ananasPauseNoop) {
      return this.__cxAnanasNativePause.apply(this, arguments);
    }
  };
  function neutralizeGlobalPause(win) {
    if (!CoreState.canRun()) return;
    bestEffort(function () {
      var a = siteAnanas(win);
      if (a && typeof a.pause === 'function') {
        var done = false;
        try {
          // §9.2-4：平台可能在中和后**动态替换** a.pause（注入新 wrapper）。仅首次保存会让 __cxAnanasNativePause
          // 指向过期引用，卸载还原时拿到非真原生 pause → 续播/暂停行为异常。故只要当前 pause 不是我们注入的 no-op，
          // 就刷新为最新真实 pause（被中和前的真原生），确保还原正确（重复下钻同一 ananas 不覆盖已存真原生）。
          if (a.pause !== _ananasPauseNoop) a.__cxAnanasNativePause = a.pause;
          Object.defineProperty(a, 'pause', { value: _ananasPauseNoop, configurable: true, writable: true });
          done = true;
        } catch (de) {
          bestEffort(function () { a.pause = _ananasPauseNoop; done = true; }, 'neut.fallback');
        }
        if (done) {
          if (_ananasNeutralized.indexOf(a) === -1) _ananasNeutralized.push(a);   // 记入还原清单（跨 iframe 各 ananas 独立实例）
        } else {
          dbg('window.ananas.pause 无法中和(描述符受限)');
        }
      }
    }, 'neut.globalPause');
  }



  // ===== MODULE: 视频枚举(walkVideos · 审查 JS1-3「scanVideos 三合一」) =====
  // 域：DOM监听与注入层 —— 视频枚举原语(walkVideos/scanVideos/allVideos)。
  // scanVideos(强制接管)、allVideos(收集/诊断/面板)、installPlayWatch(iframe 内 play 即时接管)
  // 原本各有独立遍历(Shadow DOM + 同源 iframe)，口径不一致曾导致「视频在播但诊断 0 / 手动暂停被接管」矛盾。
  // 现统一为单一递归原语 walkVideos：onVideo(v, hostSigs) 对每个视频调用；onDoc(doc, frame) 进入每个同源 iframe 文档时调用。
  // 扫描深度上限集中到 CONST（元配置集中层）
  /**
   * 统一递归遍历：从 root 文档出发，枚举视频（onVideo）并递归进入同源 iframe（onDoc）。
   * 扫描深度上限由 CONST.MAX_SCAN_DEPTH 控制；容器选择器在评审#6 中缓存以提升递归性能。
   * @param {Document|Element} root - 起始文档/根元素
   * @param {Object} hostSigs - 宿主签名集合（用于 iframe 去重防环）
   * @param {number} [depth] - 当前递归深度（默认 0）
   * @param {Function} onVideo - 视频回调 onVideo(v, hostSigs)
   * @param {Function} onDoc - 进入 iframe 文档回调 onDoc(doc, frame)
   */
  function walkVideos(root, hostSigs, depth, onVideo, onDoc) {
    if (!root || !root.querySelectorAll) return;
    depth = depth || 0;
    if (depth > CONST.MAX_SCAN_DEPTH) return;
    var _taskSel = siteTaskContainerSel();
    // 评审#6：缓存容器选择器，避免递归每层重复拼接与 detectSite 调用。
    // 当站点无任务点容器(如 deepseek 应答端 taskContainerSel='')时仅用 VIDEO_BOX，避免拼出 "#videoBox, " 尾逗号非法选择器
    // → 每轮 querySelectorAll 抛 "is not a valid selector" 被 swallow 计入遥测(诊断#510：deepseek 页 510 次 querySelectorAll 报错)。
    var _containerSel = (_taskSel && _taskSel.trim()) ? (SELECTORS.VIDEO_BOX + ', ' + _taskSel.trim()) : SELECTORS.VIDEO_BOX;
    var _vs = Array.from(root.getElementsByTagName('video'));   // 快照为静态数组，规避 live HTMLCollection 遍历期突变风险（审查：live collection 风险）；getElementsByTagName 不抛错
    for (var _vi = 0; _vi < _vs.length; _vi++) { bestEffort(function (v, hs) { if (onVideo) onVideo(v, hs); }.bind(null, _vs[_vi], hostSigs), 'walk.eachVideo'); }
    bestEffort(function () {
      if (root.host) {
        var _sh = root.querySelectorAll('*');
        for (var _hi = 0; _hi < _sh.length; _hi++) {
          if (_sh[_hi].shadowRoot) { bestEffort(function () { walkVideos(_sh[_hi].shadowRoot, hostSigs, depth + 1, onVideo, onDoc); }, 'walk.shRootHost'); }
        }
      } else {
        var _cts = root.querySelectorAll(_containerSel);
        for (var _ci = 0; _ci < _cts.length; _ci++) {
          var _ct = _cts[_ci];
          if (_ct.shadowRoot) { bestEffort(function () { walkVideos(_ct.shadowRoot, hostSigs, depth + 1, onVideo, onDoc); }, 'walk.shRootCt'); }
          var _all = Array.from(_ct.getElementsByTagName('*'));   // 快照为静态数组，规避 live HTMLCollection 遍历期突变风险
          for (var _ai = 0; _ai < _all.length; _ai++) {
            if (_all[_ai].shadowRoot) { bestEffort(function () { walkVideos(_all[_ai].shadowRoot, hostSigs, depth + 1, onVideo, onDoc); }, 'walk.shRootSub'); }
          }
        }
      }
    }, 'walk.shadowDom');
    bestEffort(function () {
      [].forEach.call(root.querySelectorAll('iframe'), function (f) {
        bestEffort(function () {
          if (f.contentWindow && f.contentDocument) {
            var _hs = (hostSigs || []).concat(signatureOf(f));   // 宿主 iframe 签名下钻传入（修复复审#2）
            bestEffort(function () { if (f.src) _hs.push(f.src); }, 'walk.iframeSrc');
            walkVideos(f.contentDocument, _hs, depth + 1, onVideo, onDoc);
            if (!cxState(f).pw) { cxState(f).pw = true; installPlayWatch(f.contentDocument); }   // 仅在首次下钻为 iframe 内视频装 play 即时接管（避免每轮重复挂载）
            safeCall(function () { neutralizeGlobalPause(f.contentWindow); }, 'walk:neutralize');
            safeCall(function () { if (onDoc) onDoc(f.contentDocument, f); }, 'walk:onDoc');
          }
          // 修时序：动态创建的播放器 iframe 可能尚未加载完，等 load 后再扫一次
          if (!cxState(f).loaded) {
            cxState(f).loaded = true;
            f.addEventListener('load', function () {
              safeCall(function () { if (f.contentWindow && f.contentDocument) { scanVideos(f.contentDocument, hostSigs, depth + 1); neutralizeGlobalPause(f.contentWindow); } }, 'walk:load');
            }, true);
          }
        }, 'walk.inner');                   // 跨域 iframe 静默跳过（外部无法挂载）
      });
    }, 'walk.outer');
  }
  // 接管遍历：对每个视频施加强制续播（含宿主 iframe 签名下钻）
  // 第 4 参 incremental(默认 false=全量)：P0-2 增量接管——主循环每轮调用传 true，
  // 对已稳定接管(已 init 且未释放)的视频跳过重复 overrideVideo(其态由自身事件监听器维护)，
  // 仅接管新视频与释放态需重接管者，省每轮全树遍历后的重复接管开销。零行为回归。
  function scanVideos(root, hostSigs, depth, incremental) {
    if (!CoreState.canRun()) return;
    var fg = foregroundVideo();   // 每轮仅算一次前台，避免 O(n²)；非前台视频在 overrideVideo 内被门控释放
    walkVideos(root, hostSigs, depth || 0, function (v, hs) {
      safeCall(function () { if (hs) cxState(v).hostSigs = hs; }, 'scan:hostSigs');
      if (incremental && cxState(v).init && !cxState(v).released) return;   // P0 增量：稳态接管视频跳过(事件监听器已维护)；释放态/新视频仍接管(F-B1 重接管依赖此)
      overrideVideo(v, fg);
    });
  }
  // 【性能修复·P2】allVideos 是全量 DOM + 同源 iframe 深度遍历，单次主循环 tick 内会被
  //   foregroundVideo / activeVideo / currentVideo / 面板渲染 / 诊断等反复调用（实测同 tick 5~8 次），
  //   在多 iframe 课程页会造成明显卡顿。此处加"极短窗口"记忆化（_AV_TTL_MS）：
  //   窗口内复用同一快照，且命中前校验所有元素仍 isConnected（DOM 被换掉即刻失效），
  //   窗口远小于主循环周期，不影响新视频的发现时效；需要绝对最新可传 fresh=true 强制重扫。
  var _avCache = null, _avAt = 0;
  var _AV_TTL_MS = 150;
  function allVideos(fresh) {
    // 诊断、状态、面板「暂停/恢复」按钮(currentVideo/activeVideo)均依赖本函数；与 scanVideos 统一口径，三者一致修复矛盾
    var now = Date.now();
    if (!fresh && _avCache && (now - _avAt) < _AV_TTL_MS) {
      var stale = false;
      for (var k = 0; k < _avCache.length; k++) {
        if (safeGet(function () { return _avCache[k] && _avCache[k].isConnected === false; }, true)) { stale = true; break; }
      }
      if (!stale) return _avCache;
    }
    var out = [], seen = new Set();
    function dedup(v) { if (seen.has(v)) return false; seen.add(v); return true; }
    walkVideos(document, null, 0, function (v) { if (dedup(v)) out.push(v); });
    safeCall(function () { if (window.top && window.top !== window && window.top.document && window.top.document.body) walkVideos(window.top.document, null, 0, function (v) { if (dedup(v)) out.push(v); }); }, 'allVideos:top');  // 并入顶层同源文档（评审#11：safeCall 收口）
    _avCache = out; _avAt = now;
    return out;
  }
  function activeVideo() {                       // 返回当前正在播放的视频（用于热键切换）
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { if (safeGet(function () { return (!vs[i].paused && !vs[i].ended); }, false)) return vs[i]; }
    return null;
  }
  // 【内聚性收敛】userPause / userResume / autoStopTick / resumeTick 已迁至 takeover/takeover/dom/session.js（观看会话：用户意图与计时），
  //   toast 已迁至 presentation/toast.js（纯 UI 渲染，经 EventBus.emit('ui:toast') 触发）。本模块只保留 DOM 接管引擎与视频枚举。
  function currentVideo() {                       // 当前目标视频：优先正在播放者；否则优先已用户暂停者；否则首个 video（供面板操作）
    var act = activeVideo(); if (act) return act;
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { if (safeGet(function () { return vs[i][FLAGS.userPaused]; }, false)) return vs[i]; }
    return vs[0] || null;
  }


  // ===== MODULE: DOM 变动驱动 + 自启动 =====
  // 域：DOM监听与注入层 —— DOM 变动驱动 + 自启动入口。
  // DOM 变动监听：覆盖动态插入的播放器 video。
  // 高频变动(弹幕/进度条批量更新)时，仅把新增 video 节点入队、合并到下一帧批量处理，避免主线程雪崩（吸收评审#2）。
  // 【易误判·诊断#九】对新增节点全子树 querySelectorAll('video') 看似浪费，但已合并到下一帧批量处理、且 video 仅现于视频容器内，
  //   实际开销极小；收窄选择器为低优可选优化，非缺陷，勿以"性能"为由过度重构。
  // 【P0 脏检查·综合优化方案 P0-1】主循环脏检查用的轻量标志：
  //   _domDirty      —— MutationObserver 捕获到 document 子树节点增删(结构变化)时置位
  //   _videoActivity —— 任一已接管视频触发 play/pause/ended/timeupdate 时置位
  // 仅当二者之一为真，主循环才做全量接管扫描(由 _loopTick 内 consumeScanNeeded() 消费并复位)；
  // 静止/挂机页跳过 walkVideos 全树遍历，CPU 与掉帧显著下降。文本/属性变更(进度条刷新)属 characterData/attributes，
  // 不触发 childList → 不会误置 _domDirty；播放中稳态页借 timeupdate 维持活动(扫描保持)，零行为回归。
  var _domDirty = false, _videoActivity = false;
  // 状态机优化(加载感知)：状态变化触发重扫——releaseVideo（释放→重新归属）与桥 skipResume 变化等
  // 「非 DOM 结构变化但接管状态变了」的路径调用本函数，使下一主循环 tick 立即全量扫描重新接管，
  // 抵消「播放稳态扫描降频（2s→4s）」对 released 视频重接管的延迟影响（延迟上限回到主循环节奏 ≤2s）。
  function markDomDirty() { _domDirty = true; }
  // 状态机优化(卡顿排查·主循环调度)：脏检查标志拆分为「结构变更」与「播放活动」两个消费通道——
  // _domDirty（节点增删，新视频必经此路径）→ 全量扫描；_videoActivity（timeupdate 等播放事件）→ 仅播放稳态，
  // 主循环据此把播放中的全量扫描从每 2s 降频到每 4s（新视频仍由 MO/domDirty 即时发现，零语义损失）。
  function consumeDomDirty() {
    var _n = _domDirty;
    _domDirty = false;
    return _n;
  }
  function consumeVideoActivity() {
    var _n = _videoActivity;
    _videoActivity = false;
    return _n;
  }
  function consumeScanNeeded() {   // 兼容入口（保持原合并语义）
    return consumeDomDirty() || consumeVideoActivity();
  }
  var _moQueue = [];
  // v4.19.38：MO 累计活动统计——_moQueue 是瞬态队列（捕获后 16ms/200ms 内即排空接管），
  // 诊断采样瞬间恒为 0，无法判断 MO 是否在工作。累计入队/排空/批次/最近活动时间提供「MO 是否活跃」证据。
  // v4.19.40：以「回调批次」为 MO 活跃主指标——静态渲染的视频不触发 MO（MO 只捕获「新增」节点），
  // 页面加载完成后入队恒 0 属正常（视频由主循环 scanVideos 接管）；批次持续增长才是 MO 在工作的直接证据。
  var _moPushes = 0, _moFlushes = 0, _moBatches = 0, _moLastPushAt = 0, _moLastFlushAt = 0, _moLastBatchAt = 0;
  var _moScheduled = false;
  var _moFlushTimer = null, _moFlushRaf = null;   // v4.19.20：flush 调度句柄化（卸载可清，不再裸 setTimeout/rAF 残留）
  CoreState.onCancel('playback', function () {
    if (_moFlushTimer !== null) clearTimeout(_moFlushTimer);
    if (_moFlushRaf !== null) cancelAnimationFrame(_moFlushRaf);
    _moFlushTimer = null; _moFlushRaf = null; _moScheduled = false;
    _moQueue.forEach(function (v) { v.__cxMoQ = false; }); _moQueue = [];
  });
  function _moFlush() {
    _moScheduled = false;
    _moFlushes++; _moLastFlushAt = Date.now();   // v4.19.38：累计排空计数
    // v4.19.20：卸载后（命名空间已删）排队 flush 不再执行——否则会把 ⑤-b 刚删除的接管属性重新写回
    var q = _moQueue; _moQueue = [];
    for (var qi = 0; qi < q.length; qi++) if (q[qi]) q[qi].__cxMoQ = false;
    if (!CoreState.canRun()) return;
    var _fg = foregroundVideo();
    for (var i = 0; i < q.length; i++) { var qv = q[i]; safeCall(function () { if (qv) qv.__cxMoQ = false; overrideVideo(qv, _fg); }, 'moFlush:override'); }
  }
  // MO 队列去重入队：同一元素实例不重复入队（防平台反复重建/重插同一视频时队列被刷爆、overrideVideo 重复接管），
  // 已被本脚本接管(forcePaused 已置)的视频直接跳过。去重标记在 _moFlush 排空后清除。
  function _moEnqueue(v) {
    if (!CoreState.canRun()) return;
    if (!v || v.nodeType !== 1 || v.tagName !== 'VIDEO') return;
    if (v.__cxMoQ) return;
    if (v[FLAGS.forcePaused]) return;
    v.__cxMoQ = true;
    _moQueue.push(v); _moPushes++; _moLastPushAt = Date.now();
  }
  // 内存埋点（切屏崩溃观测）：Chrome 专用 performance.memory。仅 DEBUG 时采样，关注 heap 与 _moQueue 长度（泄漏前兆）。
  // 注意：非 Chrome 无 performance.memory，s 显示 n/a；切屏前后各采一次可直接对比后台增长。
  var _memPoll = 0;
  function _memSample(tag) {
    bestEffort(function () {
      var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
      var s = m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a';
      dbg('[mem] ' + tag + ' heap=' + s + ' moQueue=' + _moQueue.length + ' ended=' + Object.keys(ENDED_SRCS).length);
    }, 'mem.sample');
  }
  var _mo = null;   // MutationObserver 实例（审查 JS1-2：页面卸载时断开，避免孤立回调滞留）
  bestEffort(function () {
    _mo = new MutationObserver(function (muts) {
      _domDirty = true;   // P0 脏检查：任意子树节点增删 → 结构变化，下一 tick 需全量重扫
      _moBatches++; _moLastBatchAt = Date.now();   // v4.19.38/40：累计回调批次 + 最近批次时间
      var _cap = (typeof CONST !== 'undefined' && CONST.MO_QUEUE_CAP) ? CONST.MO_QUEUE_CAP : 1024;   // 安全阀兜底值（CONST 未注入时退化为 1024，防队列无限膨胀）
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if (n.tagName === 'VIDEO') _moEnqueue(n);
          if (n.querySelectorAll) { var vs = n.querySelectorAll('video'); for (var k = 0; k < vs.length; k++) _moEnqueue(vs[k]); }
        }
      }
      // 安全阀：队列超上限立即同步排空（即便标签页隐藏 setTimeout 被节流、或 CONST 未注入也兜底，防队列无限膨胀→OOM）
      if (_moQueue.length > _cap) { safeCall(function () { _moFlush(); }, 'mo:flushCap'); }
      if (!_moScheduled && _moQueue.length) {
        _moScheduled = true;
        // 专项#切屏崩溃修复：后台标签页 rAF 被浏览器完全暂停、永不触发 flush，而页面在隐藏期仍高频 mutate
        // （心跳/进度刷新）→ _moQueue 无限增长并持引用阻止 GC，30min+ 后渲染进程 OOM 致整页崩溃。
        // 故隐藏时改用 setTimeout：后台仍会（节流）触发并排空队列；可见时保留 rAF 帧合并以省主线程。
        // v4.19.20：句柄保存（_moFlushTimer/_moFlushRaf），卸载时由 lifecycle 清理。
        if (document.hidden) {
          _moFlushTimer = setTimeout(function () { _moFlushTimer = null; _moFlush(); }, 200);
        } else if (typeof requestAnimationFrame === 'function') {
          _moFlushRaf = requestAnimationFrame(function () { _moFlushRaf = null; _moFlush(); });
        } else {
          _moFlushTimer = setTimeout(function () { _moFlushTimer = null; _moFlush(); }, 16);
        }
      }
    });
    _mo.observe(document.documentElement, { childList: true, subtree: true });
  }, 'mo.create');

  // 切回标签页时强制续播
  function visibilityHandler() {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    if (!CoreState.canRun()) return;
    if (DEBUG) { safeCall(function () { _memSample('vis:' + document.visibilityState); }, 'vis:mem'); }   // 切屏前后各采一次，直接对比后台增长（评审#11：safeCall 收口）
    if (document.visibilityState === 'visible') {
      safeCall(function () { scanVideos(document); }, 'vis:scan');
      safeCall(function () { neutralizeGlobalPause(window); }, 'vis:neutralize');   // 切回时一并中和 全局暂停封装，防平台在隐藏期重置（吸收评审#5）（评审#11：safeCall 收口）
      _domDirty = true;   // P0 脏检查：切回可见后强制下一 tick 全量重扫(捕获隐藏期 DOM/视频变化)
    }
  }
  bestEffort(function () {
    document.addEventListener('visibilitychange', visibilityHandler, true);   // 捕获阶段，但绝不 stopPropagation
  }, 'dom.visibility');

  // v4.19.38 诊断：MO 活动统计快照（瞬时队列 + 累计入队/排空/批次 + 最近活动时间）。
  // 诊断「视频总数」行的 moQueue 恒 0 属正常（瞬态队列排空即接管 / 静态视频不触发 MO），
  // 本出口让 MO 是否活跃可验证——v4.19.40 起以「批次」为活跃主指标（静态页入队恒 0 但批次持续增长）。
  bestEffort(function () {
    window.__CX_FORCE_PLAY._moStats = function () {
      return {
        queue: _moQueue.length, scheduled: _moScheduled,
        pushes: _moPushes, flushes: _moFlushes, batches: _moBatches,
        lastPushMs: _moLastPushAt ? Date.now() - _moLastPushAt : -1,
        lastFlushMs: _moLastFlushAt ? Date.now() - _moLastFlushAt : -1,
        lastBatchMs: _moLastBatchAt ? Date.now() - _moLastBatchAt : -1,
        mounted: !!_mo
      };
    };
  }, 'dom.export.moStats');

  // 【内聚性收敛】卸载还原（_ananasNeutralized / _playWatchDocs / cleanupListeners / pagehide 钩子 / uninstall 导出）
  //   已迁至 takeover/dom/lifecycle.js —— 接管引擎负责「加 Hook」，lifecycle 负责「拆 Hook」，职责相反故分离。


