  // ===== DOMAIN: biz/popup-quiz (站点无关·弹窗题目随机作答共享骨架) =====
  // ===== MODULE: 上课/随堂弹窗题目「随机选 → 答题 → 删弹窗」(站点无关) =====
  // 域：业务模块 —— 与站点无关；由各平台模块传入同构 selectors 映射后调用 popupQuizTick()。
  // 【用途】智慧树/中国大学MOOC/学堂在线/智慧职教 等平台上课期间弹「随堂题目」干扰播放，
  //   用户明确「不要求对错、只随机选一个然后答题、删弹窗」→ 本模块消干扰、保续播不被弹窗挡住。
  // 【复用】把 zhihuishu.js 原有的弹窗处理逻辑抽成通用骨架，避免每个 MOOC 平台重写一遍。
  //   站点差异仅在选择器映射(SELECTORS 同构)，逻辑只写一处（P4 收口思想落地）。
  var POPUP_QUIZ = {
    dialogSels: ['.dialog-wrap', '.question-pop', '.topic-pop', '.ans-pop', '.pop-box', '.question-dialog',
                 '.tk-pop', '.modal', '.exam-pop', '[class*="question"]', '[class*="topic"]', '[class*="answer"]', '[class*="popup"]'],
    optionSels: ['.topic-item', '.option-item', '.answer-item', 'li[class*="option"]', '.dialog-wrap li',
                 '[class*="choice"]', '.q-item', '.select-item'],
    answerBtnSels: ['.answer-btn', '.submit-btn', '.dialog-submit', '.topic-submit', 'button[class*="answer"]',
                    'button[class*="submit"]', '.pop-btn', '.confirm-btn']
  };

  var _pqHandled = {};   // 已处理弹窗指纹去重（防同弹窗重复点击/删）
  var _pqPopups = 0;     // 累计已自动作答并关闭的弹窗数（面板「做题」区计数用）
  var _pqDisabledNotified = false;   // 「弹窗自动作答」关闭提示去重，避免每轮刷屏
  function _pqSnapshot() { try { window.__CX_FORCE_PLAY.popupQuizStats = { popups: _pqPopups, ts: Date.now() }; } catch (e) {} }
  function _pqFingerprint(el) {
    try { var s = (el.className || '') + '|' + (el.id || '') + '|' + (el.textContent || '').slice(0, 80); return 'pq:' + s.length + ':' + s; }
    catch (e) { return 'pq:err'; }
  }
  function _pqQuery(root, sels) {
    if (!root || !root.querySelectorAll) return null;
    for (var i = 0; i < sels.length; i++) { try { var n = root.querySelector(sels[i]); if (n) return n; } catch (e) { swallow(e); } }
    return null;
  }
  function _pqQueryAll(root, sels) {
    var out = []; if (!root || !root.querySelectorAll) return out;
    for (var i = 0; i < sels.length; i++) { try { var ns = root.querySelectorAll(sels[i]); for (var j = 0; j < ns.length; j++) out.push(ns[j]); } catch (e) { swallow(e); } }
    return out;
  }
  function _pqPickRandom(dialog) {
    var opts = _pqQueryAll(dialog, POPUP_QUIZ.optionSels);
    if (!opts.length) return null;
    var pick = opts[Math.floor(Math.random() * opts.length)];
    try { pick.click(); } catch (e) { swallow(e); }
    return pick;
  }
  function _pqClickAnswer(dialog) {
    var btn = _pqQuery(dialog, POPUP_QUIZ.answerBtnSels);
    if (!btn) {
      try {
        var btns = dialog.querySelectorAll('button, .btn, a[class*="btn"]');
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || btns[i].innerText || '').replace(/\s/g, '');
          if (/答题|提交|确定|作答|下一题|close|关闭/.test(t)) { btn = btns[i]; break; }
        }
      } catch (e) { swallow(e); }
    }
    if (btn) { try { btn.click(); } catch (e) { swallow(e); } return true; }
    return false;
  }
  function _pqRemove(dialog) {
    try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); else if (dialog.remove) dialog.remove(); }
    catch (e) { try { dialog.style.display = 'none'; dialog.style.visibility = 'hidden'; } catch (e2) { swallow(e2); } }
  }
  function _pqHandle(dialog) {
    if (!dialog) return false;
    var fp = _pqFingerprint(dialog);
    if (_pqHandled[fp]) return false;
    _pqHandled[fp] = true;
    try {
      _pqPickRandom(dialog);
      _pqClickAnswer(dialog);
      _pqRemove(dialog);
      _pqPopups++; _pqSnapshot();   // 累计已处理弹窗，供面板「做题」区计数
      try { Store.emit('ui:toast', '已自动作答并关闭题目弹窗（累计 ' + _pqPopups + '）'); } catch (e3) { swallow(e3); }
      return true;
    } catch (e) { swallow(e); return false; }
  }

  // 通用入口：扫描弹窗并逐个随机作答+删除。selectors 可选覆盖默认 POPUP_QUIZ（站点特化）。
  function popupQuizTick(selectors) {
    // 中途关闭闸门：localStorage.cx_popup_quiz==='0' → 不处理随堂题弹窗（需用户手动关闭，否则可能遮挡播放）
    try { if (typeof localStorage !== 'undefined' && localStorage.getItem('cx_popup_quiz') === '0') {
      if (!_pqDisabledNotified) { _pqDisabledNotified = true; try { Store.emit('ui:toast', '弹窗自动作答已关闭（本次不处理随堂题）'); } catch (e) {} }
      return 0;
    } } catch (e) {}
    var sels = selectors || POPUP_QUIZ;
    var handled = 0;
    try {
      var root = (document && document.documentElement) || document;
      var dialogs = _pqQueryAll(root, sels.dialogSels);
      for (var i = 0; i < dialogs.length; i++) { if (_pqHandle(dialogs[i])) handled++; }
      if (handled === 0) {
        // 兜底：扫描含「答题/提交」按钮的浮层（无稳定 class 的弹窗）
        var allBtns = root.querySelectorAll ? root.querySelectorAll('button, a[class*="btn"]') : [];
        for (var b = 0; b < allBtns.length; b++) {
          var txt = (allBtns[b].textContent || allBtns[b].innerText || '').replace(/\s/g, '');
          if (/答题|提交|确定|作答/.test(txt)) {
            var cand = allBtns[b].closest ? allBtns[b].closest('div,section,li') : null;
            if (cand && _pqHandle(cand)) { handled++; break; }
          }
        }
      }
    } catch (e) { swallow(e); }
    return handled;
  }

  try { window.__CX_FORCE_PLAY.popupQuizTick = popupQuizTick; } catch (e) {}
