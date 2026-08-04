  // ===== DOMAIN: biz/playback (playback primitives / takeover helpers) =====
  // 覆盖后的 pause：平台任何暂停指令都被忽略（no-op）
  var pauseNoop = function () { return; };

  // 安全 play：兼容浏览器自动播放策略拒绝（先静音再播，Edge 友好）
  // 安全 play：兼容浏览器自动播放策略拒绝。按原始 muted 状态尝试；被拒则静音重试一次，成功后恢复用户预期音量。
  function safePlay(v) {
    try {
      var wasMuted = v.muted;                        // 记录原始静音状态，避免脚本误静音破坏用户音量预期
      var restored = false;
      function restore() {                           // 等视频真正开始出声(playing)后再恢复音量，避免提前取消静音（吸收评审#H）
        if (restored) return; restored = true;
        try { if (!wasMuted) v.muted = false; } catch (e) { swallow(e); }
      }
      // 手动实现 once 语义：老浏览器（Safari<10/IE）静默忽略 {once:true} 选项会导致监听器永久累积泄漏（吸收评审#H），
      // 故显式 removeEventListener 兜底，确保无论浏览器是否支持 once 选项都能在首次 playing 后自移除。
      // 【易误判·诊断#五】无需加去重标志：自移除保证 playing 触发即退订；仅"自动播放彻底被禁且永不 playing"的病理场景才暂存，可接受。
      try {
        var _cxOnPlaying = function () { try { v.removeEventListener('playing', _cxOnPlaying); } catch (e) { swallow(e); } _safePlaySuccesses++; restore(); };
        v.addEventListener('playing', _cxOnPlaying);
      } catch (e) { swallow(e); }
      _safePlayAttempts++;
      _bxLog('safePlay', 'src=' + (videoSrcOf(v) || '?').slice(-40) + ' muted=' + wasMuted);
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(restore).catch(function () {          // 自动播放策略拒绝 → 静音重试
          try {
            v.muted = true;
            var p2 = v.play();
            if (p2 && typeof p2.then === 'function') p2.then(restore).catch(function () {});
          } catch (e) { swallow(e); }
        });
      }
    } catch (e) { swallow(e); }                                    // 静默：浏览器限制，非脚本问题
  }
  // F-B1 修复：定向模式下被"跳过"的视频，若此前已在全量续播阶段被本脚本接管
  // （siteAttachments() / 桥 objectids 晚于首扫到达），必须撤销接管交还平台；否则广告/插播视频会
  // 残留 v.pause=pauseNoop、__cxForcePaused=true，被永久强制续播且用户无法暂停，与"定向跳过"目标直接相悖。
  // 仅撤销"续播接管"，保留 __cxEndedLock / 重建去重（已结束任务不应被释放重播）。
  function releaseVideo(v) {
    if (!v || (!v.__cxForcePaused && !cxState(v).released)) return;   // 未接管或已释放则跳过（幂等）
    try { v.pause = v.__np || NATIVE_PAUSE; } catch (e) { swallow(e); }       // 恢复实例级原生 pause（绕过原型 no-op），用户/平台可正常暂停
    v.__cxForcePaused = false;                                   // 关闭原型 pause 的 no-op 拦截
    cxState(v).released = true;                                       // 标记已释放：续播兜底监听(pause/canplay/waiting/stalled)不再自动续播
    // 保留 v.__cx=true：避免重复挂载监听；若后续重新归属任务点，由 overrideVideo 再断言路径重新接管（见下）
  }

  // 覆盖单个视频：pause 变 no-op + ended→重播阻断 + ratechange 仅 rate<=0.01 拉回 1x + 状态兜底续播。
  // 关键：所有续播路径都检查 v.__cxAN_hold —— 当 auto-next 因插播题锁定时，无条件避让。
  // 【易误判·诊断#四】本函数刻意不分拆：强顺序状态机，共享 safePlay / v.__np / __cxEndedLock 等闭包状态，
  //   拆子函数需提升大量状态→回归风险高（v3.10 #10/#11 已判不拆）。可读性换正确性不划算，勿以"函数过长"为由拆分。
  // 进度到底判定：距结尾 END_RELEASE_SEC 内（且未真正 ended）即视为"进度到底"。
  // ended 状态不在此处理——交给下方 ended 锁分支防重播，避免在到底处提前释放破坏防重播。
  function nearEnd(v) {
    try {
      if (v.ended) return false;
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - CONFIG.END_RELEASE_SEC) return true;
    } catch (e) { swallow(e); }
    return false;
  }
