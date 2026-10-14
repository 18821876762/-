// @requires: CX_KEYS, EventBus, QUIZ, _pqQueryAll, _quizAIPending, _quizCanRun, _quizPendingSubmit, _quizPrunePending, _quizRefreshSettlementStats, _quizReviewItems, _quizSettled, _quizSource, _quizSyncLights, bestEffort, safeGet, swallow
// @source-group: takeover/engine/quiz.js
// 职责：填空回填、待确认与手动提交；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  function _quizAutoSubmit() {
    // 默认自动提交（cx_quiz_autosubmit 未置 '0' 即自动）。考试/高风险场景建议关，由人工确认。
    return safeGet(function () { if (typeof localStorage === 'undefined') return true; var v = localStorage.getItem(CX_KEYS.QUIZ_AUTO_SUBMIT); return v === null ? true : (v !== '0'); }, true);
  }
  // ───────────────────── 填空题自动回填(step2) ─────────────────────
  // 双路径注入：input/textarea(原生 setter + input/change 事件) 与 contenteditable(execCommand/insertText)。
  // 均不走剪贴板 → 超星「禁止粘贴」拦截对程序化写入无效（用户实测提示：学习通复制粘贴被禁）。
  function _quizFillEnabled() {
    // 默认关（未显式置 '1' 即不开）：填空回填属高风险动作，需用户面板显式开启；与「自动提交」默认开相反
    return safeGet(function () { if (typeof localStorage === 'undefined') return false; var v = localStorage.getItem(CX_KEYS.QUIZ_FILL_ENABLED); return v === '1'; }, false);
  }
  // 单输入框写入（自动区分 input/textarea 与 contenteditable；contenteditable 用 insertText 模拟真实输入）
  function _quizFillSet(el, text) {
    return safeGet(function () {
      var tag = (el.tagName || '').toUpperCase();
      if (tag === 'TEXTAREA' || tag === 'INPUT') {
        var proto = Object.getPrototypeOf(el);
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(el, text); else el.value = text;   // 复用 _dsInjectText 的 React 受控输入兼容写法
      } else if (el.getAttribute && (el.getAttribute('contenteditable') === '' || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === 'plaintext-only')) {
        el.focus();
        if (typeof document !== 'undefined' && document.execCommand) { try { document.execCommand('insertText', false, text); } catch (e) { el.textContent = text; } }
        else el.textContent = text;
      } else { return false; }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, false);
  }
  // 填空题答案回填：多空题支持数组逐空填入，单字符串则所有空填同值
  function _quizFillInject(qEl, sels, text) {
    var _sel = (sels && sels.fillInputSels && sels.fillInputSels.length) ? sels.fillInputSels.concat(['[contenteditable]']) : ['input[type="text"]', 'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])', 'textarea', '[contenteditable]'];
    var _els = [];
    bestEffort(function () { _els = Array.prototype.slice.call(qEl.querySelectorAll(_sel.join(','))); }, 'quiz.fill.inject.query');
    if (!_els.length) return false;
    var _arr = (text instanceof Array) ? text : null;
    var _ok = false;
    for (var _i = 0; _i < _els.length; _i++) {
      var _t = (_arr && _arr[_i] != null) ? String(_arr[_i]) : (typeof text === 'string' ? text : (text != null ? String(text) : ''));
      if (_quizFillSet(_els[_i], _t)) _ok = true;
    }
    return _ok;
  }
  // 填空题求文本答案：题库文本命中(优先) → AI 文本(源=ai 且在外发白名单内) → 否则无答案源
  function _quizResolveFillAnswer(stem, fp, qEl) {
    var b = _quizBankLookup(stem);
    if (typeof b === 'string') return { text: b, confidence: 1.0, source: 'bank' };   // 单空文本答案
    if (b instanceof Array) return { text: b, confidence: 1.0, source: 'bank' };        // 多空数组：逐空填入
    if (b != null) return null;                                                       // 数字/选项索引 → 非填空答案
    var src = _quizSource();
    if (src === 'ai') {
      if (fp != null && _quizAIPending[fp]) return { pending: true };
      var a = _quizAskAI(stem, [], fp, qEl);   // 填空无选项；回写受本题请求身份与生命周期共同约束
      if (a === 'pending') { if (fp != null && !_quizAIPending[fp]) _quizAIPending[fp] = Date.now(); return { pending: true }; }
    }
    return null;   // random 模式/库空/AI 关 → 无文本答案源，转人工
  }
  // 填空题求解：解析+注入；返回结果状态由调用方登记（不自动提交，挂二次确认）
  function _quizFillAnswer(qEl, stem, sels, fp) {
    var res = _quizResolveFillAnswer(stem, fp, qEl);
    if (!res) return { status: 'manual' };                                       // 无答案源 → 待人工（蓝灯保持）
    if (res.pending) return { status: 'pending' };                                // AI 在途 → 下轮命中回填
    if (!_quizFillInject(qEl, sels, res.text)) return { status: 'manual', noinput: true };   // 无输入框/注入失败 → 转人工(橙)
    return { status: 'filled', source: res.source };                              // 回填成功
  }
  function _quizMaybeSubmit(qEl, submitSels, fp) {
    if (!_quizCanRun()) return false;
    if (_quizAutoSubmit() && !(fp != null && _quizReviewItems[fp])) {
      var _ok = _quizSubmitWithConfirm(qEl, submitSels, fp);   // v4.19.24：代点提交确认弹窗
      if (_ok) {
        if (fp != null) { _quizSettled[fp] = true; delete _quizPendingSubmit[fp]; }
        _quizRefreshSettlementStats();
        return true;
      }
    }
    // 二次确认模式：已作答未提交，挂起等待「确认提交」
    if (fp != null) { _quizPendingSubmit[fp] = { qEl: qEl, sels: submitSels, ts: Date.now() }; _quizPrunePending(); }
    return false;
  }
  function quizSubmitPending() {
    // 用户「确认提交」：批量提交所有已作答待确认的题（按记录复找提交按钮）
    var n = 0;
    if (!_quizCanRun()) return n;
    bestEffort(function () {
      if (typeof _quizPendingSubmit !== 'object' || !_quizPendingSubmit) return;
      for (var fp in _quizPendingSubmit) {
        (function (fp) {
          var rec = _quizPendingSubmit[fp];
          if (!rec || !rec.qEl) { bestEffort(function () { delete _quizPendingSubmit[fp]; }, 'quiz.submitP.del1'); return; }
          if (_quizReviewItems[fp]) return;   // 先完成答案复核，再确认提交
          if (_quizSubmitWithConfirm(rec.qEl, rec.sels, fp)) { n++; _quizSettled[fp] = true; delete _quizPendingSubmit[fp]; }
        })(fp);
      }
      bestEffort(function () {
        if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) {
          window.__CX_FORCE_PLAY.quizStats = window.__CX_FORCE_PLAY.quizStats || {};
          window.__CX_FORCE_PLAY.quizStats.pendingSubmit = Object.keys(_quizPendingSubmit).length;
        }
      }, 'quiz.stats.pendingSubmit');
      _quizRefreshSettlementStats();
      _quizSyncLights();
      if (n > 0) bestEffort(function () { EventBus.emit('ui:toast', '已确认提交 ' + n + ' 题'); }, 'quiz.toast.submitPending');
    }, 'quiz.submitPending');
    return n;
  }

  // v4.19.22 需求·手动提交（用户测试提交功能）：对当前帧全部扫描题执行提交（逐题按钮优先，
  // 无逐题按钮则兜底点击页面级提交按钮）。题目常在 iframe 内 → quizManualSubmit 沿同源帧递归下发命令。
  function _submitScannedLocal() {
    bestEffort(function () {
      if (!_quizCanRun()) return;
      if (!(window && window.__CX_FORCE_PLAY)) return;
      if (typeof document === 'undefined' || !document.documentElement) return;
      var _sels = (typeof CHAOXING_EXAM !== 'undefined' && CHAOXING_EXAM && CHAOXING_EXAM.questionSels) ? CHAOXING_EXAM : QUIZ;
      var _qs = _pqQueryAll(document.documentElement, _sels.questionSels || []);
      var _n = 0;
      for (var i = 0; i < _qs.length; i++) { if (_quizSubmitWithConfirm(_qs[i], _sels.submitSels || [], null)) _n++; }
      if (!_n) {
        // 无逐题提交按钮（如整卷一次性提交的作业页）→ 兜底点击页面级提交按钮（用户主动操作，弹窗由其确认）。
        // v4.19.23：提交类文本优先（提交/交卷/确定/下一题/作答）；保存类绝不自动点击（草稿暂存≠提交，用户实测误点保存）。
        var _globals = _pqQueryAll(document, (_sels.submitSels || []).concat(['button[type="submit"]', '[class*="submit"]', '[class*="Submit"]']));
        for (var j = 0; j < _globals.length; j++) {
          var t = safeGet(function () { return (_globals[j].textContent || _globals[j].innerText || '').replace(/\s/g, ''); }, '');
          if (/提交|交卷|确定|下一题|作答/.test(t)) {
            (function (_b) { bestEffort(function () { _b.click(); }, 'quiz.manualSubmit.global'); })(_globals[j]);
            // v4.19.24：代点提交确认弹窗（弹窗延迟渲染时 500ms 后补点）
            _quizConfirmDialog();
            _quizSchedule(function () { bestEffort(function () { _quizConfirmDialog(); }, 'quiz.confirmDialog.globalRetry'); }, 500);
            _n = -1;
            break;
          }
        }
        if (!_n) {
          // 反馈：仅发现保存类按钮时提示用户手动确认（不代点）
          var _saves = _pqQueryAll(document, ['.save-btn', '[class*="save"]', 'a.btnSave']);
          var _hasSave = _saves.some(function (b) {
            var t3 = safeGet(function () { return (b.textContent || b.innerText || '').replace(/\s/g, ''); }, '');
            return /保存|暂存|存草稿/.test(t3);
          });
          if (_hasSave) {
            if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('ui:toast', '未找到提交按钮（仅发现保存按钮，未自动点击——草稿暂存≠提交，请手动确认）', 'warn');
            return;
          }
        }
      }
      if (typeof EventBus !== 'undefined' && EventBus.emit) {
        EventBus.emit('ui:toast', _n > 0 ? ('手动提交：已点击 ' + _n + ' 个题提交按钮') : (_n === -1 ? '手动提交：已点击页面提交按钮（弹窗请确认）' : '手动提交：未找到提交按钮'), _n ? 'success' : 'warn');
      }
    }, 'quiz.manualSubmit.local');
  }
  function quizManualSubmit() {
    // 沿同源帧递归下发「手动提交」命令（题目在 iframe 内时由各帧处理自身 DOM；跨源帧不可达则跳过）
    bestEffort(function () {
      var _sent = 0;
      var _walk = function (w) {
        if (!w) return;
        try {
          if (w !== window && w.postMessage) { w.postMessage({ __cxQuizCmd: 'manual-submit', ts: Date.now() }, w.origin); _sent++; }
        } catch (e) {}
        var _fs = (typeof w.frames !== 'undefined') ? w.frames : [];
        for (var i = 0; i < _fs.length; i++) { try { _walk(_fs[i]); } catch (e) {} }
      };
      var _top = (window.top && window.top !== window) ? window.top : window;
      _walk(_top);
      _submitScannedLocal();   // 本帧同样执行（顶层帧无题则 no-op）
    }, 'quiz.manualSubmit');
  }
  var _quizCmdHandler = null;   // v4.19.22：跨帧手动提交命令接收端（具名供 lifecycle 清理）
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    bestEffort(function () {
      _quizCmdHandler = function (e) {
        try {
          var d = e && e.data;
          if (!d || d.__cxQuizCmd !== 'manual-submit') return;
          if (e.origin && e.origin !== window.location.origin) return;   // 仅同源
          if (e.source && e.source !== window.top) return;               // 仅接受顶层帧命令
          _submitScannedLocal();
        } catch (err) { swallow(err, 'quiz.cmd.rcv'); }
      };
      window.addEventListener('message', _quizCmdHandler);
    }, 'quiz.cmd.bind');
  }
