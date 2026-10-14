// @provides: _quizMOForced, _quizPageSubmitted, quizScanOnce
// @requires: QUIZ, _pqQueryAll, _quizCanRun, _quizDirtyGen, _quizInvalidateAsync, _quizPendingSubmit, _quizRetryTimer, _quizReviewItems, _quizVisGen, _quizVisTimers, bestEffort, isEffectiveTopFrame, quizTick, safeGet
// @source-group: takeover/engine/quiz.js
// 职责：提交确认、页面结果与 DOM 观察调度；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // v4.19.24 提交确认弹窗：超星点「提交」后弹确认框（如 el-message-box / role=dialog），脚本须代点「确定」，
  // 否则提交不生效、页面停留作答态继续运行（用户实测）。仅在我们自己点过提交后调用；弹窗正文含
  // 提交/交卷/保存/作答/完成/确认 关键词才自动确认（防误点其他弹窗）；按钮文本精确匹配 确定/确认/是/OK。
  function _quizConfirmDialog() {
    return safeGet(function () {
      if (typeof document === 'undefined' || !document.querySelectorAll) return false;
      var _boxes = _pqQueryAll(document, POPUP_BOX_SELS.split(',').concat(['[role="dialog"]', '[class*="message-box"]', '[class*="confirm"]', '[class*="Confirm"]']));
      for (var i = 0; i < _boxes.length; i++) {
        var b = _boxes[i];
        if (!b || !b.querySelector) continue;
        var rect = safeGet(function () { return b.getBoundingClientRect(); }, null);
        if (rect && (rect.width === 0 || rect.height === 0)) continue;   // 仅可见弹窗
        var body = safeGet(function () { return (b.textContent || '').replace(/\s/g, ''); }, '');
        if (!/提交|交卷|保存|作答|完成|确认|确定/.test(body)) continue;
        var btns = b.querySelectorAll('button, a[class*="btn"], .el-button');
        for (var j = 0; j < btns.length; j++) {
          var t = safeGet(function () { return (btns[j].textContent || '').replace(/\s/g, ''); }, '');
          if (/^(确定|确认|是|OK|知道了)$/.test(t)) {
            (function (_b2) { bestEffort(function () { _b2.click(); }, 'quiz.confirmDialog.click'); })(btns[j]);
            return true;
          }
        }
      }
      return false;
    }, false);
  }
  function _quizSubmitWithConfirm(qEl, sels, fp) {
    if (!_quizCanRun()) return false;
    var _ok = _quizSubmit(qEl, sels);
    if (_ok) {
      _quizConfirmDialog();
      // 弹窗可能延迟渲染：500ms 后补一次
      _quizSchedule(function () { bestEffort(function () { _quizConfirmDialog(); }, 'quiz.confirmDialog.retry'); }, 500);
    }
    return _ok;
  }

  // v4.19.10 需求·识别已提交：用户手动提交后页面进入结果/只读态——旧版无法识别，继续对已提交题目
  // 发起作答（重复截图/点选），灯也不变绿。检测信号（任一命中即视为已提交）：
  //   ① URL 结果页标记（showWorkResult/viewWorkResult/workResult 等）；
  //   ② 结果/成绩类元素（仅结果页专属 class：markResult/workResult/mark-res/result-wrap/answerResult/submit-success/submitted；
  //      刻意剔除裸 score/grade 子串——普通作答页含 score-*/grade-* 元素会被误判为已提交而提前停手）；
  //   ③ 页面已无任何提交按钮 且 全部扫描题均已被勾选/点选（只读回看态，保守双条件防误判）。
  var _quizSubmittedNotified = false;
  function _quizQSelected(qEl) {
    return safeGet(function () {
      if (!qEl || !qEl.querySelector) return false;
      if (qEl.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) return true;
      // 选项 li 被点选后的标记类（超星 addChoice 通常加 cur/on）；注意避开 checkbox 等宽泛子串
      if (qEl.querySelector('li[class*="cur"], li[class*="selected"], li[class*=" on"]')) return true;
      return false;
    }, false);
  }
  function _quizPageSubmitted(sels) {
    return safeGet(function () {
      if (typeof location !== 'undefined' && location.href && /(showworkresult|viewworkresult|workresult|examresult|resultpage|scoreresult|markresult)/i.test(location.href)) return true;
      var _doc = (typeof document !== 'undefined') ? document : null;
      if (_doc) {
        if (_doc.querySelector('[class*="markResult"],[class*="workResult"],[class*="mark-res"],[class*="result-wrap"],[class*="answerResult"],[class*="submit-success"],[class*="submitted"]')) return true;
        var _subSels = (sels && sels.submitSels) || (typeof QUIZ !== 'undefined' && QUIZ.submitSels) || [];
        if (_subSels.length) {
          var _anyBtn = false;
          for (var _bi = 0; _bi < _subSels.length; _bi++) {
            try { if (_doc.querySelector(_subSels[_bi])) { _anyBtn = true; break; } } catch (e) {}
          }
          // 信号③：无提交按钮 + 全部题目已勾选 → 只读回看/已提交（双条件，避免按钮延迟渲染误判）。
          // 仅在「自动提交」开启时生效：关闭自动提交（二次确认模式）下脚本有意「占位答完但挂起待确认」，
          // 此时无提交按钮 + 全题勾选是正常中间态，不得误判为已提交而提前停手。
          if (_quizAutoSubmit() && !_anyBtn && Object.keys(_quizPendingSubmit).length === 0
              && Object.keys(_quizReviewItems).length === 0 && _quizPendingAI() === 0) {
            var _qs = (typeof document !== 'undefined' && document.documentElement) ? _pqQueryAll(document.documentElement, (sels && sels.questionSels) || []) : [];
            if (_qs.length) {
              var _selN = 0;
              for (var _qi = 0; _qi < _qs.length; _qi++) { if (_quizQSelected(_qs[_qi])) _selN++; }
              if (_selN === _qs.length) return true;
            }
          }
        }
      }
      return false;
    }, false);
  }

  // —— MutationObserver：题目动态出现即触发作答，替代仅靠 2s 全文档轮询的空窗 ——
  var _quizObserver = null, _quizMOBusy = false, _quizMOTimer = null;
  var _quizMOForced = false;   // 状态机优化(卡顿排查)：MO 驱动标记——MO 触发（已有 1.2s/5s 动态防抖）不受 quizTick 无题节流限制
  function _quizMOTick() {
    bestEffort(function () {
      if (!_quizCanRun()) return;
      // 幂等性修复(审查 S-1)：卸载后（命名空间已删）不再触发答题 tick，杜绝 quizDisconnect 后防抖定时器
      // 仍驱动一次 quizTick 对页面作答。
      if (!(window && window.__CX_FORCE_PLAY)) return;
      var disp = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizObserveDispatch === 'function') ? window.__CX_FORCE_PLAY.quizObserveDispatch : quizTick;
      _quizMOForced = true;
      disp();
      _quizMOForced = false;
    }, 'quiz.moTick');
  }
  // 性能修复(卡顿排查)：答题页倒计时/动态元素会持续触发 MO——原 800ms 防抖使 MO 驱动 quizTick 每 ~1.8s
  // 一次全文档扫描，且每次置脏让全部题目缓存（_quizFingerprint/_quizStemCache）失效重读，
  // 与主循环 2s 扫描交错后 ≈ 每秒一次全题重读（大题库页持续卡顿）。
  // ① 防抖窗口 800→1500ms：MO 驱动扫描频率降至 ~2.5s 一次（主循环 2s 兜底，题目出现最迟 1.5s+扫描 触发）；
  // ② 置脏节流 2000ms：倒计时等高频变更不再每次失效全部缓存（缓存陈旧上限 2s，与主循环安全刷新节奏一致）。
  var _quizDirtyAt = 0;
  function _quizBumpDirty() {
    var _now = Date.now();
    if (_now - _quizDirtyAt >= 2000) { _quizDirtyAt = _now; _quizDirtyGen++; }
  }
  // 状态机优化(卡顿排查·答题调度)：MO 防抖按「变更性质」动态切换——
  //   ① 变更目标/新增节点含题目线索（class 含 question/quiz/timu/题/answer/option/stem/exam）→ 1200ms 短防抖，
  //      题目出现/更新即时响应作答；
  //   ② 无关变更（倒计时/动画/进度刷新）→ 5000ms 长防抖，多 iframe 页面（学习通作业页 4 层帧链 + 播放器帧）
  //      不再每 1.5s 各自全文档扫描——无题稳态下 MO 驱动扫描频率降 ~3 倍。
  //   配合 quizTick 的「无题节流」：主循环驱动扫描在无题稳态降至每 2 轮一次；题目出现由本 MO 短防抖即时接管。
  var _quizQuestionRe = /question|quiz|timu|题|answer|option|stem|exam/i;
  function _quizMOHasQuestionHint(muts) {
    if (!muts || !muts.length) return false;
    for (var i = 0; i < muts.length; i++) {
      var t = muts[i].target;
      if (t && t.className && _quizQuestionRe.test(String(t.className))) return true;
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var n = added[j];
        if (n && n.nodeType === 1 && n.className && _quizQuestionRe.test(String(n.className))) return true;
      }
    }
    return false;
  }
  function _quizMOHandle(muts) {
    if (!_quizCanRun()) { _quizCancelSchedulers(); return; }
    if (_quizMOBusy) return;
    _quizMOBusy = true;
    // 性能修复(加载感知)：有题线索防抖 1.2s→0.8s（与老版本 MO 防抖一致，题目出现→作答延迟不增加）；
    // 无关变更仍 5s 低频探测（倒计时/动画场景的省扫描收益保留，二者由线索分类解耦）。
    var _delay = _quizMOHasQuestionHint(muts) ? 800 : 5000;
    var _moFn = function () { _quizMOTimer = null; _quizMOBusy = false; _quizBumpDirty(); _quizMOTick(); };
    // 性能/治理修复(审查 MED-6)：MO 防抖定时器经 TimerRegistry 登记(owner 'quiz')，卸载由 clearAll 统一兜底，
    // 避免极端卸载竞态下残留一次裸 setTimeout 调度（与 _quizRetryTimer/main-loop 一致）。
    _quizMOTimer = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry)
      ? window.__CX_FORCE_PLAY.TimerRegistry.setTimeout(_moFn, _delay, 'quiz')
      : setTimeout(_moFn, _delay);
  }
  // 有效顶层帧判定（复用全局 isEffectiveTopFrame，异常回退字面顶层）：仅顶层帧下钻 iframe，避免多帧重复扫描。
  function _isEffectiveTop() {
    try { return isEffectiveTopFrame(); } catch (e) { try { return window.self === window.top; } catch (e2) { return true; } }
  }
  // 收集「可访问」子 iframe 文档：同源（含 about:blank/blob 继承父源）即纳入；
  // 真正跨域帧访问 contentDocument 会抛错 → 被 catch 跳过（属真实跨域盲区，需 @match 覆盖该源）。
  function _accessibleWorkFrames() {
    var out = [];
    try {
      var frames = (window.frames && window.frames.length) ? window.frames : [];
      for (var _i = 0; _i < frames.length; _i++) {
        var _fw = frames[_i];
        try {
          if (!_fw || _fw === window) continue;
          if (_fw.__CX_FORCE_PLAY) continue;   // 该帧已有自身引擎（TM 注入）→ 交其自处理，顶层下钻会双份状态重复作答
          var _doc = _fw.document || _fw.contentDocument;
          if (!_doc || !_doc.documentElement) continue;
          out.push(_doc);
        } catch (e) { /* 跨域帧不可达 → 跳过 */ }
      }
    } catch (e) {}
    return out;
  }
  function quizObserve(root) {
    // v4.19.20 审查修复：卸载守卫（与 _quizMOTick/quizScanOnce 一致）——uninstall 后 1.2s 初始化定时器
    // 即便触发也不会重挂 MO（旧实现缺守卫 → 卸载后重建永不 disconnect 的 MutationObserver）
    if (!(window && window.__CX_FORCE_PLAY)) return false;
    if (typeof MutationObserver === 'undefined') return false;
    return safeGet(function () {
      bestEffort(function () { if (_quizObserver) _quizObserver.disconnect(); }, 'quiz.obs.disconnect');
      var r = root || (typeof document !== 'undefined' ? (document.body || document.documentElement) : null);
      if (!r) return false;
      _quizObserver = new MutationObserver(function (muts) { _quizMOHandle(muts); });
      _quizObserver.observe(r, { childList: true, subtree: true });
      // 修复·iframe 盲区：有效顶层帧对可访问子 iframe 文档一并挂 MO，捕获嵌套作业帧内动态出现的题目
      if (_isEffectiveTop()) {
        var _awf = _accessibleWorkFrames();
        for (var _ai = 0; _ai < _awf.length; _ai++) {
          try { if (_awf[_ai] && _awf[_ai].documentElement) _quizObserver.observe(_awf[_ai].documentElement, { childList: true, subtree: true }); } catch (e) {}
        }
      }
      return true;
    }, false);
  }
  // 修复·静态题检测兜底（用户报告 v4.19「一直检测不出题目」）：
  //   v4.19 起主循环仅顶层帧一份，iframe 作业页（doHomeWorkNew 等）不再有每帧 2s 轮询；
  //   MutationObserver 只对「挂载后新增」的节点触发——题目若在挂载前已静态渲染（学习通
  //   作业页常见），MO 永不触发 → 永远检测不到。本函数在 quizObserve 挂载后立即补扫一次，
  //   与 v4.18 每帧轮询的检测语义对齐（仅一次，零持续开销）。
  function quizScanOnce() {
    bestEffort(function () {
      if (!(window && window.__CX_FORCE_PLAY)) return;
      _quizMOForced = true;
      var _sd = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizObserveDispatch === 'function') ? window.__CX_FORCE_PLAY.quizObserveDispatch : quizTick;
      _sd();
      _quizMOForced = false;
    }, 'quiz.scanOnce');
  }
  // S10 修复：暴露 disconnect，供 lifecycle.cleanupListeners 在页面卸载时断开题目 MO，避免孤立回调滞留（与 dom.js 的 _mo.disconnect 一致）
  function quizDisconnect() {
    _quizInvalidateAsync('disconnect');
    bestEffort(function () {
      // 幂等性修复(审查 S-1/A-1)：一并取消在途 MO 防抖定时器（旧实现 disconnect 后防抖仍会触发一次 _quizMOTick）
      if (_quizMOTimer) {
        if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry) window.__CX_FORCE_PLAY.TimerRegistry.clearTimeout(_quizMOTimer);
        else clearTimeout(_quizMOTimer);
        _quizMOTimer = null; _quizMOBusy = false;
      }
      // v4.19.5：子帧待答重扫定时器一并取消（经 TimerRegistry 登记，卸载后零残留调度）
      if (_quizRetryTimer) {
        bestEffort(function () { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry) window.__CX_FORCE_PLAY.TimerRegistry.clearInterval(_quizRetryTimer); }, 'quiz.retry.disconnect');
        _quizRetryTimer = null;
      }
      // 线程审计：清除全部在途视觉超时定时器（最长 45s 的裸定时器不再残留，卸载后零在途调度）
      for (var _vk in _quizVisTimers) {
        if (_quizVisTimers.hasOwnProperty(_vk)) { try { clearTimeout(_quizVisTimers[_vk]); } catch (e) {} }
      }
      _quizVisTimers = {};
      _quizVisGen = {};   // 仅清登记表；_quizEpoch/_quizRequestSeq 保持单调
      if (_quizCancelSubscription) { _quizCancelSubscription(); _quizCancelSubscription = null; }
      if (_quizResumeSubscription) { _quizResumeSubscription(); _quizResumeSubscription = null; }
      if (_quizGateStorageHandler) { window.removeEventListener('storage', _quizGateStorageHandler); _quizGateStorageHandler = null; }
      if (_quizObserver) { _quizObserver.disconnect(); _quizObserver = null; }
      // v4.19.50：卸载视频播放出清 GM 监听（脚本级长驻，不 remove 会残留）
      if (_quizEvictGmId != null && typeof GM_removeValueChangeListener === 'function') {
        try { GM_removeValueChangeListener(_quizEvictGmId); } catch (e) {}
        _quizEvictGmId = null;
      }
    }, 'quiz.disconnect');
  }
  // v4.19.50：视频「播放事件」完全出清通知监听（GM 键 cx_quiz_evict_v1，由 main-loop 播放守卫写入）。
