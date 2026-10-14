// @provides: _pqQueryAll, popupQuizTick, registerPopupQuizEnded
// @requires: CONST, CX_KEYS, CoreState, EventBus, bestEffort, detectSite, safeGet
  // ===== DOMAIN: biz/popup-quiz (站点无关·弹窗题目随机作答共享骨架) =====
  // ===== MODULE: 上课/随堂弹窗题目「随机选 → 答题 → 删弹窗」(站点无关) =====
  // 域：业务模块 —— 与站点无关；由各平台模块传入同构 selectors 映射后调用 popupQuizTick()。
  // 【用途】智慧树/中国大学MOOC/学堂在线/智慧职教 等平台上课期间弹「随堂题目」干扰播放，
  //   用户明确「不要求对错、只随机选一个然后答题、删弹窗」→ 本模块消干扰、保续播不被弹窗挡住。
  // 【复用】把 zhihuishu.js 原有的弹窗处理逻辑抽成通用骨架，避免每个 MOOC 平台重写一遍。
  //   站点差异仅在选择器映射(SELECTORS 同构)，逻辑只写一处（P4 收口思想落地）。
  // H1·SELECTORS 中央化（DRY，消除 §4.2 缺陷）：popup-quiz.js 与 zhihuishu.js 的弹窗选择器高度雷同，
  // ZHIHUISHU 是 POPUP_QUIZ 各数组的逐元素前缀子集。抽出公共 POPUP_BASE，两处均从 BASE 构造，
  // 运行时数组与改造前逐元素等价（零行为回归）。POPUP_BASE = 经 S2 收窄后的公共具名选择器
  // （不含 question/topic/answer/quiz 宽子串选择器；[class*="popup"] 由 S2 明确豁免，仅置于 POPUP_QUIZ 增量）。
  var POPUP_BASE = {
    dialogSels: ['.dialog-wrap', '.question-pop', '.topic-pop', '.ans-pop', '.pop-box', '.question-dialog', '.tk-pop'],
    optionSels: ['.topic-item', '.option-item', '.answer-item', 'li[class*="option"]', '.dialog-wrap li', '[class*="choice"]'],
    answerBtnSels: ['.answer-btn', '.submit-btn', '.dialog-submit', '.topic-submit', 'button[class*="answer"]', 'button[class*="submit"]', '.pop-btn']
  };
  var POPUP_QUIZ = {
    // S2 收紧：已移除 question/topic/answer 过宽属性选择器；[class*="popup"] 为 S2 明确豁免的兜底
    // （真弹窗由 .dialog-wrap/.modal/.question-pop 等具名类覆盖，无需宽选择器）。下方为 POPUP_BASE 之上的站点通用增量。
    dialogSels: POPUP_BASE.dialogSels.concat(['.modal', '.exam-pop', '[class*="popup"]']),
    optionSels: POPUP_BASE.optionSels.concat(['.q-item', '.select-item']),
    answerBtnSels: POPUP_BASE.answerBtnSels.concat(['.confirm-btn'])
  };

  var _pqHandled = {};   // 已处理弹窗指纹去重（防同弹窗重复点击/删）
  // §1.3 弹窗自旋保护：平台可能连续重建不同指纹的弹窗，形成「检测→关闭→重弹→检测」循环。
  // 10 秒内“实际关闭”超过 8 个弹窗 → 判定风暴 → 暂停关闭 30 秒，仅记录日志不作处理。
  // 计数器只在 _pqDismiss（真正移除弹窗）时 +1，规避两类误触发：
  //  ① 主循环每轮无条件调用 popupQuizTick，无弹窗时也会 +1 → 正常浏览 ~9 轮后假风暴；
  //  ② 彻底取消模式下 popupQuizTick→popupQuizBlock 双重入口各 +1 → 阈值被提前灌爆（见 sim-popup-block 重弹循环）。
  var _pqStormGate = { count: 0, lastReset: 0, maxPer10sec: 8, silenced: false, silentUntil: 0 };
  function _pqStormResetIfExpired() {
    var now = Date.now();
    if (_pqStormGate.silenced && now > _pqStormGate.silentUntil) {
      _pqStormGate.silenced = false; _pqStormGate.count = 0; _pqStormGate.lastReset = now; return;
    }
    if (now - _pqStormGate.lastReset > 10000) { _pqStormGate.count = 0; _pqStormGate.lastReset = now; }
  }
  // 只读：当前是否处于风暴静默期（含过期自动解除）。不修改计数，供入口门禁用。
  function _pqStormSilenced() {
    _pqStormResetIfExpired();
    return _pqStormGate.silenced;
  }
  // 记录一次“实际关闭弹窗”并判定是否进入风暴静默。仅由 _pqDismiss 在真正移除时调用，每关闭一个 +1。
  function _pqRecordClose() {
    _pqStormResetIfExpired();
    if (_pqStormGate.silenced) return true;
    _pqStormGate.count++;
    if (_pqStormGate.count > _pqStormGate.maxPer10sec) {
      _pqStormGate.silenced = true; _pqStormGate.silentUntil = Date.now() + 30000;
      bestEffort(function () {
        if (typeof console !== 'undefined' && console.warn) console.warn('[popup-quiz] 弹窗风暴检测——10秒内关闭' + _pqStormGate.count + '个弹窗(疑似循环重弹)，暂停30秒');
        if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('ui:toast', '弹窗风暴检测(疑似循环重弹)，暂停30秒');
      }, 'pq.storm.warn');
      return true;
    }
    return false;
  }
  function _pqPruneHandled() {   // A1：弹窗指纹去重上限淘汰（对齐 dedup.js 的 _endedPrune 范本，防超长会话无限增长）
    bestEffort(function () {
      var _ks = Object.keys(_pqHandled);
      if (_ks.length > CONST.PQ_HANDLED_CAP) {
        var _drop = _ks.length - CONST.PQ_HANDLED_CAP;
        for (var _p = 0; _p < _drop; _p++) delete _pqHandled[_ks[_p]];
      }
    }, 'pq.pruneHandled');
  }
  var _pqPopups = 0;     // 累计已自动作答并关闭的弹窗数（面板「做题」区计数用）
  var _pqDisabledNotified = false;   // 「弹窗自动作答」关闭提示去重，避免每轮刷屏
  var _pqBlockNotified = false;      // 「彻底取消弹窗」提示去重
  function _pqSnapshot() { bestEffort(function () { window.__CX_FORCE_PLAY.popupQuizStats = { popups: _pqPopups, ts: Date.now() }; }, 'pq.snapshot'); }
  function _pqFingerprint(el) {
    return safeGet(function () { var s = (el.className || '') + '|' + (el.id || '') + '|' + (el.textContent || '').slice(0, 80); return 'pq:' + s.length + ':' + s; }, 'pq:err');
  }
  function _pqQuery(root, sels) {
    if (!root || !root.querySelectorAll) return null;
    for (var i = 0; i < sels.length; i++) { var n = safeGet(function () { return root.querySelector(sels[i]); }, null); if (n) return n; }
    return null;
  }
  function _pqQueryAll(root, sels) {
    var out = []; if (!root || !root.querySelectorAll) return out;
    // 优化点1#1：纯并集选择器合成单次 querySelectorAll（dialogSels/optionSels/answerBtnSels 各 10 次全文档遍历 → 1 次）。
    // join 后若整个选择器集非法会抛 DOMException，故 try 单次查询；失败则逐个 fallback（保留非法选择器告警、不中断其余合法选择器）。
    try {
      var all = root.querySelectorAll(sels.join(','));
      for (var j = 0; j < all.length; j++) out.push(all[j]);
      return out;
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[popup-quiz] 选择器并集查询失败(回退逐项):', (e && e.name) || e);
      for (var i = 0; i < sels.length; i++) {
        (function (sel) {
          // 非法选择器会让 querySelectorAll 抛 DOMException(SyntaxError)；仅告警跳过，
          // 不靠 bestEffort 静默吞掉（避免隐藏配置错误），也不中断其它选择器（P1-3）。
          var ns;
          try { ns = root.querySelectorAll(sel); }
          catch (err) { if (typeof console !== 'undefined' && console.warn) console.warn('[popup-quiz] 选项选择器非法(已跳过):', sel, (err && err.name) || err); return; }
          for (var k = 0; k < ns.length; k++) out.push(ns[k]);
        })(sels[i]);
      }
      return out;
    }
  }
  // D5 修复：宽选择器（[class*="question"] 等）可能命中宿主页面的常规容器（如课程目录里带
  // question 类名的普通 div），直接 _pqRemove 会误删宿主题目/答案容器。
  // 在"命中"后追加三重确认（可见且尺寸合理 + 含选项/作答元素或弹窗语义按钮/类名），
  // 仅当确为弹窗候选时才交给处理/移除逻辑，避免误伤。
  function _pqIsDialogCandidate(el) {
    if (!el || el.nodeType !== 1) return false;
    var rect = safeGet(function () { return el.getBoundingClientRect(); }, null);
    // v4.19.20 审查修复：零尺寸元素（display:none / 隐藏布局容器）不可能是可作答的可见弹窗——
    // 旧实现尺寸门禁只拦截「可见且小」，零尺寸被豁免后仅凭语义类名（.modal/.el-dialog 等）即可命中
    // → 生产环境隐藏布局容器被当作弹窗点击内部按钮并整体移除（破坏宿主 UI）。
    // 无头/测试环境 rect 全 0 时（jsdom）仍跳过尺寸要求，保持回归可测性（D5 主防线为内容/语义判定）。
    if (rect) {
      var _measurable = (rect.width !== 0 || rect.height !== 0);
      if (_measurable && (rect.width < 120 || rect.height < 80)) return false;
    }
    var opts = safeGet(function () { return el.querySelectorAll(POPUP_QUIZ.optionSels.join(',')); }, null);
    if (opts && opts.length) return true;                              // 2a) 含选项/作答元素
    var btns = safeGet(function () { return el.querySelectorAll('button, a[class*="btn"]'); }, null);
    if (btns) {
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent || btns[i].innerText || '').replace(/\s/g, '');
        if (/答题|提交|确定|作答|下一题|close|关闭|跳过|收起|知道了/.test(t)) return true;   // 2b) 含弹窗语义按钮
      }
    }
    // v4.19.20：语义类名门禁同样要求「可测量且非零尺寸」或含内容/按钮——零尺寸隐藏容器不得仅凭类名命中
    var cls = (el.className || '').toString();
    if (/dialog|modal|pop(\b|-)|topic-pop|ans-pop|exam-pop/.test(cls)) {
      if (rect && rect.width === 0 && rect.height === 0) return false;
      return true;
    }
    return false;
  }
  function _pqPickRandom(dialog) {
    var opts = _pqQueryAll(dialog, POPUP_QUIZ.optionSels);
    if (!opts.length) return null;
    var pick = opts[Math.floor(Math.random() * opts.length)];
    bestEffort(function () { pick.click(); }, 'pq.pick.click');
    return pick;
  }
  function _pqClickAnswer(dialog) {
    var btn = _pqQuery(dialog, POPUP_QUIZ.answerBtnSels);
    if (!btn) {
      bestEffort(function () {
        var btns = dialog.querySelectorAll('button, .btn, a[class*="btn"]');
        for (var i = 0; i < btns.length; i++) {
          var t = (btns[i].textContent || btns[i].innerText || '').replace(/\s/g, '');
          // 仅匹配作答意图（答题/提交/确定/作答/下一题）；不含 关闭/close，避免误关弹窗而不作答（修复 §2 按钮歧义）
          if (/答题|提交|确定|作答|下一题/.test(t)) { btn = btns[i]; break; }
        }
      }, 'pq.clickAnswer.query');
    }
    if (btn) { bestEffort(function () { btn.click(); }, 'pq.clickAnswer.click'); return btn; }  // 返回被点击的作答键，供 _pqDismiss 跳过避免重复点击
    return null;
  }
  function _pqRemove(dialog) {
    if (!safeGet(function () { if (dialog.parentNode) { dialog.parentNode.removeChild(dialog); return true; } else if (dialog.remove) { dialog.remove(); return true; } return false; }, false)) {
      bestEffort(function () { dialog.style.display = 'none'; dialog.style.visibility = 'hidden'; }, 'pq.remove.hide');
    }
  }
  // 真正关闭弹窗：先尝试点「跳过/关闭/确定」按钮（让平台认为已结束，不再重弹），随后仍 DOM 移除兜底（幂等）。
  // 不作答、不随机选——仅让弹窗从平台视角"已处理"，从而打断「删→弹」循环。
  function _pqDismiss(dialog, skipEl) {
    if (!dialog) return false;
    _pqRecordClose();   // §1.3：记录一次实际关闭，驱动风暴断路器（每关闭一个 +1，不重复计数）
    bestEffort(function () {
      var btns = dialog.querySelectorAll ? dialog.querySelectorAll('button, a[class*="btn"], [class*="close"], [class*="Close"]') : [];
      for (var i = 0; i < btns.length; i++) {
        if (skipEl && btns[i] === skipEl) continue;   // 跳过已点击的作答键，避免同一「确定」键被点两次导致重复提交（修复 §2）
        var t = (btns[i].textContent || btns[i].innerText || '').replace(/\s/g, '');
        if (/跳过|关闭|确定|取消|close|Close|收起|知道了/.test(t)) { bestEffort(function () { btns[i].click(); }, 'pq.dismiss.click'); break; }
      }
    }, 'pq.dismiss');
    _pqRemove(dialog);
    return true;
  }
  function _pqHandle(dialog) {
    if (!dialog) return false;
    var fp = _pqFingerprint(dialog);
    // 【幂等修复·同指纹"删→弹"死锁】旧逻辑：_pqHandled[fp] 一旦置位即永久阻塞本弹窗(后续 tick 直接 return false)，
    // 若平台未真正登记作答/跳过而重渲染出内容完全相同的弹窗(同 fp)，该弹窗将永久不被处理、卡死挡播放，只能切「彻底取消弹窗」才解。
    // 现改为：首次命中才随机作答+关闭(仅计一次弹窗数)；同 fp 重弹(仍存活于 DOM)每轮仅静默关闭以保续播不被挡(不再随机翻答案)，
    // 对齐 popupQuizBlock 的每轮 dismiss 语义，彻底消除该死锁。
    var first = !_pqHandled[fp];
    _pqHandled[fp] = true; _pqPruneHandled();
    bestEffort(function () {
      if (first) {
        _pqPickRandom(dialog);
        var _ansBtn = _pqClickAnswer(dialog);   // 返回被点击的作答键，传给 dismiss 跳过避免重复点击
        _pqDismiss(dialog, _ansBtn);
        _pqPopups++; _pqSnapshot();
        bestEffort(function () { EventBus.emit('ui:toast', '已自动作答并关闭题目弹窗（累计 ' + _pqPopups + '）'); }, 'pq.handle.toast');
      } else {
        // 同指纹重弹：仅每轮静默关闭(幂等)，不重复随机作答(避免每轮翻答案 / 风暴计数暴增)。
        // 若平台持续重弹，§1.3 风暴断路器会在 10s/8 个后静默 30s；届时建议用户开启「彻底取消弹窗」。
        _pqDismiss(dialog, null);
      }
    }, 'pq.handle');
    return true;
  }

  // 彻底取消模式：仅移除/跳过弹窗，不作答（满足「彻底取消弹窗」诉求）。幂等、重弹每轮再清。
  function popupQuizBlock(selectors) {
    if (!CoreState.canRun()) return 0;
    // S1 纵深防御门禁：同 popupQuizTick
    if (!_pqSiteGuard()) return 0;
    if (_pqStormSilenced()) return 0; // §1.3 弹窗风暴断路器：静默期内暂停处理（计数在 _pqDismiss 内发生）
    var sels = selectors || POPUP_QUIZ;
    var blocked = 0;
    bestEffort(function () {
      var root = (document && document.documentElement) || document;
      var dialogs = _pqQueryAll(root, sels.dialogSels).filter(_pqIsDialogCandidate);
      for (var i = 0; i < dialogs.length; i++) { if (_pqDismiss(dialogs[i])) blocked++; }
      if (blocked === 0) {
        var allBtns = root.querySelectorAll ? root.querySelectorAll('button, a[class*="btn"]') : [];
        for (var b = 0; b < allBtns.length; b++) {
          // 优化点1#3：兜底按钮扫描优先 textContent（不触发 reflow），去掉 innerText 回退（textContent 恒返回字符串，innerText 反而触发整页强制布局）
          var txt = (allBtns[b].textContent || '').replace(/\s/g, '');
          if (/答题|提交|确定|作答/.test(txt)) {
            var cand = allBtns[b].closest ? allBtns[b].closest('div,section,li') : null;
            if (cand && _pqDismiss(cand)) { blocked++; break; }
          }
        }
      }
    }, 'pq.block');
    return blocked;
  }

  // 通用入口：扫描弹窗并逐个随机作答+删除。selectors 可选覆盖默认 POPUP_QUIZ（站点特化）。
  // S1 纵深防御：公开 API（window.__CX_FORCE_PLAY.popupQuizTick/Block）可能被非授权站点直调；
  // 内部调用方均已受 registerSiteTick 站点守卫保护，此处仅对公开 API 加门禁防跨平台误触发。
  var _pqAllowedSites = ['zhihuishu', 'icourse163', 'xuetangx', 'icve'];   // 默认允许弹窗自动作答的站点；新平台经 registerPopupQuizSite 注册，避免硬编码白名单散落（对应 C1）
  function registerPopupQuizSite(site) { if (site && _pqAllowedSites.indexOf(site) < 0) _pqAllowedSites.push(site); }
  function _pqSiteGuard() { return typeof detectSite === 'function' && _pqAllowedSites.indexOf(detectSite()) >= 0; }
  function popupQuizTick(selectors) {
    if (!CoreState.canRun()) return 0;
    if (window.__CX_FORCE_PLAY.warmup && window.__CX_FORCE_PLAY.warmup.active()) return 0;
    // S1 纵深防御门禁：非授权站点被直调 → no-op，避免全页 remove() 误删宿主 DOM
    if (!_pqSiteGuard()) return 0;
    // §1.3 弹窗风暴断路器：静默期内暂停 30 秒（计数仅在 _pqDismiss 实际关闭时 +1，避免无弹窗轮询假触发）
    if (_pqStormSilenced()) return 0;
    // 「彻底取消弹窗」开关（cx_popup_block==='1'）：无论自动作答开否，每轮静默关闭弹窗（不作答），真正打断删→弹循环
    if (safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.POPUP_BLOCK) : null; }, null) === '1') {
      var n = popupQuizBlock(selectors);
      if (n && !_pqBlockNotified) { _pqBlockNotified = true; bestEffort(function () { EventBus.emit('ui:toast', '已彻底取消 ' + n + ' 个弹窗（不作答）'); }, 'pq.toast.block'); }
      else if (!n) { _pqBlockNotified = false; }
      return n;
    }
    // 中途关闭闸门：localStorage.cx_popup_quiz==='0' → 不作答，但仍静默关闭弹窗（避免平台重弹挡播放）
    if (safeGet(function () { return (typeof localStorage !== 'undefined') ? localStorage.getItem(CX_KEYS.POPUP_QUIZ) : null; }, null) === '0') {
      if (!_pqDisabledNotified) { _pqDisabledNotified = true; bestEffort(function () { EventBus.emit('ui:toast', '弹窗自动作答已关闭（仅静默关闭弹窗）'); }, 'pq.toast.disabled'); }
      var m = popupQuizBlock(selectors);
      return m;
    }
    var sels = selectors || POPUP_QUIZ;
    var handled = 0;
    bestEffort(function () {
      var root = (document && document.documentElement) || document;
      var dialogs = _pqQueryAll(root, sels.dialogSels).filter(_pqIsDialogCandidate);
      for (var i = 0; i < dialogs.length; i++) { if (_pqHandle(dialogs[i])) handled++; }
      if (handled === 0) {
        var allBtns = root.querySelectorAll ? root.querySelectorAll('button, a[class*="btn"]') : [];
        for (var b = 0; b < allBtns.length; b++) {
          // 优化点1#3：兜底按钮扫描优先 textContent（不触发 reflow），去掉 innerText 回退（textContent 恒返回字符串，innerText 反而触发整页强制布局）
          var txt = (allBtns[b].textContent || '').replace(/\s/g, '');
          if (/答题|提交|确定|作答/.test(txt)) {
            var cand = allBtns[b].closest ? allBtns[b].closest('div,section,li') : null;
            if (cand && _pqIsDialogCandidate(cand) && _pqHandle(cand)) { handled++; break; }
          }
        }
      }
    }, 'pq.tick');
    return handled;
  }

  bestEffort(function () { window.__CX_FORCE_PLAY.popupQuizTick = popupQuizTick; window.__CX_FORCE_PLAY.popupQuizBlock = popupQuizBlock; window.__CX_FORCE_PLAY.registerPopupQuizSite = registerPopupQuizSite; window.__CX_FORCE_PLAY.POPUP_BASE = POPUP_BASE; }, 'pq.export');

  // ====== 视频结束节点（关键生命周期事件）即时作答 ======
  // 随堂题/弹窗题常在「视频结束」瞬间弹出。挂单一 ended 监听可使「自动转答题」在视频结束节点立即响应，
  // 无需等待主循环下一轮(≤2s)轮询。按站点注册 selectors 的注册表，避免各站点各自挂监听（对应审计重复代码告警）。
  var _pqEndedSelectors;            // 延迟初始化（见下），兼容按站点模块先于本模块执行的单作用域拼接顺序
  var _pqEndedStarted = false;
  var _pqEndedHandler = null;        // 命名引用，便于卸载时精确 removeEventListener
  function registerPopupQuizEnded(site, selectors) {
    if (!_pqEndedSelectors) _pqEndedSelectors = {};   // 懒初始化：避免拼接顺序导致的 var 提升未赋值（undefined 写属性报错）
    if (site && selectors) _pqEndedSelectors[site] = selectors;
    if (_pqEndedStarted) return;
    _pqEndedStarted = true;
    _pqEndedHandler = function (e) {
      var v = e && e.target;
      if (!v || v.tagName !== 'VIDEO') return;                          // 仅响应真实视频元素结束
      var s = (typeof detectSite === 'function') ? detectSite() : null;
      if (!s || !_pqEndedSelectors[s]) return;                          // 仅本站点已注册 selectors 时触发
      var sels = _pqEndedSelectors[s];
      // 立即触发一次；弹窗可能在结束瞬间稍后才挂载，补一次短延时复检（主循环 2s 轮询为最终兜底）
      bestEffort(function () { popupQuizTick(sels); }, 'pq.ended');
      var token = CoreState.capture('popup-quiz');
      window.__CX_FORCE_PLAY.TimerRegistry.setTimeout(function () { if (CoreState.valid(token)) bestEffort(function () { popupQuizTick(sels); }, 'pq.ended.delay'); }, 400, 'popup-quiz');
    };
    try { document.addEventListener('ended', _pqEndedHandler, true); } catch (e) {}
    // 卸载清理：移除 ended 监听，避免脚本卸载后残留（对应 NEW-5 侵入性监听治理，与 auto-next 一致）
    try {
      window.__cxAddonCleanups = window.__cxAddonCleanups || [];
      window.__cxAddonCleanups.push(function () {
        try { if (_pqEndedHandler) document.removeEventListener('ended', _pqEndedHandler, true); } catch (e2) {}
      });
    } catch (e) {}
  }
  bestEffort(function () { window.__CX_FORCE_PLAY.registerPopupQuizEnded = registerPopupQuizEnded; }, 'pq.export.ended');
