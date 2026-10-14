// @provides: _quizClick, _quizIsMulti, _quizSource
// @requires: CONFIG, CX_KEYS, QUIZ, _quizAIPending, _quizCanRun, _quizRefreshSettlementStats, bestEffort, safeGet, swallow
// @source-group: takeover/engine/quiz.js
// 职责：题库与 AI 答案源、选项点击和提交；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  // 任何运行本脚本的帧收到（每帧独立注册，脚本级共享键）即执行 quizHardReset('video-play') —— 等同于刷新页面，
  // 使同一标签页各帧 + 跨标签同步收敛（播放 → 上一题时段立即从零开始）。
  var _quizEvictGmId = null;
  function _quizInstallEvictGM() {
    bestEffort(function () {
      if (_quizEvictGmId != null || typeof GM_addValueChangeListener !== 'function') return;
      _quizEvictGmId = GM_addValueChangeListener('cx_quiz_evict_v1', function (name, oldV, newV, remote) {
        if (!remote || !newV) return;   // 只响应其他标签页/帧写入；本帧已由 main-loop 直接清，跳过自身回环
        // v4.19.50 复核·开关守卫：本页关闭 QUIZ_EVICT_ON_VIDEO_PLAY 时，其他标签页的视频出清通知也不响应（否则关开关无效）
        if (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_EVICT_ON_VIDEO_PLAY === false) return;
        bestEffort(function () { quizHardReset('video-play'); }, 'quiz.evictGm');
      });
    }, 'quiz.evictGmInit');
  }

  // ---- 答案源解析 ----
  function _quizBankLookup(stem) {
    var bank = null;
    bestEffort(function () { bank = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.quizBank) || null; }, 'quiz.bank.win');
    if (!bank) {
      var raw = safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_BANK) : null; }, null);
      if (raw) { bank = safeGet(function () { return JSON.parse(raw); }, null); }
    }
    if (bank && typeof bank === 'object') {
      // 精确键或子串匹配
      if (bank[stem]) return bank[stem];
      var keys = Object.keys(bank);
      for (var k = 0; k < keys.length; k++) { if (stem && stem.indexOf(keys[k]) >= 0) return bank[keys[k]]; }
    }
    return null;
  }
  function _quizAskAI(stem, options, fp, qEl) {
    // AI 答案源接口：CONFIG.QUIZ_AI_ENDPOINT 由用户配置，脚本不内置密钥。
    // 同步环境无法 await：采用 fire-and-forget + 异步结果写回 quizBank，下轮命中回填；
    // 返回 'pending' 表示已发起异步请求（调用方暂不下发、不下坑，等下轮命中），其余返回 null。
    var ep = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_ENDPOINT) || '';
    if (!ep || !_quizCanRun()) return null;
    if (!_quizEndpointAllowed(ep)) return null;   // 离线优先 / 非白名单 → 不外发题目（隐私合规）
    var _pending = false;
    var request = null;
    bestEffort(function () {
      var req = _quizNewRequest('text', fp == null ? stem : fp, qEl);
      request = req;
      req.abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var payload = JSON.stringify({ stem: stem, options: options.map(function (o) { return (o.textContent || '').replace(/\s+/g, ' ').trim(); }) });
      fetchWithTimeout(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: req.abort ? req.abort.signal : undefined
      }, (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_TIMEOUT) || 15000).then(function (r) {
        if (!_quizRequestValid(req)) return null;
        if (!r || !r.ok) return null;
        return r.json();
      }).then(function (ans) {
        if (!_quizRequestValid(req)) { _quizCancelRequest(req); return null; }
        if (ans && (ans.index != null || ans.answer != null)) {
          var idx = ans.index != null ? ans.index : ans.answer;
          bestEffort(function () { window.__CX_FORCE_PLAY.quizBank = window.__CX_FORCE_PLAY.quizBank || {}; window.__CX_FORCE_PLAY.quizBank[stem] = idx; }, 'quiz.askAI.bankWrite');
        }
        if (fp != null) delete _quizAIPending[fp];
        _quizFinishRequest(req); _quizRefreshSettlementStats();
        return null;
      }).catch(function (e) { _quizCancelRequest(req); swallow(e); return null; });
      _pending = true;   // 同步链路建立成功（实际网络错误走上面 .catch，不影响返回值）
    }, 'quiz.askAI');
    if (!_pending && request) _quizCancelRequest(request);
    return _pending ? 'pending' : null;
  }
  // 求答案索引：返回数字索引（选项数组下标）或 null（调用方按 random 兜底）
  function _quizSource() {
    // 优先级：localStorage.cx_quiz_source（面板「做题」区设置）> CONFIG.QUIZ_ANSWER_SOURCE > 'random'
    var ls = safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.QUIZ_SOURCE) : null; }, null);
    if (ls === 'bank' || ls === 'ai' || ls === 'random') return ls;
    return ((typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random');
  }
  function _quizResolveAnswer(stem, options, fp, qEl) {
    var src = _quizSource();
    var answers = [];
    var multi = _quizIsMulti(options);   // 多选题：答案可能为多个下标（题库可存字母串"AB"/数组）
    // 本地题库：bank/ai 模式下作为高权重候选（本地缓存优先；random 模式尊重用户显式选择，不交叉查库避免"随机意图被题库覆盖"）
    if (src === 'bank' || src === 'ai') {
      var b = _quizBankLookup(stem);
      if (b != null) {
        // 多选题：题库可存多答案表示（字母串"AB"/"A,B"/下标数组）→ 解析为多个下标全选点击
        if (multi && b != null) {
          var bIdxs = null;
          if (Array.isArray(b)) {
            bIdxs = b.filter(function (i) { return typeof i === 'number' && i >= 0 && i < options.length; });
          } else {
            var _r = _quizAnswerToIdxs(String(b), options, true);
            if (_r && _r.idxs) bIdxs = _r.idxs;
          }
          if (bIdxs && bIdxs.length) return { idxs: bIdxs, confidence: 1.0, source: 'bank' };
        }
        var bi = (typeof b === 'number') ? b : parseInt(b, 10);
        if (!isNaN(bi)) answers.push({ idx: bi, score: 1.0, source: 'bank' });
      }
    }
    // AI 接口：同步环境发起异步请求（返回 'pending'）→ 下一轮命中 quizBank 回填；同步命中时作为 ai 权重候选参与融合
    if (src === 'ai') {
      // v4.19.20 审查修复：在途去重——fp 已有 AI 题解在途（_quizAIPending 登记）时不再重复 POST，
      // 否则每 tick（2s）重发同一题直到 QUIZ_AI_WAIT 超时（20s 窗口约 10 次重复外发，付费端点被刷流量/限流）
      if (fp != null && _quizAIPending[fp]) return { pending: true };
      var a = _quizAskAI(stem, options, fp, qEl);
      if (a === 'pending') {
        // §9.2-3：AI 异步题解进行中。若本轮已收集到 bank 答案（b 已 push 入 answers），应优先用 bank 先放行，
        // 避免丢弃已知答案→本可立即答对的题也空等一拍（AI 回填后下轮仍幂等命中 bank，无重复作答副作用）。
        if (answers.length) {
          var _mb = mergeAnswers(answers);
          if (_mb) return { idx: _mb.index, confidence: _mb.confidence, source: _mb.sources.join('+') };
        }
        return { pending: true };   // 异步题解进行中：调用方暂不下发、不下坑
      }
      // 注：_quizAskAI 同步仅返回 'pending' 或 null，从不返回数字索引 → 此处无同步答案可加权；
      // AI 解答经异步回填 quizBank 后由 'bank' 源闭环命中（见 _quizSettlePending）。
    }
    if (!answers.length) return null;   // 无候选 → 调用方 random 兜底
    // 加权融合 → { index, confidence, sources }；多来源同向累加、异向按占比降置信度
    var m = mergeAnswers(answers);
    if (!m) return null;
    return { idx: m.index, confidence: m.confidence, source: m.sources.join('+') };
  }

  function _quizClick(optEls, idx) {
    return safeGet(function () {
      var el = optEls[idx] || optEls[Math.floor(Math.random() * optEls.length)];
      if (!el) return false;
      // 触发选中：优先 click 选项本身；若选项是 label 包裹 input，则勾选其内部 input
      bestEffort(function () { el.click(); }, 'quiz.click.el');
      bestEffort(function () {
        var inp = el.querySelector('input[type="radio"], input[type="checkbox"]');
        if (inp) { inp.checked = true; bestEffort(function () { inp.click(); }, 'quiz.click.inp'); }
      }, 'quiz.click.inpFind');
      return true;
    }, false);
  }
  // v4.19.32·置信→行为纯映射（供 _onSettle 与 sim 共用，单一事实源）：
  // high→'submit'(点选+可提交) / mid→'hold'(点选但强制挂起待确认) / low→'random'(随机兜底+人工复核队列)
  function _quizVisConfAction(conf) {
    if (conf === 'low') return 'random';
    if (conf === 'mid') return 'hold';
    return 'submit';
  }
  function _quizSubmitCandidateAllowed(button) {
    if (!button || button.disabled || (button.getAttribute && button.getAttribute('aria-disabled') === 'true')) return false;
    var text = (button.textContent || '').replace(/\s/g, '');
    return !(/保存|暂存|草稿/.test(text) && !/提交|交卷/.test(text));
  }
  function _quizSubmit(qEl, sels) {
    if (!sels) sels = QUIZ.submitSels;
    var _found = safeGet(function () {
      for (var i = 0; i < sels.length; i++) { var b = qEl.querySelector(sels[i]); if (_quizSubmitCandidateAllowed(b)) { b.click(); return true; } }
      return false;
    }, false);
    if (_found) return true;
    // 明确提交类入口兜底。保存/暂存/草稿不能作为提交成功，缺少提交入口则保持待确认。
    return safeGet(function () {
      var btns = qEl.querySelectorAll('button, .btn, a[class*="btn"]');
      // 第一轮：提交类（提交/交卷/确定/下一题/作答）
      for (var j = 0; j < btns.length; j++) {
        var t = (btns[j].textContent || '').replace(/\s/g, '');
        if (/提交|交卷|确定|下一题|作答/.test(t) && _quizSubmitCandidateAllowed(btns[j])) { btns[j].click(); return true; }
      }
      return false;
    }, false);
  }

  // 随机兜底选下标：多选题返回 2 个互异随机下标（模拟"多选"语义，未知正确项时的中性猜测），单选题返回 1 个。
  function _quizRandomPick(opts, multi) {
    var n = opts.length;
    if (!multi || n <= 1) return [Math.floor(Math.random() * n)];
    var pool = []; for (var i = 0; i < n; i++) pool.push(i);
    for (var k = pool.length - 1; k > 0; k--) { var j = Math.floor(Math.random() * (k + 1)); var t = pool[k]; pool[k] = pool[j]; pool[j] = t; }
    return pool.slice(0, Math.min(2, n));
  }

  // 多选题判定：选项为 checkbox / role=checkbox / qtype=1 → 允许多选（需点击多个选项）。
  function _quizIsMulti(opts) {
    if (!opts) return false;
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      if (!o || !o.getAttribute) continue;
      if (o.getAttribute('role') === 'checkbox') return true;
      if (o.getAttribute('qtype') === '1') return true;
      if (o.getAttribute('type') === 'checkbox') return true;
      var inp = (o.querySelector && o.querySelector('input[type="checkbox"]'));
      if (inp) return true;
    }
    return false;
  }
