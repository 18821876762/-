// @provides: _quizParseSeq
// @requires: CONFIG, CX_KEYS, QUIZ, _quizDirtyGen, bestEffort, safeGet
// @source-group: takeover/engine/quiz.js
// 职责：题目指纹、文本、题型与选项；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  function _quizFingerprint(qEl, selsOverride) {
    // P1-4：优先复用 WeakMap 缓存。同代际(_quizDirtyGen)未变 → 直接返回缓存、不读 textContent，
    //   静态大题量页稳态下每 tick 零重算；仅在 MO 检测到 DOM 增删或安全刷新触发脏代际 +1 时才重算。
    if (_quizFpCache) {
      var _c = _quizFpCache.get(qEl);
      if (_c && _c.ver === _quizDirtyGen) return _c.fp;
    }
    // 指纹函数（P1-7 补强·修复「漏题」）：旧实现仅取题干前 120 字 + 选项首末采样，
    //   同章同题型多题题干前 120 字相同（极常见）即碰撞 → 后题被误判"已答"而跳过。
    //   现改为：题号(seq) + 加长题干(480) + 选项全量签名(480) → 碰撞概率极低。
    //   选项签名改用传入站点 sels.optionSels（旧版硬编码通用选择器，超星 li 选项签名不准）。
    var fp = safeGet(function () {
      var _ss = selsOverride || (typeof QUIZ !== 'undefined' ? QUIZ : null);
      var optS = (_ss && _ss.optionSels) || (typeof QUIZ !== 'undefined' && QUIZ.optionSels) || [];
      var txt = (qEl.textContent || '').replace(/\s+/g, '');
      var seq = 0;
      // 题号：文本开头 "1."/"第1题" 等阿拉伯数字（超星混淆文本下数字不被同形字替换，仍可信），
      //   区分"10"与"100"等前缀重叠题（旧版前 120 字相同 → 碰撞漏题）。
      var m = txt.match(/^(\d{1,4})[.、)）]/);
      if (!m) { var m2 = txt.match(/(?:^|\s)第\s*(\d{1,4})\s*题/); if (m2) m = m2; }
      if (m && +m[1] > 0 && +m[1] < 10000) seq = +m[1];
      var optEls = qEl.querySelectorAll ? qEl.querySelectorAll(optS.join(',')) : [];
      var optFull = '';
      if (optEls) for (var _oi = 0; _oi < optEls.length; _oi++) optFull += (optEls[_oi].textContent || '').replace(/\s+/g, '');
      return 'quiz:' + seq + ':' + txt.length + ':' + txt.slice(0, 480) + '#' + (optEls ? optEls.length : 0) + ':' + optFull.slice(0, 480);
    }, 'quiz:err');
    if (_quizFpCache) { bestEffort(function () { _quizFpCache.set(qEl, { ver: _quizDirtyGen, fp: fp }); }, 'quiz.fpCache'); }
    return fp;
  }
  // 优化点3#2：题块题干文本 WeakMap 缓存。_quizText 原每题每 tick 读 textContent（强制布局）；
  // 题干在题块内静态不变，按脏代际(_quizDirtyGen)缓存，MO 检测 DOM 变更或安全刷新触发脏代际 +1 时失效重算，稳态零重读。
  var _quizStemCache = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
  function _quizText(el, sels) {
    if (!el) return '';
    if (_quizStemCache) {
      var _sc = _quizStemCache.get(el);
      if (_sc && _sc.ver === _quizDirtyGen) return _sc.text;  // 优化点3#2：同代际命中缓存，跳过 textContent 读取
    }
    // 【清理·M1】原此处有 `var node = (sels && _pqQuery) ? null : null;` 死代码：两支同为 null 且 node 从不读取，
    //   而裸引用 _pqQuery 又在 try 之外，构建若未含 popup-quiz.js 会直接抛 ReferenceError 令 _quizText 崩溃。已删除。
    var text = safeGet(function () {
      if (sels && sels.length) {
        for (var i = 0; i < sels.length; i++) { var n = el.querySelector(sels[i]); if (n && (n.textContent || '').trim()) return n.textContent.trim(); }
      }
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }, '');
    if (_quizStemCache) bestEffort(function () { _quizStemCache.set(el, { ver: _quizDirtyGen, text: text }); }, 'quiz.stemCache');
    return text;
  }
  // 从题干文本解析题目序号（用于反馈标注 + 完成度校验）。
  // 超星/智慧树等题干形如 "1 【多选题】…" / "第 2 题…" / "(3)…"，序号为阿拉伯数字（不被同形字混淆替换）。
  // 解析失败返回 0（主观/填空等无数字序号题），调用方应排除在校验之外。
  function _quizParseSeq(stemText) {
    if (!stemText) return 0;
    var s = String(stemText);
    var m = s.match(/^\s*(?:第\s*)?(\d{1,3})\b/) || s.match(/^\s*[（(]\s*(\d{1,3})\s*[）)]\b/);
    if (m) { var n = parseInt(m[1], 10); if (n > 0 && n < 1000) return n; }
    return 0;
  }
  // 序号→可读标签（无序号题退化为「1 题」，不破坏既有 toast 文案）
  function _quizSeqLabel(seq) { return seq ? ('第' + seq + '题') : '1 题'; }
  // 题型识别(step1)：区分 选择题 / 填空题 / 主观题。
  // 旧逻辑把「填空」与「主观」笼统归为「无序号题」→ 统一 _quizInfoMissing 跳过；现拆开：
  //   choice    —— 含 radio/checkbox 选项（opts 非空），走既有点选流程；
  //   fill      —— 无选项但含单行文本输入(input[type=text])，判定为填空题，登记 _quizFillItems 待回填(step2 接入自动回填)；
  //   subjective —— 无选项且含多行 textarea、或完全无结构化文本输入，判定为开放主观/简答，走人工队列(不作答)。
  // 输入选择器优先用站点 fillInputSels，缺省回退通用文本输入选择器（排除 radio/checkbox/hidden）。
  function _quizDetectQType(qEl, opts, sels) {
    if (opts && opts.length) return 'choice';
    var _fillSel = (sels && sels.fillInputSels && sels.fillInputSels.length)
      ? sels.fillInputSels.join(',')
      : 'input[type="text"], input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"])';
    var _hasFill = safeGet(function () { return !!(qEl && qEl.querySelector && qEl.querySelector(_fillSel)); }, false);
    if (_hasFill) return 'fill';
    // contenteditable 且非 textarea → 视为填空（富文本单空/填空编辑器，双路径注入可处理）；纯 textarea 或无结构化输入 → 主观
    var _hasCE = safeGet(function () { return !!(qEl && qEl.querySelector && qEl.querySelector('[contenteditable]')); }, false);
    var _hasTa = safeGet(function () { return !!(qEl && qEl.querySelector && qEl.querySelector('textarea')); }, false);
    if (_hasCE && !_hasTa) return 'fill';
    return 'subjective';   // 仅 textarea / 全无结构化输入 → 开放主观(走人工队列)
  }
  function _quizOptions(qEl, sels) {
    var out = []; if (!qEl || !qEl.querySelectorAll) return out;
    if (!(sels && sels.length)) return out;
    var seen = [];   // 按引用去重：多 selector 并集命中同一节点时避免重复入数组（否则 idx<opts.length 判定与随机分布被污染）
    // 优化点3#1：选择器合成单次 querySelectorAll（与 _pqQueryAll 同法，优化点1#1 已验证）。join 后若整集非法会抛 DOMException，
    // 故 try 单次查询；失败则逐 selector fallback（保留非法选择器告警、不中断其余合法选择器，P1-3）。
    try {
      var ns = qEl.querySelectorAll(sels.join(','));
      for (var j = 0; j < ns.length; j++) { if (seen.indexOf(ns[j]) < 0) { seen.push(ns[j]); out.push(ns[j]); } }
    } catch (e) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[quiz] 选项选择器合成非法(已逐 selector 回退):', (e && e.name) || e);
      for (var i = 0; i < sels.length; i++) {
        (function (sel) {
          var ns2;
          try { ns2 = qEl.querySelectorAll(sel); }
          catch (e2) { if (typeof console !== 'undefined' && console.warn) console.warn('[quiz] 选项选择器非法(已跳过):', sel, (e2 && e2.name) || e2); return; }
          for (var k = 0; k < ns2.length; k++) { if (seen.indexOf(ns2[k]) < 0) { seen.push(ns2[k]); out.push(ns2[k]); } }
        })(sels[i]);
      }
    }
    return out;
  }

  // —— 隐私合规：离线优先 + 端点白名单（默认不外发题目/选项）——
  function _quizOfflineOnly() {
    // 默认仅离线作答（cx_quiz_offline 未置 '0' 即不外发）。需用户显式允许才向外发送题目数据。
    return safeGet(function () { if (typeof localStorage === 'undefined') return true; var v = localStorage.getItem(CX_KEYS.QUIZ_OFFLINE); return v === null ? true : (v !== '0'); }, true);
  }
  function _quizEndpointAllowed(ep) {
    if (!ep) return false;
    return safeGet(function () {
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
    }, false);
  }

  // —— 提交二次确认（隐私/防误交卷）：默认自动提交；关闭后「作答但不提交」，挂起待用户「确认提交」——
