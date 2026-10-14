// @requires: bestEffort, safeGet, swallow
// @source-group: plugins/addons/auto-next.js
// 自动下一课闭包续段：下一节与题目入口查找、可取消导航。
// 顺序：auto-next.js → auto-next-navigation.js → auto-next-lifecycle.js；共享原 IIFE。
  function blockedByVerify() {
    return safeGet(function () {
      // 优化点6#3：用 textContent 替代 innerText（innerText 触发整页强制同步布局/reflow；textContent 为纯文本拼接不触发重排，子串关键词匹配完全够用）
      var txt = (document.body ? document.body.textContent : '') || '';
      for (var i = 0; i < CFG.BLOCK_KEYWORDS.length; i++) { if (txt.indexOf(CFG.BLOCK_KEYWORDS[i]) >= 0) return true; }
      return false;
    }, false);
  }

  // ---- 下一节查找（DOM 优先，Bridge 补充）----
  // 抗改版三段式：显式选择器 → 关键词文本(可点击链接) → 关键词文本(任意可点击元素，click 触发)
  // 注意：题目/作业/考试 入口词（章节测验/章节测试…）已归 QUIZ_TEXT_RE 处理，不在此混入，
  // 否则"下一节"兜底查找会把题目链接误当下一节导航。
  var NEXT_TEXT_RE = /下一章|下一节|下一课|下一页|下一个|后一章|继续学习|继续播放/;
  // 题目/作业/考试 任务点文本（span.spanText 包裹、无 href 改版）：命中后向上找可点击祖先点入
  var QUIZ_TEXT_RE = /章节测验|章节测试|随堂测验|随堂测试|课后测验|课后测试|章节作业|课后作业|单元作业|单元测验|单元考试|在线测验|在线考试|章节考试|专题测验/;
  function usableHref(el) {
    var href = el.getAttribute && (el.getAttribute('href') || el.href);
    if (href && href !== '#' && !/^javascript:/i.test(href)) return href;
    return null;
  }
  // 向上回溯到「真正可点击/可触发导航」的祖先（span.spanText 父级通常是 li/a/div[onclick]）
  function clickableAncestor(el) {
    var cur = el;
    while (cur && cur !== document.body && cur.parentNode) {
      var tag = cur.tagName || '';
      if (tag === 'A' || tag === 'BUTTON') return cur;
      var role = cur.getAttribute && cur.getAttribute('role');
      if (role === 'button') return cur;
      if (cur.getAttribute && (cur.getAttribute('onclick') || cur.getAttribute('data-url') || cur.getAttribute('data-href'))) return cur;
      var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(cur) : null;
      if (cs && cs.cursor === 'pointer') return cur;
      cur = cur.parentNode;
    }
    return el;
  }
  function findNextDOM() {
    // 1) 显式选择器（有 href → 直接导航）
    for (var i = 0; i < CFG.NEXT_SELECTORS.length; i++) {
      var el = $dom.one(CFG.NEXT_SELECTORS[i]);
      if (el && $dom.isVisible(el)) {
        var href = usableHref(el);
        if (href) return { url: href, label: (el.textContent || '下一节').trim() || '下一节(DOM)' };
        // 无 href 的按钮/span：作为可点击节点返回（doNavigate 会 click）
        return { url: null, el: el, label: (el.textContent || '下一节').trim() || '下一节(按钮)' };
      }
    }
    // 2) 关键词兜底：可点击链接（<a>）
    var as = $dom.all('a');
    for (var j = 0; j < as.length; j++) {
      var t = (as[j].textContent || as[j].title || '').trim();
      if (NEXT_TEXT_RE.test(t)) {
        var h = usableHref(as[j]);
        if (h) return { url: h, label: t };
      }
    }
    // 3) 关键词兜底：任意可点击元素（button/[role=button]/[onclick]）—— 抗「非 a 标签做下一节」的改版
    // 优化点6#2：收窄选择器，去掉 span/li/div 全量遍历（它们含整段容器，是「整子树 textContent 读取」主成本源；候选量降 1~2 个数量级）。
    // 保留 [onclick] 仍能量匹配带点击处理的 div/span/li，且叠加 #1 的 offsetParent 剔除后几乎无重排。
    var clickable = $dom.all('button, [role="button"], [onclick]');
    for (var k = 0; k < clickable.length; k++) {
      var c = clickable[k];
      var ct = (c.textContent || c.title || '').trim();
      // 仅匹配「短文本」节点，避免整段容器误命中（下一节按钮文本通常很短）
      if (ct.length <= 8 && NEXT_TEXT_RE.test(ct) && $dom.isVisible(c)) {
        var ch = usableHref(c);
        if (ch) return { url: ch, label: ct };
        return { url: null, el: c, label: ct };
      }
    }
    return null;
  }

  function findNextBridge(cid, job) {
    if (!cid || !bridgeConfigured()) return Promise.resolve(null);
    return $bridge.getPlaylist(cid, job).then(function (payload) {
      if (!jobValid(job)) return null;
      var chapters = Array.isArray(payload) ? payload : payload && payload.chapters;
      if (!Array.isArray(chapters)) return null;
      var cur = $nav.kid(), found = false;
      for (var i = 0; i < chapters.length; i++) {
        var ch = chapters[i];
        if (!ch || typeof ch !== 'object') continue;
        if (found && ((ch.unfinishedCount != null && ch.unfinishedCount > 0) || !ch.completed)) {
          var url = ch.url;
          if (!url && (ch.knowledgeId || ch.id)) {
            var nextURL = new URL(location.href);
            nextURL.searchParams.set('knowledgeId', String(ch.knowledgeId || ch.id));
            nextURL.searchParams.delete('chapterId'); nextURL.searchParams.delete('kjid');
            url = nextURL.href;
          }
          return url ? { url: url, label: ch.title || '下一章(Bridge)' } : null;
        }
        if (String(ch.knowledgeId || ch.id) === String(cur)) found = true;
      }
      return null;
    });
  }
  function resolveNext(cid, job) {
    if (!jobValid(job)) return Promise.resolve(null);
    var dom = findNextDOM();
    return dom ? Promise.resolve(dom) : findNextBridge(cid, job);
  }
  function failNavigation(job, message) {
    if (activeJob !== job) return;
    activeJob = null; setState(IDLE);
    if (canRun()) toast(message);
  }
  function finishNavigation(job) {
    recordSuccess(job);
    // 成功后冷却仍维持 NAVIGATING；失败不消费视频身份。
    later(function () { if (activeJob === job) { activeJob = null; setState(IDLE); } }, CFG.NAV_LOCK_MS);
  }
  function doNavigate(next, job, immediate) {
    if (!jobValid(job)) return;
    if (!next) { failNavigation(job, '未找到下一节入口，请手动选择或稍后重试'); return; }
    if (_isQuizActive()) { later(function () { doNavigate(next, job, immediate); }, HOLD_POLL_MS); return; }
    if (next.el && !next.url) {
      if (next.el.isConnected === false || typeof next.el.click !== 'function') { failNavigation(job, '下一节入口已变化，请重试'); return; }
      try {
        if (!jobValid(job)) return;
        next.el.click(); finishNavigation(job);
      } catch (e) { swallow(e); failNavigation(job, '点击下一节失败，可稍后重试'); }
      return;
    }
    var url;
    try {
      if (!next.url || /^\s*javascript:/i.test(next.url)) throw new Error('unsupported URL');
      url = new URL(next.url, location.href);
      if (!/^https?:$/.test(url.protocol)) throw new Error('unsupported protocol');
    } catch (e) { failNavigation(job, '下一节地址无法解析，可稍后重试'); return; }
    function land() {
      if (!jobValid(job)) return;
      if (_isQuizActive()) { later(land, HOLD_POLL_MS); return; }
      try {
        // 最后一个副作用之前重核开关、核心状态、章节和令牌。
        if (!jobValid(job)) return;
        window.location.href = url.href;
        finishNavigation(job);
      } catch (e) { swallow(e); failNavigation(job, '下一节跳转失败，可稍后重试'); }
    }
    if (immediate) land(); else later(land, 300);
  }

  // ---- 题目入口文本兜底（命中章节测验等任务点，回溯可点击祖先）----
  function probeQuizTextEntry() {
    return safeGet(function () {
      var exact = $dom.all('li[onclick]');
      var _cand = [];
      for (var e = 0; e < exact.length; e++) {
        var et = (exact[e].getAttribute('title') || exact[e].textContent || '').trim();
        if (QUIZ_TEXT_RE.test(et) && $dom.isVisible(exact[e])) _cand.push(exact[e]);
      }
      var _active = (typeof document !== 'undefined' && document.querySelector) ? document.querySelector('li.active') : null;
      if (_active && _active.parentNode) {
        var _sib = _active;
        while ((_sib = _sib.nextElementSibling)) {
          if (_sib.tagName === 'LI' && _cand.indexOf(_sib) >= 0) return { el: _sib, url: null };
        }
      }
      if (_cand.length) return { el: _cand[0], url: null };
      var qnodes = $dom.all('span.spanText, a, li, div[onclick], [role=button]');
      for (var q = 0; q < qnodes.length; q++) {
        var qn = qnodes[q];
        var qt = (qn.textContent || qn.title || '').trim();
        if (qt.length > 0 && qt.length <= 16 && QUIZ_TEXT_RE.test(qt) && $dom.isVisible(qn)) {
          var qEl = clickableAncestor(qn);
          var qHref = usableHref(qEl) || (qEl.getAttribute && (qEl.getAttribute('data-url') || qEl.getAttribute('data-href'))) || null;
          return { el: qEl, url: qHref };
        }
      }
      return null;
    }, null);
  }

  // ---- 题目入口轻量探测（超时即放弃，直接跳下一节）----
  function probeQuizEntry() {
    return new Promise(function (resolve) {
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; resolve(null); } }, CFG.QUIZ_PROBE_TIMEOUT);
      bestEffort(function () {
        for (var i = 0; i < CFG.QUIZ_ENTRY_SELECTORS.length; i++) {
          var els = $dom.all(CFG.QUIZ_ENTRY_SELECTORS[i]);
          for (var j = 0; j < els.length; j++) {
            if ($dom.isVisible(els[j])) {
              var href = els[j].getAttribute('href') || els[j].href || (els[j].tagName === 'A' ? els[j].getAttribute('onclick') : null);
              if (href && href !== '#' && !/javascript:/.test(href)) {
                if (!done) { done = true; clearTimeout(t); resolve({ el: els[j], url: href }); }
                return;
              }
              if (!done) { done = true; clearTimeout(t); resolve({ el: els[j], url: null }); }
              return;
            }
          }
        }
        var _qe = probeQuizTextEntry();
        if (_qe) { if (!done) { done = true; clearTimeout(t); resolve(_qe); } return; }
      }, 'an.probeQuiz.entry');
      if (!done) { done = true; clearTimeout(t); resolve(null); }
    });
  }

