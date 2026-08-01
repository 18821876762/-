// ==UserScript==
// @name         学习通·强制续播 (iframe穿透 + 防暂停 + 防伪暂停 + 防重播)
// @namespace    http://cx.local/
// @version      4.7
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

  // 幂等守卫（审查#5：全局定时器/监听器从不清理 → 防止脚本被重复注入产生双倍 setInterval/监听器）：
  // 每个 frame(window) 仅初始化一次；多 frame 各自独立运行，不影响视频页面板可见性（v3.35 已撤销整体 return 守卫）。
  if (window.__cxForcePlayStarted) return;
  window.__cxForcePlayStarted = true;

  // 注意：不在此处整体 return 掉同源 iframe 副本——超星播放器常嵌在同源 iframe 内，若直接退出则视频页里本脚本整段不执行、
  // 控制面板无法创建（用户反馈"有视频的页面打不开面板，无视频页可开"）。视频接管本身已被 __cxForcePaused 等标志幂等保护、
  // 顶层实例也会下钻同源 iframe 处理其视频，重复注入不会崩溃；桥/定时器重复开销极小且幂等，故每个匹配 frame 都完整运行以保证面板可见。

  // ===== MODULE: 配置与持久化 =====
  // ===== 配置 =====
  var CONFIG = {
    RESCAN_INTERVAL: 2000,  // 低频全量重扫间隔(ms)：对抗平台重定义 pause / 原型硬调用 / DOM 换血。2s 足够，高频空转徒增资源消耗
    PAUSE_HOTKEY: 'p',      // 控制面板开关键：非输入框聚焦时按此键开/关悬浮控制面板（面板内含暂停/恢复、计时器滑块）；空串=禁用
    AUTO_STOP_MIN: 0,       // 自动停止计时器：累计观看满 N 分钟自动暂停且不再续播；0=禁用
    RESUME_AFTER_MIN: 0,    // 暂停后自动恢复：N 分钟后自动续播；0=保持暂停直到手动恢复（"暂停后是否开启"开关）
    END_RELEASE_SEC: 15,    // 进度到底释放：距结尾 ≤ 此秒数（且未真正 ended）时关闭强制续播，交还平台/用户自然结束或暂停；0=禁用
    USER_RATE: 1,           // 自定义播放速率（仅对强制接管的任务点视频生效；0.25~4，默认 1）— 伪暂停回拉目标也用此值，使自定义倍速在伪暂停事件中存活
    LOOP_PLAY: false       // 可控循环播放：开启后视频播完从头重播（取代默认"播完锁死防重播"行为）；默认关闭，保持原有自动跳课/防重播协同
  };

  // DEBUG 开关：运行时按 DEBUG 判定是否输出日志（修复复审：原 dbg 在 DEBUG=false 时被固化成 no-op 闭包，
  // 面板勾选只改 DEBUG 不改 dbg → 日志永不出现。改为每次调用检查 DEBUG，开销仅一个布尔判断，热路径可忽略）。
  var DEBUG = false;
  function dbg() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[CX-FORCE]'].concat([].slice.call(arguments))); } catch (e) { swallow(e); }
  }
  // 审查 JS1-2：把空 catch 的静默吞掉改为 DEBUG 下告警，便于发现隐藏错误；生产默认静默，不污染控制台
  function swallow(e, tag) {
    if (!DEBUG) return;
    try { console.warn('[CX-FORCE] ' + (tag || 'swallowed') + ':', (e && e.message) ? e.message : e); } catch (_) {}
  }
  // ===== 面板控制数据持久化（v4.1：刷新网页后保持面板设置）=====
  // 控制面板里改动的 AUTO_STOP_MIN / RESUME_AFTER_MIN / RESCAN_INTERVAL / END_RELEASE_SEC / DEBUG
  // 原本只存在运行时变量，刷新即丢。现统一存到 localStorage.cx_panel_cfg（JSON），脚本启动即载入，
  // 面板各控件变更时即时写回 → 设置跨刷新保持不变。（当前导航区块 cx_panel_tab、副脚本开关已在各自逻辑持久化。）
  function clampCfg() {                            // 载入后把越界值夹回面板控件允许范围，避免异常值污染续播逻辑
    CONFIG.AUTO_STOP_MIN = Math.max(0, Math.min(120, +CONFIG.AUTO_STOP_MIN || 0));
    CONFIG.RESUME_AFTER_MIN = Math.max(0, Math.min(60, +CONFIG.RESUME_AFTER_MIN || 0));
    CONFIG.RESCAN_INTERVAL = Math.max(500, Math.min(5000, +CONFIG.RESCAN_INTERVAL || 2000));
    CONFIG.END_RELEASE_SEC = Math.max(0, Math.min(120, +CONFIG.END_RELEASE_SEC || 0));
    CONFIG.USER_RATE = Math.max(0.25, Math.min(4, +CONFIG.USER_RATE || 1));
    DEBUG = !!DEBUG;
  }
  function savePanelCfg() {
    try {
      localStorage.setItem('cx_panel_cfg', JSON.stringify({
        AUTO_STOP_MIN: CONFIG.AUTO_STOP_MIN,
        RESUME_AFTER_MIN: CONFIG.RESUME_AFTER_MIN,
        RESCAN_INTERVAL: CONFIG.RESCAN_INTERVAL,
        END_RELEASE_SEC: CONFIG.END_RELEASE_SEC,
        USER_RATE: CONFIG.USER_RATE,
        DEBUG: DEBUG,
        LOOP_PLAY: CONFIG.LOOP_PLAY
      }));
    } catch (e) { swallow(e); }
  }
  function loadPanelCfg() {
    try {
      var s = localStorage.getItem('cx_panel_cfg');
      if (!s) return;
      var o = JSON.parse(s) || {};
      if (typeof o.AUTO_STOP_MIN === 'number') CONFIG.AUTO_STOP_MIN = o.AUTO_STOP_MIN;
      if (typeof o.RESUME_AFTER_MIN === 'number') CONFIG.RESUME_AFTER_MIN = o.RESUME_AFTER_MIN;
      if (typeof o.RESCAN_INTERVAL === 'number') CONFIG.RESCAN_INTERVAL = o.RESCAN_INTERVAL;
      if (typeof o.END_RELEASE_SEC === 'number') CONFIG.END_RELEASE_SEC = o.END_RELEASE_SEC;
      if (typeof o.USER_RATE === 'number') CONFIG.USER_RATE = o.USER_RATE;
      if (typeof o.DEBUG === 'boolean') DEBUG = o.DEBUG;
      if (typeof o.LOOP_PLAY === 'boolean') CONFIG.LOOP_PLAY = o.LOOP_PLAY;
      clampCfg();
    } catch (e) { swallow(e); }
  }
  loadPanelCfg();   // 启动即载入上次设置（务必在 _loopTimer 启动(line 1051) 之前，使 RESCAN_INTERVAL 立即生效）
  loadWatchStats(); // 载入本地已看时长统计（进度同步·本地估算用）

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
      try { if (this && this.__cxForcePaused) return; } catch (e) { swallow(e); }
      return NATIVE_PAUSE.apply(this, arguments);
    }
    try { HTMLMediaElement.prototype.pause = protoPause; }
    catch (e1) {
      try { Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: protoPause }); }
      catch (e2) { swallow(e2); }
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
          try { if (this && this.__cxForcePaused && !this.__cxAN_hold && !this.__cxUserPaused && v <= 0.01) v = (CONFIG.USER_RATE || 1); } catch (e) { swallow(e); }
          return NATIVE_RATE_DESC.set.call(this, v);
        }
      });
    } catch (e) { swallow(e); }
  }
  installPlaybackRateNeutralize();

  // 把当前用户倍速(CONFIG.USER_RATE)施加到页面内所有视频（含 iframe 内），用于面板上调节倍速后即时生效、并持续压制平台重置。
  // 不局限于"已强制接管"的视频：定向模式下未命中白名单被释放的主视频、以及普通观看视频同样生效，避免速率形同虚设。
  // 仍尊重 auto-next 暂停锁(__cxAN_hold，锁定时平台可能用 rate=0 实现暂停，不得回拉)、用户手动暂停(__cxUserPaused)、
  // 已结束锁定(__cxEndedLock，停在末尾不应改动)；跳过 rate<=0.01 的伪暂停（交由 ratechange/coverVideo 拉回）。零网络、零上报。
  function applyUserRateAll() {
    try {
      var rate = (CONFIG.USER_RATE || 1);
      function walk(root) {
        if (!root || !root.getElementsByTagName) return;
        var vs = root.getElementsByTagName('video');
        for (var i = 0; i < vs.length; i++) {
          var v = vs[i];
          try {
            if (!v.__cxAN_hold && !v.__cxUserPaused && !v.__cxEndedLock
                && v.playbackRate > 0.01 && v.playbackRate !== rate) v.playbackRate = rate;
          } catch (e) { swallow(e); }
        }
        var fs = root.getElementsByTagName('iframe');
        for (var j = 0; j < fs.length; j++) { try { if (fs[j].contentDocument) walk(fs[j].contentDocument); } catch (e) { swallow(e); } }
      }
      walk(document);
    } catch (e) { swallow(e); }
  }
  // 立即把当前循环开关(CONFIG.LOOP_PLAY)施加到所有视频（含 iframe 内），用于面板上切换循环后即时生效（无需等下一轮重扫）。
  // 仅改 loop 属性：续播接管/防暂停/倍速压制等逻辑不变。零网络、零上报。
  function applyLoopAll() {
    try {
      var vs = allVideos();
      for (var i = 0; i < vs.length; i++) {
        try { vs[i].loop = CONFIG.LOOP_PLAY; } catch (e) { swallow(e); }
      }
    } catch (e) { swallow(e); }
  }

  // ===== MODULE: 定向/白名单 =====
  // ===== 定向续播：从 window.attachments 抽任务点视频白名单 =====
  // 播放页 JS 渲染后，顶层 window.attachments 是任务点数组，每项 { property: {...} }，
  // property.objectid / mid / id 为视频资源标识，property.type 标记类型(video/document/...)。
  // 据此只续任务点视频，广告/插播视频不在白名单内 → 跳过（不让 force-play 误续）。
  var TARGET = { enabled: false, ids: null, matchedAny: false };

  // ===== MODULE: 本地桥客户端 =====
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
    skipResume: false,  // true = 当前章已完成，禁用强制续播
    version: null       // 修复 M5：桥服务 /ping 回报的版本，供面板/诊断展示，便于发现过旧的桥
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
      try { var ls = localStorage.getItem('cx_bridge_base'); if (ls) return String(ls).replace(/\/+$/, ''); } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
    return 'http://127.0.0.1:7531';   // 修复 #14：默认端口须与 cx_crawler/config.py 的 BRIDGE_PORT 保持一致；改端口时两边同步修改
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
          if (r && r.ok) {
            // 修复 M5：ping 回报含桥版本，缓存到 BRIDGE.version 供诊断展示（非阻塞，版本不一致仅提示）
            try { r.json().then(function (d) { if (d && d.version) BRIDGE.version = d.version; }).catch(function () {}); } catch (e) { swallow(e); }
            cb('http://127.0.0.1:' + port);
          } else next();
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
    } catch (e) { swallow(e); }   // 跨域父帧读不到 href 即抛错，保留最近一层同源 href
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
      } catch (e) { swallow(e); } }
    } catch (e) { swallow(e); }
    try {
      root.querySelectorAll('iframe').forEach(function (f) {
        try { if (f.contentDocument) restoreNativePause(f.contentDocument); } catch (e) { swallow(e); }
      });
    } catch (e) { swallow(e); }
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
          try { restoreNativePause(document); } catch (e) { swallow(e); }
          dbg('bridge：当前章已完成，禁用强制续播并恢复原生 pause');
        }
        try { refreshTargets(); } catch (e) { swallow(e); }   // 桥异步到达后即时用 objectids 撑起白名单（#1）
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
          if (r && r.ok) {
            // 修复 M5：默认地址可达，记录桥版本（非阻塞）
            try { r.json().then(function (d) { if (d && d.version) BRIDGE.version = d.version; }).catch(function () {}); } catch (e) { swallow(e); }
          } else {
            probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } });
          }
        }).catch(function () { probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } }); });
      } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
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
          try { refreshTargets(); } catch (e) { swallow(e); }   // 即时重建白名单，无需等下一个 2s 周期
        }
      });
      _attachHooked = true;
    } catch (e) { swallow(e); }
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
  // 跨脚本契约：auto-next 脚本在插播题/答题需暂停时，向具体 video 写入 v.__cxAN_hold=true（暂停时清除）。
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
    } catch (e) { swallow(e); }
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
      try { if (v.currentSrc) urls.push(v.currentSrc); } catch (e) { swallow(e); }
      try { if (v.src) urls.push(v.src); } catch (e) { swallow(e); }
      // 修复复审#2：iframe 内视频 parentElement 链够不到父文档 iframe，故把下钻时传入的宿主 iframe 签名并入匹配源
      try { var _hs = v.__cxHostSigs; if (_hs) { for (var _hi = 0; _hi < _hs.length; _hi++) { if (_hs[_hi]) urls.push(_hs[_hi]); } } } catch (e) { swallow(e); }
      var el = v;
      while (el && el.parentElement) {
        el = el.parentElement;
        if (el && el.tagName === 'IFRAME') {
          try { if (el.src) urls.push(el.src); } catch (e) { swallow(e); }
          try { if (el.id) urls.push(el.id); } catch (e) { swallow(e); }
          try { if (el.name) urls.push(el.name); } catch (e) { swallow(e); }
          try { if (el.getAttribute) { var d = el.getAttribute('data'); if (d) urls.push(d); } } catch (e) { swallow(e); }
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
    } catch (e) { swallow(e); }
    return false; // 定向模式但无任何白名单 id 命中 → 视为广告/插播 → 跳过
  }

  // ===== MODULE: 重播加固(去重) =====
  // ===== 重播加固：用 currentSrc 去重"已播完任务的整元素重建" =====
  // 平台跳课时可能销毁旧 video 并以全新元素重建同一已播完视频（src 相同），旧 __cxEndedLock 失效 → 误续播。
  // 故：ended 锁定时登记其 currentSrc；任何"非 ended、地址命中已结束集合"的新 video = 同一任务点重建 → 锁死不播。
  var ENDED_SRCS = {};
  var ENDED_SRCS_CAP = 2000;   // 上限：长时挂机同章节内 blob/iframe src 反复变更时防止 ENDED_SRCS 无限增长（吸收评审 JS1-1）
  function _endedPrune() {
    try {
      var _ks = Object.keys(ENDED_SRCS);
      if (_ks.length > ENDED_SRCS_CAP) {
        var _drop = _ks.length - ENDED_SRCS_CAP;
        for (var _p = 0; _p < _drop; _p++) delete ENDED_SRCS[_ks[_p]];   // 淘汰最旧指纹（Object.keys 按插入序，最旧在前）
      }
    } catch (e) { swallow(e); }
  }
  function _markEnded(src) { if (!src) return; try { ENDED_SRCS[src] = true; } catch (e) { swallow(e); } }
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
    } catch (e) { swallow(e); }
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
      // 修复复审#2：宿主 iframe 签名（下钻时传入）直接并入指纹，覆盖 iframe 内视频 parentElement 链够不到父文档 iframe 的死代码
      var _hs = v.__cxHostSigs;
      if (_hs && _hs.length) {
        for (var _hsi = 0; _hsi < _hs.length; _hsi++) {
          var _hsig = _hs[_hsi];
          if (_hsig) { for (var _i2 = 0; _i2 < idKeys.length; _i2++) { if (keyRe(idKeys[_i2]).test(_hsig)) { out.push(_hsig); break; } } }
        }
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
          } catch (e) { swallow(e); }
        }
      }
    } catch (e) { swallow(e); }
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

  // 安全 play：兼容浏览器自动播放策略拒绝（先静音再播，Edge 友好）
  // 安全 play：兼容浏览器自动播放策略拒绝。按原始 muted 状态尝试；被拒则静音重试一次，成功后恢复用户预期音量。
  function safePlay(v) {
    try {
      var wasMuted = v.muted;                        // 记录原始静音状态，避免脚本误静音破坏用户音量预期
      var restored = false;
      function restore() {                           // 等视频真正开始出声(playing)后再恢复音量，避免提前取消静音（吸收评审#H）
        if (restored) return; restored = true;
        try { if (!wasMuted) v.muted = false; } catch (e) { swallow(e); }
      }
      // 用 {once:true} 注册：浏览器在首次 playing 后自动移除监听器，杜绝\"addEventListener(...,true) 而 remove 缺 capture 标志\"导致的监听器永久累积泄漏（吸收评审#H）
      // 【易误判·诊断#五】无需加去重标志：{once:true} 保证 playing 触发即自移除；仅"自动播放彻底被禁且永不 playing"的病理场景才暂存，可接受。
      try { v.addEventListener('playing', restore, { once: true }); } catch (e) { swallow(e); }
      var p = v.play();
      if (p && typeof p.then === 'function') {
        p.then(restore).catch(function () {          // 自动播放策略拒绝 → 静音重试
          try {
            v.muted = true;
            var p2 = v.play();
            if (p2 && typeof p2.then === 'function') p2.then(restore).catch(function () {});
          } catch (e) { swallow(e); }
        });
      }
    } catch (e) { swallow(e); }                                    // 静默：浏览器限制，非脚本问题
  }

  // ===== MODULE: 看播统计 =====
  // ===== 本地观看时长统计（进度同步·本地估算，非平台上报）=====
  // 把每视频已看毫秒按「视频源」累计到 window.__cxWatchStats[src]={ms,courseId,updated}，
  // 节流持久化到 localStorage.cx_watch_stats（跨会话累计）。仅供进度面板做"本地估算"展示，
  // 不读取平台回看时长、不发起任何上报（符合只读 GET 章程与合规红线）。
  var _watchStats = {};
  var _watchPersistAt = 0;
  function loadWatchStats() {
    try { _watchStats = JSON.parse(localStorage.getItem('cx_watch_stats') || '{}') || {}; } catch (e) { _watchStats = {}; }
    try { window.__cxWatchStats = _watchStats; } catch (e) { swallow(e); }
  }
  function recordWatchMs(src, dt, courseId) {
    if (!src || dt <= 0) return;
    var e = _watchStats[src] || { ms: 0, courseId: courseId || '', updated: 0 };
    e.ms = (e.ms || 0) + dt;
    e.courseId = courseId || e.courseId || '';
    e.updated = Date.now();
    _watchStats[src] = e;
    try { window.__cxWatchStats = _watchStats; } catch (e2) { swallow(e2); }
    var now = Date.now();
    if (now - _watchPersistAt > 10000) {   // 10s 节流写盘，避免每 2s 轮询都 JSON.stringify
      _watchPersistAt = now;
      try { localStorage.setItem('cx_watch_stats', JSON.stringify(_watchStats)); } catch (e3) { swallow(e3); }
    }
  }

  // F-B1 修复：定向模式下被"跳过"的视频，若此前已在全量续播阶段被本脚本接管
  // （window.attachments / 桥 objectids 晚于首扫到达），必须撤销接管交还平台；否则广告/插播视频会
  // 残留 v.pause=pauseNoop、__cxForcePaused=true，被永久强制续播且用户无法暂停，与"定向跳过"目标直接相悖。
  // 仅撤销"续播接管"，保留 __cxEndedLock / 重建去重（已结束任务不应被释放重播）。
  function releaseVideo(v) {
    if (!v || (!v.__cxForcePaused && !v.__cxReleased)) return;   // 未接管或已释放则跳过（幂等）
    try { v.pause = v.__np || NATIVE_PAUSE; } catch (e) { swallow(e); }       // 恢复实例级原生 pause（绕过原型 no-op），用户/平台可正常暂停
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
    } catch (e) { swallow(e); }
    return false;
  }
  // ===== MODULE: 接管引擎(overrideVideo) =====
  function overrideVideo(v, fg) {
    if (!v) return;
    // 桥避让：爬虫清单标记当前章已完成 → 不覆盖 pause、不强制续播（重进已完成章不重看）
    if (BRIDGE.skipResume) return;
    // 定向命中统计：即便视频被用户暂停（下方提前 return）也要计入，否则全部暂停时 matchedAny 恒 false → 误触 fallback 回退全量（复审确认）
    if (TARGET.enabled && !TARGET.matchedAny && videoBelongsToTask(v)) TARGET.matchedAny = true;
    // 用户暂停锁：手动暂停键/自动停止计时器置位后，不再施加 noop 覆盖、交还原生 pause，所有续播兜底避让。
    // 与 __cxReleased 分离：避免被下方"重新归属任务点→重新接管"逻辑（L461）误清除（专项：用户暂停开关）
    if (v.__cxUserPaused) {
      try { if (v.__np) v.pause = v.__np; } catch (e) { swallow(e); }
      // 看门狗：闸门若被平台重置（重定义 play / 换元素属性），每轮扫描发现"用户暂停却在播"立即压回
      try { if (!v.paused) (v.__np || NATIVE_PAUSE).call(v); } catch (e2) { swallow(e2); }
      return;
    }
    // 定向续播：仅对 window.attachments 中的任务点视频强制续播，跳过广告/插播视频
    if (TARGET.enabled && !videoBelongsToTask(v)) {
      dbg('跳过非任务点视频（广告/插播）');
      releaseVideo(v);   // F-B1：撤销全量阶段已施加的接管，交还平台（否则广告/插播被永久强制续播）
      return;
    }
    // —— 前台门控（修复"多个视频同时播放"）——
    // 当存在明确前台(可见)视频时，抑制其余视频的强制续播并交还平台、主动压下，
    // 确保一页只播一个；被用户显式保留(__cxUserKeep)的视频不受影响。
    // fg 为 undefined 时（play 即时接管 / MO 队列未传入）不施加门控，保留旧行为。
    if (fg && v !== fg && !v.__cxUserKeep) {
      if (v.__cxForcePaused) {
        try { releaseVideo(v); } catch (e) { swallow(e); }
        // 主动压下：releaseVideo 只还原 pause 不主动停，被释放的隐藏视频可能仍在播，必须压回才能真正停止
        try { if (!v.paused) (v.__np || NATIVE_PAUSE).call(v); } catch (e2) { swallow(e2); }
      }
      return;
    }
    // 注：matchedAny 统一在上方 L485（定向判定前、含被暂停视频）置位，本行冗余已删（审查#3 双写）。
    // 【进度到底关闭续播】距结尾 END_RELEASE_SEC 内（未真正 ended）不再强制续播：
    // 交还平台原生 pause，让用户能自然暂停/结束；视频自然播完后由下方 ended 锁分支防重播。
    // 用户场景：视频不必一次性看完，接近看完时脚本停手，避免 pauseNoop 吞掉原生暂停导致无法停（专项：进度到底关闭续播）。
    // 每轮 nearEnd 仍为真时持续 release + 返回，绕过下方"重新归属→重新接管"把已释放视频又接管回去。
    if (nearEnd(v) && !CONFIG.LOOP_PLAY) {
      try { if (!v.__cxEndedLock) releaseVideo(v); } catch (e) { swallow(e); }   // 释放接管（保留 ended 锁/重建锁）
      dbg('进度到底（剩 ' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's）：已关闭续播');
      return;
    }
    if (v.__cxReleased) { v.__cxForcePaused = true; v.__cxReleased = false; }   // F-B1：曾被释放、现重新归属任务点 → 重新接管
    // 已结束锁：持续阻断重播，直到元素被替换（auto-next 跳课接管）。
    // 关键修复：不再因"非 ended 瞬态"（平台重播会改 src 使 ended=false）恢复原生 play，
    // 否则平台重播得逞，且会吃掉 auto-next 的 ended 跳课（ended 事件仅派发一次）。
    if (v.__cxEndedLock) {
      try { v.pause = pauseNoop; } catch (e2) { swallow(e2); }
      v.__cxForcePaused = true;   // 原型级 no-op 也生效（即便实例 own 属性被重置）
      v.play = function () { return Promise.resolve(); };
      try { if (v.duration && isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e2) { swallow(e2); }
      dbg('ended 锁持续维持，阻断重播');
      return;
    }
    // 重播加固：新插入的 video 若地址命中"已结束集合"= 平台重建同一已播完任务点 → 锁死不播（不误伤新一课）
    if (!v.ended && !v.__cxEndedLock && isRebuildFinished(v)) {
      if (CONFIG.LOOP_PLAY) {
        dbg('循环播放：允许已结束任务的重建 video 重播');  // 不锁死，交给下方正常续播 + loop 属性实现重播
      } else {
        try { v.pause = pauseNoop; v.play = function () { return Promise.resolve(); }; v.loop = false; v.__cxsRebuild = true; } catch (e) { swallow(e); }
        v.__cxForcePaused = true;
        dbg('跳过已结束任务的重建 video（防整元素重播）');
        return;
      }
    }
    try {
      // MediaSession 劫持提到最前面：所有状态都执行（含 ended），应对锁屏界面续播。
      // 每次执行都设置，应对平台可能重置 mediaSession（含视频 ended 后）。
      try {
        if (navigator.mediaSession) {
          navigator.mediaSession.setActionHandler('pause', function () {});
          navigator.mediaSession.playbackState = 'playing';   // 视频实则在播，状态标 playing 与"劫持 pause 为 no-op"语义一致，锁屏不误发暂停
        }
      } catch (msE) { swallow(msE); }

      if (!v.__cx) {
        v.__np = NATIVE_PAUSE;   // 备份原生 pause(绕过原型级 no-op)，供 auto-next 的 holdPause 真正暂停视频
        v.__cxForcePaused = true; // 标记为本脚本强制续播对象：原型 pause 对其变 no-op，连闭包/webpack 私有暂停也拦得住(#3)
        v.loop = CONFIG.LOOP_PLAY;   // 启用用户可控循环：开启则视频播完由 loop 属性从头重播；关闭则禁掉自动重播（默认防重播）

        // pause 事件兜底：除非 auto-next 已锁定(__cxAN_hold)或桥避让(skipResume 迟到场景)，任何暂停都立刻拉回
        v.addEventListener('pause', function () {
          try { if (!v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxReleased && !v.__cxUserPaused) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        // 防伪暂停：平台把 playbackRate 设为 0 来停视频，仅在 rate<=0.01 时拉回用户设定速率（保留用户手动倍速，默认 1x）。
        // 关键：必须尊重 auto-next 的 __cxAN_hold —— 锁定时 auto-next 可能用速率=0 实现暂停，本脚本不得回拉（专项诊断#二）。
        v.addEventListener('ratechange', function () {
          try { if (!v.__cxAN_hold && !v.__cxUserPaused && v.playbackRate <= 0.01) v.playbackRate = (CONFIG.USER_RATE || 1); } catch (e) { swallow(e); }
        }, true);
        // 缓冲恢复后自动拉回播放，与轮询互补（尊重 hold 锁）
        v.addEventListener('canplay', function () {
          try { if (!v.ended && !v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxEndedLock && !isRebuildFinished(v) && !v.__cxReleased && !v.__cxUserPaused && v.paused && v.readyState >= 2) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        // #3 对抗 MSE 断流：blob: 视频经 MediaSource 喂数据，平台可停止 appendBuffer 让缓冲区耗尽"自然停"，
        // 此时可能未触发 pause 事件。waiting/stalled 即缓冲枯竭信号，重新 play() 可触发新一轮数据请求续播
        // （不 Hook SourceBuffer（appendBuffer 风险花屏）；不跳秒以免 MSE seek 出错）。尊重 hold/桥避让/已结束/重建。
        v.addEventListener('waiting', function () {
          try { if (!v.ended && !v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxEndedLock && !isRebuildFinished(v) && !v.__cxReleased && !v.__cxUserPaused) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('stalled', function () {
          try { if (!v.ended && !v.__cxAN_hold && !BRIDGE.skipResume && !v.__cxEndedLock && !isRebuildFinished(v) && !v.__cxReleased && !v.__cxUserPaused) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.__cx = true;
      }
      v.pause = pauseNoop;       // 每次重扫都再断言，应对平台重定义 pause
      v.loop = CONFIG.LOOP_PLAY; // 每次重扫再断言：循环开启保持 loop=true（浏览器自动重播），关闭则钳回 false（防平台中途置 loop 触发意外循环）

      // —— ended 状态处理（关键修复循环播放）——
      // 平台 JS 在 ended 后主动调 video.play() 或重建 video 元素重播（非 HTML loop 属性）。
      if (v.ended) {
        if (CONFIG.LOOP_PLAY) {
          // 可控循环播放：清空防重播锁，回到开头重新播放（浏览器 loop 与手动复位双保险）。不登记 ENDED_SRCS、不覆盖 play 为 no-op，
          // 使视频能反复重播；pause 仍被 no-op 拦截以防平台暂停打断循环。
          try { v.__cxEndedLock = false; } catch (e) { swallow(e); }
          try { v.loop = true; } catch (e) { swallow(e); }
          try { v.pause = pauseNoop; } catch (e) { swallow(e); }
          try { v.currentTime = 0; } catch (e) { swallow(e); }
          v.__cxForcePaused = true;
          if (v.paused) safePlay(v);
          dbg('循环播放：视频播完，从头重播');
          return;
        }
        try { if (v.__np) v.__np(); } catch (e) { swallow(e); }                        // 真正停住（原生 pause）
        v.play = function () { return Promise.resolve(); };              // 覆盖 play 为 no-op，阻断平台主动重播
        try { v.__cxEndedLock = true; } catch (e) { swallow(e); }                     // 持久锁：后续重扫持续维持，不再恢复原生 play
        try { v.__cxUserKeep = false; } catch (e) { swallow(e); }                     // 播完即清除用户保留标记，避免残留导致门控失效
        try { _markEnded(videoSrcOf(v)); } catch (e) { swallow(e); }                                                  // 登记播放地址，供重建去重
        try { var _iss = videoIframeSrcsOf(v); for (var _i = 0; _i < _iss.length; _i++) _markEnded(_iss[_i]); } catch (e) { swallow(e); }  // 同步登记祖先 iframe src，关掉 src 未就绪的时间窗（吸收评审#3）
        _endedPrune();                                                                                    // 超出上限时淘汰最旧指纹，防止无限增长（吸收评审 JS1-1）
        try { if (isFinite(v.duration)) v.currentTime = v.duration; } catch (e) { swallow(e); }  // 直播 duration=Infinity 时跳过非法赋值（吸收评审#5）
        if (!v.__seekArmed) {                                             // seeking 守卫：平台若把 currentTime 改小，拉回末尾
          v.__seekArmed = true;
          v.addEventListener('seeking', function () {
            try { if (isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e) { swallow(e); }   // 直播流(Infinity)不重置（吸收评审#5）
          }, true);
        }
        dbg('ended：已锁定 currentTime 并覆盖 play 为 no-op，阻断重播');
        return;
      }

      // 正常续播（尊重 auto-next 暂停锁；已 ended 锁元素/重建元素由前序分支跳过，不会走到这里）
      // ENDED_SRCS 为"已播完地址黑名单"，只增不清（仅在真实章节切换时由 refreshTargets 清空），
      // 故此处不重置——原"任意新 video 即清空"写法会令重建重播保护失效，已删除（吸收评审）。
      if (v.paused && !v.__cxAN_hold && !v.__cxReleased && !v.__cxUserPaused && v.readyState >= 2) { safePlay(v); }
      // 仅防伪暂停回拉：平台用 rate<=0.01 伪暂停，拉回用户设定速率（默认 1x）；尊重 auto-next 暂停锁（专项诊断#二）
      if (v.playbackRate <= 0.01 && !v.__cxReleased && !v.__cxAN_hold && !v.__cxUserPaused) { v.playbackRate = (CONFIG.USER_RATE || 1); }
      // 用户倍速持续施加：对"已强制接管"视频，若当前速率与用户设定不一致（且非 0 伪暂停/非锁定/非用户暂停），拉回用户速率（倍速调节支持）
      else if (CONFIG.USER_RATE && CONFIG.USER_RATE !== 1 && v.__cxForcePaused && !v.__cxReleased && !v.__cxAN_hold && !v.__cxUserPaused && v.playbackRate > 0.01 && v.playbackRate !== CONFIG.USER_RATE) { v.playbackRate = CONFIG.USER_RATE; }
    } catch (e) { swallow(e); }
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
          try { a.pause = function () {}; done = true; } catch (ae) { swallow(ae); }
        }
        if (!done) dbg('window.ananas.pause 无法中和(描述符受限)');
      }
    } catch (e) { dbg('neutralizeGlobalPause 异常', e); }
  }

  // ===== MODULE: 用户暂停开关 =====
  // —— 用户暂停开关（手动暂停键 + 自动停止计时器）——
  // v.__cxUserPaused：用户主动暂停锁。置位后 overrideVideo 不再施加 noop 覆盖、各兜底监听与正常续播均避让，
  // 视频可正常暂停/播放；与原先 __cxReleased（定向跳过/桥避让的"交还平台"语义）分离，避免被重新接管逻辑误清除。
  // ===== MODULE: 视频枚举(walkVideos · 审查 JS1-3「scanVideos 三合一」) =====
  // scanVideos(强制接管)、allVideos(收集/诊断/面板)、installPlayWatch(iframe 内 play 即时接管)
  // 原本各有独立遍历(Shadow DOM + 同源 iframe)，口径不一致曾导致「视频在播但诊断 0 / 手动暂停被接管」矛盾。
  // 现统一为单一递归原语 walkVideos：onVideo(v, hostSigs) 对每个视频调用；onDoc(doc, frame) 进入每个同源 iframe 文档时调用。
  var MAX_SCAN_DEPTH = 16;
  function walkVideos(root, hostSigs, depth, onVideo, onDoc) {
    if (!root || !root.querySelectorAll) return;
    depth = depth || 0;
    if (depth > MAX_SCAN_DEPTH) return;
    try {
      var _vs = root.getElementsByTagName('video');
      for (var _vi = 0; _vi < _vs.length; _vi++) { try { if (onVideo) onVideo(_vs[_vi], hostSigs); } catch (e) { swallow(e); } }
    } catch (e) { swallow(e); }
    try {
      if (root.host) {
        var _sh = root.querySelectorAll('*');
        for (var _hi = 0; _hi < _sh.length; _hi++) {
          if (_sh[_hi].shadowRoot) { try { walkVideos(_sh[_hi].shadowRoot, hostSigs, depth + 1, onVideo, onDoc); } catch (e) { swallow(e); } }
        }
      } else {
        var _cts = root.querySelectorAll('#videoBox, .ans-attach-ct');
        for (var _ci = 0; _ci < _cts.length; _ci++) {
          var _ct = _cts[_ci];
          if (_ct.shadowRoot) { try { walkVideos(_ct.shadowRoot, hostSigs, depth + 1, onVideo, onDoc); } catch (e) { swallow(e); } }
          var _all = _ct.getElementsByTagName('*');
          for (var _ai = 0; _ai < _all.length; _ai++) {
            if (_all[_ai].shadowRoot) { try { walkVideos(_all[_ai].shadowRoot, hostSigs, depth + 1, onVideo, onDoc); } catch (e) { swallow(e); } }
          }
        }
      }
    } catch (e) { swallow(e); }
    try {
      root.querySelectorAll('iframe').forEach(function (f) {
        try {
          if (f.contentWindow && f.contentDocument) {
            var _hs = (hostSigs || []).concat(signatureOf(f));   // 宿主 iframe 签名下钻传入（修复复审#2）
            try { if (f.src) _hs.push(f.src); } catch (e2) { swallow(e2); }
            walkVideos(f.contentDocument, _hs, depth + 1, onVideo, onDoc);
            if (!f.__cxPW) { f.__cxPW = true; installPlayWatch(f.contentDocument); }   // 仅在首次下钻为 iframe 内视频装 play 即时接管（避免每轮重复挂载）
            try { neutralizeGlobalPause(f.contentWindow); } catch (e3) { swallow(e3); }
            try { if (onDoc) onDoc(f.contentDocument, f); } catch (e3) { swallow(e3); }
          }
          // 修时序：动态创建的播放器 iframe 可能尚未加载完，等 load 后再扫一次
          if (!f.__cxL) {
            f.__cxL = true;
            f.addEventListener('load', function () {
              try { if (f.contentWindow && f.contentDocument) { scanVideos(f.contentDocument, hostSigs, depth + 1); neutralizeGlobalPause(f.contentWindow); } } catch (e) { swallow(e); }
            }, true);
          }
        } catch (e) { swallow(e); }                   // 跨域 iframe 静默跳过（外部无法挂载）
      });
    } catch (e) { swallow(e); }
  }
  // 接管遍历：对每个视频施加强制续播（含宿主 iframe 签名下钻）
  function scanVideos(root) {
    var fg = foregroundVideo();   // 每轮仅算一次前台，避免 O(n²)；非前台视频在 overrideVideo 内被门控释放
    walkVideos(root, null, 0, function (v, hs) {
      try { if (hs) v.__cxHostSigs = hs; } catch (e) { swallow(e); }
      overrideVideo(v, fg);
    });
  }
  function allVideos() {
    // 诊断、状态、面板「暂停/恢复」按钮(currentVideo/activeVideo)均依赖本函数；与 scanVideos 统一口径，三者一致修复矛盾
    var out = [], seen = [];
    function dedup(v) { for (var i = 0; i < seen.length; i++) if (seen[i] === v) return false; seen.push(v); return true; }
    walkVideos(document, null, 0, function (v) { if (dedup(v)) out.push(v); });
    try { if (window.top && window.top !== window && window.top.document && window.top.document.body) walkVideos(window.top.document, null, 0, function (v) { if (dedup(v)) out.push(v); }); } catch (e) { swallow(e); }  // 并入顶层同源文档
    return out;
  }
  function activeVideo() {                       // 返回当前正在播放的视频（用于热键切换）
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try { if (!vs[i].paused && !vs[i].ended) return vs[i]; } catch (e) { swallow(e); } }
    return null;
  }
  function userPause(v) {                         // 用户暂停：真正停住并置锁；按 RESUME_AFTER_MIN 排自动恢复
    if (!v) return;
    v.__cxUserPaused = true;
    v.__cxUserKeep = false;                       // 用户主动暂停即取消"保留播放"标记（门控可重新管理该视频）
    try { (v.__np ? v.__np : NATIVE_PAUSE || v.pause).call(v); } catch (e) { swallow(e); }   // 原生 pause 真正停住（绕过原型/实例 noop）
    // 播放闸门：脚本此前只拦"暂停"从不拦"播放"，平台播放器自调 video.play() 会把用户暂停的视频拉回播放
    //（实测诊断：状态 playing 而 UserPaused=true 的矛盾态）。在实例上遮蔽 play：用户暂停期间一律拒绝。
    try {
      Object.defineProperty(v, 'play', { configurable: true, writable: true, value: function () {
        if (this.__cxUserPaused) { dbg('播放闸门：用户暂停中，拒绝 play()'); return Promise.resolve(); }
        return NATIVE_PLAY ? NATIVE_PLAY.apply(this, arguments) : Promise.resolve();
      } });
    } catch (eG) { swallow(eG); }
    if (CONFIG.RESUME_AFTER_MIN > 0) v.__cxResumeAt = Date.now() + CONFIG.RESUME_AFTER_MIN * 60000;
    try { toast('已暂停续播（手动/计时）'); } catch (e2) { swallow(e2); }
  }
  function userResume(v) {                        // 用户恢复：清锁并续播
    if (!v) return;
    v.__cxUserPaused = false;
    if (v !== foregroundVideo()) v.__cxUserKeep = true;   // 用户对非前台视频显式恢复：打保留标记，门控不再误回收（修复"其他视频无法开启"）
    v.__cxResumeAt = 0;
    v.__cxWatchMs = 0;                            // 重置自动停止计时，避免恢复后立刻再停
    // 修复复审（低-中危）：恢复续播应能重看已播完视频——清 ended 锁并解除全局黑名单，否则下一轮 overrideVideo 又把 play 设回 no-op 锁死
    if (v.__cxEndedLock) {
      v.__cxEndedLock = false;
      try { if (v.duration && isFinite(v.duration) && v.currentTime > 0) v.currentTime = 0; } catch (e) { swallow(e); }   // 从头重看
      try { delete ENDED_SRCS[videoSrcOf(v)]; } catch (e) { swallow(e); }                                          // 解除本视频地址黑名单
      try { var _hsg = v.__cxHostSigs; if (_hsg) { for (var _hg = 0; _hg < _hsg.length; _hg++) { try { delete ENDED_SRCS[_hsg[_hg]]; } catch (e2) { swallow(e2); } } } } catch (e) { swallow(e); }
    }
    try { delete v.play; } catch (e3) { swallow(e3); }          // 拆除播放闸门，还原原型 play
    try { safePlay(v); } catch (e) { swallow(e); }
    try { toast('已恢复续播'); } catch (e2) { swallow(e2); }
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
        recordWatchMs(videoSrcOf(v), dt, urlParam(topHref(), ['courseId']));  // 进度同步·本地估算：按课程累计已看时长
        if (CONFIG.AUTO_STOP_MIN > 0 && v.__cxWatchMs >= CONFIG.AUTO_STOP_MIN * 60000) userPause(v);
      }
    } catch (e) { swallow(e); } }
  }
  function resumeTick() {                         // 暂停后自动恢复：到 __cxResumeAt 时间则自动续播
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try {
      var v = vs[i];
      if (v.__cxUserPaused && v.__cxResumeAt && Date.now() >= v.__cxResumeAt) userResume(v);
    } catch (e) { swallow(e); } }
  }
  function toast(msg) {                           // 轻量提示（仅顶部文档，不污染输入框）
    try {
      var t = document.getElementById('__cxToast');
      if (!t) { t = document.createElement('div'); t.id = '__cxToast'; t.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:rgba(0,0,0,.82);color:#fff;padding:6px 10px;border-radius:6px;font:13px/1.4 sans-serif;pointer-events:none;'; if (document.body) document.body.appendChild(t); }
      if (!t) return;
      t.textContent = '[CX] ' + msg;
      t.style.display = 'block';
      clearTimeout(t.__cxTimer); t.__cxTimer = setTimeout(function () { if (t) t.style.display = 'none'; }, 1500);
    } catch (e) { swallow(e); }
  }
  function currentVideo() {                       // 当前目标视频：优先正在播放者；否则优先已用户暂停者；否则首个 video（供面板操作）
    var act = activeVideo(); if (act) return act;
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try { if (vs[i].__cxUserPaused) return vs[i]; } catch (e) { swallow(e); } }
    return vs[0] || null;
  }
  // ===== MODULE: 前台判定（修复"多个视频同时播放"）=====
  // 仅在"明确可见且面积最大"的视频上强制续播，其余视频交还平台并主动压下，避免一页多视频同时播放。
  // 可见性以 getBoundingClientRect 面积判断：display:none / 零尺寸预加载预览会被排除；
  // 滚动出视口但仍布局的视频面积仍为正，视为前台（不希望因滚动就释放当前任务）。
  function foregroundVideo() {
    var vs = allVideos(), best = null, bestScore = -1;
    for (var i = 0; i < vs.length; i++) {
      try {
        var r = vs[i].getBoundingClientRect();
        var area = (r.width || 0) * (r.height || 0);
        if (area <= 4) continue;                       // 不可见（隐藏/零尺寸）
        var score = area + (vs[i].paused ? 0 : 1e7);   // 同面积时优先"正在播放"者
        if (score > bestScore) { bestScore = score; best = vs[i]; }
      } catch (e) { swallow(e); }
    }
    return best;
  }
  function shortSrc(v) {
    var s = (v && (v.currentSrc || v.src)) || '';
    if (!s) return '(未知源)';
    try { s = decodeURIComponent(s); } catch (e) {}
    return s.length > 76 ? (s.slice(0, 48) + '…' + s.slice(-26)) : s;
  }
  // ===== MODULE: 悬浮控制面板 =====
  // —— 悬浮控制面板（开关键 = PAUSE_HOTKEY，默认 p）——
  // 集中控制：暂停/恢复、自动停止计时(AUTO_STOP_MIN)、暂停后自动恢复(RESUME_AFTER_MIN)，并实时显示状态。
  // 仅懒创建一次，随状态刷新；不污染页面输入框，Esc/× 关闭。
  var SCRIPT_VERSION = '4.7';   // 与文件头 @version 保持一致（面板与诊断信息显示用）
  var _cxPanel = null;
  var _lastVideoList = [];       // 面板视频列表渲染时缓存的视频引用快照，供点击委托回调定位目标视频（索引稳定）
  // ===== MODULE: 副脚本注册中心 =====
  // —— 副脚本注册中心（v4.0 主脚本架构）——
  // 本脚本为「主脚本」，其余用户脚本作为「副脚本」把自己的开关/按钮挂进本面板，用法（加载顺序无关）：
  //   (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
  //     id: '唯一id', type: 'toggle'|'button'|'subpanel', label: '显示名', note: '小字说明(可选)',
  //     get: function(){return bool},   // toggle 当前值
  //     set: function(v){},             // toggle 切换回调
  //     onClick: function(){}           // button 点击回调
  //     render: function(container){}   // 仅 subpanel 用：把内容渲染进主控面板内的可折叠副面板区块
  //   });
  //   if (window.__cxRegisterAddon) window.__cxRegisterAddon();   // 主脚本已就绪时立即渲染
  // 主脚本启动时与面板创建时都会排空队列，故副脚本先于主脚本加载也能注册成功。
  var _cxAddons = {};                    // id -> addon（去重）
  function renderAddons() {
    if (!_cxPanel) return;
    try {
      var box = _cxPanel.querySelector('#__cxAddons');
      var wrap = _cxPanel.querySelector('#__cxAddonsWrap');
      var subBox = _cxPanel.querySelector('#__cxSubPanels');
      var subWrap = _cxPanel.querySelector('#__cxSubPanelsWrap');
      if (box) box.innerHTML = '';
      if (subBox) subBox.innerHTML = '';
      var ids = Object.keys(_cxAddons);
      var hasToggle = false, hasSub = false;
      ids.forEach(function (id) {
        var a = _cxAddons[id];
        if (!a) return;
        // —— 副面板：在主控面板内嵌一块可折叠内容（由副脚本 render 填充），不再需要独立浮动窗 ——
        if (a.type === 'subpanel') {
          hasSub = true;
          if (!subBox) return;
          var block = document.createElement('div');
          block.style.cssText = 'margin-bottom:10px;font-size:12px;border:1px solid #3a3f4b;border-radius:6px;overflow:hidden;';
          var head = document.createElement('div');
          head.style.cssText = 'cursor:pointer;padding:6px 8px;background:#2a2e37;color:#e8e8e8;font-weight:600;display:flex;justify-content:space-between;align-items:center;';
          var titleSpan = document.createElement('span');
          titleSpan.textContent = a.label || id;
          var caret = document.createElement('span');
          caret.textContent = '▾';   // 默认展开
          caret.style.cssText = 'font-size:10px;';
          head.appendChild(titleSpan);
          head.appendChild(caret);
          var bodyEl = document.createElement('div');
          bodyEl.style.cssText = 'padding:8px;max-height:50vh;overflow:auto;';
          head.addEventListener('click', function () {
            var open = bodyEl.style.display !== 'none';
            bodyEl.style.display = open ? 'none' : 'block';
            caret.textContent = open ? '▸' : '▾';
          });
          block.appendChild(head);
          block.appendChild(bodyEl);
          subBox.appendChild(block);
          try { a.render && a.render(bodyEl); } catch (e) { swallow(e); }
          return;
        }
        // —— 普通副脚本开关 / 按钮 ——
        hasToggle = true;
        if (!box) return;
        var row = document.createElement('div');
        row.style.cssText = 'margin-bottom:6px;font-size:12px;';
        if (a.type === 'button') {
          var b = document.createElement('button');
          b.textContent = a.label;
          b.style.cssText = 'width:100%;padding:6px;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:6px;cursor:pointer;font-size:12px;';
          b.addEventListener('click', function () { try { a.onClick && a.onClick(); } catch (e) { swallow(e); } });
          row.appendChild(b);
        } else {
          var lab = document.createElement('label');
          lab.style.cssText = 'display:block;cursor:pointer;';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.style.cssText = 'vertical-align:middle;margin-right:6px;';
          try { cb.checked = !!(a.get && a.get()); } catch (e) { swallow(e); }
          cb.addEventListener('change', function () { try { a.set && a.set(cb.checked); } catch (e) { swallow(e); } });
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode(a.label));
          row.appendChild(lab);
        }
        if (a.note) {
          var nt = document.createElement('div');
          nt.style.cssText = 'font-size:11px;color:#6b7280;margin-left:20px;';
          nt.textContent = a.note;
          row.appendChild(nt);
        }
        box.appendChild(row);
      });
      if (wrap) wrap.style.display = hasToggle ? 'block' : 'none';
      if (subWrap) subWrap.style.display = hasSub ? 'block' : 'none';
    } catch (e) { swallow(e); }
  }
  function drainAddonQueue() {
    try {
      var q = window.__cxAddonQueue;
      if (q && q.length) {
        for (var i = 0; i < q.length; i++) {
          var a = q[i];
          if (a && a.id && !_cxAddons[a.id]) _cxAddons[a.id] = a;
        }
        q.length = 0;
      }
      renderAddons();
    } catch (e) { swallow(e); }
  }
  try { window.__cxRegisterAddon = drainAddonQueue; } catch (e) { swallow(e); }
  drainAddonQueue();   // 排空先于主脚本加载的副脚本注册（此时面板未建，仅入册，建面板时渲染）
  // 命令面板（v4.7）：暴露注册入口供副脚本扩展命令（initBuiltinCommands 在 MODULE 内、_cxCommands 初始化后调用，避免执行顺序问题）
  try { window.__cxRegisterCommand = registerCommand; } catch (e) { swallow(e); }
  // 主从式导航当前激活区块（localStorage 持久化）：面板顶部分区导航，切换下方内容（暂停设置/副面板/高级/其他）。
  var _cxActiveTab = 'pause';
  try { _cxActiveTab = (localStorage.getItem('cx_panel_tab') || 'pause'); } catch (e) { swallow(e); }
  function ensurePanel() {
    if (_cxPanel) return _cxPanel;
    // 面板落点：同源顶层(window.top)可达则挂在顶层文档，保证全站仅一个面板且跨 iframe 聚合所有视频；
    // 跨域嵌入(顶层不可达)时回退挂本帧文档。用全局 id 守卫避免每个 frame 各建一个面板——
    // 旧行为会导致"面板被建在视频 iframe 内、且只看见那一帧的 1 个视频、必须点进 iframe 才能用 P 键"。
    var pd = (window.top && window.top.document && window.top.document.body) ? window.top.document : document;
    var _cxExisting = null;
    try { _cxExisting = pd.getElementById('__cxPanel'); } catch (e) { swallow(e); }
    if (_cxExisting) { _cxPanel = _cxExisting; return _cxExisting; }   // 已存在(别的 frame 建的)：直接复用，全站唯一
    // 修复 #16：body 尚未就绪时，面板若被立即构建会游离在 DOM 之外（pd.body.appendChild
    // 跳过），_cxPanel 即使被赋值也不可见。改为 deferred：等 DOMContentLoaded / rAF 后再构建，
    // 期间返回 null，调用方均已对 null 做了安全处理（if (_cxPanel) ...）。
    if (!pd.body) {
      try {
        var _cxBuildLater = function () { if (!_cxPanel && pd.body) ensurePanel(); };
        if (pd.readyState === 'loading') {
          pd.addEventListener('DOMContentLoaded', _cxBuildLater, { once: true });
        } else {
          requestAnimationFrame(_cxBuildLater);
        }
      } catch (e) { swallow(e); }
      return null;
    }
    var el = pd.createElement('div');
    el.id = '__cxPanel';
    el.style.cssText = 'position:fixed;right:12px;top:12px;z-index:2147483647;width:288px;max-height:calc(100vh - 24px);overflow-y:auto;background:rgba(20,22,28,.96);color:#e8e8e8;font:13px/1.5 sans-serif;border:1px solid #3a3f4b;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.45);padding:12px;user-select:none;';
    el.innerHTML =
      // 标题栏（关闭按钮 + 版本）
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<b style="font-size:14px;">学习通·主控面板 <span id="__cxVer" style="color:#6b7280;font-weight:normal;font-size:11px;"></span></b>' +
        '<span id="__cxPanelClose" style="cursor:pointer;padding:0 6px;font-size:18px;line-height:1;">×</span>' +
      '</div>' +
      // 命令输入栏（v4.7 命令面板）：输入 / 唤起命令下拉，支持参数与 ↑↓/Tab/Enter/Esc
      '<div style="position:relative;margin-bottom:8px;">' +
        '<input id="__cxCmd" type="text" placeholder="输入 / 唤起命令…" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:6px 8px;background:#1a1d24;color:#e8e8e8;border:1px solid #3a3f4b;border-radius:6px;font-size:12px;outline:none;">' +
        '<div id="__cxCmdList" style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;max-height:200px;overflow-y:auto;background:#1a1d24;border:1px solid #3a3f4b;border-radius:6px;z-index:10;"></div>' +
      '</div>' +
      // 顶部导航栏（主从式布局）：点击切换下方内容区块
      '<div class="cx-nav" style="display:flex;gap:4px;margin-bottom:8px;">' +
        '<button class="cx-nav-btn" data-tab="pause" style="flex:1;padding:6px;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:6px;cursor:pointer;font-size:12px;">暂停设置</button>' +
        '<button class="cx-nav-btn" data-tab="sub" style="flex:1;padding:6px;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:6px;cursor:pointer;font-size:12px;">副面板</button>' +
        '<button class="cx-nav-btn" data-tab="adv" style="flex:1;padding:6px;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:6px;cursor:pointer;font-size:12px;">高级</button>' +
        '<button class="cx-nav-btn" data-tab="other" style="flex:1;padding:6px;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:6px;cursor:pointer;font-size:12px;">其他</button>' +
      '</div>' +
      // 区块：暂停设置
      '<div id="__cxTab_pause" class="cx-tab">' +
        '<button id="__cxBtnPause" style="width:100%;padding:9px;margin-bottom:8px;background:#2d6cdf;color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;">暂停 / 恢复</button>' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;">自动停止计时 (分钟): <b id="__cxAutoVal">0</b>' +
          '<input id="__cxAuto" type="range" min="0" max="120" step="1" value="0" style="width:100%;"></label>' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;">暂停后自动恢复 (分钟): <b id="__cxResumeVal">0</b>' +
          '<input id="__cxResume" type="range" min="0" max="60" step="1" value="0" style="width:100%;"></label>' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxLoop" type="checkbox" style="vertical-align:middle;margin-right:6px;">循环播放（播完从头重播）</label>' +
        '<div style="border-top:1px solid #3a3f4b;margin-top:8px;padding-top:8px;">' +
          '<div style="font-size:11px;color:#9aa0a8;margin-bottom:4px;">视频开关（逐个续播/暂停 · ★=前台）</div>' +
          '<div id="__cxVideoList" style="max-height:190px;overflow-y:auto;"></div>' +   // 超过 5 个视频时滚动兜住（>5 的折叠/分页方案另做打算）
        '</div>' +
      '</div>' +
      // 区块：副面板（内嵌副脚本 + 副面板）
      '<div id="__cxTab_sub" class="cx-tab">' +
        '<div id="__cxAddonsWrap" style="border-top:1px solid #3a3f4b;margin-top:4px;padding-top:8px;">' +
          '<div style="font-size:11px;color:#9aa0a8;margin-bottom:6px;">副脚本（已接入主面板）</div>' +
          '<div id="__cxAddons"></div>' +
        '</div>' +
        '<div id="__cxSubPanelsWrap" style="border-top:1px solid #3a3f4b;margin-top:8px;padding-top:8px;">' +
          '<div style="font-size:11px;color:#9aa0a8;margin-bottom:6px;">副面板（内嵌显示，可折叠）</div>' +
          '<div id="__cxSubPanels"></div>' +
        '</div>' +
      '</div>' +
      // 区块：高级（视频信息 + 全局诊断 + 高级控制）
      '<div id="__cxTab_adv" class="cx-tab">' +
        // 视频信息（v4.7 起从顶部移入高级）：当前视频状态/进度/已看
        '<div style="border-top:1px solid #3a3f4b;margin-top:4px;padding-top:8px;">' +
          '<div style="font-size:11px;color:#9aa0a8;margin-bottom:4px;">视频信息</div>' +
          '<div id="__cxPanelState" style="font-size:12px;color:#9aa0a8;margin-bottom:8px;word-break:break-all;white-space:pre-line;"></div>' +
        '</div>' +
        '<div id="__cxPanelInfo" style="font-size:11px;color:#8b93a1;margin-bottom:10px;white-space:pre-line;background:rgba(0,0,0,.25);padding:6px;border-radius:4px;"></div>' +
        '<label id="__cxRescanRow" style="display:block;margin-bottom:6px;font-size:12px;">轮询间隔 (ms): <b id="__cxRescanVal">2000</b>' +
          '<input id="__cxRescan" type="range" min="500" max="5000" step="500" value="2000" style="width:100%;"></label>' +
        '<label id="__cxEndRelRow" style="display:block;margin-bottom:6px;font-size:12px;">进度到底释放 (秒): <b id="__cxEndRelVal">15</b>' +
          '<input id="__cxEndRel" type="range" min="0" max="120" step="5" value="15" style="width:100%;"></label>' +
        '<div id="__cxRateRow" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;">' +
          '<span>播放速率</span>' +
          '<span><b id="__cxRateVal">' + (CONFIG.USER_RATE || 1) + 'x</b>' +
          '<select id="__cxRate" style="font-size:12px;margin-left:6px;">' +
            '<option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option>' +
            '<option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="1.75">1.75x</option><option value="2">2x</option>' +
          '</select></span>' +
        '</div>' +
        '<label id="__cxDebugRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxDebug" type="checkbox" style="vertical-align:middle;margin-right:6px;">调试日志 (DEBUG → 控制台)</label>' +
      '</div>' +
      // 区块：其他（反馈 / 帮助）
      '<div id="__cxTab_other" class="cx-tab">' +
        '<button id="__cxBtnCopy" style="width:100%;padding:7px;margin-top:4px;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:6px;cursor:pointer;font-size:12px;">复制诊断信息（反馈用）</button>' +
        '<div style="font-size:11px;color:#6b7280;margin-top:6px;">按 <b>P</b> 开关本面板 · <b>Esc</b> 关闭 · 0 = 禁用</div>' +
      '</div>';
    if (pd.body) pd.body.appendChild(el);
    // —— 移动端适配：窄屏下主控面板自适应宽度、放大点按区、缩小字号（仅注入一次）——
    if (!pd.getElementById('__cxPanelMobileStyle')) {
      try {
        var ms = pd.createElement('style');
        ms.id = '__cxPanelMobileStyle';
        ms.textContent =
          '@media (max-width:480px){' +
            '#__cxPanel{left:8px!important;right:8px!important;top:8px!important;width:auto!important;max-width:none!important;max-height:calc(100vh - 16px)!important;overflow-y:auto!important;font-size:12px!important;padding:10px!important;}' +
            '#__cxPanel button{padding:11px!important;font-size:13px!important;}' +
            '#__cxPanel .cx-nav-btn{padding:9px!important;}' +
            '#__cxPanel input[type=range]{height:22px;}' +
            '#__cxPanel #__cxAddons .cx-course button,#__cxPanel #__cxSubPanels button{padding:8px 12px!important;font-size:13px!important;}' +
          '}';
        if (pd.head) pd.head.appendChild(ms);
      } catch (e) { swallow(e); }
    }
    el.querySelector('#__cxPanelClose').addEventListener('click', hidePanel);
    // —— 命令面板（v4.7）：输入 / 唤起命令下拉，↑↓/Tab/Enter/Esc ——
    var cmdInp = el.querySelector('#__cxCmd');
    if (cmdInp) {
      cmdInp.addEventListener('input', _cxCmdOnInput);
      cmdInp.addEventListener('keydown', _cxCmdOnKey);
      cmdInp.addEventListener('blur', _cxCmdOnBlur);
      cmdInp.addEventListener('focus', _cxCmdUpdate);
      // 鼠标点击命令项：用 mousedown + preventDefault 抢在 input blur 之前执行，避免点击被吞（修复点击无效）
      var cmdListEl = el.querySelector('#__cxCmdList');
      if (cmdListEl) {
        cmdListEl.addEventListener('mousedown', function (ev) {
          ev.preventDefault();   // 阻止 input 失焦，保证点击生效
          var item = ev.target && ev.target.closest ? ev.target.closest('[data-ci]') : null;
          if (!item) return;
          var idx = +item.getAttribute('data-ci');
          var c = _cxCmdFilter[idx];
          if (!c) return;
          if (c.args) { cmdInp.value = '/' + c.name + ' '; try { cmdInp.focus(); var L = cmdInp.value.length; cmdInp.setSelectionRange(L, L); } catch (ee) { swallow(ee); } _cxCmdRender(_cxCmdFilter, idx); }
          else { cmdInp.value = '/' + c.name; executeRawCmd('/' + c.name); hideCmdList(); cmdInp.value = ''; }
        });
      }
    }
    el.querySelector('#__cxBtnPause').addEventListener('click', function () {
      var v = currentVideo(); if (!v) { toast('无目标视频'); return; }
      if (v.__cxUserPaused) userResume(v); else userPause(v);
      refreshPanelState();
    });
    // 视频列表：事件委托，逐个暂停/恢复（修复"多视频下只能控制单个视频"）
    var vlist = el.querySelector('#__cxVideoList');
    if (vlist) vlist.addEventListener('click', function (ev) {
      try {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-vi]') : null;
        if (!btn) return;
        if (btn.getAttribute('data-dis')) return;          // 已结束视频的开关禁用，不可点
        var idx = +btn.getAttribute('data-vi');
        var vv = (_lastVideoList && _lastVideoList[idx]) || allVideos()[idx];
        if (!vv) return;
        if (vv.__cxUserPaused) userResume(vv); else userPause(vv);
        refreshPanelState();
      } catch (e) { swallow(e); }
    });
    var auto = el.querySelector('#__cxAuto');
    auto.addEventListener('input', function () { CONFIG.AUTO_STOP_MIN = +auto.value; savePanelCfg(); refreshPanelState(); });
    var res = el.querySelector('#__cxResume');
    res.addEventListener('input', function () { CONFIG.RESUME_AFTER_MIN = +res.value; savePanelCfg(); refreshPanelState(); });
    var resc = el.querySelector('#__cxRescan');
    resc.addEventListener('input', function () {
      CONFIG.RESCAN_INTERVAL = +resc.value;
      try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }   // 实时重启轮询，使间隔立即生效
      try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }
      savePanelCfg(); refreshPanelState();
    });
    var endrel = el.querySelector('#__cxEndRel');
    endrel.addEventListener('input', function () { CONFIG.END_RELEASE_SEC = +endrel.value; savePanelCfg(); refreshPanelState(); });
    var rateSel = el.querySelector('#__cxRate');
    if (rateSel) {
      rateSel.value = ('' + (CONFIG.USER_RATE || 1));
      rateSel.addEventListener('change', function () {
        var r = parseFloat(this.value);
        CONFIG.USER_RATE = (isNaN(r) ? 1 : r);
        clampCfg(); CONFIG.USER_RATE = (CONFIG.USER_RATE || 1);
        var rv = el.querySelector('#__cxRateVal'); if (rv) rv.textContent = CONFIG.USER_RATE + 'x';
        savePanelCfg(); applyUserRateAll();
        refreshPanelState();
      });
    }
    var dbg = el.querySelector('#__cxDebug');
    dbg.addEventListener('change', function () { try { DEBUG = !!dbg.checked; toast(DEBUG ? '调试日志已开' : '调试日志已关'); } catch (e) { swallow(e); } savePanelCfg(); });
    var lp = el.querySelector('#__cxLoop');
    if (lp) {
      lp.addEventListener('change', function () {
        CONFIG.LOOP_PLAY = !!lp.checked;
        try {
          if (CONFIG.LOOP_PLAY) toast('循环播放已开（当前视频播完将从头重播）');
          else toast('循环播放已关（恢复默认防重播）');
        } catch (e) { swallow(e); }
        savePanelCfg();
        applyLoopAll();        // 立即对当前所有视频施加 loop 状态，使开关即时生效（无需等下一轮重扫）
        refreshPanelState();
      });
    }
    // —— 主从式导航：切换下方内容区块（localStorage 记住当前 tab）——
    function switchTab(name) {
      if (!_cxPanel) return;
      try {
        var tabs = _cxPanel.querySelectorAll('.cx-tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].style.display = (tabs[i].id === '__cxTab_' + name) ? 'block' : 'none';
        var btns = _cxPanel.querySelectorAll('.cx-nav-btn');
        for (var j = 0; j < btns.length; j++) btns[j].style.background = (btns[j].getAttribute('data-tab') === name) ? '#2d6cdf' : '#3a3f4b';
        try { localStorage.setItem('cx_panel_tab', name); } catch (e2) { swallow(e2); }
        _cxActiveTab = name;
      } catch (e) { swallow(e); }
    }
    var navBtns = el.querySelectorAll('.cx-nav-btn');
    for (var ni = 0; ni < navBtns.length; ni++) {
      (function (b) { b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); }); })(navBtns[ni]);
    }
    el.querySelector('#__cxBtnCopy').addEventListener('click', copyDiagnostics);
    _cxPanel = el;
    syncPanelInputs();
    drainAddonQueue();   // v4.0：面板建成后渲染已注册的副脚本开关（含晚于本脚本注册的）
    switchTab(_cxActiveTab || 'pause');   // 主从式导航：应用上次选中的区块（默认 暂停设置）
    positionPanel();   // 适配 progress-panel：若其已挂载，则下沉避让避免同角重叠
    return el;
  }
  // 精简模式已移除（v4.4）：改用主从式导航分区块，所有控件常显，不再需要 applyCompact 隐藏/显示。
  function syncPanelInputs() {                     // 把 CONFIG / 版本 / DEBUG 当前值回填到面板控件
    if (!_cxPanel) return;
    try {
      var auto = _cxPanel.querySelector('#__cxAuto'); if (auto) { auto.value = CONFIG.AUTO_STOP_MIN; _cxPanel.querySelector('#__cxAutoVal').textContent = CONFIG.AUTO_STOP_MIN; }
      var res = _cxPanel.querySelector('#__cxResume'); if (res) { res.value = CONFIG.RESUME_AFTER_MIN; _cxPanel.querySelector('#__cxResumeVal').textContent = CONFIG.RESUME_AFTER_MIN; }
      var resc = _cxPanel.querySelector('#__cxRescan'); if (resc) { resc.value = CONFIG.RESCAN_INTERVAL; _cxPanel.querySelector('#__cxRescanVal').textContent = CONFIG.RESCAN_INTERVAL; }
      var endrel = _cxPanel.querySelector('#__cxEndRel'); if (endrel) { endrel.value = CONFIG.END_RELEASE_SEC; _cxPanel.querySelector('#__cxEndRelVal').textContent = CONFIG.END_RELEASE_SEC; }
      var rateSel = _cxPanel.querySelector('#__cxRate'); if (rateSel) { rateSel.value = ('' + (CONFIG.USER_RATE || 1)); var rv = _cxPanel.querySelector('#__cxRateVal'); if (rv) rv.textContent = (CONFIG.USER_RATE || 1) + 'x'; }
      var dbg = _cxPanel.querySelector('#__cxDebug'); if (dbg) dbg.checked = !!DEBUG;
      var lp = _cxPanel.querySelector('#__cxLoop'); if (lp) lp.checked = !!CONFIG.LOOP_PLAY;
      var ver = _cxPanel.querySelector('#__cxVer'); if (ver) ver.textContent = 'v' + SCRIPT_VERSION;
    } catch (e) { swallow(e); }
  }
  function refreshPanelLabels() {                   // 拖动滑块时实时刷新旁边的数值文字（syncPanelInputs 仅在面板创建时回填一次，否则显示滞后）
    if (!_cxPanel) return;
    try {
      var map = [['#__cxAutoVal', CONFIG.AUTO_STOP_MIN], ['#__cxResumeVal', CONFIG.RESUME_AFTER_MIN], ['#__cxRescanVal', CONFIG.RESCAN_INTERVAL], ['#__cxEndRelVal', CONFIG.END_RELEASE_SEC]];
      for (var i = 0; i < map.length; i++) { var n = _cxPanel.querySelector(map[i][0]); if (n) n.textContent = map[i][1]; }
    } catch (e) { swallow(e); }
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
    L.push('CONFIG: AUTO_STOP_MIN=' + CONFIG.AUTO_STOP_MIN + ' RESUME_AFTER_MIN=' + CONFIG.RESUME_AFTER_MIN + ' RESCAN_INTERVAL=' + CONFIG.RESCAN_INTERVAL + ' END_RELEASE_SEC=' + CONFIG.END_RELEASE_SEC + ' LOOP_PLAY=' + CONFIG.LOOP_PLAY + ' PAUSE_HOTKEY=' + CONFIG.PAUSE_HOTKEY + ' DEBUG=' + DEBUG);
    var fg = foregroundVideo();
    L.push('前台(可见·面积最大): ' + (fg ? ('#' + (vs.indexOf(fg) + 1)) : '无(无可见视频→本帧不强制续播)'));
    L.push('=== 视频列表(' + vs.length + ') ===');
    for (var i = 0; i < vs.length; i++) {
      try {
        var v = vs[i];
        var st = v.ended ? 'ended' : (v.paused ? 'paused' : 'playing');
        L.push('#' + (i + 1) + (v === fg ? '★前台' : '') + ' ' + st +
          ' rate=' + v.playbackRate + ' loop=' + v.loop +
          ' ForcePaused=' + !!v.__cxForcePaused + ' UserPaused=' + !!v.__cxUserPaused +
          ' Released=' + !!v.__cxReleased + ' EndedLock=' + !!v.__cxEndedLock +
          ' 原生pause=' + !!v.__np + ' nearEnd=' + nearEnd(v) + ' keep=' + !!v.__cxUserKeep +
          ' 进度=' + fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? '/' + fmtTime(v.duration) : '') +
          ' 已看=' + ((v.__cxWatchMs || 0) / 60000).toFixed(1) + 'min' +
          ' isRebuildFinished=' + isRebuildFinished(v) +
          ' src=' + shortSrc(v));
      } catch (e) { swallow(e); }
    }
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
    try {
      var info = _cxPanel.querySelector('#__cxPanelInfo');
      if (info) {
        var vs = allVideos();
        var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
        var heap = m ? ((m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB') : 'n/a';
        var bridge = (BRIDGE && BRIDGE.base) ? ('已连 ' + BRIDGE.base + (BRIDGE.version ? ' v' + BRIDGE.version : '')) : '离线';
        info.textContent =
          'v' + SCRIPT_VERSION + ' · 视频 ' + vs.length + ' · moQueue ' + _moQueue.length + ' · ended ' + Object.keys(ENDED_SRCS).length + '\n' +
          'heap ' + heap + '\n' +
          '桥 ' + bridge + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter) + '\n' +
          '定向 enabled=' + (TARGET && TARGET.enabled) + ' 命中=' + (TARGET && TARGET.matchedAny) + ' 0命中 ' + _targetMissStreak + '/' + TARGET_FALLBACK_ROUNDS + '\n' +
          '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms · 热键 P';
      }
    } catch (e) { swallow(e); }
    renderVideoList();                  // 实时刷新逐视频控制列表
  }
  function renderVideoList() {          // 逐视频暂停/恢复：修复"多视频下只能控制单个视频"的缺陷
    if (!_cxPanel) return;
    var wrap = _cxPanel.querySelector('#__cxVideoList');
    if (!wrap) return;
    var vs = allVideos(), fg = foregroundVideo();
    _lastVideoList = vs;
    var html = '';
    if (!vs.length) html = '<div style="font-size:11px;color:#6b7280;">未发现视频</div>';
    for (var i = 0; i < vs.length; i++) {
      try {
        var v = vs[i];
        var isEnded = v.ended;
        var on = !v.__cxUserPaused && !v.paused && !isEnded;   // 开关 ON = 当前处于续播/播放态（蓝）；OFF = 暂停（灰）
        var star = (v === fg) ? '★' : '';
        var tag = isEnded ? '[结束]' : (v.__cxUserPaused ? '[暂停]' : (v.__cxForcePaused ? '[续播]' : ''));
        var trackBg = isEnded ? '#2a2e37' : (on ? '#3b82f6' : '#4b5563');
        var knobLeft = isEnded ? '2px' : (on ? '16px' : '2px');
        var cur = isEnded ? 'default' : 'pointer';
        html += '<div style="display:flex;align-items:center;gap:8px;margin:5px 0;font-size:11px;">' +
          '<span data-vi="' + i + '"' + (isEnded ? ' data-dis="1"' : '') + ' title="点击切换续播/暂停" style="display:inline-block;width:32px;height:18px;border-radius:9px;position:relative;flex:0 0 auto;cursor:' + cur + ';background:' + trackBg + ';">' +
            '<span style="position:absolute;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;left:' + knobLeft + ';"></span>' +
          '</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (star ? 'color:#5ea0ff;' : '') + (isEnded ? 'color:#6b7280;' : '') + '">#' + (i + 1) + star + ' ' + tag + ' ' + shortSrc(v) + '</span>' +
          '</div>';
      } catch (e) { swallow(e); }
    }
    wrap.innerHTML = html;
  }
  function positionPanel() {                      // 进度面板已内嵌为副面板（progress-panel v3.2 起），不再有独立浮动窗需要避让；保留空壳以维持 showPanel/ensurePanel 调用一致
  }
  function showPanel() { try { ensurePanel(); if (_cxPanel) { _cxPanel.style.display = 'block'; syncPanelInputs(); positionPanel(); refreshPanelState(); } } catch (e) { swallow(e); } }
  function hidePanel() { if (_cxPanel) _cxPanel.style.display = 'none'; }
  function togglePanel() { if (_cxPanel && _cxPanel.style.display !== 'none') hidePanel(); else showPanel(); }

  // 递归扫描原语已统一到上方 MODULE: 视频枚举(walkVideos / scanVideos / allVideos)。

  // 首次安装：先拉桥清单（异步、失败静默），再刷新定向目标（读 window.attachments），再扫描
  try { hookAttachments(); } catch (e) { swallow(e); }   // #1：安装 setter 钩子，attachments 异步到达即重建白名单
  try { bridgeInit(); } catch (e) { swallow(e); }
  try { refreshTargets(); } catch (e) { swallow(e); }
  try { scanVideos(document); neutralizeGlobalPause(window); } catch (e) { swallow(e); }

  // 低频全量重扫：应对平台重定义 pause / 原型硬调用 / DOM 换血（间隔由 CONFIG.RESCAN_INTERVAL 控制，面板可实时调整）
  function _loopTick() {                            // 提取为命名函数：使面板改 RESCAN_INTERVAL 时能 clearInterval 后重启立即生效
    try { refreshTargets(); } catch (e) { swallow(e); }                 // 重置 matchedAny 并重建任务点 id 集
    try { scanVideos(document); neutralizeGlobalPause(window); } catch (e) { swallow(e); }
    // 【易误判·诊断#六】此处每轮重装是 F-B4 刻意设计（防 use strict 下描述符被平台还原绕过），切勿改为"仅首装幂等"，否则还原该缺陷。
    try { installPrototypePauseNeutralize(); } catch (e) { swallow(e); }   // F-B4：每轮重新 neutralize 原型 pause，防个别页 use strict 下描述符被平台还原绕过
    // 定向启用但本轮无任何 video 命中：不在本轮回退（避免章节切换间隙 / 视频延迟渲染的瞬时空窗触发
    // 定向↔全量横跳、误强播广告/插播）。连续 N 轮稳定 0 命中才判定"白名单失效"回退全量（专项诊断#三，迟滞）。
    try {
      if (TARGET.enabled && !TARGET.matchedAny) {
        if (++_targetMissStreak >= TARGET_FALLBACK_ROUNDS) { dbg('定向连续 ' + _targetMissStreak + ' 轮 0 命中，回退全续播'); TARGET.enabled = false; }
      } else { _targetMissStreak = 0; }
    } catch (e) { swallow(e); }
    // 内存埋点（切屏崩溃观测）：DEBUG 时每 30 轮（~1min）采样一次，持续观察 heap 与队列趋势
    if (DEBUG && (++_memPoll % 30) === 0) { try { _memSample('loop'); } catch (e) { swallow(e); } }
    // 观看计时始终运行（修复面板"已看"恒为 0：原先仅 AUTO_STOP_MIN>0 才累计）；自动暂停判定在 tick 内部按开关生效
    try { autoStopTick(); } catch (e) { swallow(e); }
    if (CONFIG.RESUME_AFTER_MIN > 0) { try { resumeTick(); } catch (e) { swallow(e); } }
    try { applyUserRateAll(); } catch (e) { swallow(e); }   // 周期性把用户倍速施加到所有视频，压制平台把 playbackRate 重置回 1x（防倍速形同虚设）
    if (_cxPanel && _cxPanel.style.display !== 'none') { try { refreshPanelState(); } catch (e) { swallow(e); } }  // 面板可见时实时刷新状态
  }
  var _loopTimer = null;
  try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }

  // ===== MODULE: 命令面板（v4.7）=====
  // 在控制面板内提供「/命令」输入：输入 / 唤起下拉、↑↓ 选择、Tab 补全、Enter 执行、Esc 关闭下拉。
  // 命令可带参数（如 /rate 2 /autostop 5）；无参数命令鼠标点击即执行，有参数命令点击后填入待补全。
  // registerCommand 同时暴露到 window.__cxRegisterCommand，供副脚本/其它脚本扩展命令。
  var _cxCommands = [];                 // [{name, desc, args, exec}]
  var _cxCmdFilter = [];                // 当前过滤后的命令（用于 ↑↓ 高亮）
  var _cxCmdHi = -1;                    // 高亮索引（过滤列表内）
  function registerCommand(name, desc, hasArgs, exec) {   // name 不含斜杠；exec(rawInput, argStr)
    name = ('' + (name || '')).replace(/^\//, '').trim().toLowerCase();
    if (!name) return;
    for (var i = 0; i < _cxCommands.length; i++) { if (_cxCommands[i].name === name) { _cxCommands[i].desc = desc; _cxCommands[i].args = !!hasArgs; _cxCommands[i].exec = exec; return; } }
    _cxCommands.push({ name: name, desc: desc || '', args: !!hasArgs, exec: exec });
  }
  function executeRawCmd(raw) {         // 解析并执任何输入（含参数），下拉关闭与否都执行——修复「参数命令下拉关闭后 Enter 不执行」
    raw = ('' + (raw || '')).trim();
    if (!raw) { toast('请输入命令，如 /pause（输入 / 查看全部）'); return false; }
    var sp = raw.indexOf(' ');
    var head = (sp < 0 ? raw : raw.slice(0, sp)).replace(/^\//, '').toLowerCase();
    var arg = (sp < 0 ? '' : raw.slice(sp + 1)).trim();
    if (!head) { toast('请输入命令名称，如 /pause'); return false; }
    for (var i = 0; i < _cxCommands.length; i++) {
      if (_cxCommands[i].name === head) {
        try { _cxCommands[i].exec(raw, arg); } catch (e) { swallow(e); toast('命令执行出错: ' + head); }
        return true;
      }
    }
    toast('未知命令: /' + head + '（输入 / 查看全部）');
    return false;
  }
  function _videoByArg(arg) {           // 参数为空→前台/当前视频；数字→该序号视频
    if (!arg) { var v = currentVideo(); if (!v) { toast('未找到当前视频，无法执行'); return undefined; } return v; }
    var n = parseInt(arg, 10); if (isNaN(n)) { toast('参数需为数字序号，如 /pause 2'); return undefined; }
    var vs = allVideos(); var v = vs[n - 1];
    if (!v) { toast('无第 ' + n + ' 个视频（共 ' + vs.length + ' 个）'); return undefined; }
    return v;
  }
  function initBuiltinCommands() {      // 注册内置命令（幂等）
    if (_cxCommands.length) return;     // 已注册则跳过，避免重复
    registerCommand('pause', '暂停视频（可带序号，如 /pause 2）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userPause(v); refreshPanelState(); toast('已暂停视频');
    });
    registerCommand('resume', '恢复续播（可带序号）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userResume(v); refreshPanelState(); toast('已恢复续播');
    });
    registerCommand('loop', '循环播放 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); CONFIG.LOOP_PLAY = on; clampCfg(); applyLoopAll(); syncPanelInputs(); refreshPanelState(); toast('循环播放 ' + (on ? '开' : '关'));
    });
    registerCommand('rate', '设置播放速率，如 /rate 1.5', true, function (raw, arg) {
      var r = parseFloat(arg); if (isNaN(r)) { toast('用法: /rate 0.5~2'); return; } CONFIG.USER_RATE = r; clampCfg(); applyUserRateAll(); syncPanelInputs(); refreshPanelState(); toast('播放速率 ' + CONFIG.USER_RATE + 'x');
    });
    registerCommand('autostop', '自动停止计时(分钟)，如 /autostop 30', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { toast('用法: /autostop 0~120'); return; } CONFIG.AUTO_STOP_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); refreshPanelState(); toast('自动停止 ' + CONFIG.AUTO_STOP_MIN + ' 分钟');
    });
    registerCommand('autoresume', '暂停后自动恢复(分钟)，如 /autoresume 10', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { toast('用法: /autoresume 0~60'); return; } CONFIG.RESUME_AFTER_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); refreshPanelState(); toast('自动恢复 ' + CONFIG.RESUME_AFTER_MIN + ' 分钟');
    });
    registerCommand('debug', '调试日志 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); DEBUG = on; savePanelCfg(); toast('调试日志 ' + (on ? '开' : '关'));
    });
    registerCommand('copy', '复制诊断信息', false, function () { copyDiagnostics(); });
    registerCommand('refresh', '立即重扫视频与状态', false, function () { try { _loopTick(); } catch (e) { swallow(e); } refreshPanelState(); toast('已重扫'); });
    registerCommand('rescan', '重启轮询(ms)，如 /rescan 1000', true, function (raw, arg) {
      var ms = parseInt(arg, 10); if (isNaN(ms)) { toast('用法: /rescan 500~5000'); return; } CONFIG.RESCAN_INTERVAL = ms; clampCfg(); savePanelCfg();
      try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }
      try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }
      syncPanelInputs(); refreshPanelState(); toast('轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms');
    });
    registerCommand('help', '显示命令帮助', false, function () {
      var names = _cxCommands.map(function (c) { return '/' + c.name + (c.args ? ' …' : ''); }).join('  ');
      toast('命令: ' + names);
      _cxCmdShowAll && _cxCmdShowAll();
    });
    registerCommand('close', '关闭面板', false, function () { hidePanel(); });
    registerCommand('hide', '关闭面板', false, function () { hidePanel(); });
  }
  // —— 下拉渲染与交互（依赖面板内 #__cxCmd / #__cxCmdList，缺失时安全降级）——
  function _cxCmdRender(list, hi) {
    var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList'); if (!box) return;
    _cxCmdFilter = list; _cxCmdHi = hi;
    if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      html += '<div data-ci="' + i + '" style="padding:6px 8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
        (i === hi ? 'background:#2d6cdf;color:#fff;' : 'color:#e8e8e8;') + '"' +
        ' title="' + (c.desc || ('/' + c.name)) + '">' +
        '<b>/' + c.name + '</b>' + (c.args ? ' …' : '') +
        (c.desc ? ' <span style="color:' + (i === hi ? '#dbeafe' : '#8b93a1') + ';">— ' + c.desc + '</span>' : '') +
        '</div>';
    }
    box.innerHTML = html; box.style.display = 'block';
  }
  function _cxCmdUpdate() {
    var inp = _cxPanel && _cxPanel.querySelector('#__cxCmd'); if (!inp) return;
    var q = ('' + (inp.value || '')).trim().toLowerCase();
    if (!q) { _cxCmdRender(_cxCommands.slice(), -1); return; }
    var head = q.replace(/^\//, '');
    var list = [];
    for (var i = 0; i < _cxCommands.length; i++) { if (_cxCommands[i].name.indexOf(head) === 0) list.push(_cxCommands[i]); }
    if (!list.length) { for (var j = 0; j < _cxCommands.length; j++) { if (_cxCommands[j].name.indexOf(head) >= 0) list.push(_cxCommands[j]); } }
    _cxCmdRender(list, list.length ? 0 : -1);
  }
  function _cxCmdShowAll() { var inp = _cxPanel && _cxPanel.querySelector('#__cxCmd'); if (inp) inp.focus(); _cxCmdUpdate(); }
  function _cxCmdOnInput() { _cxCmdUpdate(); }
  function _cxCmdOnKey(e) {
    var inp = e.target; if (!inp) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (_cxCmdFilter.length) { _cxCmdHi = (_cxCmdHi + 1) % _cxCmdFilter.length; _cxCmdRender(_cxCmdFilter, _cxCmdHi); } return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (_cxCmdFilter.length) { _cxCmdHi = (_cxCmdHi - 1 + _cxCmdFilter.length) % _cxCmdFilter.length; _cxCmdRender(_cxCmdFilter, _cxCmdHi); } return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      var pick = (_cxCmdHi >= 0 && _cxCmdFilter[_cxCmdHi]) ? _cxCmdFilter[_cxCmdHi] : (_cxCmdFilter[0] || null);
      if (pick) { inp.value = '/' + pick.name + ' '; _cxCmdHi = -1; _cxCmdRender(_cxCmdFilter, -1); try { inp.focus(); var L = inp.value.length; inp.setSelectionRange(L, L); } catch (ee) { swallow(ee); } }
      return;
    }
    if (e.key === 'Enter') {
      // 若有高亮项且下拉中与输入一致则取之；否则直接按原始输入解析执行（覆盖「参数命令下拉关闭不执行」bug）
      e.preventDefault();
      if (_cxCmdHi >= 0 && _cxCmdFilter[_cxCmdHi] && (('/' + _cxCmdFilter[_cxCmdHi].name) === ('' + inp.value).trim())) {
        inp.value = '/' + _cxCmdFilter[_cxCmdHi].name + ' ';
      }
      var raw = inp.value;
      executeRawCmd(raw);
      hideCmdList(); inp.value = '';
      return;
    }
    if (e.key === 'Escape') {
      var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList');
      if (box && box.style.display !== 'none') { e.preventDefault(); e.stopPropagation(); hideCmdList(); }
      return;
    }
  }
  function hideCmdList() { var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList'); if (box) { box.style.display = 'none'; box.innerHTML = ''; } _cxCmdFilter = []; _cxCmdHi = -1; }
  function _cxCmdOnBlur() { hideCmdList(); }
  // _cxCommands 已在本 MODULE 顶部初始化完毕，此处调用 initBuiltinCommands 注册内置命令（执行顺序正确，不会被 var 初始化覆盖）
  try { initBuiltinCommands(); } catch (e) { swallow(e); }

  // 控制面板开关键：非输入框聚焦时按 PAUSE_HOTKEY 开/关悬浮控制面板（用户暂停开关的可视化控制，含暂停/恢复 + 计时器滑块）
  function keydownHandler(e) {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    if (e.key === 'Escape') { try { hidePanel(); } catch (e3) { swallow(e3); } return; }   // Esc 关闭面板
    if (!CONFIG.PAUSE_HOTKEY) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;  // 输入框内不触发，避免误触
    if (e.key && e.key.toLowerCase() === String(CONFIG.PAUSE_HOTKEY).toLowerCase()) {
      try { togglePanel(); e.preventDefault(); } catch (e2) { swallow(e2); }
    }
  }
  try {
    document.addEventListener('keydown', keydownHandler);
  } catch (e) { swallow(e); }

  // 即时接管：任何 video 一开始 play 即立刻 override，无需等 2s 轮询（吸收 browser-media-collector 的 play 捕获思路）。
  // 缩短动态插入播放器的接管空窗，使手动暂停开关对"新插入、尚未轮询到"的视频也可靠生效；overrideVideo 自身幂等且
  // 在 __cxUserPaused 时交还原生 pause 提前返回，故对暂停态/已接管视频无副作用。
  // 即时接管 play 事件（修复复审：同源 iframe 内视频的 play 事件不冒泡到顶层 document，需在 iframe 文档内也装一份）
  function installPlayWatch(doc) {
    if (!doc || !doc.addEventListener) return;
    try {
      doc.addEventListener('play', function (e) {
        try {
          if (e && e.target && e.target.tagName === 'VIDEO') {
            var _pv = e.target;
            // 用户暂停期间任何 play 事件（平台绕过闸门直接触发播放）→ 立即压回暂停，保证暂停锁真正锁得住
            if (_pv.__cxUserPaused) { try { (_pv.__np || NATIVE_PAUSE).call(_pv); } catch (e3) { swallow(e3); } return; }
            overrideVideo(_pv, foregroundVideo());   // 传前台，使非前台视频即时接管时被门控释放（修复多视频同播）
          }
        } catch (e2) { swallow(e2); }
      }, true);   // 捕获阶段，最先拿到 play 事件
    } catch (e) { swallow(e); }
  }
  try { installPlayWatch(document); } catch (e) { swallow(e); }   // 顶层文档

  // DOM 变动监听：覆盖动态插入的播放器 video。
  // 高频变动(弹幕/进度条批量更新)时，仅把新增 video 节点入队、合并到下一帧批量处理，避免主线程雪崩（吸收评审#2）。
  // 【易误判·诊断#九】对新增节点全子树 querySelectorAll('video') 看似浪费，但已合并到下一帧批量处理、且 video 仅现于视频容器内，
  //   实际开销极小；收窄选择器为低优可选优化，非缺陷，勿以"性能"为由过度重构。
  var _moQueue = [];
  var _moScheduled = false;
  function _moFlush() {
    _moScheduled = false;
    var q = _moQueue; _moQueue = [];
    var _fg = foregroundVideo();
    for (var i = 0; i < q.length; i++) { try { overrideVideo(q[i], _fg); } catch (e) { swallow(e); } }
  }
  // 内存埋点（切屏崩溃观测）：Chrome 专用 performance.memory。仅 DEBUG 时采样，关注 heap 与 _moQueue 长度（泄漏前兆）。
  // 注意：非 Chrome 无 performance.memory，s 显示 n/a；切屏前后各采一次可直接对比后台增长。
  var _memPoll = 0;
  function _memSample(tag) {
    try {
      var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
      var s = m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB/' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a';
      dbg('[mem] ' + tag + ' heap=' + s + ' moQueue=' + _moQueue.length + ' ended=' + Object.keys(ENDED_SRCS).length);
    } catch (e) { swallow(e); }
  }
  var _mo = null;   // MutationObserver 实例（审查 JS1-2：页面卸载时断开，避免孤立回调滞留）
  try {
    _mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          try { if (n.tagName === 'VIDEO') _moQueue.push(n); } catch (e) { swallow(e); }
          try {
            var vs = n.querySelectorAll ? n.querySelectorAll('video') : [];
            for (var k = 0; k < vs.length; k++) _moQueue.push(vs[k]);
          } catch (e) { swallow(e); }
        }
      }
      if (_moQueue.length > 1024) { try { _moFlush(); } catch (e) { swallow(e); } }   // 安全阀：极端高频/后台节流窗口兜底排空，防队列无限膨胀（专项#切屏崩溃）
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
  } catch (e) { swallow(e); }

  // 切回标签页时强制续播
  function visibilityHandler() {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    if (DEBUG) { try { _memSample('vis:' + document.visibilityState); } catch (e) { swallow(e); } }   // 切屏前后各采一次，直接对比后台增长
    if (document.visibilityState === 'visible') {
      try { scanVideos(document); } catch (e) { swallow(e); }
      try { neutralizeGlobalPause(window); } catch (e) { swallow(e); }   // 切回时一并中和 window.ananas.pause，防平台在隐藏期重置（吸收评审#5）
    }
  }
  try {
    document.addEventListener('visibilitychange', visibilityHandler, true);   // 捕获阶段，但绝不 stopPropagation
  } catch (e) { swallow(e); }

  // 监听器清理（审查 JS1-2）：页面卸载时断开 MutationObserver、清除轮询定时器、移除全局监听器，避免孤立回调滞留
  function cleanupListeners() {
    try { if (_mo && _mo.disconnect) _mo.disconnect(); } catch (e) { swallow(e); }
    try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }
    try { document.removeEventListener('keydown', keydownHandler); } catch (e) { swallow(e); }
    try { document.removeEventListener('visibilitychange', visibilityHandler, true); } catch (e) { swallow(e); }
  }
  try { window.addEventListener('pagehide', cleanupListeners); } catch (e) { swallow(e); }
  try { window.addEventListener('beforeunload', cleanupListeners); } catch (e) { swallow(e); }
})();
