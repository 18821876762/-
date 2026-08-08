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
  //   ② 'bank'    (本地题库)：从 window.__CX_FORCE_PLAY.quizBank 或 localStorage['cx_quiz_bank'] 读 {题干指纹: 答案} 映射做匹配；
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

  var _quizHandled = {};       // 已作答题目指纹去重（防重复提交）
  var _quizAIPending = {};     // AI 异步题解进行中：fp→发起时间戳（超时则随机兜底）
  var _quizPendingSubmit = {}; // 二次确认：已作答未提交：fp→{qEl,sels}（待用户「确认提交」）
  var _quizReviewItems = {};   // 人工复核队列：fp→{fp,stem,opts,guessedIdx,ts}（置信度<0.6 随机兜底后待用户确认/入题库）
  function _quizFingerprint(qEl) {
    try { var s = (qEl.textContent || '').replace(/\s+/g, '').slice(0, 120); return 'quiz:' + s.length + ':' + s; }
    catch (e) { return 'quiz:err'; }
  }
  function _quizText(el, sels) {
    if (!el) return '';
    var node = (sels && _pqQuery) ? null : null; // 占位（避免未定义引用，下方用本地 query）
    try {
      if (sels && sels.length) {
        for (var i = 0; i < sels.length; i++) { var n = el.querySelector(sels[i]); if (n && (n.textContent || '').trim()) return n.textContent.trim(); }
      }
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    } catch (e) { return ''; }
  }
  function _quizOptions(qEl, sels) {
    var out = []; if (!qEl || !qEl.querySelectorAll) return out;
    var seen = [];   // 按引用去重：多 selector 并集命中同一节点时避免重复入数组（否则 idx<opts.length 判定与随机分布被污染）
    for (var i = 0; i < sels.length; i++) { try { var ns = qEl.querySelectorAll(sels[i]); for (var j = 0; j < ns.length; j++) { if (seen.indexOf(ns[j]) < 0) { seen.push(ns[j]); out.push(ns[j]); } } } catch (e) { swallow(e); } }
    return out;
  }

  // —— 隐私合规：离线优先 + 端点白名单（默认不外发题目/选项）——
  function _quizOfflineOnly() {
    // 默认仅离线作答（cx_quiz_offline 未置 '0' 即不外发）。需用户显式允许才向外发送题目数据。
    try { if (typeof localStorage === 'undefined') return true; var v = localStorage.getItem('cx_quiz_offline'); return v === null ? true : (v !== '0'); } catch (e) { return true; }
  }
  function _quizEndpointAllowed(ep) {
    if (!ep) return false;
    try {
      if (_quizOfflineOnly()) return false;   // 离线优先：默认不外发（隐私合规硬缺口闭合）
      var _base = (typeof location !== 'undefined' && location.href) ? location.href : 'https://localhost/';
      var _u = new URL(ep, _base);
      if (_u.protocol !== 'http:' && _u.protocol !== 'https:') return false;   // 仅 http/https，防 file:/javascript: 泄漏
      var wl = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ENDPOINT_WHITELIST) || [];
      if (!wl.length) return false;            // 未配置白名单 → 禁外发（需明确授权）
      for (var i = 0; i < wl.length; i++) {
        var h = wl[i]; if (!h) continue;
        if (_u.host === h || _u.host.endsWith('.' + h)) return true;
      }
      return false;
    } catch (e) { return false; }
  }

  // —— 提交二次确认（隐私/防误交卷）：默认自动提交；关闭后「作答但不提交」，挂起待用户「确认提交」——
  function _quizAutoSubmit() {
    // 默认自动提交（cx_quiz_autosubmit 未置 '0' 即自动）。考试/高风险场景建议关，由人工确认。
    try { if (typeof localStorage === 'undefined') return true; var v = localStorage.getItem('cx_quiz_autosubmit'); return v === null ? true : (v !== '0'); } catch (e) { return true; }
  }
  function _quizMaybeSubmit(qEl, submitSels, fp) {
    if (_quizAutoSubmit()) {
      var _ok = _quizSubmit(qEl, submitSels);
      if (fp != null) { try { delete _quizPendingSubmit[fp]; } catch (e) {} }
      return _ok;
    }
    // 二次确认模式：已作答未提交，挂起等待「确认提交」
    if (fp != null) _quizPendingSubmit[fp] = { qEl: qEl, sels: submitSels };
    return false;
  }
  function quizSubmitPending() {
    // 用户「确认提交」：批量提交所有已作答待确认的题（按记录复找提交按钮）
    var n = 0;
    try {
      if (typeof _quizPendingSubmit !== 'object' || !_quizPendingSubmit) return 0;
      for (var fp in _quizPendingSubmit) {
        try {
          var rec = _quizPendingSubmit[fp];
          if (!rec || !rec.qEl) { try { delete _quizPendingSubmit[fp]; } catch (e2) {} continue; }
          if (_quizSubmit(rec.qEl, rec.sels)) { n++; try { delete _quizPendingSubmit[fp]; } catch (e3) {} }
        } catch (e) { swallow(e); }
      }
      try {
        if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) {
          window.__CX_FORCE_PLAY.quizStats = window.__CX_FORCE_PLAY.quizStats || {};
          window.__CX_FORCE_PLAY.quizStats.pendingSubmit = Object.keys(_quizPendingSubmit).length;
        }
      } catch (e) {}
      if (n > 0) try { Store.emit('ui:toast', '已确认提交 ' + n + ' 题'); } catch (e) {}
    } catch (e) { swallow(e); }
    return n;
  }

  // —— MutationObserver：题目动态出现即触发作答，替代仅靠 2s 全文档轮询的空窗 ——
  var _quizObserver = null, _quizMOBusy = false;
  function _quizMOTick() {
    try {
      var disp = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizObserveDispatch === 'function') ? window.__CX_FORCE_PLAY.quizObserveDispatch : quizTick;
      disp();
    } catch (e) { swallow(e); }
  }
  function _quizMOHandle() {
    if (_quizMOBusy) return;
    _quizMOBusy = true;
    setTimeout(function () { _quizMOBusy = false; _quizMOTick(); }, 300);   // 300ms 防抖，合并批量 DOM 变更
  }
  function quizObserve(root) {
    if (typeof MutationObserver === 'undefined') return false;
    try {
      if (_quizObserver) { try { _quizObserver.disconnect(); } catch (e) {} }
      var r = root || (typeof document !== 'undefined' ? (document.body || document.documentElement) : null);
      if (!r) return false;
      _quizObserver = new MutationObserver(function () { _quizMOHandle(); });
      _quizObserver.observe(r, { childList: true, subtree: true });
      return true;
    } catch (e) { swallow(e); return false; }
  }

  // ---- 答案源解析 ----
  function _quizBankLookup(stem) {
    try {
      var bank = null;
      try { bank = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizBank) || null; } catch (e) {}
      if (!bank && typeof localStorage !== 'undefined') {
        try { var raw = localStorage.getItem('cx_quiz_bank'); if (raw) bank = JSON.parse(raw); } catch (e2) { swallow(e2); }
      }
      if (bank && typeof bank === 'object') {
        // 精确键或子串匹配
        if (bank[stem]) return bank[stem];
        var keys = Object.keys(bank);
        for (var k = 0; k < keys.length; k++) { if (stem && stem.indexOf(keys[k]) >= 0) return bank[keys[k]]; }
      }
    } catch (e) { swallow(e); }
    return null;
  }
  function _quizAskAI(stem, options) {
    // AI 答案源接口：CONFIG.QUIZ_AI_ENDPOINT 由用户配置，脚本不内置密钥。
    // 同步环境无法 await：采用 fire-and-forget + 异步结果写回 quizBank，下轮命中回填；
    // 返回 'pending' 表示已发起异步请求（调用方暂不下发、不下坑，等下轮命中），其余返回 null。
    try {
      var ep = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_ENDPOINT) || '';
      if (!ep) return null;
      if (!_quizEndpointAllowed(ep)) return null;   // 离线优先 / 非白名单 → 不外发题目（隐私合规）
      try {
        var payload = JSON.stringify({ stem: stem, options: options.map(function (o) { return (o.textContent || '').replace(/\s+/g, ' ').trim(); }) });
        fetchWithTimeout(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        }, (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_TIMEOUT) || 15000).then(function (r) {
          if (!r || !r.ok) return null;
          return r.json();
        }).then(function (ans) {
          if (ans && (ans.index != null || ans.answer != null)) {
            var idx = ans.index != null ? ans.index : ans.answer;
            try { window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {}; window.__CX_FORCE_PLAY.quizBank = window.__CX_FORCE_PLAY.quizBank || {}; window.__CX_FORCE_PLAY.quizBank[stem] = idx; } catch (e3) {}
          }
          return null;
        }).catch(function (e) { swallow(e); return null; });
        return 'pending';   // 已发起异步题解，下一轮从 quizBank 命中回填
      } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
    return null;
  }
  // 求答案索引：返回数字索引（选项数组下标）或 null（调用方按 random 兜底）
  function _quizSource() {
    // 优先级：localStorage.cx_quiz_source（面板「做题」区设置）> CONFIG.QUIZ_ANSWER_SOURCE > 'random'
    var ls = null;
    try { if (typeof localStorage !== 'undefined') ls = localStorage.getItem('cx_quiz_source'); } catch (e) {}
    if (ls === 'bank' || ls === 'ai' || ls === 'random') return ls;
    return ((typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random');
  }
  function _quizResolveAnswer(stem, options) {
    var src = _quizSource();
    var answers = [];
    // 本地题库：bank/ai 模式下作为高权重候选（本地缓存优先；random 模式尊重用户显式选择，不交叉查库避免"随机意图被题库覆盖"）
    if (src === 'bank' || src === 'ai') {
      var b = _quizBankLookup(stem);
      if (b != null) {
        var bi = (typeof b === 'number') ? b : parseInt(b, 10);
        if (!isNaN(bi)) answers.push({ idx: bi, score: 1.0, source: 'bank' });
      }
    }
    // AI 接口：同步环境发起异步请求（返回 'pending'）→ 下一轮命中 quizBank 回填；同步命中时作为 ai 权重候选参与融合
    if (src === 'ai') {
      var a = _quizAskAI(stem, options);
      if (a === 'pending') return { pending: true };   // 异步题解进行中：调用方暂不下发、不下坑
      if (a != null && !isNaN(Number(a))) answers.push({ idx: Number(a), score: 0.7, source: 'ai' });
    }
    if (!answers.length) return null;   // 无候选 → 调用方 random 兜底
    // 加权融合 → { index, confidence, sources }；多来源同向累加、异向按占比降置信度
    var m = mergeAnswers(answers);
    if (!m) return null;
    return { idx: m.index, confidence: m.confidence, source: m.sources.join('+') };
  }

  function _quizClick(optEls, idx) {
    try {
      var el = optEls[idx] || optEls[Math.floor(Math.random() * optEls.length)];
      if (!el) return false;
      // 触发选中：优先 click 选项本身；若选项是 label 包裹 input，则勾选其内部 input
      try { el.click(); } catch (e) { swallow(e); }
      try {
        var inp = el.querySelector('input[type="radio"], input[type="checkbox"]');
        if (inp) { inp.checked = true; try { inp.click(); } catch (e2) { swallow(e2); } }
      } catch (e3) { swallow(e3); }
      return true;
    } catch (e) { swallow(e); return false; }
  }
  function _quizSubmit(qEl, sels) {
    if (!sels) sels = QUIZ.submitSels;
    for (var i = 0; i < sels.length; i++) { try { var b = qEl.querySelector(sels[i]); if (b) { b.click(); return true; } } catch (e) { swallow(e); } }
    // 退而求其次：题目容器内任意含「提交/下一题/确定」文字的按钮
    try {
      var btns = qEl.querySelectorAll('button, .btn, a[class*="btn"]');
      for (var j = 0; j < btns.length; j++) {
        var t = (btns[j].textContent || '').replace(/\s/g, '');
        if (/提交|下一题|确定|作答|保存/.test(t)) { btns[j].click(); return true; }
      }
    } catch (e) { swallow(e); }
    return false;
  }

  // 视觉识别异步作答：截图还原后求答案并回填（quiz-vision.js 提供 quizRecover）。先由调用方占坑(_quizHandled)，此处只负责还原+回填。
  function _quizVisionAnswer(qEl, opts, sels, stem) {
    try {
      quizRecover(qEl).then(function (res) {
        if (!res || (res.text == null && res.answer == null)) throw new Error('empty recover');
        var useIdx = null;
        if (res.answer != null) {                       // 多模态端点直接给答案索引（DeepSeek 返回字母 A-D，需转换为数字索引）
          useIdx = (typeof res.answer === 'number') ? res.answer :
            ({ A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 })[res.answer] != null
              ? ({ A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 })[res.answer] : parseInt(res.answer, 10);
        } else {
          // 还原文本 → 查本地题库（题干已还原为真实文本，可命中 bank）；仍无则对原(可能混淆)题干再查一次
          var src = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random';
          if (src === 'bank' && res.text) {
            var b = _quizBankLookup(res.text);
            if (b != null) useIdx = (typeof b === 'number') ? b : parseInt(b, 10);
          }
          if (useIdx == null) { var b2 = _quizBankLookup(stem); if (b2 != null) useIdx = (typeof b2 === 'number') ? b2 : parseInt(b2, 10); }
        }
        if (!(useIdx != null && useIdx >= 0 && useIdx < opts.length)) useIdx = Math.floor(Math.random() * opts.length); // 无果→随机兜底保不卡
        _quizClick(opts, useIdx);
        _quizSubmit(qEl, sels.submitSels);
        try { Store.emit('ui:toast', '已视觉识别作答 1 题' + (useIdx != null ? '' : '（随机兜底）')); } catch (e) { swallow(e); }
      }).catch(function (e) {
        swallow(e);
        _quizClick(opts, Math.floor(Math.random() * opts.length));   // 识别失败→随机兜底，绝不卡进度
        _quizSubmit(qEl, sels.submitSels);
        try { Store.emit('ui:toast', '题目识别失败，已随机兜底'); } catch (e2) { swallow(e2); }
      });
    } catch (e) { swallow(e); }
  }

  // 运行状态可观测（修复"答题不像视频能精准判断是否运行"）：记录 启动/完成 信号 + 实时统计
  var _quizDetectedNotified = false;   // 已发「开始」信号（扫描到题即报一次）
  var _quizDoneNotified = false;       // 已发「完成」信号（剩余=0 即报一次）
  var _quizDisabledNotified = false;   // 已发「已禁用」提示
  var _quizLastScanned = 0;
  // 统计"已作答"题数：已记入去重指纹 或 含已勾选输入（比单纯看 class 名更稳）
  function _quizCountAnswered(qs) {
    var n = 0;
    try {
      for (var i = 0; i < qs.length; i++) {
        var q = qs[i];
        if (!q) continue;
        if (_quizHandled[_quizFingerprint(q)]) { n++; continue; }
        if (q.querySelector && q.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) n++;
      }
    } catch (e) { swallow(e); }
    return n;
  }

  // 通用入口：扫描题目并认真作答（随机/bank/ai/视觉识别 兜底）。selectors 可选覆盖默认 QUIZ。
  //   - 文本路径(random/bank/ai)同步可解 → 立即作答；
  //   - 文本无解且 QUIZ_VISION_ENABLED → 截图还原(异步)后作答（先占坑防每轮重复截图）；
  //   - 其余 → 随机兜底保不卡。
  function quizTick(selectors) {
    var sels = selectors || QUIZ;
    var answered = 0;
    try {
      // 中途关闭开关（控制台 localStorage.setItem('cx_quiz_auto','1'/'0') 切换）
      try {
        if (typeof localStorage !== 'undefined' && localStorage.getItem('cx_quiz_auto') === '0') {
          if (!_quizDisabledNotified) { _quizDisabledNotified = true; try { Store.emit('ui:toast', '自动答题已禁用（cx_quiz_auto=0，置 1 恢复）'); } catch (e2) {} }
          return 0;
        }
      } catch (e2) {}
      var root = (document && document.documentElement) || document;
      var qs = _pqQueryAll(root, sels.questionSels);
      var scanned = qs.length;
      var src = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random';  // 提到循环外，避免全部跳过时 source 为 undefined
      var _confAcc = 0, _confN = 0, _srcMap = {}, _lvlMap = {};   // 统计：平均置信度 + 实际命中来源集合 + 分级分布(auto/confirm/review)
      for (var i = 0; i < qs.length; i++) {
        var qEl = qs[i];
        var fp = _quizFingerprint(qEl);
        if (_quizHandled[fp]) continue;            // 已作答跳过
        var stem = _quizText(qEl, sels.stemSels);
        var opts = _quizOptions(qEl, sels.optionSels);
        if (!opts.length) continue;
        var idxObj = _quizResolveAnswer(stem, opts);  // 文本路径(random/bank/ai)同步求答案（融合后含 confidence/source）
        if (idxObj && idxObj.idx != null && idxObj.idx >= 0 && idxObj.idx < opts.length) {
          // —— 置信度分级决策（评估建议#3：置信度驱动行为，而非无差别点选+提交）——
          //   auto(≥0.9)：点选 + 按二次确认开关提交/挂起
          //   confirm(0.6~0.9)：点选但强制挂起待用户确认（即便自动提交开着也不直接交，避免中置信误交）
          //   review(<0.6)：低可信，转随机兜底保不卡，但标记"人工复核"（不计入高可信来源）
          var _c = (typeof idxObj.confidence === 'number') ? idxObj.confidence : 1;
          var _lvl = (typeof decisionFor === 'function') ? decisionFor(_c) : (_c >= 0.9 ? 'auto' : (_c >= 0.6 ? 'confirm' : 'review'));
          if (_lvl === 'review') {
            // 低置信：不盲选"正确"，随机兜底保不卡进度，但标记为人工复核
            var _guessed = Math.floor(Math.random() * opts.length);
            _quizClick(opts, _guessed);
            _quizMaybeSubmit(qEl, sels.submitSels, fp);
            _quizHandled[fp] = true; answered++;
            _srcMap['review'] = true; _lvlMap['review'] = true;
            // 登记到人工复核队列：供面板「一键采纳/导出」闭环（评估建议#6 增量进本地题库）
            _quizReviewItems[fp] = { fp: fp, stem: stem, opts: opts, guessedIdx: _guessed, ts: Date.now() };
            try { Store.emit('ui:toast', '低置信度(' + Math.round(_c * 100) + '%)·已随机兜底·标记人工复核（源=' + (idxObj.source || '?') + '）'); } catch (e) { swallow(e); }
            continue;
          }
          _quizClick(opts, idxObj.idx);
          if (_lvl === 'confirm') {
            // 中置信：点选但不提交，强制挂起待用户「确认提交」（_quizMaybeSubmit 的挂起语义天然满足；此处额外绕过自动提交开关）
            _quizPendingSubmit[fp] = { qEl: qEl, sels: sels.submitSels };
            _quizHandled[fp] = true; answered++;
            _confAcc += _c; _confN++;
            if (idxObj.source) { _srcMap[idxObj.source] = true; }
            _lvlMap['confirm'] = true;
            try { Store.emit('ui:toast', '中置信度(' + Math.round(_c * 100) + '%)·已点选·待你确认提交（源=' + idxObj.source + '）'); } catch (e) { swallow(e); }
            continue;
          }
          // auto：点选 + 按二次确认开关提交/挂起
          _quizMaybeSubmit(qEl, sels.submitSels, fp);
          _quizHandled[fp] = true;
          if (_quizAIPending[fp]) { try { delete _quizAIPending[fp]; } catch (e) {} }
          answered++;
          _confAcc += _c; _confN++;
          if (idxObj.source) _srcMap[idxObj.source] = true;
          _lvlMap['auto'] = true;
          try { Store.emit('ui:toast', '已作答 1 题（源=' + idxObj.source + ' 置信度=' + Math.round(_c * 100) + '%）'); } catch (e) { swallow(e); }
          continue;
        }
        // AI 异步题解进行中：暂不下发、不下坑，记录待回填；超过 QUIZ_AI_WAIT 未命中则随机兜底（不空题）
        if (idxObj && idxObj.pending) {
          if (!_quizAIPending[fp]) _quizAIPending[fp] = Date.now();
          else {
            var _wait = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_WAIT) || 20000;
            if (Date.now() - _quizAIPending[fp] > _wait) {
              delete _quizAIPending[fp];
              _quizClick(opts, Math.floor(Math.random() * opts.length));
              _quizMaybeSubmit(qEl, sels.submitSels, fp);   // 超时随机兜底 + 自动提交/挂起
              _quizHandled[fp] = true;
              answered++;
              _srcMap['random'] = true;
              try { Store.emit('ui:toast', 'AI 题解超时，已随机兜底 1 题'); } catch (e) { swallow(e); }
            }
          }
          continue;
        }
        // 文本路径无果 + 视觉识别启用 → 截图还原后作答（异步；先占坑防重复触发截图）
        // deepseek-web 模式还需确认 DeepSeek 已登录可用，否则直接随机兜底（并在状态徽标显示"不可用"）
        var _visionOk = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENABLED) && typeof quizRecover === 'function';
        if (_visionOk && ((typeof CONFIG === 'undefined' || CONFIG.QUIZ_VISION_OCR !== 'deepseek-web') || (typeof dsAvailable === 'function' && dsAvailable()))) {
          _quizHandled[fp] = true;
          _quizVisionAnswer(qEl, opts, sels, stem);
          continue;
        }
        // 兜底随机：保证不卡进度 / 不空题
        _quizClick(opts, Math.floor(Math.random() * opts.length));
        _quizMaybeSubmit(qEl, sels.submitSels, fp);   // 自动提交或挂起待二次确认
        _quizHandled[fp] = true;
        answered++;
        _srcMap['random'] = true;   // 随机兜底计入来源集合（置信度不累计，视为低可信）
        try { Store.emit('ui:toast', '已随机作答 1 题（无答案源）'); } catch (e) { swallow(e); }
      }
      // —— 运行/结束可观测 ——
      if (scanned === 0) {
        _quizDetectedNotified = false; _quizDoneNotified = false; _quizLastScanned = 0;  // 离开题目页→重置，再进会重报「启动」
      } else {
        var done = _quizCountAnswered(qs);
        var remaining = scanned - done;
        if (scanned > _quizLastScanned) _quizDoneNotified = false;   // 题量变多（翻页/动态加载）→ 重置完成信号
        _quizLastScanned = scanned;
        try {
          window.__CX_FORCE_PLAY.quizStats = {
            scanned: scanned, answered: answered, done: done, remaining: remaining,
            doneAll: remaining === 0, source: src,
            answerSource: Object.keys(_srcMap).join('+') || 'random',   // 实际命中来源（融合后可见：bank/ai/random 等）
            confidence: _confN ? (_confAcc / _confN) : 0,                // 已作答项平均置信度（0~1）
            levels: Object.keys(_lvlMap).join('+') || 'auto',           // 本次分级分布（auto=直接提交/confirm=待确认/review=人工复核）
            pendingSubmit: Object.keys(_quizPendingSubmit).length,       // 已作答待二次确认提交数
            reviewCount: Object.keys(_quizReviewItems).length,           // 待人工复核题数（置信度<0.6 随机兜底，需用户确认/入题库）
            offline: _quizOfflineOnly(),                                 // 是否仅离线作答（题目不外发）
            ts: Date.now()
          };
        } catch (e) {}
        if (!_quizDetectedNotified) { _quizDetectedNotified = true; try { Store.emit('ui:toast', '自动答题已启动：检测到 ' + scanned + ' 道题（源=' + src + '）'); } catch (e) {} }
        if (remaining === 0 && !_quizDoneNotified) { _quizDoneNotified = true; try { Store.emit('ui:toast', '答题完成：共 ' + scanned + ' 题已作答'); } catch (e) {} }
      }
    } catch (e) { swallow(e); }
    return answered;
  }

  // 配置默认值注入（CONFIG 可能尚未含这些字段，安全补默认值）
  try {
    if (typeof CONFIG !== 'undefined') {
      // 从 localStorage 读取用户持久化配置（由面板「用 DeepSeek 作答」开关写入），覆盖默认值，刷新后保持
      var _lsGet = function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
      var _lsBool = function (k, d) { var v = _lsGet(k, null); if (v === null) return d; return v === '1' || v === 'true'; };
      if (CONFIG.QUIZ_ANSWER_SOURCE == null) CONFIG.QUIZ_ANSWER_SOURCE = 'random';
      if (CONFIG.QUIZ_AI_ENDPOINT == null) CONFIG.QUIZ_AI_ENDPOINT = '';
      // rev3 抗题目文本混淆（视觉识别）配置默认值
      if (CONFIG.QUIZ_VISION_ENABLED == null) CONFIG.QUIZ_VISION_ENABLED = _lsBool('cx_quiz_vision_enabled', false);   // 启用截图→识别对抗混淆；默认关（零运行时依赖）
      if (CONFIG.QUIZ_VISION_OCR == null) CONFIG.QUIZ_VISION_OCR = _lsGet('cx_quiz_vision_ocr', 'endpoint');         // 'endpoint'=多模态AI直接答；'tesseract'=本地OCR还原文本查题库；'deepseek-web'=DeepSeek 网页版应答端
      if (CONFIG.QUIZ_VISION_ENDPOINT == null) CONFIG.QUIZ_VISION_ENDPOINT = _lsGet('cx_quiz_vision_endpoint', '');   // 多模态识别端点（接收 {image,options}，返回 {text,answer}）
      if (CONFIG.QUIZ_OCR_LANG == null) CONFIG.QUIZ_OCR_LANG = _lsGet('cx_quiz_ocr_lang', 'chi_sim');                // Tesseract 语言包
      if (CONFIG.QUIZ_VISION_TIMEOUT == null) CONFIG.QUIZ_VISION_TIMEOUT = 60000;            // deepseek-web 单次问答超时(ms)
      if (CONFIG.QUIZ_VISION_PRIVACY_OK == null) CONFIG.QUIZ_VISION_PRIVACY_OK = _lsBool('cx_quiz_vision_privacy', false);  // 外部 CDN 脚本(html2canvas)加载须显式授权，默认关（隐私优先）
      // 隐私合规 / 提交控制默认值
      if (CONFIG.QUIZ_OFFLINE_ONLY == null) CONFIG.QUIZ_OFFLINE_ONLY = true;                  // 默认仅离线作答，题目/选项不外发
      if (CONFIG.QUIZ_ENDPOINT_WHITELIST == null) CONFIG.QUIZ_ENDPOINT_WHITELIST = [];        // 允许外发的 AI 端点域名白名单（空=禁外发）
      if (CONFIG.QUIZ_AI_WAIT == null) CONFIG.QUIZ_AI_WAIT = 20000;                           // AI 异步题解最长等待(ms)，超时则随机兜底
      if (CONFIG.QUIZ_AUTO_SUBMIT == null) CONFIG.QUIZ_AUTO_SUBMIT = true;                    // 作答后自动提交；关闭→挂起待用户「确认提交」
    }
  } catch (e) {}

  try { window.__CX_FORCE_PLAY.quizTick = quizTick; } catch (e) {}
  try { window.__CX_FORCE_PLAY.quizObserve = quizObserve; } catch (e) {}
  try { window.__CX_FORCE_PLAY.quizSubmitPending = quizSubmitPending; } catch (e) {}

  // —— 人工复核闭环 API（评估建议#6：增量学习——用户纠正结果入本地题库）——
  // 写入题库：内存对象 + localStorage['cx_quiz_bank'] 同步持久化（与 _quizAskAI 回填路径一致）
  function _quizBankWrite(stem, idx) {
    try {
      window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
      window.__CX_FORCE_PLAY.quizBank = window.__CX_FORCE_PLAY.quizBank || {};
      window.__CX_FORCE_PLAY.quizBank[stem] = idx;
      if (typeof localStorage !== 'undefined') {
        try { localStorage.setItem('cx_quiz_bank', JSON.stringify(window.__CX_FORCE_PLAY.quizBank)); } catch (e2) {}
      }
      return true;
    } catch (e) { return false; }
  }
  // 列出待人工复核项：[{fp,stem,opts,guessedIdx,ts}]
  function quizReviewList() { try { return Object.keys(_quizReviewItems).map(function (k) { return _quizReviewItems[k]; }); } catch (e) { return []; } }
  // 采纳指定答案入题库（correctIdx 缺省=采用当前随机猜测值），并移出复核队列；成功返回 true
  function quizReviewAccept(fp, correctIdx) {
    try {
      var it = _quizReviewItems[fp]; if (!it) return false;
      var idx = (correctIdx == null) ? it.guessedIdx : correctIdx;
      var ok = _quizBankWrite(it.stem, idx);
      if (ok) { delete _quizReviewItems[fp]; try { Store.emit('ui:toast', '已采纳入本地题库（fp=' + fp.slice(0, 16) + '）'); } catch (e2) {} }
      return ok;
    } catch (e) { return false; }
  }
  // 导出待复核题为 JSON 文本（供用户核对/外部维护题库），返回字符串
  function quizReviewExport() {
    try {
      var arr = quizReviewList().map(function (it) { return { stem: it.stem, options: it.opts, guessedIdx: it.guessedIdx }; });
      return JSON.stringify(arr, null, 2);
    } catch (e) { return '[]'; }
  }
  try { window.__CX_FORCE_PLAY.quizReviewList = quizReviewList; } catch (e) {}
  try { window.__CX_FORCE_PLAY.quizReviewAccept = quizReviewAccept; } catch (e) {}
  try { window.__CX_FORCE_PLAY.quizReviewExport = quizReviewExport; } catch (e) {}
