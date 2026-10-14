// ==UserScript==
// @name         学习通·强制续播 (iframe穿透 + 防暂停 + 防伪暂停 + 防重播)
// @namespace    http://cx.local/
// @version      3.33
// @author       anon
// @description  钻入同源 iframe / Shadow DOM，覆盖 pause 为 no-op、ratechange 仅在 rate<=0.01 时拉回 1x、低频 2s 轮询兜底续播；无条件尊重 auto-next 的 __cxAN_hold 暂停锁。ended 状态采用持久锁(__cxEndedLock)覆盖 play 为 no-op、进度条锁末尾、seeking 守卫，并持续到元素被替换(阻断平台以 video.play()/重建元素/src 替换重播)，与 auto-next 的 ended 跳课协同(避免重播吃掉跳课时机)；劫持 navigator.mediaSession 应对锁屏续播。无视平台自定义暂停指令(window.ananas.pause / 直接 video.pause / playbackRate=0 伪暂停 / postMessage)。【定向续播】读取 window.attachments 构建任务点视频白名单，仅对命中的任务点视频强制续播，跳过广告/插播视频；匹配规则整体失效时自动回退为全量续播。【重建去重】ended 时登记 currentSrc，任何地址命中的新 video 判定为同一已播完任务点的整元素重建并锁死不播，彻底杜绝跳课后的重播。【稳健性】定向匹配改边界正则(防 123 误命中 12345)、refreshTargets 加滞回(附件瞬时空窗不回退全量)、ENDED_SRCS 黑名单仅随真实章节切换清空。【v3.9 健壮性】MutationObserver 改为帧合并队列(防高频雪崩)、loop 持续断言(防循环重播)、可见性切回复位 window.ananas.pause、mediaSession 态改 playing、safePlay 静音重试后恢复音量、定向匹配正则按 URL 边界[/?&=.#]收紧。【v3.10 健壮性】neutralizeGlobalPause 改 defineProperty+描述符探测(严格模式不再静默失效)、重建去重补齐祖先 iframe src 关掉 currentSrc 未就绪时间窗、直播 duration=Infinity 加 isFinite 守卫、for...in 改 Object.keys、hasVideo 仅计 video、querySelectorAll 微优化为 getElementsByTagName、清死代码(__rp/重复 pauseNoop/不可达 TARGETED 分支)。【v3.11 复核修复】keyRe 回退 [^A-Za-z0-9](撤销纯损的 [/?&=.#] 收窄，防漏匹 lesson_123/clip-123)、iframe src 仅限承载任务 id 的播放器 iframe 进黑名单(防通用 shell iframe 误锁)、neutralizeGlobalPause 改 defineProperty 直接遮蔽(覆盖继承属性)、删死配置 TARGETED 与死字段 hasVideo/__cxSkip、safePlay 音量恢复改 playing 事件驱动(避免提前取消静音)。【v3.12 复核修复】safePlay 的 restore 监听器改用 {once:true} 注册(消除 addEventListener(capture) 与 removeEventListener 缺 capture 标志不匹配导致的监听器永久累积泄漏)、videoIframeSrcsOf 改用 keyRe 边界匹配(与 videoBelongsToTask 统一，避免裸子串误收通用 iframe)。【v3.14 抗失效】①定向续播：安装 window.attachments setter 钩子(AJAX 异步到达即重建白名单，不等 2s 轮询)，attachments 永不出现时由桥 objectids 独立撑起白名单(防"无米之炊")；②重建去重：指纹由仅 video.src/iframe.src 扩展为 iframe id/name/title/data-* 与 video 自身 id——抗 MSE 的 blob: 源(无 objectid)与通用 src 播放器重建；③防暂停：下沉到 HTMLMediaElement.prototype.pause(仅拦截 __cxForcePaused 视频)，连闭包/webpack 私有 pause() 也拦得住，未命中广告/插播仍可正常暂停，auto-next 经原生备份 v.__np 真正暂停。【v3.15 抗伪暂停/断流】①playbackRate 伪暂停下沉 HTMLMediaElement.prototype.playbackRate setter 拦截（对 __cxForcePaused 视频赋 0/极小速率直接改写为 1x，与 ratechange+轮询双重兜底，不采用 SourceBuffer Hook 以免花屏）；②MSE 断流：新增 waiting/stalled 事件监听，缓冲枯竭即 safePlay() 触发新一轮数据请求续播（不跳秒以免 seek 出错）。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ===== 配置 =====
  var CONFIG = {
    RESCAN_INTERVAL: 2000,  // 低频全量重扫间隔(ms)：对抗平台重定义 pause / 原型硬调用 / DOM 换血。2s 足够，高频空转徒增资源消耗
    PAUSE_HOTKEY: 'p',      // 控制面板开关键：非输入框聚焦时按此键开/关悬浮控制面板（面板内含暂停/恢复、计时器滑块）；空串=禁用
    AUTO_STOP_MIN: 0,       // 自动停止计时器：累计观看满 N 分钟自动暂停且不再续播；0=禁用
    RESUME_AFTER_MIN: 0,    // 暂停后自动恢复：N 分钟后自动续播；0=保持暂停直到手动恢复（"暂停后是否开启"开关）
    END_RELEASE_SEC: 15     // 进度到底释放：距结尾 ≤ 此秒数（且未真正 ended）时关闭强制续播，交还平台/用户自然结束或暂停；0=禁用
  };

  // DEBUG 开关：仅当为 true 时输出日志，避免污染控制台。
  // 用条件定义替代运行时 if(!DEBUG) + arguments 遍历，热路径零开销（吸收评审#12）。
  var DEBUG = false;
  var dbg = DEBUG ? function () {
    try { console.log.apply(console, ['[CX-FORCE]'].concat([].slice.call(arguments))); } catch (e) {}
  } : function () {};

  // #3 修复：平台常在闭包/webpack 私有函数里直接调 video.pause()（绕过 window.ananas.pause 覆盖），
  // 仅覆盖全局对象/实例方法防不住。故将"防暂停"下沉到 HTMLMediaElement.prototype.pause：
  //   任何视频的 pause() 在 __cxForcePaused 为真(本脚本已强制续播)时变为 no-op，闭包私有暂停也走此路径被拦截；
  //   未命中的广告/插播视频(__cxForcePaused 未置)仍可正常暂停；
  //   auto-next 的 hold 暂停通过原生备份 NATIVE_PAUSE(经 v.__np)绕过拦截真正暂停，不受影响。
  var NATIVE_PAUSE = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype && HTMLMediaElement.prototype.pause)
    ? HTMLMediaElement.prototype.pause : null;
  var NATIVE_PLAY = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype && HTMLMediaElement.prototype.play)
    ? HTMLMediaElement.prototype.play : null;   // 原生 play 备份：用户暂停闸门放行时经此播放，绕过实例级覆盖
  function installPrototypePauseNeutralize() {
    if (!NATIVE_PAUSE) return;
    function protoPause() {
      try { if (this && this.__cxForcePaused) return; } catch (e) {}
      return NATIVE_PAUSE.apply(this, arguments);
    }
    try { HTMLMediaElement.prototype.pause = protoPause; }
    catch (e1) {
      try { Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: protoPause }); }
      catch (e2) {}
    }
  }
  installPrototypePauseNeutralize();

  // #2 进阶（对抗 playbackRate 伪暂停）：平台不调 pause()，而是直接 video.playbackRate = 0 让画面"冻结"。
  // 已有时有 ratechange 事件回拉 + 轮询断言；再下沉到原型 setter 更激进拦截：一旦对"已强制续播"视频
  // 赋 0/极小速率，直接改写为 1x（尊重 hold 锁与未命中视频）。不 Hook SourceBuffer（appendBuffer 风险花屏，故不采用）。
  var NATIVE_RATE_DESC = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype)
    ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate') : null;
  function installPlaybackRateNeutralize() {
    if (!NATIVE_RATE_DESC || !NATIVE_RATE_DESC.set) return;
    try {
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        configurable: true, enumerable: true,
        get: NATIVE_RATE_DESC.get,
        set: function (v) {
          try { if (this && this.__cxForcePaused && !this.__cxAN_hold && !this.__cxUserPaused && v <= 0.01) v = 1; } catch (e) {}
          return NATIVE_RATE_DESC.set.call(this, v);
        }
      });
    } catch (e) {}
  }
  installPlaybackRateNeutralize();

  // ===== 定向续播：从 window.attachments 抽任务点视频白名单 =====
  // 播放页 JS 渲染后，顶层 window.attachments 是任务点数组，每项 { property: {...} }，
  // property.objectid / mid / id 为视频资源标识，property.type 标记类型(video/document/...)。
  // 据此只续任务点视频，广告/插播视频不在白名单内 → 跳过（不让 force-play 误续）。
  var TARGET = { enabled: false, ids: null, matchedAny: false };

  // ===== 本地桥（cx_crawler/bridge.py）：读取爬虫权威清单 =====
  // 作用：① 当前章 completed 且无未完成任务点 → 本脚本整体避让（不覆盖 pause、不强制续播），
  //         避免重进已完成章节被重新续播；
  //      ② 当前章 objectids（爬虫 RENDER_JOBS=True 渲染产物）→ 预填定向白名单，
  //         早于 window.attachments 渲染就绪，定向更快更稳。
  // 桥服务不在线 / 无清单 / URL 缺参时静默回退原有行为（零新增依赖）。
  // 127.0.0.1 属 potentially-trustworthy origin，https 页面可直接 fetch，无混合内容拦截。
  // 【易误判·诊断#一】曾有审查误判 http://127.0.0.1 在 https 页会被混合内容拦截——错：回环地址依 Secure Contexts 规范豁免混合内容；
  //   且 https base 已可经 ?cxbridge= / localStorage.cx_bridge_base 配置，无需改代码。桥在生产环境可用。
  // 端口可配置化（v3.14）：桥地址优先级 = URL ?cxbridge= > localStorage.cx_bridge_base > 默认 127.0.0.1:7531；
  // 默认/指定地址不通时，自动探测候选端口挑首个可达者（与 bridge.py 启动端口对齐即可免手动配置）。
  var BRIDGE = {
    base: null,         // 运行时解析得到
    chapter: null,      // 当前章清单条目
    skipResume: false   // true = 当前章已完成，禁用强制续播
  };
  var BRIDGE_PROBE_PORTS = [7531, 7532, 7533, 8543, 9090];
  function resolveBridgeBase() {
    try {
      var q = (window.location.search.match(/[?&]cxbridge=([^&]+)/i) || [])[1];
      if (q) {
        if (/^https?:\/\//i.test(q)) return q.replace(/\/+$/, '');
        if (/^\d{1,5}$/.test(q)) return 'http://127.0.0.1:' + q;
        return 'http://' + q.replace(/\/+$/, '');   // host:port 形式
      }
      try { var ls = localStorage.getItem('cx_bridge_base'); if (ls) return String(ls).replace(/\/+$/, ''); } catch (e) {}
    } catch (e) {}
    return 'http://127.0.0.1:7531';
  }
  // 探测候选端口：依次 GET /ping，返回首个 200 的 base（无则 null）。结果写入 BRIDGE.base 缓存。
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
  function topHref() {
    var w = window, href = '';
    try {
      href = w.location.href;
      while (w.parent && w.parent !== w) { w = w.parent; href = w.location.href; }
    } catch (e) {}   // 跨域父帧读不到 href 即抛错，保留最近一层同源 href
    return href;
  }
  function urlParam(href, names) {
    for (var i = 0; i < names.length; i++) {
      var m = href.match(new RegExp('[?&#]' + names[i] + '=([^&#]+)', 'i'));   // F-B5：兼容参数置于 hash（#kid=...）的新模板路由
      if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    }
    return null;
  }
  // skipResume 迟到时（fetch 异步），已被覆盖的 video 需恢复原生 pause + 清除续播标记，还用户暂停/播放能力。
  // F-B2 修复：仅恢复 v.pause 不够——原型/实例的 pause 中性化与 play 包装仍由 __cxForcePaused 控制，
  // 不清除该标志会导致用户既无法暂停（原型 noop 检查到 true）也无法播放（neutralVideoPlay 返回 noop）。
  function restoreNativePause(root) {
    if (!root || !root.getElementsByTagName) return;
    try {
      var vs = root.getElementsByTagName('video');
      for (var i = 0; i < vs.length; i++) { var v = vs[i]; try {
        if (v.__np) v.pause = v.__np;                            // 恢复实例级原生 pause（绕过原型 noop）
        v.__cxForcePaused = false;                               // F-B2：关闭原型 pause/play/playbackRate 的 noop 拦截
        v.__cxReleased = true;                                   // F-B6：标记已释放，续播兜底监听不再自动续播
      } catch (e) {} }
    } catch (e) {}
    try {
      root.querySelectorAll('iframe').forEach(function (f) {
        try { if (f.contentDocument) restoreNativePause(f.contentDocument); } catch (e) {}
      });
    } catch (e) {}
  }
  function bridgeFetch(cid, kid, base) {
    // 评审#7：严格 CSP(connect-src) 下 fetch 会同步抛异常（而非 promise reject）。
    // 本函数还会在 probe 回调（promise 链内）被调用，同步抛出会变成未处理 rejection，故就地兜住。
    var p;
    try { p = fetch(base + '/playlist/' + cid); } catch (e) { dbg('bridge：fetch 被环境拦截(CSP?)，跳过桥'); return; }
    p.then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !Array.isArray(d.chapters)) return;
        for (var i = 0; i < d.chapters.length; i++) {
          if (String(d.chapters[i].knowledgeId) === String(kid)) { BRIDGE.chapter = d.chapters[i]; break; }
        }
        var ch = BRIDGE.chapter;
        if (!ch) return;
        if (ch.completed && !(ch.unfinishedCount > 0)) {
          BRIDGE.skipResume = true;
          try { restoreNativePause(document); } catch (e) {}
          dbg('bridge：当前章已完成，禁用强制续播并恢复原生 pause');
        }
        try { refreshTargets(); } catch (e) {}   // 桥异步到达后即时用 objectids 撑起白名单（#1）
        dbg('bridge：清单命中当前章', ch.title || kid);
      })
      .catch(function () {});                    // 桥不在线：静默回退
  }
  function bridgeInit() {
    try {
      var href = topHref();
      var cid = urlParam(href, ['courseId']);
      var kid = urlParam(href, ['chapterId', 'knowledgeId']);
      if (!cid || !kid) return;                    // 非播放页（无课程/章节参数）不拉桥
      var base = BRIDGE.base || resolveBridgeBase();
      BRIDGE.base = base;
      bridgeFetch(cid, kid, base);
      // 默认/指定地址不通 → 自动探测候选端口；命中后缓存 base 并重新拉取（v3.14 端口可配置化）
      try {
        fetch(base + '/ping', { mode: 'cors' }).then(function (r) {
          if (!(r && r.ok)) {
            probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } });
          }
        }).catch(function () { probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } }); });
      } catch (e) {}
    } catch (e) {}
  }

    // 下钻收集 attachments 中所有可定位视频的 id（objectid/mid/id），兼容大小写与子附件
  function collectAttachmentIds() {
    try {
      var a = window.attachments;
      if (!Array.isArray(a) || !a.length) return null;
      var ids = {};
      function walk(prop) {
        if (!prop || typeof prop !== 'object') return;
        var oid = prop.objectid || prop.objectId || prop.object_id;
        if (oid != null) ids[String(oid)] = true;
        var mid = prop.mid || prop.mediaId;
        if (mid != null) ids[String(mid)] = true;
        var idv = prop.id;
        if (idv != null) ids[String(idv)] = true;
        if (Array.isArray(prop.attachments)) prop.attachments.forEach(walk);
        if (Array.isArray(prop.childList)) prop.childList.forEach(walk);
      }
      for (var i = 0; i < a.length; i++) {
        var item = a[i];
        if (item) walk(item.property || item);
      }
      return { ids: ids };
    } catch (e) { return null; }
  }

  // #1 修复：window.attachments 延迟/缺失导致"无米之炊"。
  // 该变量常在 AJAX 回包后异步挂到 window，早期轮询只能读到 undefined；某些旧版/移动端页甚至永不出现。
  // 故：①定义 setter 钩子——页面一旦 assign window.attachments 立即触发 refreshTargets，不等 2s 轮询；
  //    ②refreshTargets 退化时优先用桥清单 objectids（爬虫侧权威、早于 AJAX 渲染），保证白名单不空窗；
  //    ③保留轮询兜底，应对 setter 被平台劫持/描述符受限写不进的极端情况。
  var _attachHooked = false;
  function hookAttachments() {
    if (_attachHooked) return;
    try {
      if (Object.getOwnPropertyDescriptor(window, 'attachments')) return;  // 已被平台定义（不可重定义）→ 退回轮询兜底
      var _store = { value: window.attachments };
      Object.defineProperty(window, 'attachments', {
        configurable: true,
        enumerable: true,
        get: function () { return _store.value; },
        set: function (v) {
          _store.value = v;
          try { refreshTargets(); } catch (e) {}   // 即时重建白名单，无需等下一个 2s 周期
        }
      });
      _attachHooked = true;
    } catch (e) {}
  }

  // 刷新定向目标：基于 window.attachments + 桥清单 objectids 重建任务点白名单。
  // 改进（吸收评审）：① 滞回——已启用状态下若本次 attachments 暂为空窗，保持稳定不回退，避免"定向↔全量"横跳误触广告；
  //                 ② 仅在"任务点 id 集合真变化"(真实章节/课程切换)时清空 ENDED_SRCS 黑名单，既保留重建重播保护，
  //                    又允许切到新一课/回看（原"任意新 video 即清空"写法会令黑名单失效，已删除）。
  // #1 强化：attachments 永不出现时，桥 objectids 可独立撑起白名单（ids 非空即启用），不再"无米之炊"。
  var _lastTaskKey = null;
  var _lastChapterKey = null;                 // 专项诊断#八：章节参数跟踪，跨章复用同 objectid 时强制清空 ENDED_SRCS 防误锁
  var _targetMissStreak = 0;                  // 定向 0 命中连续轮数（迟滞：连续 N 轮才回退全量，避免瞬时空窗横跳，专项诊断#三）
  var TARGET_FALLBACK_ROUNDS = 3;             // 连续 0 命中达此轮数判定白名单失效 → 回退全续播
  // 跨脚本契约：auto-next 脚本在插插题/答题需暂停时，向具体 video 写入 v.__cxAN_hold=true（暂停时清除）。
  // 本脚本只读此标志并一律避让，不自行定义/初始化——若 auto-next 未加载，该标志恒为 undefined(假)，不影响续播。
  // 【易误判·诊断#十】字段名刻意不提取为常量：属与 auto-next 的隐式契约，改名需两端同步；提取常量无收益且增间接层。
  function refreshTargets() {
    var info = collectAttachmentIds();
    // 合并桥清单预填的 objectids：attachments 未渲染/缺字段时白名单仍完整；
    // 每轮固定合并同一集合，键集稳定，不会扰动 _lastTaskKey 的章节切换判定。
    try {
      var bo = BRIDGE.chapter && BRIDGE.chapter.objectids;
      if (bo && bo.length) {
        if (!info || !info.ids) info = { ids: {} };
        for (var _b = 0; _b < bo.length; _b++) info.ids[String(bo[_b])] = true;
      }
    } catch (e) {}
    var keyArr = (info && info.ids) ? Object.keys(info.ids) : [];
    if (keyArr.length) {
      var keys = keyArr.slice().sort().join('|');
      var kid = urlParam(topHref(), ['chapterId', 'knowledgeId']) || '';   // 专项诊断#八：章节参数亦纳入切换判定
      var _taskChanged = (keys !== _lastTaskKey);
      var _chapChanged = (kid !== _lastChapterKey);
      if (_taskChanged || _chapChanged) {        // 真实章节切换（任务点 id 集或章节参数任一变化）→ 重置"已结束地址"黑名单(防微量泄漏)
        ENDED_SRCS = {};                          // 专项诊断#八：跨章复用同一 objectid 时仍清空，避免旧章已结束指纹误锁新章首播
        if (_taskChanged) _keyReCache = {};       // 正则缓存按 task id 维护，仅 id 集变化才需清（与章节无关）
        _lastTaskKey = keys;
        _lastChapterKey = kid;
      }
      TARGET.ids = info.ids;
      TARGET.keys = keyArr;               // 评审#2：key 数组随白名单一次性生成，热路径复用，免每视频每轮 Object.keys 分配
      TARGET.enabled = true;
      TARGET.matchedAny = false; // 本轮重置，扫描命中后置真
      dbg('定向模式启用，任务点 id 数=', keyArr.length);
    } else {
      // 滞回分支修补（吸收外部评审 2.1）：保持"空窗不回退"的滞回设计不变（避免定向↔全量横跳），
      // 但此前 matchedAny 只在 if 分支重置——空窗期间沿用旧轮真值，导致 setInterval 里
      // "定向 0 命中→回退全续播"的兜底永不触发，过期 TARGET.ids 可能长期误杀新视频。
      // 现空窗轮也重置 matchedAny，本轮扫描若过期 ids 一个都没命中，兜底立即回退全续播。
      TARGET.matchedAny = false;
      if (!TARGET.enabled) {              // 仅从未启用时才回退，已启用遇瞬时空窗保持稳定
        TARGET.enabled = false;
        TARGET.ids = null;
        TARGET.keys = null;
        dbg('无可用 attachments 任务点，回退全续播');
      }
    }
  }

  // 任务点 id 的边界正则缓存：要求 key 前后为非字母数字边界或字符串边界。
  // 注：v3.9 曾把边界收窄为 [/?&=.#]，系"纯损"修改——该集合是 [^A-Za-z0-9] 的真子集，
  // 会漏匹 _ - : 等分隔符包裹的合法 id(如 lesson_123 / clip-123)，而旧版本就不会把 123 误命中 12345
  //(因 "12345" 中 "123" 之后是 alnum '5'，边界不成立)。故回退到 [^A-Za-z0-9]（吸收评审 A）。
  var _keyReCache = {};
  function keyRe(key) {
    if (!_keyReCache[key]) {
      var esc = String(key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      _keyReCache[key] = new RegExp('(?:^|[^A-Za-z0-9])' + esc + '(?:[^A-Za-z0-9]|$)');
    }
    return _keyReCache[key];
  }

  // 判断某 video 是否属于任务点：向上收集 video.currentSrc / 祖先 iframe 的 src/name/id/data，
  // 任一含白名单 id 即命中。定向未启用或缺白名单时返回 true（全续播兜底）。
  function videoBelongsToTask(v) {
    if (!TARGET.enabled || !TARGET.ids) return true;
    try {
      var urls = [];
      try { if (v.currentSrc) urls.push(v.currentSrc); } catch (e) {}
      try { if (v.src) urls.push(v.src); } catch (e) {}
      var el = v;
      while (el && el.parentElement) {
        el = el.parentElement;
        if (el && el.tagName === 'IFRAME') {
          try { if (el.src) urls.push(el.src); } catch (e) {}
          try { if (el.id) urls.push(el.id); } catch (e) {}
          try { if (el.name) urls.push(el.name); } catch (e) {}
          try { if (el.getAttribute) { var d = el.getAttribute('data'); if (d) urls.push(d); } } catch (e) {}
        }
      }
      var idKeys = TARGET.keys || Object.keys(TARGET.ids);   // 评审#2：优先用缓存 key 数组
      for (var ki = 0; ki < idKeys.length; ki++) {
        var key = idKeys[ki];
        var re = keyRe(key);
        for (var u = 0; u < urls.length; u++) {
          if (urls[u] && re.test(urls[u])) return true;
        }
      }
    } catch (e) {}
    return false; // 定向模式但无任何白名单 id 命中 → 视为广告/插播 → 跳过
  }

  // ===== 重播加固：用 currentSrc 去重"已播完任务的整元素重建" =====
  // 平台跳课时可能销毁旧 video 并以全新元素重建同一已播完视频（src 相同），旧 __cxEndedLock 失效 → 误续播。
  // 故：ended 锁定时登记其 currentSrc；任何"非 ended、地址命中已结束集合"的新 video = 同一任务点重建 → 锁死不播。
  var ENDED_SRCS = {};
  function videoSrcOf(v) {
    try { return v.currentSrc || v.src || ''; } catch (e) { return ''; }
  }
  // 收集 video 祖先 iframe 的"可定位签名"：平台常把同一任务点视频放在固定签名(通常含任务 id)的 iframe 内重建。
  // #2 修复：旧实现只取 iframe.src，但①src 常为通用播放器地址(不含任务 id，被漏收)；
  //         ②视频走 MSE 后 currentSrc 是 blob: URL，根本不含 objectid → ENDED_SRCS 拿不到指纹。
  //         故扩展收集 iframe 的 id/name/title/data-* 以及 video 自身 id——这些在"整元素重建/ blob: 源"场景下
  //         仍稳定携带任务 id，可被 keyRe 边界匹配命中，重建去重得以成立（即时 src 是 blob: 也照样锁死）。
  // 收敛不变（吸收评审 B）：仅返回"签名含白名单任务 id"的播放器 iframe，排除通用 shell。
  function signatureOf(el) {
    var out = [];
    try {
      if (el.id) out.push(el.id);
      if (el.name) out.push(el.name);
      if (el.title) out.push(el.title);
      if (el.getAttribute) {
        var d = el.getAttribute('data'); if (d) out.push(d);
        // 常见 data-taskid / data-objectid / data-id 等
        var attrs = el.attributes;
        if (attrs) { for (var a = 0; a < attrs.length; a++) { var an = attrs[a].name; if (an.indexOf('data-') === 0) out.push(attrs[a].value); } }
      }
    } catch (e) {}
    return out;
  }
  function videoIframeSrcsOf(v) {
    var out = [];
    if (!TARGET.enabled || !TARGET.ids) return out;
    var idKeys = TARGET.keys || Object.keys(TARGET.ids);   // 评审#2：优先用缓存 key 数组
    if (!idKeys.length) return out;
    try {
      if (v.id) {                              // video 自身 id 也纳入指纹（部分播放器直接挂任务 id）
        for (var vi = 0; vi < idKeys.length; vi++) { if (keyRe(idKeys[vi]).test(v.id)) { out.push(v.id); break; } }
      }
      var el = v;
      while (el && el.parentElement) {
        el = el.parentElement;
        if (el && el.tagName === 'IFRAME') {
          try {
            var sigs = signatureOf(el);
            for (var si = 0; si < sigs.length; si++) {
              var sig = sigs[si];
              if (sig) { for (var i = 0; i < idKeys.length; i++) { if (keyRe(idKeys[i]).test(sig)) { out.push(sig); break; } } }
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
    return out;
  }
  function isRebuildFinished(v) {
    var s = videoSrcOf(v);
    if (s && ENDED_SRCS[s]) return true;
    var iss = videoIframeSrcsOf(v);
    for (var i = 0; i < iss.length; i++) { if (iss[i] && ENDED_SRCS[iss[i]]) return true; }
    return false;
  }

  // 覆盖后的 pause：平台任何暂停指令都被忽略（no-op）
  var pauseNoop = function () { return; };

  // 安全 play：兼容浏览器自动播放策略拒绝。按原始 muted 状态尝试；被拒则静音重试一次，成功后恢复用户预期音量。
  function safePlay(v) {
    try {
      var wasMuted = v.muted;                        // 记录原始静音状态，避免脚本误静音破坏用户音量预期
      var restored = false;
      function restore() {                           // 等视频真正开始出声(playing)后再恢复音量，避免提前取消静音（吸收评审#H）
        if (restored) return; restored = true;
        try { if (!wasMuted) v.muted = false; } catch (e) {}
      }
      // 用 {once:true} 注册：浏览器在首次 playing 后自动移除监听器，杜绝监听器永久累积泄漏（吸收评审#H）
      // 【易误判·诊断#五】无需加去重标志：{once:true} 保证 playing 触发即自移除；仅"自动播放彻底被禁且永不 playing"的病理场景才暂存，可接受。
      try { v.addEventListener('playing', restore, { once: true }); } catch (e) {}
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(restore).catch(function () {          // 自动播放策略拒绝 → 静音重试
          try {
            v.muted = true;
            var p2 = v.play();
            if (p2 && typeof p2.then === 'function') p2.then(restore).catch(function () {});
          } catch (e) {}
        });
      }
    } catch (e) {}                                    // 静默：浏览器限制，非脚本问题
  }

  // F-B1 修复：定向模式下被"跳过"的视频，若此前已在全量续播阶段被本脚本接管
  // （window.attachments / 桥 objectids 晚于首扫到达），必须撤销接管交还平台；否则广告/插播视频会
  // 残留 v.pause=pauseNoop、__cxForcePaused=true，被永久强制续播且用户无法暂停，与"定向跳过"目标直接相悖。
  // 仅撤销"续播接管"，保留 __cxEndedLock / 重建去重（已结束任务不应被释放重播）。
  function releaseVideo(v) {
    if (!v || (!v.__cxForcePaused && !v.__cxReleased)) return;   // 未接管或已释放则跳过（幂等）
    try { v.pause = v.__np || NATIVE_PAUSE; } catch (e) {}       // 恢复实例级原生 pause（绕过原型 no-op），用户/平台可正常暂停
    v.__cxForcePaused = false;                                   // 关闭原型 pause 的 no-op 拦截
    v.__cxReleased = true;                                       // 标记已释放：续播兜底监听(pause/canplay/waiting/stalled)不再自动续播
    // 保留 v.__cx=true：避免重复挂载监听；若后续重新归属任务点，由 overrideVideo 再断言路径重新接管（见下）
  }

  // 覆盖单个视频：pause 变 no-op + ended→重播阻断 + ratechange 仅 rate<=0.01 拉回 1x + 状态兜底续播。
  // 关键：所有续播路径都检查 v.__cxAN_hold —— 当 auto-next 因插播题锁定时，无条件避让。
  // 【易误判·诊断#四】本函数刻意不分拆：强顺序状态机，共享 safePlay / v.__np / __cxEndedLock 等闭包状态，
  //   拆子函数需提升大量状态→回归风险高（v3.10 #10/#11 已判不拆）。可读性换正确性不划算，勿以"函数过长"为由拆分。
  // 进度到底判定：距结尾 END_RELEASE_SEC 内（且未真正 ended）即视为"进度到底"。
  // ended 状态不在此处理——交给下方 ended 锁分支防重播，避免在到底处提前释放破坏防重播。
  function nearEnd(v) {
    try {
      if (v.ended) return false;
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - CONFIG.END_RELEASE_SEC) return true;
    } catch (e) {}
    return false;
  }
  function overrideVideo(v) {
    if (!v) return;
    // 桥避让：爬虫清单标记当前章已完成 → 不覆盖 pause、不强制续播（重进已完成章不重看）
    if (BRIDGE.skipResume) return;
    // 用户暂停锁：手动暂停键/自动停止计时器置位后，不再施加 noop 覆盖、交还原生 pause，所有续播兜底避让。
    // 与 __cxReleased 分离：避免被下方"重新归属任务点→重新接管"逻辑（L461）误清除（专项：用户暂停开关）
    if (v.__cxUserPaused) {
      try { if (v.__np) v.pause = v.__np; } catch (e) {}
      // 看门狗：闸门若被平台重置（重定义 play / 换元素属性），每轮扫描发现"用户暂停却在播"立即压回
      try { if (!v.paused) (v.__np || NATIVE_PAUSE).call(v); } catch (e2) {}
      return;
    }
    // 定向续播：仅对 window.attachments 中的任务点视频强制续播，跳过广告/插播视频
    if (TARGET.enabled && !videoBelongsToTask(v)) {
      dbg('跳过非任务点视频（广告/插播）');
      releaseVideo(v);   // F-B1：撤销全量阶段已施加的接管，交还平台（否则广告/插播被永久强制续播）
      return;
    }
    if (TARGET.enabled) TARGET.matchedAny = true;
    // 【进度到底关闭续播】距结尾 END_RELEASE_SEC 内（未真正 ended）不再强制续播：
    // 交还平台原生 pause，让用户能自然暂停/结束；视频自然播完后由下方 ended 锁分支防重播。
    // 用户场景：视频不必一次性看完，接近看完时脚本停手，避免 pauseNoop 吞掉原生暂停导致无法停（专项：进度到底关闭续播）。
    // 每轮 nearEnd 仍为真时持续 release + 返回，绕过下方"重新归属→重新接管"把已释放视频又接管回去。
    if (nearEnd(v)) {
      try { if (!v.__cxEndedLock) releaseVideo(v); } catch (e) {}   // 释放接管（保留 ended 锁/重建锁）
      dbg('进度到底（剩 ' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's）：已关闭续播');
      return;
    }
    if (v.__cxReleased) { v.__cxForcePaused = true; v.__cxReleased = false; }   // F-B1：曾被释放、现重新归属任务点 → 重新接管
    // 已结束锁：持续阻断重播，直到元素被替换（auto-next 跳课接管）。
    // 关键修复：不再因"非 ended 瞬态"（平台重播会改 src 使 ended=false）恢复原生 play，
    // 否则平台重播得逞，且会吃掉 auto-next 的 ended 跳课（ended 事件仅派发一次）。
    if (v.__cxEndedLock) {
      try { v.pause = pauseNoop; } catch (e2) {}
      v.__cxForcePaused = true;   // 原型级 no-op 也生效（即便实例 own 属性被重置）
      v.play = function () { return Promise.resolve(); };
      try { if (v.duration && isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e2) {}
      dbg('ended 锁持续维持，阻断重播');
      return;
    }
    // 重播加固：新插入的 video 若地址命中"已结束集合"= 平台重建同一已播完任务点 → 锁死不播（不误伤新一课）
    if (!v.ended && !v.__cxEndedLock && isRebuildFinished(v)) {
      try { v.pause = pauseNoop; v.play = function () { return Promise.resolve(); }; v.loop = false; v.__cxsRebuild = true; } catch (e) {}
      v.__cxForcePaused = true;
      dbg('跳过已结束任务的重建 video（防整元素重播）');
      return;
    }
    try {
      // MediaSession 劫持提到最前面：所有状态都执行（含 ended），应对锁屏界面续播。
      // 每次执行都设置，应对平台可能重置 mediaSession（含视频 ended 后）。
      try {
        if (navigator.mediaSession) {
          navigator.mediaSession.setActionHandler('pause', function () {});
          navigator.mediaSession.playbackState = 'playing';   // 视频实则在播，状态标 playing 与"劫持 pause 为 no-op"语义一致，锁屏不误发暂停
        }
      } catch (msE) {}

      if (!v.__cx) {
        v.__np = NATIVE_PAUSE;   // 备份原生 pause(绕过原型级 no-op)，供 auto-next 的 holdPause 真正暂停视频
        v.__cxForcePaused = true; // 标记为本脚本强制续播对象：原型 pause 对其变 no-op，连闭包/webpack 私有暂停也拦得住(#3)
        v.loop = false;          // 禁掉自动重播，视频播完停在结尾而非无限循环（pause 覆盖由下方每扫再断言）

        // pause 事件兜底：除非 auto-next 已锁定(__cxAN_hold)或桥避让(skipResume 迟到场景)，任何暂停都立刻拉回
        v.addEventListener('pause', function () {
          try { if (!v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxReleased && !v.__cxUserPaused) safePlay(v); } catch (e) {}
        }, true);
        // 防伪暂停：平台把 playbackRate 设为 0 来停视频，仅在 rate<=0.01 时拉回 1x（保留用户手动倍速）。
        // 关键：必须尊重 auto-next 的 __cxAN_hold —— 锁定时 auto-next 可能用速率=0 实现暂停，本脚本不得回拉（专项诊断#二）。
        v.addEventListener('ratechange', function () {
          try { if (!v.__cxAN_hold && !v.__cxUserPaused && v.playbackRate <= 0.01) v.playbackRate = 1; } catch (e) {}
        }, true);
        // 缓冲恢复后自动拉回播放，与轮询互补（尊重 hold 锁）
        v.addEventListener('canplay', function () {
          try { if (!v.ended && !v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxEndedLock && !isRebuildFinished(v) && !v.__cxReleased && !v.__cxUserPaused && v.paused && v.readyState >= 2) safePlay(v); } catch (e) {}
        }, true);
        // #3 对抗 MSE 断流：blob: 视频经 MediaSource 喂数据，平台可停止 appendBuffer 让缓冲区耗尽"自然停"，
        // 此时可能未触发 pause 事件。waiting/stalled 即缓冲枯竭信号，重新 play() 可触发新一轮数据请求续播
        // （不 Hook SourceBuffer（appendBuffer 风险花屏）；不跳秒以免 MSE seek 出错）。尊重 hold/桥避让/已结束/重建。
        v.addEventListener('waiting', function () {
          try { if (!v.ended && !v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxEndedLock && !isRebuildFinished(v) && !v.__cxReleased && !v.__cxUserPaused) safePlay(v); } catch (e) {}
        }, true);
        v.addEventListener('stalled', function () {
          try { if (!v.ended && !v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxEndedLock && !isRebuildFinished(v) && !v.__cxReleased && !v.__cxUserPaused) safePlay(v); } catch (e) {}
        }, true);
        v.__cx = true;
      }
      v.pause = pauseNoop;       // 每次重扫都再断言，应对平台重定义 pause
      v.loop = false;            // 每次重扫再断言，防平台中途置 loop=true 触发循环重播

      // —— ended 状态处理（关键修复循环播放）——
      // 平台 JS 在 ended 后主动调 video.play() 或重建 video 元素重播（非 HTML loop 属性）。
      if (v.ended) {
        try { if (v.__np) v.__np(); } catch (e) {}                        // 真正停住（原生 pause）
        v.play = function () { return Promise.resolve(); };              // 覆盖 play 为 no-op，阻断平台主动重播
        try { v.__cxEndedLock = true; } catch (e) {}                     // 持久锁：后续重扫持续维持，不再恢复原生 play
        try { var _es = videoSrcOf(v); if (_es) ENDED_SRCS[_es] = true; } catch (e) {}  // 登记播放地址，供重建去重
        try { var _iss = videoIframeSrcsOf(v); for (var _i = 0; _i < _iss.length; _i++) { if (_iss[_i]) ENDED_SRCS[_iss[_i]] = true; } } catch (e) {}  // 同步登记祖先 iframe src，关掉 src 未就绪的时间窗（吸收评审#3）
        try { if (isFinite(v.duration)) v.currentTime = v.duration; } catch (e) {}  // 直播 duration=Infinity 时跳过非法赋值（吸收评审#5）
        if (!v.__seekArmed) {                                             // seeking 守卫：平台若把 currentTime 改小，拉回末尾
          v.__seekArmed = true;
          v.addEventListener('seeking', function () {
            try { if (isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e) {}   // 直播流(Infinity)不重置（吸收评审#5）
          }, true);
        }
        dbg('ended：已锁定 currentTime 并覆盖 play 为 no-op，阻断重播');
        return;
      }

      // 正常续播（尊重 auto-next 暂停锁；已 ended 锁元素/重建元素由前序分支跳过，不会走到这里）
      // ENDED_SRCS 为"已播完地址黑名单"，只增不清（仅在真实章节切换时由 refreshTargets 清空），
      // 故此处不重置——原"任意新 video 即清空"写法会令重建重播保护失效，已删除（吸收评审）。
      if (v.paused && !v.__cxAN_hold && !v.__cxReleased && !v.__cxUserPaused && v.readyState >= 2) { safePlay(v); }
      if (v.playbackRate <= 0.01 && !v.__cxReleased && !v.__cxAN_hold && !v.__cxUserPaused) { v.playbackRate = 1; }                 // 仅防伪暂停，不动用户倍速；尊重 auto-next 暂停锁（专项诊断#二）
    } catch (e) {}
  }

  // 中和平台暴露的全局暂停封装（如 window.ananas.pause）。
  // 'use strict' 下若属性不可写/不可配置，直接赋值会抛 TypeError 被静默吞掉导致中和失效。
  // 故优先用 defineProperty 在实例上创建 own 属性遮蔽——无论 pause 是自有还是原型继承都能遮蔽（吸收评审#2/#D）；
  // 仅当 defineProperty 失败（自有属性 non-configurable）再回退普通赋值，仍失败则 dbg 暴露。
  function neutralizeGlobalPause(win) {
    try {
      var a = win && win.ananas;
      if (a && typeof a.pause === 'function') {
        var done = false;
        try {
          Object.defineProperty(a, 'pause', { value: function () {}, configurable: true, writable: true });
          done = true;
        } catch (de) {
          try { a.pause = function () {}; done = true; } catch (ae) {}
        }
        if (!done) dbg('window.ananas.pause 无法中和(描述符受限)');
      }
    } catch (e) { dbg('neutralizeGlobalPause 异常', e); }
  }

  // —— 用户暂停开关（手动暂停键 + 自动停止计时器）——
  // v.__cxUserPaused：用户主动暂停锁。置位后 overrideVideo 不再施加 noop 覆盖、各兜底监听与正常续播均避让，
  // 视频可正常暂停/播放；与原先 __cxReleased（定向跳过/桥避让的"交还平台"语义）分离，避免被重新接管逻辑误清除。
  function allVideos() {
    var out = [];
    try { var vs = document.getElementsByTagName('video'); for (var i = 0; i < vs.length; i++) out.push(vs[i]); } catch (e) {}
    try {
      var fs = document.getElementsByTagName('iframe');
      for (var j = 0; j < fs.length; j++) { try { if (fs[j].contentDocument) { var iv = fs[j].contentDocument.getElementsByTagName('video'); for (var k = 0; k < iv.length; k++) out.push(iv[k]); } } catch (e2) {} }
    } catch (e) {}
    return out;
  }
  function activeVideo() {                       // 返回当前正在播放的视频（用于热键切换）
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try { if (!vs[i].paused && !vs[i].ended) return vs[i]; } catch (e) {} }
    return null;
  }
  function userPause(v) {                         // 用户暂停：真正停住并置锁；按 RESUME_AFTER_MIN 排自动恢复
    if (!v) return;
    v.__cxUserPaused = true;
    try { (v.__np ? v.__np : NATIVE_PAUSE || v.pause).call(v); } catch (e) {}   // 原生 pause 真正停住（绕过原型/实例 noop）
    // 播放闸门：脚本此前只拦"暂停"从不拦"播放"，平台播放器自调 video.play() 会把用户暂停的视频拉回播放
    //（实测诊断：状态 playing 而 UserPaused=true 的矛盾态）。在实例上遮蔽 play：用户暂停期间一律拒绝。
    try {
      Object.defineProperty(v, 'play', { configurable: true, writable: true, value: function () {
        if (this.__cxUserPaused) { dbg('播放闸门：用户暂停中，拒绝 play()'); return Promise.resolve(); }
        return NATIVE_PLAY ? NATIVE_PLAY.apply(this, arguments) : Promise.resolve();
      } });
    } catch (eG) {}
    if (CONFIG.RESUME_AFTER_MIN > 0) v.__cxResumeAt = Date.now() + CONFIG.RESUME_AFTER_MIN * 60000;
    try { toast('已暂停续播（手动/计时）'); } catch (e2) {}
  }
  function userResume(v) {                        // 用户恢复：清锁并续播
    if (!v) return;
    v.__cxUserPaused = false;
    v.__cxResumeAt = 0;
    v.__cxWatchMs = 0;                            // 重置自动停止计时，避免恢复后立刻再停
    try { delete v.play; } catch (e3) {}          // 拆除播放闸门，还原原型 play
    try { safePlay(v); } catch (e) {}
    try { toast('已恢复续播'); } catch (e2) {}
  }
  var _lastWatchTick = Date.now();                // 上次计时采样点（真实墙钟差值，后台节流/休眠也不会多算或少算）
  function autoStopTick() {                       // 观看计时（始终累计，供面板"已看"显示）+ 满 AUTO_STOP_MIN 分钟自动暂停
    var now = Date.now();
    var dt = now - _lastWatchTick; _lastWatchTick = now;
    if (dt < 0 || dt > 60000) dt = CONFIG.RESCAN_INTERVAL;   // 防休眠唤醒/时钟回拨造成的大跳
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try {
      var v = vs[i];
      if (v.__cxUserPaused || v.ended) continue;
      if (!v.paused && v.readyState >= 2) {
        v.__cxWatchMs = (v.__cxWatchMs || 0) + dt;
        if (CONFIG.AUTO_STOP_MIN > 0 && v.__cxWatchMs >= CONFIG.AUTO_STOP_MIN * 60000) userPause(v);
      }
    } catch (e) {} }
  }
  function resumeTick() {                         // 暂停后自动恢复：到 __cxResumeAt 时间则自动续播
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try {
      var v = vs[i];
      if (v.__cxUserPaused && v.__cxResumeAt && Date.now() >= v.__cxResumeAt) userResume(v);
    } catch (e) {} }
  }
  function toast(msg) {                           // 轻量提示（仅顶部文档，不污染输入框）
    try {
      var t = document.getElementById('__cxToast');
      if (!t) { t = document.createElement('div'); t.id = '__cxToast'; t.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:rgba(0,0,0,.82);color:#fff;padding:6px 10px;border-radius:6px;font:13px/1.4 sans-serif;pointer-events:none;'; if (document.body) document.body.appendChild(t); }
      if (!t) return;
      t.textContent = '[CX] ' + msg;
      t.style.display = 'block';
      clearTimeout(t.__cxTimer); t.__cxTimer = setTimeout(function () { if (t) t.style.display = 'none'; }, 1500);
    } catch (e) {}
  }
  function currentVideo() {                       // 当前目标视频：优先正在播放者；否则优先已用户暂停者；否则首个 video（供面板操作）
    var act = activeVideo(); if (act) return act;
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try { if (vs[i].__cxUserPaused) return vs[i]; } catch (e) {} }
    return vs[0] || null;
  }
  // —— 悬浮控制面板（开关键 = PAUSE_HOTKEY，默认 p）——
  // 集中控制：暂停/恢复、自动停止计时(AUTO_STOP_MIN)、暂停后自动恢复(RESUME_AFTER_MIN)，并实时显示状态。
  // 仅懒创建一次，随状态刷新；不污染页面输入框，Esc/× 关闭。
  var SCRIPT_VERSION = '3.33';   // 与文件头 @version 保持一致（面板与诊断信息显示用）
  var _cxPanel = null;
  // 精简模式（用户自选，localStorage 持久化）：勾选后隐藏诊断块 / 轮询滑块 / DEBUG / 复制按钮等高级项，
  // 只留状态 + 暂停按钮 + 计时滑块，面板更清爽；取消勾选即恢复完整信息（反馈问题时用完整模式）。
  var PANEL_COMPACT = false;
  try { PANEL_COMPACT = localStorage.getItem('cx_panel_compact') === '1'; } catch (e) {}
  function ensurePanel() {
    if (_cxPanel) return _cxPanel;
    var el = document.createElement('div');
    el.id = '__cxPanel';
    el.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;width:288px;background:rgba(20,22,28,.96);color:#e8e8e8;font:13px/1.5 sans-serif;border:1px solid #3a3f4b;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.45);padding:12px;user-select:none;';
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<b style="font-size:14px;">学习通·强制续播 <span id="__cxVer" style="color:#6b7280;font-weight:normal;font-size:11px;"></span></b>' +
        '<span id="__cxPanelClose" style="cursor:pointer;padding:0 6px;font-size:18px;line-height:1;">×</span>' +
      '</div>' +
      '<div id="__cxPanelState" style="font-size:12px;color:#9aa0a8;margin-bottom:8px;word-break:break-all;white-space:pre-line;"></div>' +
      '<div id="__cxPanelInfo" style="font-size:11px;color:#8b93a1;margin-bottom:10px;white-space:pre-line;background:rgba(0,0,0,.25);padding:6px;border-radius:4px;"></div>' +
      '<button id="__cxBtnPause" style="width:100%;padding:9px;margin-bottom:8px;background:#2d6cdf;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;">暂停 / 恢复</button>' +
      '<label style="display:block;margin-bottom:6px;font-size:12px;">自动停止计时 (分钟): <b id="__cxAutoVal">0</b>' +
        '<input id="__cxAuto" type="range" min="0" max="120" step="1" value="0" style="width:100%;"></label>' +
      '<label style="display:block;margin-bottom:6px;font-size:12px;">暂停后自动恢复 (分钟): <b id="__cxResumeVal">0</b>' +
        '<input id="__cxResume" type="range" min="0" max="60" step="1" value="0" style="width:100%;"></label>' +
      '<label id="__cxRescanRow" style="display:block;margin-bottom:6px;font-size:12px;">轮询间隔 (ms): <b id="__cxRescanVal">2000</b>' +
        '<input id="__cxRescan" type="range" min="500" max="5000" step="500" value="2000" style="width:100%;"></label>' +
      '<label id="__cxEndRelRow" style="display:block;margin-bottom:6px;font-size:12px;">进度到底释放 (秒): <b id="__cxEndRelVal">15</b>' +
        '<input id="__cxEndRel" type="range" min="0" max="120" step="5" value="15" style="width:100%;"></label>' +
      '<label id="__cxDebugRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxDebug" type="checkbox" style="vertical-align:middle;margin-right:6px;">调试日志 (DEBUG → 控制台)</label>' +
      '<label style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxCompact" type="checkbox" style="vertical-align:middle;margin-right:6px;">精简模式（隐藏诊断与高级项）</label>' +
      '<button id="__cxBtnCopy" style="width:100%;padding:7px;margin-top:4px;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:6px;cursor:pointer;font-size:12px;">复制诊断信息（反馈用）</button>' +
      '<div style="font-size:11px;color:#6b7280;margin-top:6px;">按 <b>P</b> 开关本面板 · <b>Esc</b> 关闭 · 0 = 禁用</div>';
    if (document.body) document.body.appendChild(el);
    el.querySelector('#__cxPanelClose').addEventListener('click', hidePanel);
    el.querySelector('#__cxBtnPause').addEventListener('click', function () {
      var v = currentVideo(); if (!v) { toast('无目标视频'); return; }
      if (v.__cxUserPaused) userResume(v); else userPause(v);
      refreshPanelState();
    });
    var auto = el.querySelector('#__cxAuto');
    auto.addEventListener('input', function () { CONFIG.AUTO_STOP_MIN = +auto.value; refreshPanelState(); });
    var res = el.querySelector('#__cxResume');
    res.addEventListener('input', function () { CONFIG.RESUME_AFTER_MIN = +res.value; refreshPanelState(); });
    var resc = el.querySelector('#__cxRescan');
    resc.addEventListener('input', function () {
      CONFIG.RESCAN_INTERVAL = +resc.value;
      try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) {}   // 实时重启轮询，使间隔立即生效
      try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) {}
      refreshPanelState();
    });
    var endrel = el.querySelector('#__cxEndRel');
    endrel.addEventListener('input', function () { CONFIG.END_RELEASE_SEC = +endrel.value; refreshPanelState(); });
    var dbg = el.querySelector('#__cxDebug');
    dbg.addEventListener('change', function () { try { DEBUG = !!dbg.checked; toast(DEBUG ? '调试日志已开' : '调试日志已关'); } catch (e) {} });
    var cpt = el.querySelector('#__cxCompact');
    cpt.addEventListener('change', function () {
      PANEL_COMPACT = !!cpt.checked;
      try { localStorage.setItem('cx_panel_compact', PANEL_COMPACT ? '1' : '0'); } catch (e) {}   // 记住用户选择，下次进页面沿用
      applyCompact();
      refreshPanelState();
      toast(PANEL_COMPACT ? '精简模式已开' : '已恢复完整面板');
    });
    el.querySelector('#__cxBtnCopy').addEventListener('click', copyDiagnostics);
    _cxPanel = el;
    syncPanelInputs();
    applyCompact();    // 按用户上次选择应用精简/完整布局
    positionPanel();   // 适配 progress-panel：若其已挂载，则下沉避让避免同角重叠
    return el;
  }
  function applyCompact() {                        // 精简模式：隐藏诊断块 / 轮询滑块 / DEBUG / 复制按钮，只留核心控制
    if (!_cxPanel) return;
    try {
      var d = PANEL_COMPACT ? 'none' : 'block';
      ['#__cxPanelInfo', '#__cxRescanRow', '#__cxEndRelRow', '#__cxDebugRow', '#__cxBtnCopy'].forEach(function (sel) {
        var n = _cxPanel.querySelector(sel); if (n) n.style.display = d;
      });
    } catch (e) {}
  }
  function syncPanelInputs() {                     // 把 CONFIG / 版本 / DEBUG 当前值回填到面板控件
    if (!_cxPanel) return;
    try {
      var auto = _cxPanel.querySelector('#__cxAuto'); if (auto) { auto.value = CONFIG.AUTO_STOP_MIN; _cxPanel.querySelector('#__cxAutoVal').textContent = CONFIG.AUTO_STOP_MIN; }
      var res = _cxPanel.querySelector('#__cxResume'); if (res) { res.value = CONFIG.RESUME_AFTER_MIN; _cxPanel.querySelector('#__cxResumeVal').textContent = CONFIG.RESUME_AFTER_MIN; }
      var resc = _cxPanel.querySelector('#__cxRescan'); if (resc) { resc.value = CONFIG.RESCAN_INTERVAL; _cxPanel.querySelector('#__cxRescanVal').textContent = CONFIG.RESCAN_INTERVAL; }
      var endrel = _cxPanel.querySelector('#__cxEndRel'); if (endrel) { endrel.value = CONFIG.END_RELEASE_SEC; _cxPanel.querySelector('#__cxEndRelVal').textContent = CONFIG.END_RELEASE_SEC; }
      var dbg = _cxPanel.querySelector('#__cxDebug'); if (dbg) dbg.checked = !!DEBUG;
      var cpt = _cxPanel.querySelector('#__cxCompact'); if (cpt) cpt.checked = !!PANEL_COMPACT;
      var ver = _cxPanel.querySelector('#__cxVer'); if (ver) ver.textContent = 'v' + SCRIPT_VERSION;
    } catch (e) {}
  }
  function refreshPanelLabels() {                   // 拖动滑块时实时刷新旁边的数值文字（syncPanelInputs 仅在面板创建时回填一次，否则显示滞后）
    if (!_cxPanel) return;
    try {
      var map = [['#__cxAutoVal', CONFIG.AUTO_STOP_MIN], ['#__cxResumeVal', CONFIG.RESUME_AFTER_MIN], ['#__cxRescanVal', CONFIG.RESCAN_INTERVAL], ['#__cxEndRelVal', CONFIG.END_RELEASE_SEC]];
      for (var i = 0; i < map.length; i++) { var n = _cxPanel.querySelector(map[i][0]); if (n) n.textContent = map[i][1]; }
    } catch (e) {}
  }
  function buildDiagnostics() {                    // 一键反馈：汇总共全部状态/开关/标志为文本
    var L = [];
    L.push('=== 学习通·强制续播 诊断信息 ===');
    L.push('版本: ' + SCRIPT_VERSION + ' · 时间: ' + new Date().toLocaleString());
    var vs = allVideos();
    L.push('视频总数: ' + vs.length + ' · moQueue: ' + _moQueue.length + ' · ENDED_SRCS: ' + Object.keys(ENDED_SRCS).length);
    var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    L.push('heap: ' + (m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB / ' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a'));
    L.push('桥: ' + (BRIDGE && BRIDGE.base ? ('已连 ' + BRIDGE.base) : '离线') + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter));
    L.push('定向: enabled=' + (TARGET && TARGET.enabled) + ' matchedAny=' + (TARGET && TARGET.matchedAny) + ' 0命中连击=' + _targetMissStreak + '/' + TARGET_FALLBACK_ROUNDS);
    L.push('CONFIG: AUTO_STOP_MIN=' + CONFIG.AUTO_STOP_MIN + ' RESUME_AFTER_MIN=' + CONFIG.RESUME_AFTER_MIN + ' RESCAN_INTERVAL=' + CONFIG.RESCAN_INTERVAL + ' END_RELEASE_SEC=' + CONFIG.END_RELEASE_SEC + ' PAUSE_HOTKEY=' + CONFIG.PAUSE_HOTKEY + ' DEBUG=' + DEBUG + ' 精简=' + PANEL_COMPACT);
    var v = activeVideo() || currentVideo();
    if (v) {
      L.push('--- 当前视频 ---');
      L.push('src: ' + (v.currentSrc || v.src || ''));
      L.push('状态: ' + (v.ended ? 'ended' : (v.paused ? 'paused' : 'playing')) + ' · rate=' + v.playbackRate + ' · loop=' + v.loop);
      L.push('标志: ForcePaused=' + !!v.__cxForcePaused + ' UserPaused=' + !!v.__cxUserPaused + ' AN_hold=' + !!v.__cxAN_hold + ' Released=' + !!v.__cxReleased + ' EndedLock=' + !!v.__cxEndedLock + ' 原生pause=' + !!v.__np + ' EndRel=' + nearEnd(v));
      L.push('进度: ' + fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? ' / ' + fmtTime(v.duration) : '') + ' · 已看=' + ((v.__cxWatchMs || 0) / 60000).toFixed(1) + 'min · isRebuildFinished=' + isRebuildFinished(v));
    } else { L.push('当前无视频'); }
    return L.join('\n');
  }
  function copyDiagnostics() {
    var txt = buildDiagnostics();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('已复制诊断信息'); }, function () { fallbackCopy(txt); });
      } else fallbackCopy(txt);
    } catch (e) { fallbackCopy(txt); }
  }
  function fallbackCopy(txt) {                     // 非安全上下文/剪贴板 API 不可用时的降级
    try {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px';
      if (document.body) { document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
      toast('已复制诊断信息');
    } catch (e2) { toast('复制失败，请手动复制'); }
  }
  function fmtTime(sec) {                          // 秒 → m:ss / h:mm:ss
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h > 0 && m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return (h > 0 ? h + ':' + mm : m) + ':' + ss;
  }
  function refreshPanelState() {
    if (!_cxPanel) return;
    refreshPanelLabels();   // 拖动滑块即时刷新数值文字（修复：拖动时显示不变）
    var st = _cxPanel.querySelector('#__cxPanelState');
    var v = activeVideo();
    if (!v) {
      // 没有正在播放的：尝试展示已用户暂停的目标
      v = currentVideo();
      if (st) { if (!v) st.textContent = '当前无视频'; else st.textContent = '视频已暂停(用户) · 按按钮恢复'; }
    } else if (st) {
      var src = (v.currentSrc || v.src || '').split('/').pop() || '(未知)';
      var status = v.__cxAN_hold ? '插播题锁定(auto-next)' : (v.__cxUserPaused ? '已暂停(用户)' : (v.paused ? '暂停' : '播放中'));
      var watchMin = ((v.__cxWatchMs || 0) / 60000).toFixed(1);
      var autoRemain = CONFIG.AUTO_STOP_MIN > 0 ? Math.max(0, CONFIG.AUTO_STOP_MIN - (v.__cxWatchMs || 0) / 60000).toFixed(1) : '关闭';
      var resumeRemain = (v.__cxUserPaused && v.__cxResumeAt) ? Math.max(0, (v.__cxResumeAt - Date.now()) / 60000).toFixed(1) : '—';
      var prog = fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? ' / ' + fmtTime(v.duration) : '');
      st.textContent = '视频: ' + src + '\n状态: ' + status + ' · 进度 ' + prog + '\n已看 ' + watchMin + 'min · 自动停剩 ' + autoRemain + 'min · 恢复剩 ' + resumeRemain + 'min';
    }
    var btn = _cxPanel.querySelector('#__cxBtnPause');
    if (btn) btn.textContent = (v && v.__cxUserPaused) ? '▶ 恢复续播' : '⏸ 暂停续播';
    // 全局诊断信息（含 heap / 桥 / 定向 / 轮询，供反馈；替代原单独 heap 行）
    // 精简模式下该块已隐藏，跳过刷新省一次 heap/DOM 读取
    try {
      var info = _cxPanel.querySelector('#__cxPanelInfo');
      if (info && !PANEL_COMPACT) {
        var vs = allVideos();
        var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
        var heap = m ? ((m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB') : 'n/a';
        var bridge = (BRIDGE && BRIDGE.base) ? ('已连 ' + BRIDGE.base) : '离线';
        info.textContent =
          'v' + SCRIPT_VERSION + ' · 视频 ' + vs.length + ' · moQueue ' + _moQueue.length + ' · ended ' + Object.keys(ENDED_SRCS).length + '\n' +
          'heap ' + heap + '\n' +
          '桥 ' + bridge + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter) + '\n' +
          '定向 enabled=' + (TARGET && TARGET.enabled) + ' 命中=' + (TARGET && TARGET.matchedAny) + ' 0命中 ' + _targetMissStreak + '/' + TARGET_FALLBACK_ROUNDS + '\n' +
          '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms · 热键 P';
      }
    } catch (e) {}
  }
  function positionPanel() {                      // 适配 progress-panel：两者默认都钉在 top-right 且同最高 z-index，会重叠。
    if (!_cxPanel) return;                          // 若 progress-panel(#cxProgressPanel) 已挂载，则把本面板下沉到其下方。
    try {
      var pp = document.getElementById('cxProgressPanel');
      if (pp && pp.style.display !== 'none') {
        var r = pp.getBoundingClientRect();
        if (r && r.bottom > 0) _cxPanel.style.top = (r.bottom + 8) + 'px';
      }
    } catch (e) {}
  }
  function showPanel() { try { ensurePanel(); if (_cxPanel) { _cxPanel.style.display = 'block'; syncPanelInputs(); positionPanel(); refreshPanelState(); } } catch (e) {} }
  function hidePanel() { if (_cxPanel) _cxPanel.style.display = 'none'; }
  function togglePanel() { if (_cxPanel && _cxPanel.style.display !== 'none') hidePanel(); else showPanel(); }

  // 递归扫描：video + Shadow DOM + 同源 iframe（含 iframe load 时序）
  function scanVideos(root) {
    if (!root || !root.querySelectorAll) return;
    try { var _vs = root.getElementsByTagName('video'); for (var _vi = 0; _vi < _vs.length; _vi++) overrideVideo(_vs[_vi]); } catch (e) {}   // 活动集合，免每次分配（吸收评审#8 微优化）
    // 审查 F1/F2：原 getElementsByTagName('*') 每 2s 全文档枚举找 Shadow 宿主，长章节页
    //（长评论/讨论区/目录）下成为周期性主线程热点。参考 no-pause J4 改法收窄：
    //   - 文档级：只在视频容器（#videoBox / .ans-attach-ct）子树内枚举 Shadow 宿主，
    //     无关节点不再逐个触碰；video/iframe 扫描路径不变，动态新增仍由 MutationObserver 兜底。
    //   - ShadowRoot 内部：子树小，保留全量枚举以发现嵌套 Shadow 宿主。
    try {
      if (root.host) {
        var _sh = root.querySelectorAll('*');
        for (var _hi = 0; _hi < _sh.length; _hi++) {
          if (_sh[_hi].shadowRoot) { try { scanVideos(_sh[_hi].shadowRoot); } catch (e) {} }
        }
      } else {
        var _cts = root.querySelectorAll('#videoBox, .ans-attach-ct');
        for (var _ci = 0; _ci < _cts.length; _ci++) {
          var _ct = _cts[_ci];
          if (_ct.shadowRoot) { try { scanVideos(_ct.shadowRoot); } catch (e) {} }
          var _all = _ct.getElementsByTagName('*');
          for (var _ai = 0; _ai < _all.length; _ai++) {
            if (_all[_ai].shadowRoot) { try { scanVideos(_all[_ai].shadowRoot); } catch (e) {} }
          }
        }
      }
    } catch (e) {}
    try {
      root.querySelectorAll('iframe').forEach(function (f) {
        try {
          if (f.contentWindow && f.contentDocument) {
            scanVideos(f.contentDocument);       // 钻入同源 iframe 内部
            neutralizeGlobalPause(f.contentWindow); // 中和 iframe 内的全局暂停封装
          }
          // 修时序：动态创建的播放器 iframe 可能尚未加载完，等 load 后再扫一次
          if (!f.__cxL) {
            f.__cxL = true;
            f.addEventListener('load', function () {
              try { if (f.contentWindow && f.contentDocument) { scanVideos(f.contentDocument); neutralizeGlobalPause(f.contentWindow); } } catch (e2) {}
            }, true);
          }
        } catch (e) {}                   // 跨域 iframe 静默跳过（外部无法挂载）
      });
    } catch (e) {}
  }

  // 首次安装：先拉桥清单（异步、失败静默），再刷新定向目标（读 window.attachments），再扫描
  try { hookAttachments(); } catch (e) {}   // #1：安装 setter 钩子，attachments 异步到达即重建白名单
  try { bridgeInit(); } catch (e) {}
  try { refreshTargets(); } catch (e) {}
  try { scanVideos(document); neutralizeGlobalPause(window); } catch (e) {}

  // 低频全量重扫：应对平台重定义 pause / 原型硬调用 / DOM 换血（间隔由 CONFIG.RESCAN_INTERVAL 控制，面板可实时调整）
  function _loopTick() {                            // 提取为命名函数：使面板改 RESCAN_INTERVAL 时能 clearInterval 后重启立即生效
    try { refreshTargets(); } catch (e) {}                 // 重置 matchedAny 并重建任务点 id 集
    try { scanVideos(document); neutralizeGlobalPause(window); } catch (e) {}
    // 【易误判·诊断#六】此处每轮重装是 F-B4 刻意设计（防 use strict 下描述符被平台还原绕过），切勿改为"仅首装幂等"，否则还原该缺陷。
    try { installPrototypePauseNeutralize(); } catch (e) {}   // F-B4：每轮重新 neutralize 原型 pause，防个别页 use strict 下描述符被平台还原绕过
    // 定向启用但本轮无任何 video 命中：不在本轮回退（避免章节切换间隙 / 视频延迟渲染的瞬时空窗触发
    // 定向↔全量横跳、误强播广告/插播）。连续 N 轮稳定 0 命中才判定"白名单失效"回退全量（专项诊断#三，迟滞）。
    try {
      if (TARGET.enabled && !TARGET.matchedAny) {
        if (++_targetMissStreak >= TARGET_FALLBACK_ROUNDS) { dbg('定向连续 ' + _targetMissStreak + ' 轮 0 命中，回退全续播'); TARGET.enabled = false; }
      } else { _targetMissStreak = 0; }
    } catch (e) {}
    // 内存埋点（切屏崩溃观测）：DEBUG 时每 30 轮（~1min）采样一次，持续观察 heap 与队列趋势
    if (DEBUG && (++_memPoll % 30) === 0) { try { _memSample('loop'); } catch (e) {} }
    // 观看计时始终运行（修复面板"已看"恒为 0：原先仅 AUTO_STOP_MIN>0 才累计）；自动暂停判定在 tick 内部按开关生效
    try { autoStopTick(); } catch (e) {}
    if (CONFIG.RESUME_AFTER_MIN > 0) { try { resumeTick(); } catch (e) {} }
    if (_cxPanel && _cxPanel.style.display !== 'none') { try { refreshPanelState(); } catch (e) {} }  // 面板可见时实时刷新状态
  }
  var _loopTimer = null;
  try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) {}

  // 控制面板开关键：非输入框聚焦时按 PAUSE_HOTKEY 开/关悬浮控制面板（用户暂停开关的可视化控制，含暂停/恢复 + 计时器滑块）
  try {
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { try { hidePanel(); } catch (e3) {} return; }   // Esc 关闭面板
      if (!CONFIG.PAUSE_HOTKEY) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;  // 输入框内不触发，避免误触
      if (e.key && e.key.toLowerCase() === String(CONFIG.PAUSE_HOTKEY).toLowerCase()) {
        try { togglePanel(); e.preventDefault(); } catch (e2) {}
      }
    });
  } catch (e) {}

  // 即时接管：任何 video 一开始 play 即立刻 override，无需等 2s 轮询（吸收 browser-media-collector 的 play 捕获思路）。
  // 缩短动态插入播放器的接管空窗，使手动暂停开关对"新插入、尚未轮询到"的视频也可靠生效；overrideVideo 自身幂等且
  // 在 __cxUserPaused 时交还原生 pause 提前返回，故对暂停态/已接管视频无副作用。
  try {
    document.addEventListener('play', function (e) {
      try {
        if (e && e.target && e.target.tagName === 'VIDEO') {
          var _pv = e.target;
          // 用户暂停期间任何 play 事件（平台绕过闸门直接触发播放）→ 立即压回暂停，保证暂停锁真正锁得住
          if (_pv.__cxUserPaused) { try { (_pv.__np || NATIVE_PAUSE).call(_pv); } catch (e3) {} return; }
          overrideVideo(_pv);
        }
      } catch (e2) {}
    }, true);   // 捕获阶段，最先拿到 play 事件
  } catch (e) {}

  // DOM 变动监听：覆盖动态插入的播放器 video。
  // 高频变动(弹幕/进度条批量更新)时，仅把新增 video 节点入队、合并到下一帧批量处理，避免主线程雪崩（吸收评审#2）。
  // 【易误判·诊断#九】对新增节点全子树 querySelectorAll('video') 看似浪费，但已合并到下一帧批量处理、且 video 仅现于视频容器内，
  //   实际开销极小；收窄选择器为低优可选优化，非缺陷，勿以"性能"为由过度重构。
  var _moQueue = [];
  var _moScheduled = false;
  function _moFlush() {
    _moScheduled = false;
    var q = _moQueue; _moQueue = [];
    for (var i = 0; i < q.length; i++) { try { overrideVideo(q[i]); } catch (e) {} }
  }
  // 内存埋点（切屏崩溃观测）：Chrome 专用 performance.memory。仅 DEBUG 时采样，关注 heap 与 _moQueue 长度（泄漏前兆）。
  // 注意：非 Chrome 无 performance.memory，s 显示 n/a；切屏前后各采一次可直接对比后台增长。
  var _memPoll = 0;
  function _memSample(tag) {
    try {
      var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
      var s = m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a';
      dbg('[mem] ' + tag + ' heap=' + s + ' moQueue=' + _moQueue.length + ' ended=' + Object.keys(ENDED_SRCS).length);
    } catch (e) {}
  }
  try {
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          try { if (n.tagName === 'VIDEO') _moQueue.push(n); } catch (e) {}
          try {
            var vs = n.querySelectorAll ? n.querySelectorAll('video') : [];
            for (var k = 0; k < vs.length; k++) _moQueue.push(vs[k]);
          } catch (e) {}
        }
      }
      if (_moQueue.length > 1024) { try { _moFlush(); } catch (e) {} }   // 安全阀：极端高频/后台节流窗口兜底排空，防队列无限膨胀（专项#切屏崩溃）
      if (!_moScheduled && _moQueue.length) {
        _moScheduled = true;
        // 专项#切屏崩溃修复：后台标签页 rAF 被浏览器完全暂停、永不触发 flush，而页面在隐藏期仍高频 mutate
        // （心跳/进度刷新）→ _moQueue 无限增长并持引用阻止 GC，30min+ 后渲染进程 OOM 致整页崩溃。
        // 故隐藏时改用 setTimeout：后台仍会（节流）触发并排空队列；可见时保留 rAF 帧合并以省主线程。
        if (document.hidden) setTimeout(_moFlush, 200);
        else if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_moFlush);
        else setTimeout(_moFlush, 16);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  // 切回标签页时强制续播
  try {
    document.addEventListener('visibilitychange', function () {
      if (DEBUG) { try { _memSample('vis:' + document.visibilityState); } catch (e) {} }   // 切屏前后各采一次，直接对比后台增长
      if (document.visibilityState === 'visible') {
        try { scanVideos(document); } catch (e) {}
        try { neutralizeGlobalPause(window); } catch (e) {}   // 切回时一并中和 window.ananas.pause，防平台在隐藏期重置（吸收评审#5）
      }
    }, true);                            // 捕获阶段，但绝不 stopPropagation
  } catch (e) {}
})();