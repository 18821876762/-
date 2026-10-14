// @requires: CONFIG, CX_KEYS, EventBus, _quizAIFailed, _quizAIPending, _quizAIProblems, _quizDirtyGen, _quizDsGraceUntil, _quizFillItems, _quizHandled, _quizInfoMissing, _quizInvalidateAsync, _quizLastAnswered, _quizLastHadQuestions, _quizLastQuestions, _quizLastScanned, _quizLastTickErr, _quizLightFp, _quizLights, _quizMOForced, _quizManualHold, _quizPageSubmitted, _quizPendingSubmit, _quizRemoteOrder, _quizRemoteState, _quizRetryTimer, _quizReviewItems, _quizSettled, _quizSkipCounts, _quizSyncLights, _quizVisGen, _quizVisTimers, bestEffort, dbg, detectSite, quizScanOnce, quizTick, safeGet
// @source-group: takeover/engine/quiz.js
// 职责：配置初始化、完整重置与公共入口挂载；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 配置默认值注入（CONFIG 可能尚未含这些字段，安全补默认值）
  bestEffort(function () {
    if (typeof CONFIG !== 'undefined') {
      // 从 localStorage 读取用户持久化配置（由面板「用 DeepSeek 作答」开关写入），覆盖默认值，刷新后保持
      var _lsGet = function (k, d) { return safeGet(function () { var v = localStorage.getItem(k); return v == null ? d : v; }, d); };
      var _lsBool = function (k, d) { var v = _lsGet(k, null); if (v === null) return d; return v === '1' || v === 'true'; };
      if (CONFIG.QUIZ_ANSWER_SOURCE == null) CONFIG.QUIZ_ANSWER_SOURCE = 'random';
      if (CONFIG.QUIZ_AI_ENDPOINT == null) CONFIG.QUIZ_AI_ENDPOINT = '';
      // rev3 抗题目文本混淆（视觉识别）配置默认值
      if (CONFIG.QUIZ_VISION_ENABLED == null) CONFIG.QUIZ_VISION_ENABLED = _lsBool(CX_KEYS.VISION_ENABLED, false);
      if (CONFIG.QUIZ_VISION_OCR == null) CONFIG.QUIZ_VISION_OCR = _lsGet(CX_KEYS.VISION_OCR, 'endpoint');
      if (CONFIG.QUIZ_VISION_ENDPOINT == null) CONFIG.QUIZ_VISION_ENDPOINT = _lsGet(CX_KEYS.VISION_ENDPOINT, '');
      if (CONFIG.QUIZ_OCR_LANG == null) CONFIG.QUIZ_OCR_LANG = _lsGet(CX_KEYS.VISION_OCR_LANG, 'chi_sim');
      if (CONFIG.QUIZ_VISION_TIMEOUT == null) CONFIG.QUIZ_VISION_TIMEOUT = 60000;
      if (CONFIG.QUIZ_VISION_PRIVACY_OK == null) CONFIG.QUIZ_VISION_PRIVACY_OK = _lsBool(CX_KEYS.VISION_PRIVACY, false);
      // 自定义 html2canvas 地址（自建/本地可访问）：当所有公共 CDN 均被浏览器按域名拦截时的兜底入口
      if (CONFIG.QUIZ_VISION_H2C_URL == null) CONFIG.QUIZ_VISION_H2C_URL = _lsGet(CX_KEYS.VISION_H2C_URL, '');
      if (CONFIG.QUIZ_VISION_USE_API_KEY == null) CONFIG.QUIZ_VISION_USE_API_KEY = _lsBool(CX_KEYS.VISION_USE_API_KEY, false);
      if (CONFIG.QUIZ_VISION_API_MODEL == null) CONFIG.QUIZ_VISION_API_MODEL = _lsGet(CX_KEYS.VISION_API_MODEL, 'deepseek-chat');
      // 隐私合规 / 提交控制默认值
      if (CONFIG.QUIZ_OFFLINE_ONLY == null) CONFIG.QUIZ_OFFLINE_ONLY = true;
      if (CONFIG.QUIZ_ENDPOINT_WHITELIST == null) CONFIG.QUIZ_ENDPOINT_WHITELIST = [];
      if (CONFIG.QUIZ_AI_WAIT == null) CONFIG.QUIZ_AI_WAIT = 20000;
      if (CONFIG.QUIZ_AUTO_SUBMIT == null) CONFIG.QUIZ_AUTO_SUBMIT = true;
    }
  }, 'quiz.configDefaults');

  // v4.19.33·出清系统升级：等同「刷新网页」的完整重置。
  // 刷新网页 = 脚本模块重新加载 → 所有运行时内存变量回到初始值；localStorage 用户配置(cx_*) 保留
  // （config-ls 桶受保护、绝不在出清范围；刷新网页同样不会删除配置）。
  // 旧 quizCacheEvict 仅清部分答题态，残留 _quizRemoteState/_quizSkipCounts/_quizRetryTimer/quizStats 计数等，
  // 导致「已出清」后仍沿用上一时段残留态（如跨帧陈旧灯、跳过计数、待答重扫定时器），不等同刷新。
  // 现升级为全量运行时归零：清零所有自动答题相关内存变量 + 重置 quizStats + 重设 DS 计数，但绝不碰用户配置。
  function quizHardReset(reason) {
    reason = reason || 'manual';
    function _cnt(o) { try { return (o && typeof o === 'object') ? Object.keys(o).length : 0; } catch (e) { return 0; } }
    var _cleared = _cnt(_quizHandled) + _cnt(_quizAIPending) + _cnt(_quizAIProblems) + _cnt(_quizAIFailed)
      + _cnt(_quizAiDiag) + _cnt(_quizPendingSubmit) + _cnt(_quizFillItems) + _cnt(_quizReviewItems) + _cnt(_quizInfoMissing)
      + _cnt(_quizLightFp) + _cnt(_quizLights) + _cnt(_quizRemoteState);
    _quizInvalidateAsync(reason);
    bestEffort(function () {
      // 在途定时器先清再删（视觉超时 / 子帧待答重扫），避免出清后残留定时器仍触发点选/回写
      for (var _vk in _quizVisTimers) { if (_quizVisTimers.hasOwnProperty(_vk)) { try { clearTimeout(_quizVisTimers[_vk]); } catch (e) {} } }
      if (_quizRetryTimer) {
        try { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry) window.__CX_FORCE_PLAY.TimerRegistry.clearInterval(_quizRetryTimer); } catch (e) {}
        try { clearTimeout(_quizRetryTimer); } catch (e) {}
        _quizRetryTimer = null;
      }
      // —— 运行时内存状态全量归零（等同刷新网页的 JS 变量初值）——
      _quizVisTimers = {};
      _quizVisGen = {};   // 仅清索引；会话epoch和请求序号始终单调
      _quizSettled = {}; _quizLastQuestions = [];
      _quizHandled = {}; _quizAIPending = {}; _quizAIProblems = {}; _quizAIFailed = {};
      _quizPendingSubmit = {}; _quizReviewItems = {}; _quizFillItems = {}; _quizInfoMissing = {};
      _quizLightFp = {};
      // 以下两处经 window.__CX_FORCE_PLAY 以「引用」方式导出(quizLights/quizAiDiag)，必须就地清空而非重新赋值，
      // 否则面板/sim 持有的旧引用会悬空、看不到重置后的空态（等同刷新后灯/诊断应即时归零）。
      _quizAiDiag = _quizAiDiag || {}; for (var _ak in _quizAiDiag) { if (Object.prototype.hasOwnProperty.call(_quizAiDiag, _ak)) delete _quizAiDiag[_ak]; }
      _quizLights.length = 0;
      _quizDsGraceUntil = 0;        // DS 通道宽限清零（新时段重新建立）
      _quizManualArmed = false;     // 一次性「手动开始」置位清零
      _quizManualHold = false;      // 运行时派生量：每次 quizTick 开头按 localStorage.cx_quiz_auto_start 重算（刷新后首 tick 即恢复用户开关语义）
      _quizDetectedNotified = false; _quizDoneNotified = false; _quizDisabledNotified = false; _quizSeqWarnNotified = false;  // 通知节流复位（刷新后首 tick 可重新播报）
      _quizLastActivityTs = 0;
      _quizLastHadQuestions = false; _quizLastScanAt = 0;   // 无题稳态节流复位
      _quizDirtyGen = 0; _quizFpCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null; _quizTickCount = 0;  // 指纹缓存代际复位（刷新后重新累计）
      _quizStemCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
      _quizRemoteState = {}; _quizRemoteOrder = []; _quizRemoteTick = null;  // 跨帧灯/遥测快照复位（刷新后各帧重新上报）
      _quizSkipCounts = {};          // 跳过原因计数复位
      _quizLastScanned = 0; _quizLastAnswered = 0; _quizLastTickErr = '';   // 本帧 tick 遥测复位
      _quizLightsSigLast = ''; _quizLightsGmSig = '';  // 跨帧/跨页灯广播去重签名复位（刷新后重新广播）
      _quizPopupOff = false;         // 弹窗开关标记复位（quizTick 开头按 localStorage 重算）
      // quizStats 计数归零（刷新后首 tick 会重新累计；保留 lastEvict 供诊断）
      if (window.__CX_FORCE_PLAY) {
        window.__CX_FORCE_PLAY.quizStats = {
          scanned: 0, answered: 0, done: 0, remaining: 0, maxSeq: 0,
          settled: 0, unsettled: 0, pendingSubmit: 0, reviewCount: 0, pendingAI: 0, doneAll: false,
          lastEvict: { reason: reason, ts: Date.now(), cleared: _cleared }
        };
      }
      // DS 应答端累计发起计数归零（视觉模块重装即 0；此处等同刷新）
      if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.__resetDsAskTryCount === 'function') {
        try { window.__CX_FORCE_PLAY.__resetDsAskTryCount(); } catch (e) {}
      }
      // 注意：localStorage 用户配置(cx_*) 受保护、绝不删除（刷新网页同样不删配置）。
    }, 'quiz.hardReset');
    // 仅在确有缓存被清时才提示，避免空出清(每 2s 评估)刷屏
    if (_cleared > 0) {
      bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('ui:toast', '♻ 已重置自动答题状态（等同刷新网页，原因：' + reason + '，清除 ' + _cleared + ' 项）'); }, 'quiz.hardReset.toast');
    }
    // 刷新面板信号灯（缓存已空 → 全黑/无）
    bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('quiz:lights'); }, 'quiz.hardReset.emitLights');
    dbg('quizHardReset reason=' + reason + ' cleared=' + _cleared);
    return _cleared;
  }
  // 兼容别名：main-loop.js 与旧调用方经 quizCacheEvict 出清，现统一走 quizHardReset（完整重置）
  function quizCacheEvict(reason) { return quizHardReset(reason); }

  _quizInstallEvictGM();   // v4.19.50：加载即挂视频播放出清 GM 监听（每帧独立，响应跨页通知）
  _quizInstallCancellation();
  bestEffort(function () { window.__CX_FORCE_PLAY.quizTick = quizTick; }, 'quiz.export.tick');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizObserve = quizObserve; }, 'quiz.export.observe');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizScanOnce = quizScanOnce; }, 'quiz.export.scanOnce');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizDisconnect = quizDisconnect; }, 'quiz.export.disconnect');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizSubmitPending = quizSubmitPending; }, 'quiz.export.submitPending');
  // 导出检测钩子供回归测试直接断言「已提交」判定（避免依赖灯态间接推断）；与 __dsEnsureChannel 同惯例。
  bestEffort(function () { window.__CX_FORCE_PLAY.quizPageSubmitted = _quizPageSubmitted; }, 'quiz.export.pageSubmitted');
  // v4.19.22：手动提交（面板「⏺ 手动提交」按钮；含跨帧下发，题目在 iframe 内也生效）
  bestEffort(function () { window.__CX_FORCE_PLAY.quizManualSubmit = quizManualSubmit; }, 'quiz.export.manualSubmit');
  // v4.19.36 诊断：答题调度器状态快照（重扫定时器/MO/宽限/待确认/待复核/灯数）
  bestEffort(function () {
    window.__CX_FORCE_PLAY._quizSchedStats = function () {
      return {
        retryTimer: !!_quizRetryTimer, moForced: !!_quizMOForced, moMounted: !!_quizObserver,
        graceUntilMs: _quizDsGraceUntil ? Math.max(0, _quizDsGraceUntil - Date.now()) : 0,
        pendingSubmit: Object.keys(_quizPendingSubmit).length,
        reviewCount: (typeof _quizReviewItems !== 'undefined') ? Object.keys(_quizReviewItems).length : 0,
        handledCount: Object.keys(_quizHandled).length, lights: _quizLights.length
      };
    };
  }, 'quiz.export.schedStats');
  // v4.19.33·出清系统：暴露「等同刷新网页的完整重置」入口（主循环自动调用 / 命令 /evict 手动调用 / 回归直接断言）
  bestEffort(function () { window.__CX_FORCE_PLAY.quizCacheEvict = quizCacheEvict; }, 'quiz.export.cacheEvict');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizHardReset = quizHardReset; }, 'quiz.export.hardReset');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizSyncGate = quizSyncGate; }, 'quiz.export.syncGate');
  bestEffort(function () { window.__CX_FORCE_PLAY._quizVisConfAction = _quizVisConfAction; }, 'quiz.export.confAction');   // v4.19.32·置信→行为映射（sim 验证）
  // v4.19.30·统一数据治理：注册 quiz-cache session 桶（委托 quizHardReset，v4.19.33 起等同刷新网页的运行时归零）。
  // 使 main-loop/命令/诊断能从统一注册表一处出清与查看答题缓存，而非各自调用 quizCacheEvict。
  bestEffort(function () {
    if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.dataGovernance && typeof window.__CX_FORCE_PLAY.dataGovernance.registerBucket === 'function') {
      window.__CX_FORCE_PLAY.dataGovernance.registerBucket({
        id: 'quiz-cache', category: 'session', desc: '自动答题运行时(已答去重/在途题解/失败/信号灯/DS宽限/跨帧遥测/跳过计数)',
        size: function () {
          function _c(o) { try { return (o && typeof o === 'object') ? Object.keys(o).length : 0; } catch (e) { return 0; } }
          return _c(_quizHandled) + _c(_quizAIPending) + _c(_quizAIProblems) + _c(_quizAIFailed) + _c(_quizAiDiag) + _c(_quizPendingSubmit) + _c(_quizReviewItems) + _c(_quizInfoMissing) + _c(_quizLightFp) + (_quizLights ? _quizLights.length : 0) + _c(_quizRemoteState) + _c(_quizSkipCounts);
        },
        evict: function (reason) { quizHardReset(reason); }
      });
    }
  }, 'quiz.dataGov.register');
  // 需求·自动答题控制 + 信号灯导出：
  //   quizManualStart —— 手动开始答题（置位后立即强制作答一次；自动启动开时同效幂等）
  //   quizLights      —— 信号灯数组 [{seq, fp, state}]（红=fail 绿=done 黄=busy 黑=idle），面板渲染只读
  //   quizAutoStartOn —— 自动启动开关当前值（面板同步用）
  bestEffort(function () {
    window.__CX_FORCE_PLAY.quizManualStart = function () {
      _quizManualArmed = true;
      // 修复·手动开始路由：与 quizObserveDispatch 同源——经 runSiteTick 走站点专属 tick
      // （chaoxing→quizTick(CHAOXING_EXAM)）。旧实现裸 quizTick() 用通用 QUIZ 选择器
      // （不含 div.TiMu），超星页扫不到任何题 → 手动开始无效（实测 sim S6）。
      var _msF = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.runSiteTick === 'function') ? window.__CX_FORCE_PLAY.runSiteTick : null;
      if (_msF) bestEffort(function () { _msF(detectSite()); }, 'quiz.manualStart.siteTick');
      else quizTick();
      _quizSyncLights();
    };
    window.__CX_FORCE_PLAY.quizLights = _quizLights;
    window.__CX_FORCE_PLAY.quizAutoStartOn = _quizAutoStartOn;
    window.__CX_FORCE_PLAY.quizAiDiag = _quizAiDiag;               // v4.19.14：逐题 AI 作答诊断明细（题型/选项数/DeepSeek 回传/解析原因/结果）
    window.__CX_FORCE_PLAY._quizAnswerParse = _quizAnswerParse;   // v4.19.14 测试钩子：答案解析原因分类（诊断根因定位）回归
  }, 'quiz.export.manualStart');
