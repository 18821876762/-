// ==UserScript==
// @name         学习通·视频播完自动答题/下一课
// @namespace    http://cx.local/
// @version      3.0
// @author       anon
// @description  【副脚本·接入主控面板】视频播完(ended)后延迟扫描并点击"章节检测"等答题入口(类型B跳转)；播放中平台以 .dialog-mask 遮罩弹出插播题(类型A)时主动暂停(__cxAN_hold)，遮罩消失即解锁让主脚本续播。不碰答题内容、不自动提交。总开关已挂入 chaoxing-force-play(4.0) 主控面板（按 P 呼出 → 副脚本区）。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // 全局状态与定时器句柄声明（审查#2 严格模式未声明变量 ReferenceError 修复）
  var _obs = null;
  var _checkTimer = null;

  // ===== 配置 =====
  var CONFIG = {
    OVERLAY_CHECK_INTERVAL: 1500,                  // 遮罩轮询间隔(ms)
    END_WAIT: 4000,                                // ended 后等平台渲染答题入口的时间(ms)
    STUCK_WAIT: 1500,                              // 子帧消息延迟(ms)，与 postMessage 时序对齐
    NAV_MAX_RETRIES: 4,                            // 跳转被拒最大重试次数
    NAV_RETRY_WAIT: 6000,                          // 重试间隔(ms)，需 > busy 超时确保重试能执行
    NAV_LOCK_TIMEOUT: 8000,                        // busy/navigating 超时释放(ms)
    BRIDGE_BASE: 'http://127.0.0.1:7531',          // 爬虫本地桥默认地址；可用 ?cxbridge=端口 或 localStorage.cx_bridge_base 覆盖
    ANSWER_KEYWORDS: /章节检测|作业|测验|继续|答题|考试|下一题/ // 题面关键词（不含"开始"）
  };

  // 跨帧消息 nonce（#18）：同源父子帧共用同一脚本，故收发双方天然持有同一常量。
  // 配合接收端 origin 白名单，提供纵深防御——即便某个白名单内域名被攻陷，
  // 无正确 nonce 的伪造消息仍会被丢弃。
  var CX_AN_NONCE = 'cxAN_v1_3.0';

  // ===== 副脚本接入主控面板（force-play v4.0）=====
  // 总开关：localStorage.cx_an_on（'0'=关，默认开）；通过主面板「副脚本」区的复选框切换，立即生效无需刷新。
  var AN_ON = true;
  try { AN_ON = localStorage.getItem('cx_an_on') !== '0'; } catch (e) { swallow(e); }
  try {
    (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
      id: 'auto-next', type: 'toggle', label: '自动下一课 (auto-next)',
      note: '播完自动进答题入口 / 跳下一未完成章节；插播题遮罩自动暂停',
      get: function () { return AN_ON; },
      set: function (v) {
        AN_ON = !!v;
        try { localStorage.setItem('cx_an_on', v ? '1' : '0'); } catch (e) { swallow(e); }
      }
    });
    // 自检：探测主脚本契约（force-play 暴露的 __cxRegisterAddon）。
    // 立即缺失可能是「副脚本先于主脚本执行」所致，故延迟 3s 复核，确实缺失再告警，避免误报。
    if (typeof window.__cxRegisterAddon === 'function') {
      window.__cxRegisterAddon();
    } else {
      setTimeout(function () {
        if (typeof window.__cxRegisterAddon !== 'function') {
          try { console.warn('[auto-next] 未检测到 chaoxing-force-play 主脚本(__cxRegisterAddon 缺失)，本副脚本不会生效；请确认主脚本已安装且与本脚本在相同的 @match 下运行。'); } catch (e) { swallow(e); }
        }
      }, 3000);
    }
  } catch (e) { swallow(e); }

  // DEBUG 开关：仅当为 true 时输出日志，避免污染控制台
  var DEBUG = false;
  function dbg() {
    if (!DEBUG) return;
    try {
      var a = ['[CX-AUTO]'];
      for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
      console.log.apply(console, a);
    } catch (e) { swallow(e); }
  }

  // 由配置派生的局部变量（保持下方逻辑与历史版本一致）
  var P_END = CONFIG.END_WAIT;
  var P_Q = CONFIG.STUCK_WAIT;
  var RE = CONFIG.ANSWER_KEYWORDS;
  var NAV_MAX = CONFIG.NAV_MAX_RETRIES;
  var NAV_WAIT = CONFIG.NAV_RETRY_WAIT;
  var OVERLAY_POLL = CONFIG.OVERLAY_CHECK_INTERVAL;
  var pendingNav = null;  // { retries:Number, fp:String } —— 仅用于跳转重试计数与跳转指纹

  // ===== 本地桥（cx_crawler/bridge.py）：爬虫权威的"未完成章节"清单 =====
  // fallbackNext 原本依赖平台在目录 DOM 上打的 finished/locked 类——该类经常缺失/延迟。
  // 桥清单给出全课程逐章的 completed/unfinishedCount，可精确定位"下一个未完成章节"，
  // 再按 knowledgeId 在目录 DOM 里找对应锚点点击。桥不在线/无清单时静默回退原 DOM 启发式。
  // 端口可配置化（v2.3）：桥地址优先级 = URL ?cxbridge= > localStorage.cx_bridge_base > 默认 127.0.0.1:7531；
  // 指定地址不通时自动探测候选端口挑首个可达者，与 bridge.py 启动端口对齐即可免手动配置。
  var BRIDGE = { data: null, base: null };
  var BRIDGE_PROBE_PORTS = [7531, 7532, 7533, 8543, 9090];
  function resolveBridgeBase() {
    try {
      var q = (window.location.search.match(/[?&]cxbridge=([^&]+)/i) || [])[1];
      if (q) {
        if (/^https?:\/\//i.test(q)) return q.replace(/\/+$/, '');
        if (/^\d{1,5}$/.test(q)) return 'http://127.0.0.1:' + q;
        return 'http://' + q.replace(/\/+$/, '');   // host:port 形式
      }
      try { var ls = localStorage.getItem('cx_bridge_base'); if (ls) return String(ls).replace(/\/+$/, ''); } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
    return CONFIG.BRIDGE_BASE;
  }
  function probeBridgeBase(cb) {
    var i = 0;
    function next() {
      if (i >= BRIDGE_PROBE_PORTS.length) { cb(null); return; }
      var port = BRIDGE_PROBE_PORTS[i++];
      var url = 'http://127.0.0.1:' + port + '/ping';
      try {
        fetch(url, { mode: 'cors' }).then(function (r) {
          if (r && r.ok) cb('http://127.0.0.1:' + port); else next();
        }).catch(function () { next(); });
      } catch (e) { next(); }
    }
    next();
  }
  function bridgeFetch(cid, base) {
    // 评审#7：严格 CSP(connect-src) 下 fetch 会同步抛异常（而非 promise reject），
    // 且本函数会在 probe 回调（promise 链内）被调用，同步抛出会成未处理 rejection，就地兜住。
    var p;
    try { p = fetch(base + '/playlist/' + cid, { mode: 'cors' }); } catch (eSync) { dbg('bridge：fetch 被环境拦截(CSP?)，跳过桥'); return; }
    p.then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && Array.isArray(d.chapters) && d.chapters.length) {
          BRIDGE.data = d;
          dbg('bridge：清单加载成功，共', d.chapters.length, '章');
        }
      })
      .catch(function (e) {
        // 审查 N4：桥失败不再仅 DEBUG 可见。正常模式也 console.warn 一次（每页仅一次，避免刷屏），
        // 让部署了 bridge.py 的用户能发现"桥没生效、已回退 DOM 启发式"；DEBUG 时额外打印错误对象。
        if (!BRIDGE.warned) {
          BRIDGE.warned = true;
          try { console.warn('[CX-AUTO] bridge 清单拉取失败（桥不在线/CORS/网络），已回退 DOM 启发式跳章'); } catch (e2) { swallow(e2); }
        }
        dbg('bridge：fetch 失败（桥不在线/CORS/网络），回退 DOM 启发式');
        if (DEBUG) console.warn('[CX-AUTO] bridge fetch error:', e);
      });
  }
  function bridgeInit() {
    try {
      var href = topHrefAN();
      var cid = urlParamAN(href, ['courseId', 'courseid']);
      // kid 不再在此快照，由 bridgeNextUnfinished 每次实时解析（SPA 路由切换后 URL 参数会变）
      if (!cid) return;
      var base = BRIDGE.base || resolveBridgeBase();
      BRIDGE.base = base;
      bridgeFetch(cid, base);
      // 指定地址不通 → 自动探测候选端口；命中后缓存 base 并重新拉取（v2.3 端口可配置化）
      try {
        fetch(base + '/ping', { mode: 'cors' }).then(function (r) {
          if (!(r && r.ok)) {
            probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, okBase); } });
          }
        }).catch(function () { probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, okBase); } }); });
      } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
  }
  function topHrefAN() {
    var w = window, href = '';
    try {
      href = w.location.href;
      while (w.parent && w.parent !== w) { w = w.parent; href = w.location.href; }
    } catch (e) { swallow(e); }
    return href;
  }
  function urlParamAN(href, names) {
    for (var i = 0; i < names.length; i++) {
      var m = href.match(new RegExp('[?&]' + names[i] + '=([^&#]+)', 'i'));
      if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    }
    return null;
  }
  // 清单中找"当前章之后第一个未完成"的章节（到尾则从头回绕，跳过当前章）
  function bridgeNextUnfinished() {
    try {
      var d = BRIDGE.data;
      if (!d || !Array.isArray(d.chapters)) return null;
      var chs = d.chapters, curIdx = -1;
      // SPA 路由切换时 URL 参数变化但 BRIDGE.kid 仍为旧值，这里实时解析当前章 ID
      var curKid = urlParamAN(topHrefAN(), ['chapterId', 'knowledgeId']);
      for (var i = 0; i < chs.length; i++) {
        if (curKid && String(chs[i].knowledgeId) === String(curKid)) { curIdx = i; break; }
      }
      function unfinished(c) { return c.unfinishedCount > 0 || (!c.completed && c.hasTaskPoints); }
      for (var j = curIdx + 1; j < chs.length; j++) { if (unfinished(chs[j])) return chs[j]; }
      for (var k = 0; k < chs.length; k++) {
        if (k === curIdx) continue;
        if (unfinished(chs[k])) return chs[k];
      }
    } catch (e) { swallow(e); }
    return null;
  }
  // 按 knowledgeId 在目录 DOM 中找可点击锚点：扫描 href/onclick/id 以及常见 data-* 属性（新模板常把节点 id 放在 data-* 上）。
  // 命中即返回首个可见元素；找不到则回退到 DOM 启发式(由 fallbackNext 处理)。
  function anchorForKnowledgeId(kid) {
    if (!kid) return null;
    try {
      var skid = String(kid);
      var links = document.querySelectorAll('a, [onclick]');
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        var blob = '';
        try { blob += (el.getAttribute('href') || ''); } catch (e) { swallow(e); }
        try { blob += '|' + (el.getAttribute('onclick') || ''); } catch (e) { swallow(e); }
        try { blob += '|' + (el.id || ''); } catch (e) { swallow(e); }
        try {
          var attrs = el.attributes;
          for (var a = 0; a < attrs.length; a++) {
            var an = attrs[a].name;
            if (an.indexOf('data-') === 0) blob += '|' + attrs[a].value;
          }
        } catch (e) { swallow(e); }
        if (blob.indexOf(skid) >= 0 && visible(el)) return el;
      }
    } catch (e) { swallow(e); }
    return null;
  }

  // 跨同源窗口共享的防重入锁（同一祖先树内唯一）
  var ROOT = (function () {
    try {
      var w = window;
      while (w.parent && w.parent !== w) {
        try { if (w.parent.location.host === w.location.host) { w = w.parent; } else { break; } }
        catch (e2) { break; }
      }
      return w;
    } catch (e) { return window; }
  })();

  function busy() {
    try { return ROOT.__cxANbusy === true; } catch (e) { return false; }
  }
  function lock() {
    try {
      ROOT.__cxANbusy = true;
      // 记录定时器句柄，便于 unlock() 精确清除（审查 J5）
      if (ROOT.__cxANbusyTimer) { try { clearTimeout(ROOT.__cxANbusyTimer); } catch (e2) { swallow(e2); } }
      ROOT.__cxANbusyTimer = setTimeout(function () { try { ROOT.__cxANbusy = false; } catch (e) { swallow(e); } }, CONFIG.NAV_LOCK_TIMEOUT);
      // navigating 也加对称超时，避免非导航点击（.job-btn / 弹层按钮）误置锁后永久卡死
      setTimeout(function () { try { ROOT.__cxAN_navigating = false; } catch (e) { swallow(e); } }, CONFIG.NAV_LOCK_TIMEOUT);
    } catch (e) { swallow(e); }
  }
  // 审查 J5：run 提前 return 且未实际点击/导航时，立即释放忙锁，避免空占最长 8s
  // （NAV_LOCK_TIMEOUT）阻塞后续 ended/切课触发。navigating 锁仍由 run 入口与 confirmNav 守卫。
  function unlock() {
    try {
      ROOT.__cxANbusy = false;
      if (ROOT.__cxANbusyTimer) { try { clearTimeout(ROOT.__cxANbusyTimer); } catch (e2) { swallow(e2); } ROOT.__cxANbusyTimer = null; }
    } catch (e) { swallow(e); }
  }

  // v2.1.1 改用 getBoundingClientRect 标准方法，兼容 position:fixed / display:none 等场景
  function visible(el) {
    try {
      if (!el) return false;
      var r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      var s = window.getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
    } catch (e) { return false; }
  }

  function clickable(el) {
    if (!el) return false;
    var tag = el.tagName;
    if (tag === 'A' || tag === 'BUTTON') return true;
    var c = (typeof el.className === 'string') ? el.className : '';
    if (/btn|job-btn/.test(c)) return true;
    try { if (el.getAttribute('onclick')) return true; } catch (e) { swallow(e); }
    return false;
  }

  function textOf(el) {
    try { return (el && el.textContent) ? el.textContent : ''; } catch (e) { return ''; }
  }

  // 点击第一个"可见且可点"的元素；命中返回 true
  function clickFirst(list) {
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (visible(el) && clickable(el)) { el.click(); return true; }
    }
    return false;
  }

  // 同上，但还要求文本匹配关键词（用于收窄 [class*="job"] 等宽泛选择器）
  function clickFirstText(list, re) {
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (visible(el) && clickable(el) && re.test(textOf(el))) { el.click(); return true; }
    }
    return false;
  }

  // 多模板适配：目录容器 + 章节项。学习通目录 DOM 多次改版，旧选择器(.catalog-list/.units 等)
  // 在新模板下会整体落空，导致 fallbackNext 直接 return、永不跳章。这里大幅拓宽已知容器/章节项选择器，
  // 并在显式容器都没命中时做一次兜底扫描（标题含 chapter/catalog/point/lesson/unit 且带 <a> 的元素），
  // 以兼容未枚举到的新模板。纯 DOM 只读，无网络/上报。
  function chaptersAll() {
    var out = [];
    var sels = '.catalog-list,.units,.catalog,.catalog-body,.chapter-list,.course-nav,' +
               '.catalogue,.catalog-tree,.course-catalog,.stuCatalog,.catalogContent,' +
               '.leftCatalog,.catalog-item-list,.chapter-list-box,.knowledge-point-list,' +
               '.catalogue-list,.course-catalogue,.catalogBox,.catalog-ul,.catalogList';
    var conts = document.querySelectorAll(sels);
    for (var i = 0; i < conts.length; i++) {
      var cs = conts[i].querySelectorAll(
        '.chapter,.catalog-item,.level-0,.unit-chapter,.catalog-point,.point,' +
        '.catalogItem,.catalog-point-item,.chapter-item,.course-chapter,.knowledge-point,.catalog-li,.catalog-unit'
      );
      for (var j = 0; j < cs.length; j++) out.push(cs[j]);
    }
    // 兜底：显式容器都没命中时，扫描标题含关键字且带 <a> 的元素（排除按钮/图标/遮罩，避免误选）
    if (!out.length) {
      try {
        var all = document.querySelectorAll(
          '[class*="chapter"],[class*="catalog"],[class*="point"],[class*="lesson"],[class*="unit"]'
        );
        for (var k = 0; k < all.length; k++) {
          var ex = all[k];
          var cls = ex.className || '';
          if (/btn|button|icon|mask|dialog/.test(cls)) continue;
          if (ex.querySelector('a')) out.push(ex);
        }
      } catch (e) { swallow(e); }
    }
    return out;
  }

  function currentChapter(list) {
    for (var i = 0; i < list.length; i++) {
      if (/(^|\s)(active|current|on|open|cur)(\s|$)/.test(list[i].className || '')) return list[i];
    }
    // 兜底：模板未给当前章打 active/current 类时，用 URL 中的 chapterId/knowledgeId/kid 定位当前章节，
    // 否则 fallbackNext 会回退到"从头找第一个未完成"，点到的是章节开头而非"下一节"。
    try {
      var kurl = urlParamAN(topHrefAN(), ['chapterId', 'knowledgeId', 'kid']);
      if (kurl) {
        for (var j = 0; j < list.length; j++) {
          var a = list[j].querySelector('a');
          if (a) {
            var h = a.getAttribute('href') || '';
            if (h.indexOf('knowledgeId=' + kurl) >= 0 || h.indexOf('chapterId=' + kurl) >= 0 || h.indexOf('kid=' + kurl) >= 0) return list[j];
          }
        }
      }
    } catch (e) { swallow(e); }
    return null;
  }

  // 页面指纹：用于"跳转是否真发生"的确认。URL + 当前高亮章节文本，任一项变化即视为已跳转。
  function pageFingerprint() {
    try {
      var cur = currentChapter(chaptersAll());
      var key = location.href;
      if (cur) key += '|' + (cur.textContent || '').replace(/\s+/g, '').slice(0, 40);
      return key;
    } catch (e) { return location.href; }
  }

  // 跳转被拒(后端校验未过)后的重试：先释放 busy 锁，再重新评估
  function retryNav() {
    try {
      // 若页面指纹已变化 = 跳转早已成功（可能 SPA 转场较晚），不再重试，直接复位退出，避免在新课上误点
      if (pendingNav && pendingNav.fp && pageFingerprint() !== pendingNav.fp) {
        try { ROOT.__cxAN_navigating = false; } catch (e2) { swallow(e2); }
        dbg('retryNav：指纹已变化，跳转早已成功，放弃重试');
        return;
      }
    } catch (e) { swallow(e); }
    try { ROOT.__cxANbusy = false; } catch (e) { swallow(e); }
    try { run(true); } catch (e) { swallow(e); }
  }

  // 点击"下一节"后确认是否真跳转：若页面指纹未变 = 后端拒绝/未解锁 → 释放导航锁并安排重试；变了 = 成功
  function confirmNav() {
    try {
      if (ROOT.__cxAN_navigating !== true) return; // 已被新视频 arm 复位(成功)或手动释放
      if (pageFingerprint() !== (pendingNav ? pendingNav.fp : '')) {
        ROOT.__cxAN_navigating = false; // 指纹变化 = 跳转成功
        dbg('confirmNav：跳转成功（指纹变化）');
        return;
      }
      // 指纹未变 = 点击被拒（测验未提交/未解锁），释放锁并安排重试
      ROOT.__cxAN_navigating = false;
      if (pendingNav && pendingNav.retries < NAV_MAX) {
        pendingNav.retries++;
        dbg('confirmNav：跳转被拒，安排重试', pendingNav.retries, '/', NAV_MAX);
        setTimeout(retryNav, NAV_WAIT);
      } else {
        dbg('confirmNav：重试次数用尽，停止');
      }
    } catch (e) { swallow(e); }
  }

  // 主流程。allowFallback=true 时才允许"切下一课"（仅真正 ended 时）
  function run(allowFallback) {
    if (!AN_ON) return;          // 主面板总开关（副脚本适配）
    if (busy()) return;
    // 导航锁：一旦已开始跳转（点或 SPA 转场），后续全部触发点一律放弃，防旧页面脚本继续操作导致崩溃
    try { if (ROOT.__cxAN_navigating === true) return; } catch (e) { swallow(e); }
    lock();
    var acted = false;  // 审查 J5：是否真正点击/触发了导航；否则结尾立即释放忙锁
    try {
      // 优先级 1：视频区 job 按钮
      var ct = document.querySelector('.ans-attach-ct');
      if (ct) {
        // 明确的 .job-btn 仅在"真正播完"路径点击，避免插播点误跳到整章作业
        if (allowFallback && clickFirst(ct.querySelectorAll('.job-btn'))) {
          dbg('lock 内点击：.job-btn（类型B）'); acted = true; return;
        }
        // 宽泛 [class*="job"] 必须带题面关键词才点（收窄，防侧栏常驻入口）。
        // 同样受 allowFallback 限制：弹窗（类型A）场景下不应误点视频区常驻入口而跳过错层按钮（优先级2）
        if (allowFallback && clickFirstText(ct.querySelectorAll('[class*="job"]'), RE)) {
          dbg('lock 内点击：视频区 job 子项'); acted = true; return;
        }
      }

      // 优先级 2：弹层里的答题/继续按钮
      var masks = document.querySelectorAll('.dialog-mask');
      for (var m = 0; m < masks.length; m++) {
        var icon = masks[m].querySelector('.ans-job-icon');
        if (!icon) continue;
        var btns = icon.querySelectorAll('button, a, [class*="btn"], [class*="job"]');
        for (var b = 0; b < btns.length; b++) {
          var t = textOf(btns[b]);
          if (RE.test(t) && visible(btns[b])) {
            btns[b].click();
            // 弹层按钮点击后一般触发答题/测验，不是真导航（不置navigating，由lock()的busy+超时兜底）
            dbg('lock 内点击：弹层按钮（', t, '）');
            acted = true; return;
          }
        }
      }

      // 优先级 3：左侧目录当前章节的 job 子项
      var cur = currentChapter(chaptersAll());
      if (cur) {
        var subs = cur.querySelectorAll('a, button, [class*="job"], [class*="btn"]');
        if (clickFirstText(subs, RE)) {
          dbg('lock 内点击：目录当前章节 job 子项'); acted = true; return;
        }
      }

      // fallback：仅真正 ended 时，点下一个未 finished 且未 locked 的章节
      if (allowFallback) fallbackNext();
    } catch (e) {
      try { unlock(); } catch (e2) { swallow(e2); }  // 异常路径也释放，避免锁泄漏（审查 J5）
      return;
    }
    // 审查 J5：本次 run 未实际点击/触发导航 → 立即释放忙锁，
    // 避免空占最长 NAV_LOCK_TIMEOUT(8s)，阻塞后续 ended/切课触发。
    if (!acted) unlock();
  }

  function fallbackNext() {
    try {
      if (ROOT.__cxAN_navigating === true) return;
      if (!pendingNav) pendingNav = { retries: 0 };
      // —— 桥优先：用爬虫权威清单精确跳到"下一个未完成章节"（不依赖平台 finished/locked 类）——
      // 找到清单条目但目录 DOM 无对应锚点时（模板差异/目录未展开），落回原 DOM 启发式。
      try {
        var bnext = bridgeNextUnfinished();
        if (bnext) {
          var ba = anchorForKnowledgeId(bnext.knowledgeId);
          if (ba) {
            pendingNav.fp = pageFingerprint();
            ROOT.__cxAN_navigating = true;
            dbg('导航锁置位：桥清单精确跳章 →', bnext.title || bnext.knowledgeId);
            ba.click();
            setTimeout(confirmNav, 2500);
            return;
          }
          dbg('桥清单命中下一未完成章但目录无锚点，回退 DOM 启发式');
        }
      } catch (e) { swallow(e); }
      var ch = chaptersAll();
      if (!ch.length) return;
      var cur = currentChapter(ch);
      var curIdx = -1;
      for (var i = 0; i < ch.length; i++) { if (ch[i] === cur) { curIdx = i; break; } }
      var start = (curIdx >= 0) ? curIdx + 1 : 0;
      var target = null, targetIdx = -1;
      // 向后找第一个"可见且未 finished/locked"的章节链接（未 locked = 平台已解锁，可点）
      for (var j = start; j < ch.length; j++) {
        if (/finished|locked/.test(ch[j].className || '')) continue;
        var a = ch[j].querySelector('a');
        if (a && visible(a)) { target = a; targetIdx = j; break; }
      }
      if (!target && curIdx > 0) {
        for (var k = 0; k < curIdx; k++) {
          if (/finished|locked/.test(ch[k].className || '')) continue;
          var a2 = ch[k].querySelector('a');
          if (a2 && visible(a2)) { target = a2; targetIdx = k; break; }
        }
      }
      // 目录里找不到时，最后尝试底部的"下一节/下一个"实体按钮（部分课程模板以它为主跳转入口）
      if (!target) {
        var nb = document.querySelectorAll('.next-btn, .next-page, [class*="nextBtn"], [class*="next-page"], [class*="next"]');
        for (var n = 0; n < nb.length; n++) {
          if (visible(nb[n]) && /下一节|下一个|下一课|下一讲/.test(textOf(nb[n]))) { target = nb[n]; targetIdx = -2; break; }
        }
      }
      if (!target) {
        // 没有"已解锁"的下一节：很可能任务点尚未同步解锁（双任务点延迟）。
        // 不放弃：安排轮询重试，等平台把下一节解锁后再点。
        if (pendingNav.retries < NAV_MAX) {
          pendingNav.retries++;
          dbg('fallbackNext：无已解锁下一节，安排重试', pendingNav.retries, '/', NAV_MAX);
          setTimeout(retryNav, NAV_WAIT);
        } else {
          dbg('fallbackNext：重试用尽，停止轮询');
        }
        return;
      }
      // 点前一记录指纹，点击后置导航锁，并安排"跳转确认"
      pendingNav.fp = pageFingerprint();
      ROOT.__cxAN_navigating = true;
      dbg('导航锁置位：切下一节（fallback）');
      target.click();
      setTimeout(confirmNav, 2500);
    } catch (e) { swallow(e); }
  }

  // 通知父帧也跑一次（按钮常在父文档，而视频常在子 iframe）。仅通知最近一级父帧，避免多实例重复点击
  function notifyParent(allowFallback) {
    try {
      if (window.parent && window.parent !== window) {
        // 收窄：若父帧同源则用 location.origin，否则保持 '*' 但接收端已做 origin 白名单校验
        var tgt = '*';
        try { tgt = window.parent.location.origin; } catch (e) { /* 跨域不可读 */ }
        // #18：附带 nonce，接收端在 origin 白名单之外再校验 nonce，纵深防御伪造消息
        window.parent.postMessage(
          { __cxAN: allowFallback ? 'ended' : 'q', nonce: CX_AN_NONCE },
          tgt
        );
      }
    } catch (e) { swallow(e); }
  }

  function schedule(allowFallback) {
    try {
      setTimeout(function () { try { run(allowFallback); } catch (e) { swallow(e); } }, allowFallback ? P_END : P_Q);
      notifyParent(allowFallback);
    } catch (e) { swallow(e); }
  }

  // 真正暂停视频（配合 force-play 的 __cxAN_hold 协调，避免其轮询把视频续上）
  // 先置 hold 标志再调原生 pause：force-play 的 pause 事件/轮询看到 hold 后跳过续播。
  // 释放机制（双保险）：① 监听 video 原生 play 事件（答题完成、平台恢复播放自动解锁）；
  //                     ② checkOverlay 轮询到遮罩消失也会主动释放（见下）。
  // __np 是 chaoxing-force-play(≥3.15) 在「接管视频」时保存的原生 HTMLMediaElement.pause 引用；
  // 仅当 force-play 已接管(v.__cxForcePaused)且 __np 就绪，才用它绕过被覆盖为 no-op 的原生 pause，
  // 确保暂停真正生效。force-play 未安装/未接管时，v.pause 仍是原生实现，直接调用即可。
  // 审查 J6：不再仅凭 `typeof __np==='function'` 判定——避免 __np 在 force-play 真正接管前被误置，
  // 从而绕过尚未被覆盖的原生 pause 导致「暂停失效」；改以 v.__cxForcePaused 作接管守卫。
  function holdPause(v) {
    try { v.__cxAN_hold = true; } catch (e) { swallow(e); }
    try {
      if (v.__cxForcePaused && typeof v.__np === 'function') v.__np();
      else v.pause();
    } catch (e) { swallow(e); }
    if (!v.__holdArmed) {
      v.__holdArmed = true;
      try {
        v.addEventListener('play', function () {
          try { if (v.__cxAN_hold) v.__cxAN_hold = false; } catch (e) { swallow(e); }
        }, true);
      } catch (e) { swallow(e); }
    }
  }

  // 给单个 video 挂事件：仅保留 ended（真正播完才触发"章节检测"扫描与切课）。
  // 插播题暂停已由 checkOverlay 主动检测遮罩完成，不再依赖任何 video 事件。
  function arm(v) {
    if (!v || v.__armed) return;
    try {
      v.__armed = true;
      // 新视频元素出现 = 新一节课已加载（SPA 路由切换或刷新完成）：释放上一轮导航锁，并重置跳转重试计数
      try { ROOT.__cxAN_navigating = false; } catch (e2) { swallow(e2); }
      try { if (pendingNav) pendingNav.retries = 0; } catch (e3) { swallow(e3); }

      // 真正播完：延迟 P_END 等平台渲染答题入口/下一节解锁，再扫描"章节检测"并跳转（类型 B）
      v.addEventListener('ended', function () {
        if (v.__ed) return; v.__ed = true;
        schedule(true);
      }, true);
    } catch (e) { swallow(e); }
  }

  // 学习通插播题(类型 A)真相：平台从不暂停视频，只在视频上方盖 .dialog-mask / .ans-job-icon 遮罩，
  // 视频在底下继续播。因此不依赖 video 事件，改为每 OVERLAY_POLL 主动轮询遮罩可见性：
  //   - 遮罩可见 且 当前视频未 ended、未被锁定 → 主动调原生 pause 暂停（让用户能答题）
  //   - 遮罩不可见 且 视频处于锁定态 → 释放锁，让 force-play 恢复续播
  function getOverlay() {
    try {
      // 审查#6：仅匹配真正的插播题/答题模态遮罩 .dialog-mask。.ans-job-icon 是播放器控制栏里常驻的任务点小图标，
      // 正常播放时也始终可见，若一并匹配会在「无遮罩」时误暂停视频，故排除。
      var o = document.querySelector('.dialog-mask');
      if (o && visible(o)) return o;   // 复用下方 visible()，去掉与 elVisible 的重复实现
    } catch (e) { swallow(e); }
    return null;
  }

  // 取第一个"尚未播完"的 video（已 ended 的视频不参与插播题暂停判定）
  function firstPlayingVideo() {
    try {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) {
        if (!vs[i].ended) return vs[i];
      }
    } catch (e) { swallow(e); }
    return null;
  }

  function checkOverlay() {
    if (!AN_ON) return;          // 主面板总开关（副脚本适配）
    try {
      var ov = getOverlay();
      var v = firstPlayingVideo();
      if (ov && v && !v.__cxAN_hold) {
        // 遮罩可见且仍在播 → 主动暂停（类型 A 插播题）
        dbg('checkOverlay：遮罩可见，主动暂停视频（holdPause）');
        holdPause(v);
      } else if (!ov && v && v.__cxAN_hold) {
        // 遮罩已消失 → 解锁，force-play 下一轮(≤2s)即恢复续播
        try { v.__cxAN_hold = false; } catch (e) { swallow(e); }
        dbg('checkOverlay：遮罩消失，释放 hold 锁');
      }
    } catch (e) { swallow(e); }
  }

  function scanVideos() {
    try {
      var vs = document.querySelectorAll('video');
      for (var i = 0; i < vs.length; i++) arm(vs[i]);
    } catch (e) { swallow(e); }
  }

  // 接收子帧通知（子 iframe 视频结束后，父文档按钮在此被点击）。加 origin 校验，仅接受学习通域名。
  // 审查 N1：原 indexOf 子串匹配可被 evilchaoxing.com / chaoxing.com.attacker.com 等伪造域名绕过，
  // 改为解析 hostname 后做「等于或以 .chaoxing.com / .edu.cn 结尾」的后缀精确匹配。
  function trustedOriginAN(origin) {
    try {
      var h = new URL(origin).hostname;
      return h === 'chaoxing.com' || /\.chaoxing\.com$/.test(h) || /\.edu\.cn$/.test(h);
    } catch (e) { return false; }
  }
  function messageHandler(ev) {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    try {
      if (!ev || !ev.data || !ev.data.__cxAN) return;
      if (!(ev.origin && trustedOriginAN(ev.origin))) return;
      // #18：nonce 校验，与 origin 白名单叠加，丢弃无正确 nonce 的伪造消息
      if (ev.data.nonce !== CX_AN_NONCE) return;
      var t = ev.data.__cxAN;
      setTimeout(function () { try { run(t === 'ended'); } catch (e) { swallow(e); } },
        t === 'ended' ? P_END : P_Q);
    } catch (e) { swallow(e); }
  }
  try {
    window.addEventListener('message', messageHandler, true);
  } catch (e) { swallow(e); }

  // 同源 iframe 内的视频：脚本在每个 @match 帧各自注入，这里再递归钻入可见同源 iframe
  var _debounceScanTimer = null;
  function observe(root) {
    try {
      _obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'VIDEO') arm(n);
            try {
              var vs = n.querySelectorAll ? n.querySelectorAll('video') : [];
              for (var k = 0; k < vs.length; k++) arm(vs[k]);
            } catch (e) { swallow(e); }
          }
        }
        // debounce：高频 mutation 下 500ms 内最多扫一次全文档，避免低端机卡顿
        try { clearTimeout(_debounceScanTimer); } catch (e) { swallow(e); }
        _debounceScanTimer = setTimeout(function () { scanVideos(); }, 500);
      });
      _obs.observe(root, { childList: true, subtree: true });
    } catch (e) { swallow(e); }
  }

  // init
  try { bridgeInit(); } catch (e) { swallow(e); }
  scanVideos();
  try { observe(document.documentElement); } catch (e) { swallow(e); }
  // 遮罩轮询：每 1.5s 检测插播题遮罩并主动暂停/释放
  try { _checkTimer = setInterval(checkOverlay, OVERLAY_POLL); } catch (e) { swallow(e); }

  // 监听器清理（审查 JS1-2）：页面卸载时断开 MutationObserver、清除轮询定时器、移除全局监听器，避免孤立回调滞留
  function cleanupListeners() {
    try { if (_obs && _obs.disconnect) _obs.disconnect(); } catch (e) { swallow(e); }
    try { if (_checkTimer) clearInterval(_checkTimer); } catch (e) { swallow(e); }
    try { window.removeEventListener('message', messageHandler, true); } catch (e) { swallow(e); }
  }
  try { window.addEventListener('pagehide', cleanupListeners); } catch (e) { swallow(e); }
  try { window.addEventListener('beforeunload', cleanupListeners); } catch (e) { swallow(e); }
})();
