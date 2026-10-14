// @provides: _loopTicks, _loopTimer
// @requires: BRIDGE, CONFIG, CoreState, ENDED_SRCS, EventBus, TARGET, bestEffort, detectSite, isEffectiveTopFrame, markDomDirty, quizScanOnce, quizTick, reconcileIntrusionMode, savePanelCfg, singleVideoActive, videoDriftStableKeys
// @source-group: takeover/bootstrap/main-loop.js
  var _loopTimer = null;
  var _loopTicks = 0, _loopLastTick = 0;   // 诊断#七：主循环健康遥测（已运行轮次 + 上次 tick 时间），供诊断一处查看续播调度是否仍在跑
  var _loopTickDeltas = [];                 // v4.19.45：主循环 tick 间隔历史（环形 30，供诊断算 jitter/RMS 偏差）
  var _vidScanTick = 0;                     // 状态机优化(卡顿排查·主循环调度)：播放活动稳态的全量扫描降频计数（每 2 轮一次）
  // P0-3 后台标签页降频：隐藏时主循环间隔 ×4(封顶 30s)，可见时恢复 CONFIG.RESCAN_INTERVAL。
  // 隐藏页无视觉需求且 MO 已用 setTimeout 兜底排空新视频队列；降频显著降低后台 CPU/内存(专项#切屏崩溃)。
  // 单一重启入口：面板/命令改 RESCAN_INTERVAL 时也经此(见 panel-core/commands)，每次先 clear 再 set，杜绝双定时器。
  // P1：主循环定时器经 TimerRegistry 登记(owner 'main-loop')，uninstall 时一次性 clearAll() 兜底，杜绝散落定时器泄漏。
  function restartLoopTimer() {
    bestEffort(function () {
      if (!CoreState.canRun()) { stopLoopTimer(); return; }
      // v4.19.49：DeepSeek 应答端页不启动主循环定时器——tick 体对 deepseek 站点本就短路 return，
      // 定时器纯空转（后台节流 ×4 还制造 8s tick 抖动噪音），responder 由 ds-ask 事件驱动不依赖 tick。
      if (typeof detectSite === 'function' && detectSite() === 'deepseek') return;
      if (_loopTimer) { try { window.__CX_FORCE_PLAY.TimerRegistry.clearInterval(_loopTimer); } catch (e) {} }
      var _iv = CONFIG.RESCAN_INTERVAL;
      if (document.hidden) _iv = Math.min(_iv * 4, 30000);
      _loopTimer = window.__CX_FORCE_PLAY.TimerRegistry.setInterval(_loopTick, _iv, 'main-loop');
      EventBus.state._loopTimer = _loopTimer;
    }, 'loop.restartTimer');
  }
  window.__CX_FORCE_PLAY.restartLoopTimer = restartLoopTimer;   // P1：暴露给 commands/panel-core 跨模块重启主循环（消除裸 setInterval 双定时器 bug）
  // 安全停机配套：停止主循环（safety.js 检测到验证码/风控验证时调用）。
  // 只 clear 不重设，与 restartLoopTimer 共用同一「单一重启入口」约定，杜绝双定时器。
  function stopLoopTimer() {
    bestEffort(function () {
      if (_loopTimer) {
        try { window.__CX_FORCE_PLAY.TimerRegistry.clearInterval(_loopTimer); } catch (e) { /* ignore */ }
        _loopTimer = null;
      }
      EventBus.state._loopTimer = null;
    }, 'loop.stopTimer');
  }
  window.__CX_FORCE_PLAY.stopLoopTimer = stopLoopTimer;
  // 接管开关命名空间 API（面板 / 脚本可调用）
  window.__CX_FORCE_PLAY.setTakeoverEnabled = function (on) {
    CONFIG.ENABLED = !!on;
    bestEffort(function () { if (typeof savePanelCfg === 'function') savePanelCfg(); }, 'ns.setEnabled');
    applyTakeoverNow();
  };
  window.__CX_FORCE_PLAY.toggleCourseTakeover = function (cid) {
    cid = cid || _currentCourseId();
    if (!cid) return false;
    var list = CONFIG.DISABLED_COURSES || [];
    var i = list.indexOf(cid);
    if (i === -1) list.push(cid); else list.splice(i, 1);
    CONFIG.DISABLED_COURSES = list;
    bestEffort(function () { if (typeof savePanelCfg === 'function') savePanelCfg(); }, 'ns.toggleCourse');
    applyTakeoverNow();
    return i === -1; // true=已加入黑名单（停用）
  };
  window.__CX_FORCE_PLAY.isTakeoverActive = takeoverActive;
  window.__CX_FORCE_PLAY.listDisabledCourses = function () { return (CONFIG.DISABLED_COURSES || []).slice(); };
  window.__CX_FORCE_PLAY.applyTakeoverNow = applyTakeoverNow;
  window.__CX_FORCE_PLAY.singleVideoActive = singleVideoActive;
  window.__CX_FORCE_PLAY.toggleCourseSingleVideo = function (cid) {
    cid = cid || _currentCourseId();
    if (!cid) return false;
    var list = CONFIG.SINGLE_VIDEO_COURSES || [];
    var i = list.indexOf(cid);
    if (i === -1) list.push(cid); else list.splice(i, 1);
    CONFIG.SINGLE_VIDEO_COURSES = list;
    bestEffort(function () { if (typeof savePanelCfg === 'function') savePanelCfg(); }, 'ns.toggleCourseSV');
    bestEffort(function () { if (typeof markDomDirty === 'function') markDomDirty(); }, 'ns.toggleCourseSV.dirty');
    return i === -1; // true=已加入（本门课强制单视频）
  };
  // 【架构·有效顶层帧编排】主循环只在「有效顶层帧」起一份（v4.19.18 起由 isEffectiveTopFrame 判定，兼容 LMS 跨域嵌入盲区）；
  // iframe 由 installPlayWatch/scanVideos 初扫/neutralizeGlobalPause/quizObserve 等
  // 轻量初始化(事件/MO 驱动)覆盖，不再各自起 2s 主循环 → 多帧页面每帧开销从 ×N 收敛为 ×1，消除「内存翻倍/加载变慢」放大器。
  // 有效顶层帧经 walkVideos 同源递归接管嵌套视频，故嵌套 iframe 内课程视频仍被周期接管/漂移守卫覆盖（见 isEffectiveTopFrame 注释）。
  bestEffort(function () {
    if (isEffectiveTopFrame()) restartLoopTimer();
  }, 'loop.setInterval');
  // 幂等性修复(审查 G-7)：具名函数 + cleanup 登记——旧实现为内联匿名函数，cleanupListeners 无法移除，
  // 手动 uninstall 后每次切前后台仍会经 restartLoopTimer 重新 setInterval 主循环（clearAll 之后复活孤儿定时器）。
  function visThrottleHandler() { restartLoopTimer(); }
  bestEffort(function () {
    if (isEffectiveTopFrame()) document.addEventListener('visibilitychange', visThrottleHandler, true);   // 切前/切后台均重启以套用降频(捕获阶段，绝不 stopPropagation)
  }, 'loop.visThrottle');

  // 真答题引擎：接入 MutationObserver，题目动态出现即触发作答（减少 2s 轮询空窗）
  bestEffort(function () {
    if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY)
      // D10 修复：MO 只驱动轻量 quizTick（题目动态出现即作答），不再触发整个 _loopTick——
      // 否则视频进度条高频 DOM 变更会把 2s 主循环放大到最快 300ms 全量扫描，长时挂机 CPU 占用与掉帧明显。
      // D10 修复补充：MO 驱动应使用当前站点已注册的正确 handler（runSiteTick→站点专属 tick，
      //   如 chaoxing→quizTick(CHAOXING_EXAM)、zhihuishu→zhihuishuExamTick），而非裸 quizTick() 默认通用 QUIZ 选择器。
      //   裸 quizTick() 不含 div.TiMu 等站点题块选择器 → 超星题在 MO 触发时扫不到，且可能用通用选择器误匹配非题块元素占坑。
      //   站点 handler 经注册表统一调度，保证与 2s 主循环同源、指纹一致，消除「动态题出现却漏答」窗口。
      window.__CX_FORCE_PLAY.quizObserveDispatch = function () { bestEffort(function () {
        // 接管关闭：不自动答题（MO 驱动路径）
        if (!takeoverActive()) return;
        var f = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.runSiteTick === 'function') ? window.__CX_FORCE_PLAY.runSiteTick : null;
        if (f) f(detectSite()); else quizTick();
      }, 'loop.quizObsDis'); };
  }, 'loop.quizObsDispatch');
  bestEffort(function () {
    if (typeof quizObserve === 'function') {
      // v4.19.20：1.2s 初始化定时器经 TimerRegistry 登记（owner 'main-loop'）——uninstall 后不再
      // 触发 quizObserve 重挂 MO/quizScanOnce 重扫（旧实现裸 setTimeout 卸载竞态残留）。
      var _qo = function () {
        bestEffort(function () {
          quizObserve(document.body || document.documentElement);
          // 修复·静态题检测兜底：MO 只对「挂载后新增」的节点触发，挂载前已静态渲染的题目
          // （学习通 iframe 作业页常见）永不触发 MO → 挂载后立即补扫一次。v4.19 前每帧
          // 2s 轮询覆盖此场景，现由一次性补扫对齐（详见 quiz.js quizScanOnce，零持续开销）。
          if (typeof quizScanOnce === 'function') bestEffort(function () { quizScanOnce(); }, 'loop.quizObserve.scanOnce');
        }, 'loop.quizObserve');
      };
      if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry && typeof window.__CX_FORCE_PLAY.TimerRegistry.setTimeout === 'function') {
        window.__CX_FORCE_PLAY.TimerRegistry.setTimeout(_qo, 1200, 'main-loop');
      } else {
        setTimeout(_qo, 1200);
      }
    }
  }, 'loop.quizObserveInit');

  // #1 温和/礼貌模式：全模块加载、站点识别(SITE)已就绪后，按 INTRUSION_MODE 收敛原型中性化装/卸。
  bestEffort(function () { if (typeof reconcileIntrusionMode === 'function') reconcileIntrusionMode(); }, 'loop.reconcile');

  EventBus.state.TARGET = TARGET;
  EventBus.state.BRIDGE = BRIDGE;
  EventBus.state.ENDED_SRCS = ENDED_SRCS;
  EventBus.state.videoDriftStableKeys = videoDriftStableKeys;   // v4.19.17 回归可测：漂移守卫稳定键（不依赖定向，跨 blob 重建存活）
  try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.videoDriftStableKeys = videoDriftStableKeys; } catch (e) {}
  EventBus.state.isEffectiveTopFrame = isEffectiveTopFrame;       // v4.19.18 回归可测：有效顶层帧判定（兼容 LMS 跨域嵌入盲区）
  try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.isEffectiveTopFrame = isEffectiveTopFrame; } catch (e) {}
  EventBus.state._watchStats = _watchStats;
  EventBus.state._loopTimer = _loopTimer;
  // 版本导出已移至 presentation/panel.js（SCRIPT_VERSION 定义处、最后加载域）——此处若提前拷贝会因 var 提升读到 undefined(见 panel.js 注释)，故不再赋值。
