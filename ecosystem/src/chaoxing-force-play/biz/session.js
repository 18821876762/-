  // ===== DOMAIN: biz session =====
  // ===== MODULE: 观看会话（用户暂停/恢复 + 计时器） =====
  // 域：业务层 —— 「用户意图」与「观看时长」的会话状态管理。
  //
  // 【内聚性收敛】本块原寄居于 dom/dom.js，与 overrideVideo/walkVideos（DOM 接管）混居。
  // 但二者层次不同：接管引擎表达的是「脚本要让视频一直播」，本模块表达的是「用户/计时器要它停」——
  // 后者是前者的**覆盖层**（通过 FLAGS.userPaused 令接管引擎的 _ovUserPaused 提前 return）。
  // 把「用户意图」从「DOM 接管机制」里剥离出来，二者的优先级关系才显式可读。
  //
  // 【职责边界】
  //   userPause / userResume  —— 用户显式意图的写入口（含播放闸门 defineProperty）
  //   autoStopTick            —— 观看计时累计 + 满 AUTO_STOP_MIN 自动暂停
  //   resumeTick              —— 到点自动恢复
  // 三者共同维护 FLAGS.userPaused / cxState(v).{userKeep,resumeAt,watchMs} 这组会话状态。
  //
  // 依赖（均为顶层 var/function，同一 IIFE 闭包，运行时求值，不受拼接顺序影响）：
  //   allVideos / foregroundVideo（视频枚举与前台判定）、safePlay（biz/playback）、
  //   NATIVE_PAUSE / NATIVE_PLAY（config）、ENDED_SRCS（biz/dedup）、recordWatchMs（biz/stats）、
  //   urlParam / topHref（utils/url）、Store（state）。

  function userPause(v) {                         // 用户暂停：真正停住并置锁；按 RESUME_AFTER_MIN 排自动恢复
    if (!v) return;
    v[FLAGS.userPaused] = true;
    cxState(v).userKeep = false;                       // 用户主动暂停即取消"保留播放"标记（门控可重新管理该视频）
    try { (v[FLAGS.np] ? v[FLAGS.np] : NATIVE_PAUSE || v.pause).call(v); } catch (e) { swallow(e); }   // 原生 pause 真正停住（绕过原型/实例 noop）
    // 播放闸门：脚本此前只拦"暂停"从不拦"播放"，平台播放器自调 video.play() 会把用户暂停的视频拉回播放
    //（实测诊断：状态 playing 而 UserPaused=true 的矛盾态）。在实例上遮蔽 play：用户暂停期间一律拒绝。
    try {
      Object.defineProperty(v, 'play', { configurable: true, writable: true, value: function () {
        if (this[FLAGS.userPaused]) { dbg('播放闸门：用户暂停中，拒绝 play()'); return Promise.resolve(); }
        return NATIVE_PLAY ? NATIVE_PLAY.apply(this, arguments) : Promise.resolve();
      } });
    } catch (eG) { swallow(eG); }
    if (CONFIG.RESUME_AFTER_MIN > 0) cxState(v).resumeAt = Date.now() + CONFIG.RESUME_AFTER_MIN * 60000;
    try { Store.emit('ui:toast', '已暂停续播（手动/计时）', 'success'); } catch (e2) { swallow(e2); }
  }

  function userResume(v) {                        // 用户恢复：清锁并续播
    if (!v) return;
    v[FLAGS.userPaused] = false;
    if (v !== foregroundVideo()) cxState(v).userKeep = true;   // 用户对非前台视频显式恢复：打保留标记，门控不再误回收（修复"其他视频无法开启"）
    cxState(v).resumeAt = 0;
    cxState(v).watchMs = 0;                            // 重置自动停止计时，避免恢复后立刻再停
    // 修复复审（低-中危）：恢复续播应能重看已播完视频——清 ended 锁并解除全局黑名单，否则下一轮 overrideVideo 又把 play 设回 no-op 锁死
    if (v[FLAGS.endedLock]) {
      v[FLAGS.endedLock] = false;
      try { if (v.duration && isFinite(v.duration) && v.currentTime > 0) v.currentTime = 0; } catch (e) { swallow(e); }   // 从头重看
      try { delete ENDED_SRCS[videoSrcOf(v)]; } catch (e) { swallow(e); }                                          // 解除本视频地址黑名单
      try { var _hsg = cxState(v).hostSigs; if (_hsg) { for (var _hg = 0; _hg < _hsg.length; _hg++) { try { delete ENDED_SRCS[_hsg[_hg]]; } catch (e2) { swallow(e2); } } } } catch (e) { swallow(e); }
    }
    try { delete v.play; } catch (e3) { swallow(e3); }          // 拆除播放闸门，还原原型 play
    try { safePlay(v); } catch (e) { swallow(e); }
    try { Store.emit('ui:toast', '已恢复续播', 'success'); } catch (e2) { swallow(e2); }
  }

  var _lastWatchTick = Date.now();                // 上次计时采样点（真实墙钟差值，后台节流/休眠也不会多算或少算）
  function autoStopTick() {                       // 观看计时（始终累计，供面板"已看"显示）+ 满 AUTO_STOP_MIN 分钟自动暂停
    var now = Date.now();
    var dt = now - _lastWatchTick; _lastWatchTick = now;
    if (dt < 0 || dt > 60000) dt = CONFIG.RESCAN_INTERVAL;   // 防休眠唤醒/时钟回拨造成的大跳
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try {
      var v = vs[i];
      if (v[FLAGS.userPaused] || v.ended) continue;
      if (!v.paused && v.readyState >= 2) {
        cxState(v).watchMs = (cxState(v).watchMs || 0) + dt;
        recordWatchMs(videoSrcOf(v), dt, urlParam(topHref(), ['courseId']));  // 进度同步·本地估算：按课程累计已看时长
        if (CONFIG.AUTO_STOP_MIN > 0 && cxState(v).watchMs >= CONFIG.AUTO_STOP_MIN * 60000) userPause(v);
      }
    } catch (e) { swallow(e); } }
  }

  function resumeTick() {                         // 暂停后自动恢复：到 __cxResumeAt 时间则自动续播
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try {
      var v = vs[i];
      if (v[FLAGS.userPaused] && cxState(v).resumeAt && Date.now() >= cxState(v).resumeAt) userResume(v);
    } catch (e) { swallow(e); } }
  }
