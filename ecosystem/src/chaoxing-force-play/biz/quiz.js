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
  //   ② 'bank'    (本地题库)：从 window.__CX_QUIZ_BANK 或 localStorage['cx_quiz_bank'] 读 {题干指纹: 答案} 映射做匹配；
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

  var _quizHandled = {};   // 已作答题目指纹去重（防重复提交）
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
    for (var i = 0; i < sels.length; i++) { try { var ns = qEl.querySelectorAll(sels[i]); for (var j = 0; j < ns.length; j++) out.push(ns[j]); } catch (e) { swallow(e); } }
    return out;
  }

  // ---- 答案源解析 ----
  function _quizBankLookup(stem) {
    try {
      var bank = null;
      try { bank = window.__CX_QUIZ_BANK; } catch (e) {}
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
    // 预留 AI 答案源接口：CONFIG.QUIZ_AI_ENDPOINT 由用户配置，脚本不内置密钥。
    try {
      var ep = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_ENDPOINT) || '';
      if (!ep) return null;
      // 同步环境无法 await；采用 fire-and-forget + 后续轮次回填（命中缓存即生效）。
      // 这里仅返回 null，交由调用方按 random 兜底；AI 异步结果写入 __CX_QUIZ_BANK 供下轮命中。
      try {
        var payload = JSON.stringify({ stem: stem, options: options.map(function (o) { return (o.textContent || '').replace(/\s+/g, ' ').trim(); }) });
        var xhr = new XMLHttpRequest();
        xhr.open('POST', ep, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4 && xhr.status === 200) {
            try {
              var ans = JSON.parse(xhr.responseText);
              if (ans && (ans.index != null || ans.answer != null)) {
                var idx = ans.index != null ? ans.index : ans.answer;
                try { window.__CX_QUIZ_BANK = window.__CX_QUIZ_BANK || {}; window.__CX_QUIZ_BANK[stem] = idx; } catch (e3) {}
              }
            } catch (e2) { swallow(e2); }
          }
        };
        xhr.send(payload);
      } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
    return null;
  }
  // 求答案索引：返回数字索引（选项数组下标）或 null（调用方按 random 兜底）
  function _quizResolveAnswer(stem, options) {
    var src = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random';
    if (src === 'bank') {
      var b = _quizBankLookup(stem);
      if (b != null) return (typeof b === 'number') ? b : parseInt(b, 10);
    } else if (src === 'ai') {
      var a = _quizAskAI(stem, options);
      if (a != null) return a;
    }
    return null; // null → 调用方 random 兜底
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

  // 通用入口：扫描题目并认真作答（随机/bank/ai 兜底）。selectors 可选覆盖默认 QUIZ。
  function quizTick(selectors) {
    var sels = selectors || QUIZ;
    var answered = 0;
    try {
      var root = (document && document.documentElement) || document;
      var qs = _pqQueryAll(root, sels.questionSels);
      for (var i = 0; i < qs.length; i++) {
        var qEl = qs[i];
        var fp = _quizFingerprint(qEl);
        if (_quizHandled[fp]) continue;            // 已作答跳过
        var stem = _quizText(qEl, sels.stemSels);
        var opts = _quizOptions(qEl, sels.optionSels);
        if (!opts.length) continue;
        var idx = _quizResolveAnswer(stem, opts);
        var useIdx = (idx != null && idx >= 0 && idx < opts.length) ? idx : Math.floor(Math.random() * opts.length);
        _quizClick(opts, useIdx);
        _quizSubmit(qEl, sels.submitSels);
        _quizHandled[fp] = true;
        answered++;
        try { Store.emit('ui:toast', '已作答 1 题（源=' + ((typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random') + '）'); } catch (e) { swallow(e); }
      }
    } catch (e) { swallow(e); }
    return answered;
  }

  // 配置默认值注入（CONFIG 可能尚未含这些字段，安全补默认值）
  try {
    if (typeof CONFIG !== 'undefined') {
      if (CONFIG.QUIZ_ANSWER_SOURCE == null) CONFIG.QUIZ_ANSWER_SOURCE = 'random';
      if (CONFIG.QUIZ_AI_ENDPOINT == null) CONFIG.QUIZ_AI_ENDPOINT = '';
    }
  } catch (e) {}

  try { window.__CX_FORCE_PLAY.quizTick = quizTick; } catch (e) {}
