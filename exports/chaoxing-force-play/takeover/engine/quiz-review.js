// @requires: CX_KEYS, EventBus, QUIZ, _quizCanRun, _quizClick, _quizPendingSubmit, _quizRefreshSettlementStats, _quizReviewItems, _quizSyncLights, bestEffort, safeGet
// @source-group: takeover/engine/quiz.js
// 职责：人工复核与题库写入；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  // —— 人工复核闭环 API（评估建议#6：增量学习——用户纠正结果入本地题库）——
  // 写入题库：内存对象 + localStorage(CX_KEYS.QUIZ_BANK) 同步持久化（与 _quizAskAI 回填路径一致）
  function _quizBankWrite(stem, idx) {
    return safeGet(function () {
      window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
      window.__CX_FORCE_PLAY.quizBank = window.__CX_FORCE_PLAY.quizBank || {};
      window.__CX_FORCE_PLAY.quizBank[stem] = idx;
      if (typeof localStorage !== 'undefined') {
        bestEffort(function () { localStorage.setItem(CX_KEYS.QUIZ_BANK, JSON.stringify(window.__CX_FORCE_PLAY.quizBank)); }, 'quiz.bankWrite.ls');
      }
      return true;
    }, false);
  }
  // 列出待人工复核项：[{fp,stem,opts,guessedIdx,ts}]
  function quizReviewList() { return safeGet(function () { return Object.keys(_quizReviewItems).map(function (k) { return _quizReviewItems[k]; }); }, []); }
  // 采纳指定答案入题库（correctIdx 缺省=采用当前随机猜测值），并移出复核队列；成功返回 true
  function quizReviewAccept(fp, correctIdx) {
    return safeGet(function () {
      if (!_quizCanRun()) return false;
      var it = _quizReviewItems[fp]; if (!it) return false;
      var idx = (correctIdx == null) ? it.guessedIdx : correctIdx;
      var rec = _quizPendingSubmit[fp];
      if (rec && rec.qEl) {
        var opts = _quizOptions(rec.qEl, rec.optionSels || QUIZ.optionSels);
        if (typeof idx !== 'number' || idx < 0 || idx >= opts.length) return false;
        _quizClick(opts, idx);
      }
      var ok = _quizBankWrite(it.stem, idx);
      if (ok) { delete _quizReviewItems[fp]; bestEffort(function () { EventBus.emit('ui:toast', '已采纳入本地题库（fp=' + fp.slice(0, 16) + '）'); }, 'quiz.reviewAccept.toast'); }
      _quizRefreshSettlementStats(); _quizSyncLights();
      return ok;
    }, false);
  }
  // 导出待复核题为 JSON 文本（供用户核对/外部维护题库），返回字符串
  function quizReviewExport() {
    return safeGet(function () {
      var arr = quizReviewList().map(function (it) { return { stem: it.stem, options: (it.optTexts || []).map(function (o) { return (o && o.textContent) ? o.textContent : o; }), guessedIdx: it.guessedIdx }; });
      return JSON.stringify(arr, null, 2);
    }, '[]');
  }
  bestEffort(function () { window.__CX_FORCE_PLAY.quizReviewList = quizReviewList; }, 'quiz.export.reviewList');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizReviewAccept = quizReviewAccept; }, 'quiz.export.reviewAccept');
  bestEffort(function () { window.__CX_FORCE_PLAY.quizReviewExport = quizReviewExport; }, 'quiz.export.reviewExport');
