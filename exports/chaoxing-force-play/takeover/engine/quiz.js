// @provides: QUIZ, _quizCanRun, _quizCancelForFp, _quizDirtyGen, _quizDsGraceUntil, _quizHandled, _quizInfoMissing, _quizInvalidateAsync, _quizLastHadQuestions, _quizLastQuestions, _quizLastTickErr, _quizLightFp, _quizLights, _quizManualHold, _quizQuestionSettled, _quizRefreshSettlementStats, _quizRemoteOrder, _quizRemoteState, _quizRetryTimer, _quizSettled, _quizSkipCounts
// @requires: CX_KEYS, CoreState, SAFETY, _quizAIPending, _quizPendingSubmit, _quizReviewItems, _quizSyncLights, _quizVisTimers, quizScanOnce, safeGet
// @source-group: takeover/engine/quiz.js
// 职责：请求生命周期与答题状态；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  // ===== DOMAIN: biz/quiz (站点无关·真答题引擎) =====
  // ===== MODULE: 作业/章节「真答题」引擎 —— 抓取题目+选项，经可插拔答案源求答案并回填 =====
  // 域：业务模块 —— 与站点无关；rev2 为「题目/作业重」的平台(人卫/Unipus/U校园/实验空间)提供真答题能力。
  //
  // 【与 popup-quiz 的区别】
  //   popup-quiz：上课弹窗干扰，「随机选一个→答题→删弹窗」，不关心对错（消干扰保续播）。
  //   quiz(本模块)：作业/章节题需「认真作答」——抓题干文本+选项，由答案源求答案再回填，追求正确率。
  //
  // 【答案源(可插拔)】—— 正确答案从哪来由答案源决定，脚本不凭空编造：
  //   ① 'random'  (默认兜底)：随机选一项。保证「不卡进度 / 不空题」，但无正确率 —— 用户未配置题库/AI 时的安全默认。
  //   ② 'bank'    (本地题库)：从 window.__CX_FORCE_PLAY.quizBank 或 localStorage(CX_KEYS.QUIZ_BANK) 读 {题干指纹: 答案} 映射做匹配；
  //                命中则回填正确项，未命中回退 random。题库格式由用户维护（见文档）。
  //   ③ 'ai'      (AI 接口，预留)：把题干+选项 POST 到 CONFIG.QUIZ_AI_ENDPOINT，取回答案索引回填；
  //                接口契约预留（请求/响应形态见下方 _quizAskAI），端点与密钥由用户配置，脚本不内置任何密钥。
  //   默认答案源 = CONFIG.QUIZ_ANSWER_SOURCE || 'random'；用户可于面板/配置切换。
  //
  // 【站点适配】各答题平台模块只需提供 selectors 同构映射 + 调用 quizTick(sel)；题目 DOM 结构各异，selector 待真实站点校准(标 TODO)。
  var QUIZ = {
    // 题目容器 / 题干 / 选项 / 提交 的候选选择器并集（best-effort，站点可覆盖）
    questionSels: ['.question-item', '.quiz-item', '.topic-item', '.exam-item', 'li[class*="question"]', '[class*="quiz-item"]', '.q-container'],
    stemSels: ['.stem', '.question-title', '.q-title', '.topic-title', '[class*="stem"]', '[class*="title"]'],
    optionSels: ['.option-item', '.q-option', '.choice-item', 'li[class*="option"]', '[class*="choice"]', '.answer-item'],
    submitSels: ['.submit-btn', '.answer-btn', 'button[class*="submit"]', '.confirm-btn', '.next-btn']
  };

  var _quizHandled = {};       // 已占用/已点选指纹（防重入；不代表已经结算）
  var _quizSettled = {};       // 已提交或已进入结果页；与占坑、待确认、待复核明确区分
  var _quizEpoch = 1;          // 本模块生命周期单调递增，出清绝不回到初值
  var _quizRequestSeq = 0;
  var _quizRequests = {};
  var _quizLastQuestions = [];
  var _quizGateLast = null;
  var _quizCancelSubscription = null, _quizResumeSubscription = null, _quizGateStorageHandler = null;
  function _quizCoreState() {
    if (typeof CoreState !== 'undefined' && CoreState) return CoreState;
    return (window && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.CoreState) || null;
  }
  function _quizCanRun() {
    if (!(window && window.__CX_FORCE_PLAY)) return false;
    var core = _quizCoreState();
    if (core && typeof core.canRun === 'function' && !core.canRun()) return false;
    if (typeof SAFETY !== 'undefined' && SAFETY.tripped) return false;
    return safeGet(function () { return typeof localStorage === 'undefined' || localStorage.getItem(CX_KEYS.QUIZ_AUTO) !== '0'; }, true);
  }
  function _quizRequestValid(req) {
    if (!req || req.cancelled || req.epoch !== _quizEpoch || _quizRequests[req.key] !== req || !_quizCanRun()) return false;
    if (req.owner !== window.__CX_FORCE_PLAY || req.href !== location.href) return false;
    if (req.autoStartRequired && !_quizAutoStartOn()) return false;
    if (req.qEl && typeof req.qEl.isConnected === 'boolean' && !req.qEl.isConnected) return false;
    var core = _quizCoreState();
    return !core || !req.token || typeof core.valid !== 'function' || core.valid(req.token);
  }
  function _quizClearRequestTimer(req) {
    if (!req) return;
    var timer = req.timer;
    if (timer != null) { clearTimeout(timer); req.timer = null; }
    if (req.kind === 'vision' && _quizVisTimers[req.fp] === timer) delete _quizVisTimers[req.fp];
  }
  function _quizFinishRequest(req) {
    if (!req) return;
    _quizClearRequestTimer(req);
    if (_quizRequests[req.key] === req) delete _quizRequests[req.key];
    if (req.unsubscribe) { req.unsubscribe(); req.unsubscribe = null; }
  }
  function _quizCancelRequest(req) {
    if (!req || req.cancelled) return;
    var owns = _quizRequests[req.key] === req;
    req.cancelled = true;
    if (req.abort) { try { req.abort.abort(); } catch (e) {} }
    _quizFinishRequest(req);
    if (owns && req.fp != null) {
      if (req.kind === 'text') delete _quizAIPending[req.fp];
      if (req.kind === 'vision' && !_quizSettled[req.fp]) delete _quizHandled[req.fp];
    }
  }
  function _quizNewRequest(kind, fp, qEl) {
    var key = kind + ':' + fp;
    if (_quizRequests[key]) _quizCancelRequest(_quizRequests[key]);
    var core = _quizCoreState();
    var req = { id: ++_quizRequestSeq, key: key, kind: kind, fp: fp, qEl: qEl || null,
      epoch: _quizEpoch, owner: window.__CX_FORCE_PLAY, href: location.href,
      token: core && typeof core.capture === 'function' ? core.capture('quiz') : null,
      timer: null, cancelled: false, unsubscribe: null,
      abort: typeof AbortController !== 'undefined' ? new AbortController() : null,
      autoStartRequired: kind !== 'confirm' && _quizAutoStartOn() };
    _quizRequests[key] = req;
    if (core && typeof core.onCancel === 'function') req.unsubscribe = core.onCancel('quiz', function () { _quizCancelRequest(req); _quizRefreshSettlementStats(); _quizSyncLights(); });
    return req;
  }
  function _quizCancelForFp(fp) {
    Object.keys(_quizRequests).forEach(function (key) { var req = _quizRequests[key]; if (req && req.fp === fp) _quizCancelRequest(req); });
  }
  function _quizInvalidateAsync(reason) {
    _quizEpoch++;
    Object.keys(_quizRequests).forEach(function (key) { _quizCancelRequest(_quizRequests[key]); });
    var core = _quizCoreState();
    if (core && typeof core.invalidateScope === 'function') core.invalidateScope('quiz', reason || 'reset');
  }
  function _quizCancelSchedulers() {
    var registry = window && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry;
    if (_quizRetryTimer != null) { if (registry) registry.clearInterval(_quizRetryTimer); else clearInterval(_quizRetryTimer); _quizRetryTimer = null; }
    if (_quizMOTimer != null) { if (registry) registry.clearTimeout(_quizMOTimer); else clearTimeout(_quizMOTimer); _quizMOTimer = null; _quizMOBusy = false; }
  }
  function quizSyncGate() {
    var next = { auto: safeGet(function () { return localStorage.getItem(CX_KEYS.QUIZ_AUTO) !== '0'; }, true), start: _quizAutoStartOn() };
    var was = _quizGateLast;
    _quizGateLast = next;
    if (was && ((was.auto && !next.auto) || (was.start && !next.start))) {
      _quizInvalidateAsync('quiz-disabled'); _quizCancelSchedulers(); _quizRefreshSettlementStats(); _quizSyncLights();
    } else if (was && ((!was.auto && next.auto) || (!was.start && next.start))) {
      quizScanOnce();
    }
    return next.auto && next.start;
  }
  function _quizInstallCancellation() {
    var core = _quizCoreState();
    if (core && typeof core.onCancel === 'function' && !_quizCancelSubscription) _quizCancelSubscription = core.onCancel('quiz', _quizCancelSchedulers);
    if (core && typeof core.onChange === 'function' && !_quizResumeSubscription) _quizResumeSubscription = core.onChange(function (view) {
      if (view && view.state === 'RUNNING') _quizSchedule(quizScanOnce, 0);
    });
    if (!_quizGateStorageHandler && window && typeof window.addEventListener === 'function') {
      _quizGateStorageHandler = function (event) { if (event.key === CX_KEYS.QUIZ_AUTO || event.key === CX_KEYS.QUIZ_AUTO_START) quizSyncGate(); };
      window.addEventListener('storage', _quizGateStorageHandler);
    }
    if (!_quizGateLast) _quizGateLast = { auto: safeGet(function () { return localStorage.getItem(CX_KEYS.QUIZ_AUTO) !== '0'; }, true), start: _quizAutoStartOn() };
  }
  function _quizSchedule(fn, ms) {
    var req = _quizNewRequest('confirm', 'timer-' + (_quizRequestSeq + 1));
    req.timer = setTimeout(function () { var valid = _quizRequestValid(req); _quizFinishRequest(req); if (valid) fn(); }, ms);
    return req.timer;
  }
  function _quizPendingAI() {
    return Object.keys(_quizRequests).filter(function (key) { var r = _quizRequests[key]; return r && !r.cancelled && (r.kind === 'text' || r.kind === 'vision'); }).length;
  }
  function _quizQuestionSettled(fp) {
    return !!_quizSettled[fp] && !_quizPendingSubmit[fp] && !_quizReviewItems[fp] && !_quizAIPending[fp] && !_quizRequests['vision:' + fp];
  }
  function _quizRefreshSettlementStats() {
    if (!(window && window.__CX_FORCE_PLAY)) return;
    var stats = window.__CX_FORCE_PLAY.quizStats || {};
    var done = 0;
    for (var i = 0; i < _quizLastQuestions.length; i++) if (_quizQuestionSettled(_quizLastQuestions[i].fp)) done++;
    stats.scanned = _quizLastQuestions.length;
    stats.done = stats.settled = done;
    stats.remaining = stats.unsettled = Math.max(0, stats.scanned - done);
    stats.pendingSubmit = Object.keys(_quizPendingSubmit).length;
    stats.reviewCount = Object.keys(_quizReviewItems).length;
    stats.pendingAI = _quizPendingAI();
    stats.doneAll = stats.scanned > 0 && stats.remaining === 0 && stats.pendingSubmit === 0 && stats.reviewCount === 0 && stats.pendingAI === 0;
    window.__CX_FORCE_PLAY.quizStats = stats;
  }
  var _quizPopupOff = false;   // 「弹窗自动作答」开关关闭标记（仅作用于弹窗内题目）
  // P1-4：MO 增量 diff —— 指纹跨 tick 缓存，仅在「脏代际」变化时重算 textContent。
  //   - _quizDirtyGen：由 MutationObserver 在检测到 childList/subtree 变更时递增（一次变更批量只 +1，非每节点）；
  //     另设「全量安全刷新」节奏兜底，覆盖 MO 未触发的字符变更与 MO 未初始化场景。
  //   - _quizFpCache：WeakMap<node,{ver,fp}>，ver===_quizDirtyGen 时复用缓存、不读 textContent（静态大题量页稳态零重算）。
  //   - 检测仍由每 tick 全量 _pqQueryAll 负责（不丢题）；本优化只削减「逐题重读 textContent」成本。
  var _quizDirtyGen = 0;
  var _quizFpCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  var _quizTickCount = 0;
// 状态机优化(卡顿排查·答题调度)：无题稳态状态——上次扫描题数/时间，供 quizTick 无题节流与 MO 动态防抖使用
var _quizLastHadQuestions = false;
var _quizLastScanAt = 0;
// 需求·自动答题控制：自动启动开关（cx_quiz_auto_start，默认开）+ 手动开始按钮
//   _quizManualArmed —— 手动按钮/开启动置位：本次 quizTick 强制作答（绕过自动启动关）
//   _quizManualHold  —— 自动启动关时挂起作答：只扫描登记信号灯，不发 AI 请求、不点选、不提交
var _quizManualArmed = false;
var _quizManualHold = false;
function _quizAutoStartOn() {
  return safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_AUTO_START) !== '0' : true; }, true);
}
// 需求·答题信号灯：每道题一个状态灯，七态七色——红=完全失败 绿=已完成 黄=作答中/待确认/待复核 紫=暂时受阻 蓝=特殊情况 橙=信息缺失 黑=未进行
//   按题目发现顺序登记（fp→序号），状态由现有答题状态推导（_quizHandled/_quizAIFailed/_quizAIProblems/
//   _quizVisTimers/_quizAIPending/_quizPendingSubmit/_quizManualHold/_quizDsGraceUntil/_quizInfoMissing），quizTick 扫描后与视觉 settle 后统一同步。
//   红(完全失败)为最高严重度；紫(暂时受阻)=DS 通道建立宽限中；蓝(特殊情况)=自动启动关闭挂起；橙(信息缺失)=无选项/题干未识别。
var _quizLights = [];
var _quizLightFp = {};
var _quizLastActivityTs = 0;   // v4.19.29·出清系统：最近一次「有作答活动」的时间戳(供 QUIZ_CACHE_EVICT_ON_IDLE_MIN 判定空闲超时)
var _topQuizLightsHandler = null;   // 跨帧信号灯接收端（顶层帧监听器；具名供 lifecycle cleanup removeEventListener）
var _quizLightsSigLast = '';        // 跨帧广播去重签名（灯数+状态串；未变不重复 postMessage，防高频刷屏）
// 跨帧灯源跟踪（v4.19.2 修复·陈旧灯）：子帧每次广播的是**全量快照**，合并必须按「源帧」替换——
// 旧实现空快照直接 no-op：SPA 切换章节/作业重建 iframe 后，新实例广播空数组时旧灯永不清理，
// 顶层面板残留上一会话的陈旧灯（实测：子帧已 0 灯，面板仍显示 5 黑灯、无任何作答请求）。
var _quizRemoteState = {};   // fp → {state, msg, src}（跨源灯的最新快照；空快照=清除该源全部陈旧灯）
var _quizRemoteOrder = [];   // fp 首次出现顺序（跨源合并保持发现顺序）
var _quizRemoteTick = null;  // 子帧最近一轮答题 tick 遥测 {scanned, answered, err, ts}（随广播上报，诊断可见）
var _quizLastTickErr = '';   // 本帧答题 tick 末次异常（循环内 catch 捕获，随广播上报顶层）
var _quizSkipCounts = {};    // 本帧答题 tick 跳过原因计数（handled/cooldown/popup/hold/noOpts/gate，随广播上报）
var _quizRetryTimer = null;  // 子帧待答重扫定时器（仅子帧、有待答题时启用；答完/离页即停）
var _quizLightsGmSig = '';   // 跨页信号灯镜像去重签名（课程页→DS 应答端，未变不重复写 GM）
var _QUIZ_LIGHTS_CAP = 200;   // 上限：翻页/长会话不无限累积（淘汰最旧非作答中灯）
var _quizDsGraceUntil = 0;     // DS 通道建立宽限截止时间戳（_quizTick gate 分支置位；_quizSyncLights 据此显示紫色=暂时受阻）
var _quizInfoMissing = {};     // fp → true：题目信息缺失（无选项/题干无法识别），橙色=信息缺失（已作答则让位于绿/黄）
