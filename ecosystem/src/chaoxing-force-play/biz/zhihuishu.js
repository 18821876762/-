  // ===== DOMAIN: biz/zhihuishu (Zhihuishu / 智慧树-知到 专属业务) =====
  // ===== MODULE: 智慧树上课弹窗题目自动处理 =====
  // 域：业务模块 —— 智慧树(知到)专属，与超星(学习通)完全隔离；仅 detectSite()==='zhihuishu' 时才激活。
  // 【需求差异】智慧树上课期间会弹出「随堂题目」弹窗（互动题/弹幕答题），其 UI 与超星学习通结构完全不同：
  //   ① 无 window.attachments 白名单、无 window.ananas 私有暂停封装（已由 site-router.js 收口为智慧树空键）；
  //   ② 强制续播仍由原型级 pause 中性化(usePrototypeNeutralize auto 分支对智慧树激进)兜底，无需本模块介入；
  //   ③ 本模块独有职责：弹窗题目干扰处理 —— 随机选一个选项 → 点击「答题」按钮 → 删除弹窗。
  // 题目对错不在意（用户明确：只要求随机选一个然后答题、删弹窗），故不解析题干语义、不判断正确率。
  //
  // 【选择器校准】智慧树真实 DOM 结构待实测校准，下方选择器为 best-effort 猜测并集，命中其一即生效。
  //   真实站点接入时只需调 ZHIHUISHU.selectors 映射，无需改逻辑（P4 同款收口思想）。
  var ZHIHUISHU = {
    // 弹窗根容器候选选择器（命中任一即视为题目弹窗）
    dialogSels: ['.dialog-wrap', '.question-pop', '.topic-pop', '.ans-pop', '.pop-box', '.question-dialog', '.tk-pop', '[class*="question"]', '[class*="topic"]', '[class*="answer"]'],
    // 选项（单选/多选候选项）候选选择器
    optionSels: ['.topic-item', '.option-item', '.answer-item', 'li[class*="option"]', '.dialog-wrap li', '[class*="choice"]'],
    // 「答题 / 提交 / 确定」按钮候选选择器
    answerBtnSels: ['.answer-btn', '.submit-btn', '.dialog-submit', '.topic-submit', 'button[class*="answer"]', 'button[class*="submit"]', '.pop-btn']
  };

  // 已处理弹窗的去重指纹集合（防同弹窗被轮询重复点击/删两次导致闪烁或误触）
  var _zhsHandled = {};
  function _zhsFingerprint(el) {
    try {
      var s = (el.className || '') + '|' + (el.id || '') + '|' + (el.textContent || '').slice(0, 80);
      return 'zhs:' + s.length + ':' + s;
    } catch (e) { return 'zhs:err'; }
  }

  // 在某容器(或 document)内按候选选择器并集查找首个命中元素
  function _zhsQuery(root, sels) {
    if (!root || !root.querySelectorAll) return null;
    for (var i = 0; i < sels.length; i++) {
      try {
        var node = root.querySelector(sels[i]);
        if (node) return node;
      } catch (e) { swallow(e); }
    }
    return null;
  }
  function _zhsQueryAll(root, sels) {
    var out = [];
    if (!root || !root.querySelectorAll) return out;
    for (var i = 0; i < sels.length; i++) {
      try {
        var nodes = root.querySelectorAll(sels[i]);
        for (var j = 0; j < nodes.length; j++) out.push(nodes[j]);
      } catch (e) { swallow(e); }
    }
    return out;
  }

  // 随机选一个选项并高亮（视觉反馈，不改答题语义）：点击第一项即可触发平台选中态
  function _zhsPickRandomOption(dialog) {
    var opts = _zhsQueryAll(dialog, ZHIHUISHU.optionSels);
    if (!opts.length) return null;
    var pick = opts[Math.floor(Math.random() * opts.length)];
    try { pick.click(); } catch (e) { swallow(e); }   // 触发平台选中逻辑（radio/checkbox 切换）
    return pick;
  }

  // 点击「答题」按钮：优先按候选选择器，退而求其次找弹窗内文字含「答题/提交/确定」的 button
  function _zhsClickAnswerBtn(dialog) {
    var btn = _zhsQuery(dialog, ZHIHUISHU.answerBtnSels);
    if (!btn) {
      try {
        var btns = dialog.querySelectorAll('button, .btn, a[class*="btn"]');
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || btns[i].innerText || '').replace(/\s/g, '');
          if (/答题|提交|确定|作答/.test(t)) { btn = btns[i]; break; }
        }
      } catch (e) { swallow(e); }
    }
    if (btn) { try { btn.click(); } catch (e) { swallow(e); } return true; }
    return false;
  }

  // 处理单个题目弹窗：随机选 → 答题 → 删除弹窗。返回 true 表示已处理（用于去重/计数）
  function _zhsHandleDialog(dialog) {
    if (!dialog) return false;
    var fp = _zhsFingerprint(dialog);
    if (_zhsHandled[fp]) return false;            // 已处理过，跳过（防重复点击/删）
    _zhsHandled[fp] = true;
    try {
      _zhsPickRandomOption(dialog);               // ① 随机选一个选项（触发选中态）
      _zhsClickAnswerBtn(dialog);                 // ② 点击「答题 / 提交」按钮
      // ③ 删除弹窗：优先 removeChild，失败则隐藏兜底（避免残留遮挡播放器）
      try {
        if (dialog.parentNode) dialog.parentNode.removeChild(dialog);
        else if (dialog.remove) dialog.remove();
      } catch (e) {
        try { dialog.style.display = 'none'; dialog.style.visibility = 'hidden'; } catch (e2) { swallow(e2); }
      }
      try { Store.emit('ui:toast', '智慧树：已自动作答并关闭题目弹窗'); } catch (e3) { swallow(e3); }
      dbg('智慧树弹窗已处理：', fp.slice(0, 40));
      return true;
    } catch (e) { swallow(e); return false; }
  }

  // 每轮扫描：找出当前页面所有题目弹窗并逐个处理
  function zhihuishuTickQuestions() {
    if (detectSite() !== 'zhihuishu') return 0;   // 隔离：非智慧树页面不执行任何逻辑
    var handled = 0;
    try {
      var root = (document && document.documentElement) || document;
      // 先按根容器候选直接定位弹窗
      var dialogs = _zhsQueryAll(root, ZHIHUISHU.dialogSels);
      for (var i = 0; i < dialogs.length; i++) {
        if (_zhsHandleDialog(dialogs[i])) handled++;
      }
      // 兜底：某些弹窗无稳定 class（如行内 style 动态题），扫描含「答题」按钮的浮层 div
      if (handled === 0) {
        var allBtns = root.querySelectorAll ? root.querySelectorAll('button, a[class*="btn"]') : [];
        for (var b = 0; b < allBtns.length; b++) {
          var txt = (allBtns[b].textContent || allBtns[b].innerText || '').replace(/\s/g, '');
          if (/答题|提交|确定|作答/.test(txt)) {
            var cand = allBtns[b].closest ? allBtns[b].closest('div,section,li') : null;
            if (cand && _zhsHandleDialog(cand)) { handled++; if (handled >= 1) break; }
          }
        }
      }
    } catch (e) { swallow(e); }
    return handled;
  }

  // 暴露给主循环与回归测试
  try { window.__CX_FORCE_PLAY.zhihuishuTickQuestions = zhihuishuTickQuestions; } catch (e) {}
