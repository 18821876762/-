// @provides: _quizAIFailed, _quizAIPending, _quizAIProblems, _quizFillItems, _quizPendingSubmit, _quizPrunePending, _quizReviewItems, _quizStrictAI
// @requires: CONFIG, CONST, EventBus, _quizCancelForFp, _quizHandled, _quizIsMulti, _quizParseSeq, bestEffort, safeGet, swallow
// @source-group: takeover/engine/quiz.js
// 职责：弹窗边界、严格模式诊断与队列修剪；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  var _QUIZ_FULL_REFRESH_TICKS = (typeof CONST !== 'undefined' && CONST.QUIZ_FULL_REFRESH_TICKS) || 30;
  // 弹窗容器/关闭按钮选择器（best-effort，待真实站点校准）：识别题目是否位于弹窗内，以及作答后真正关闭弹窗
  var POPUP_BOX_SELS = '.dialog,.modal,.popup,[class*="dialog"],[class*="modal"],[class*="popup"],[class*="mask"],[class*="layer"],[class*="Drawer"],[class*="drawer"]';
  var POPUP_CLOSE_SELS = '.close,.icon-close,[class*="close"],[class*="Close"],.dialog-x,.el-dialog__close,button[aria-label*="关闭"],button[aria-label*="close"]';
  function _quizIsInPopup(qEl) {
    return safeGet(function () { return (qEl && qEl.closest) ? !!qEl.closest(POPUP_BOX_SELS) : false; }, false);
  }
  // 作答/提交后真正关闭弹窗：优先点关闭按钮，失败则移除弹窗 DOM 兜底。仅在题目位于弹窗内时操作（普通作业/考试页无弹窗祖先→零副作用）
  function _quizClosePopup(qEl) {
    bestEffort(function () {
      if (!qEl || !qEl.closest) return;
      var box = qEl.closest(POPUP_BOX_SELS);
      if (!box) return;
      var closes = box.querySelectorAll(POPUP_CLOSE_SELS);
      for (var i = 0; i < closes.length; i++) { bestEffort(function () { if (closes[i] && closes[i].click) closes[i].click(); }, 'quiz.popupClose.click'); }
      var still = qEl.closest(POPUP_BOX_SELS);
      if (still && still.parentNode) {
        bestEffort(function () { still.style.display = 'none'; }, 'quiz.popupClose.hide');
        bestEffort(function () { still.parentNode.removeChild(still); }, 'quiz.popupClose.remove');
      }
    }, 'quiz.popupClose');
  }
  var _quizAIPending = {};     // AI 异步题解进行中：fp→发起时间戳（超时则随机兜底）
  // —— 严格 AI 模式（用户强制用 AI/DeepSeek 作答）：任何无法用 AI 取得答案的情况都「停下报错」，绝不允许随机兜底 ——
  var _quizAIProblems = {};    // 严格模式下的失败题登记（fp→{msg,ts}）；用于面板/诊断观测「已停下」
  var _quizAIFailed = {};      // 严格 AI 模式失败冷却：fp→可重试时间戳；避免 2s 紧循环反复问 DS（重复上传截图）
  // v4.19.14：逐题 AI 作答诊断明细（fp→{seq,qtype,optCount,last,history}）——供诊断页「AI 作答诊断明细」逐题定位
  // 解析失败根因。last = 最近一次尝试的关键信息；history = 前几次尝试（最多 3 条）。
  var _quizAiDiag = {};
  function _quizStrictAI() {
    // 严格 AI 模式仅在「用 DeepSeek 网页版作答」开关开启时生效（视觉启用 + OCR=deepseek-web）。
    // 注意：「答案来源=AI」是独立的「自建 AI 接口」路径（需配置 QUIZ_AI_ENDPOINT），不在此列——
    // 否则会与「离线/白名单隐私 + 随机兜底」既有语义冲突，也误伤仅选 AI 源、未配端点的场景。
    var vis = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENABLED);
    var ocr = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_OCR);
    return !!(vis && ocr === 'deepseek-web');
  }
  // v4.19.14：把单次 AI 作答尝试的关键信息写入逐题诊断明细（供诊断页「AI 作答诊断明细」逐题定位解析失败根因）。
  // patch 字段：ts/recovered/hasAnswer/hasText/answer/text/decodeOk/decodeLen/parseReason/result/err/idxs
  // result ∈ 'ok'(已作答) | 'fail'(严格停下) | 'random'(解析失败→随机兜底) | 'error'(超时/DS错误/空回传)
  function _quizRecordDiag(fp, qEl, opts, patch) {
    if (!fp) return;
    bestEffort(function () {
      var _base = _quizAiDiag[fp] || {};
      if (!_base.startTs) _base.startTs = (patch && patch.ts) || Date.now();   // v4.19.45：每题耗时起点（首次登记该题为题出现/首答时刻），诊断据 last.ts 求耗时
      _base.fp = fp;
      _base.seq = safeGet(function () { return _quizParseSeq(qEl && (qEl.textContent || '')); }, 0);
      _base.qtype = opts ? (_quizIsMulti(opts) ? '多选' : '单选') : '?';
      _base.optCount = opts ? opts.length : 0;
      var _prev = _base.last;
      _base.last = {
        ts: (patch && patch.ts) || Date.now(),
        recovered: patch ? patch.recovered : undefined,
        hasAnswer: patch ? patch.hasAnswer : undefined,
        hasText: patch ? patch.hasText : undefined,
        answer: patch ? patch.answer : undefined,
        text: patch ? patch.text : undefined,
        decodeOk: patch ? patch.decodeOk : undefined,
        decodeLen: patch ? patch.decodeLen : undefined,
        imgSkipped: patch ? patch.imgSkipped : undefined,
        parseReason: patch ? patch.parseReason : undefined,
        result: patch ? patch.result : undefined,
        err: patch ? patch.err : undefined,
        idxs: patch ? patch.idxs : undefined
      };
      if (!_base.history) _base.history = [];
      if (_prev) _base.history.push(_prev);
      if (_base.history.length > 3) _base.history = _base.history.slice(-3);  // 保留最近 3 次尝试演变
      _quizAiDiag[fp] = _base;
      // 性能/内存护栏(审查 MED-4)：逐题 AI 诊断明细随超长会话/长题库单调增长，加计数上限淘汰（保留最近 N 题）
      var _diagCap = (typeof CONST !== 'undefined' && CONST.QUIZ_AI_DIAG_CAP) || 200;
      var _diagKs = Object.keys(_quizAiDiag);
      if (_diagKs.length > _diagCap) { var _drop = _diagKs.length - _diagCap; for (var _di = 0; _di < _drop; _di++) delete _quizAiDiag[_diagKs[_di]]; }
    }, 'quiz.recordDiag');
  }
  function _quizStrictFail(fp, qEl, sels, msg) {
    // 严格 AI 模式下：不点选、不提交、不标记 _quizHandled（保持停下，DS 恢复后下轮幂等重试）。
    // 首次登记时 toast 报错 + 计入错误环形缓冲（与诊断「错误累计/最近(3)」联动）；同一题重复失败仅安静停下（避免刷屏），
    // 并由 quizStats.aiProblems / quizAIProblems 暴露给诊断「AI 作答」段落，使报错与诊断结合、可一键复盘。
    if (!fp) return;
    // 解析题号前缀（用于反馈/诊断定位「具体哪道题」）：从题块文本提取开头序号（如 "1 【多选题】…"→1）
    var _seq = safeGet(function () { return _quizParseSeq(qEl && (qEl.textContent || '')); }, 0);
    var _tag = _seq ? ('[第' + _seq + '题] ') : '';
    // 冷却：阻止主循环每 tick 都重新问 DeepSeek → 截图重复上传死循环。失败后立即冷却（默认 30s），冷却结束后幂等重试。
    _quizAIFailed[fp] = Date.now() + ((typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_RETRY_COOLDOWN_MS) || 30000);
    if (_quizHandled[fp]) delete _quizHandled[fp];   // 解除占坑，冷却结束后可重试
    if (!_quizAIProblems[fp]) {
      _quizAIProblems[fp] = { fp: fp, msg: _tag + msg, ts: Date.now() };
      bestEffort(function () {
        EventBus.emit('ui:toast', '⛔ 作答失败（已停止自动重试，未随机填答）：' + _tag + msg);
      }, 'quiz.strictFail');
      swallow(new Error('AI 作答已停止: ' + _tag + msg), 'quiz.strictFail');   // 进错误环形缓冲→诊断「错误累计/最近(3)」可见
      _quizPruneAIProblems();   // P1 修复：登记后即时淘汰，防长会话累积
    }
  }
  var _quizPendingSubmit = {}; // 二次确认：已作答未提交：fp→{qEl,sels}（待用户「确认提交」）
  var _quizReviewItems = {};   // 人工复核队列：fp→{fp,stem,optTexts,guessedIdx,ts}（置信度<0.6 随机兜底后待用户确认/入题库）。
                                // 只存题干/选项文本，不持有题目 DOM 节点引用，避免大题量考试下整棵 DOM 子树无法 GC（游离大对象）。
  var _quizFillItems = {};     // 填空题队列：fp→{fp,stem,ts}（题型识别=fill 时登记，待 step2 自动回填消费）。
                                // 仅存题干文本摘要，不持有题目 DOM 节点引用（与 _quizReviewItems 同内存护栏）；回填由 _quizFillAnswer 写入输入框。
  // 填空题队列上限淘汰（与 _quizPruneReviews 同范本，防超长会话无限增长）
  function _quizPruneFill() {
    bestEffort(function () {
      var _cap = (typeof CONST !== 'undefined' && CONST.QUIZ_REVIEW_CAP) || 200;
      var _ks = Object.keys(_quizFillItems);
      if (_ks.length > _cap) {
        var _drop = _ks.length - _cap;
        for (var _p = 0; _p < _drop; _p++) delete _quizFillItems[_ks[_p]];
      }
    }, 'quiz.pruneFill');
  }

  // —— A2/A3/A4 内存护栏：指纹/队列上限淘汰（对齐 dedup.js 的 _endedPrune 范本，防超长会话无限增长）——
  function _quizPruneHandled() {
    bestEffort(function () {
      var _ks = Object.keys(_quizHandled);
      if (_ks.length > CONST.QUIZ_HANDLED_CAP) {
        var _drop = _ks.length - CONST.QUIZ_HANDLED_CAP;
        for (var _p = 0; _p < _drop; _p++) delete _quizHandled[_ks[_p]];
      }
    }, 'quiz.pruneHandled');
  }
  function _quizPruneAIFailed() {
    bestEffort(function () {
      var _now = Date.now(), _ks = Object.keys(_quizAIFailed), _cap = 200;
      for (var _p = 0; _p < _ks.length; _p++) { if (_now >= _quizAIFailed[_ks[_p]]) delete _quizAIFailed[_ks[_p]]; }
      var _rem = Object.keys(_quizAIFailed);
      if (_rem.length > _cap) { for (var _q = 0; _q < _rem.length - _cap; _q++) delete _quizAIFailed[_rem[_q]]; }
    }, 'quiz.pruneAIFailed');
  }
  // 幂等性修复(审查 G-3)：_quizAIPending（AI 异步题解进行中）原仅超时路径删除——若题目在 pending 期间从 DOM 消失
  // （翻页/提交后不再被扫到），条目永久残留、随会话单调增长（同文件其余队列均有 A2/A3/A4 护栏，唯独此 map 缺失）。
  // 仿 _quizPruneAIFailed：TTL 淘汰（超过 QUIZ_AI_WAIT×2 视为死条目）+ 计数上限（与 QUIZ_PENDING_CAP 同量级）。
  function _quizPruneAIPending() {
    bestEffort(function () {
      var _now = Date.now(), _wait = ((typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_WAIT) || 20000) * 2;
      var _ks = Object.keys(_quizAIPending), _cap = 1000;
      for (var _p = 0; _p < _ks.length; _p++) { if (_now - _quizAIPending[_ks[_p]] > _wait) { _quizCancelForFp(_ks[_p]); delete _quizAIPending[_ks[_p]]; } }
      var _rem = Object.keys(_quizAIPending);
      if (_rem.length > _cap) { for (var _q = 0; _q < _rem.length - _cap; _q++) delete _quizAIPending[_rem[_q]]; }
    }, 'quiz.pruneAIPending');
  }
  // P1 修复：严格 AI 模式下「已停下」的失败题登记(_quizAIProblems)原只增不删，超长会话持续累积。
  // 加计数上限淘汰（与 _quizPruneReviews 同范本），保留最近 N 条用于面板/诊断观测即可。
  function _quizPruneAIProblems() {
    bestEffort(function () {
      var _cap = (typeof CONST !== 'undefined' && CONST.QUIZ_AI_PROBLEM_CAP) || 200;
      var _ks = Object.keys(_quizAIProblems);
      if (_ks.length > _cap) {
        var _drop = _ks.length - _cap;
        for (var _p = 0; _p < _drop; _p++) delete _quizAIProblems[_ks[_p]];
      }
    }, 'quiz.pruneAIProblems');
  }
  function _quizPruneReviews() {
    bestEffort(function () {
      var _ks = Object.keys(_quizReviewItems);
      if (_ks.length > CONST.QUIZ_REVIEW_CAP) {
        var _drop = _ks.length - CONST.QUIZ_REVIEW_CAP;
        for (var _p = 0; _p < _drop; _p++) delete _quizReviewItems[_ks[_p]];
      }
    }, 'quiz.pruneReviews');
  }
  function _quizPrunePending() {
    bestEffort(function () {
      var _now = Date.now(), _ttl = (typeof CONST !== 'undefined' && CONST.QUIZ_PENDING_TTL_MS) || 1800000;
      var _ks = Object.keys(_quizPendingSubmit), _cap = (typeof CONST !== 'undefined' && CONST.QUIZ_PENDING_CAP) || 1000;
      for (var _p = 0; _p < _ks.length; _p++) { var _v = _quizPendingSubmit[_ks[_p]]; if (_v && _now - (_v.ts || 0) > _ttl) delete _quizPendingSubmit[_ks[_p]]; }
      var _ks2 = Object.keys(_quizPendingSubmit);
      if (_ks2.length > _cap) { var _drop = _ks2.length - _cap; for (var _q = 0; _q < _drop; _q++) delete _quizPendingSubmit[_ks2[_q]]; }
    }, 'quiz.prunePending');
  }
