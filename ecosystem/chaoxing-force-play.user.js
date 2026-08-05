// ==UserScript==
// @name         学习通·强制续播（主脚本）
// @namespace    https://github.com/cx-force-play/chaoxing-force-play
// @version      4.9
// @author       anon
// @description  钻入同源 iframe / Shadow DOM，覆盖 pause 为 no-op、ratechange 仅在 rate<=0.01 时拉回 1x、低频 2s 轮询兜底续播；无条件尊重 auto-next 的 __cxAN_hold 暂停锁。ended 状态采用持久锁(__cxEndedLock)覆盖 play 为 no-op、进度条锁末尾、seeking 守卫，并持续到元素被替换(阻断平台以 video.play()/重建元素/src 替换重播)，与 auto-next 的 ended 跳课协同(避免重播吃掉跳课时机)；劫持 navigator.mediaSession 应对锁屏续播。无视平台自定义暂停指令(window.ananas.pause / 直接 video.pause / playbackRate=0 伪暂停 / postMessage)。【定向续播】读取 页面全局 attachments 构建任务点视频白名单，仅对命中的任务点视频强制续播，跳过广告/插播视频；匹配规则整体失效时自动回退为全量续播。【重建去重】ended 时登记 currentSrc，任何地址命中的新 video 判定为同一已播完任务点的整元素重建并锁死不播，彻底杜绝跳课后的重播。【稳健性】定向匹配改边界正则(防 123 误命中 12345)、refreshTargets 加滞回(附件瞬时空窗不回退全量)、ENDED_SRCS 黑名单仅随真实章节切换清空。【v3.9 健壮性】MutationObserver 改为帧合并队列(防高频雪崩)、loop 持续断言(防循环重播)、可见性切回复位 全局暂停封装、mediaSession 态改 playing、safePlay 静音重试后恢复音量、定向匹配正则按 URL 边界[/?&=.#]收紧。【v3.10 健壮性】neutralizeGlobalPause 改 defineProperty+描述符探测(严格模式不再静默失效)、重建去重补齐祖先 iframe src 关掉 currentSrc 未就绪时间窗、直播 duration=Infinity 加 isFinite 守卫、for...in 改 Object.keys、hasVideo 仅计 video、querySelectorAll 微优化为 getElementsByTagName、清死代码(__rp/重复 pauseNoop/不可达 TARGETED 分支)。【v3.11 复核修复】keyRe 回退 [^A-Za-z0-9](撤销纯损的 [/?&=.#] 收窄，防漏匹 lesson_123/clip-123)、iframe src 仅限承载任务 id 的播放器 iframe 进黑名单(防通用 shell iframe 误锁)、neutralizeGlobalPause 改 defineProperty 直接遮蔽(覆盖继承属性)、删死配置 TARGETED 与死字段 hasVideo/__cxSkip、safePlay 音量恢复改 playing 事件驱动(避免提前取消静音)。【v3.12 复核修复】safePlay 的 restore 监听器改用 {once:true} 注册(消除 addEventListener(capture) 与 removeEventListener 缺 capture 标志不匹配导致的监听器永久累积泄漏)、videoIframeSrcsOf 改用 keyRe 边界匹配(与 videoBelongsToTask 统一，避免裸子串误收通用 iframe)。【v3.14 抗失效】①定向续播：安装 页面全局 attachments setter 钩子(AJAX 异步到达即重建白名单，不等 2s 轮询)，attachments 永不出现时由桥 objectids 独立撑起白名单(防"无米之炊")；②重建去重：指纹由仅 video.src/iframe.src 扩展为 iframe id/name/title/data-* 与 video 自身 id——抗 MSE 的 blob: 源(无 objectid)与通用 src 播放器重建；③防暂停：下沉到 HTMLMediaElement.prototype.pause(仅拦截 __cxForcePaused 视频)，连闭包/webpack 私有 pause() 也拦得住，未命中广告/插播仍可正常暂停，auto-next 经原生备份 v.__np 真正暂停。【v3.15 抗伪暂停/断流】①playbackRate 伪暂停下沉 HTMLMediaElement.prototype.playbackRate setter 拦截（对 __cxForcePaused 视频赋 0/极小速率直接改写为 1x，与 ratechange+轮询双重兜底，不采用 SourceBuffer Hook 以免花屏）；②MSE 断流：新增 waiting/stalled 事件监听，缓冲枯竭即 safePlay() 触发新一轮数据请求续播（不跳秒以免 seek 出错）。【v4.x 面板化】命令面板(/唤起、↑↓/Tab/Enter/Esc、星标收藏夹持久化)、运维仪表盘(实时 CPU/内存/网速监控)、Ninja 折叠态(胶囊居中图标+播放/暂停状态指示)、面板设置刷新后持久化、副脚本注册中心(可扩展命令与开关)；v4.9 面板位置策略锁定右上角安全位、禁用拖拽避免遮挡。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @run-at       document-idle
// @grant        none
// @compatible   Tampermonkey
// @compatible   Violentmonkey
// @compatible   Greasemonkey 4
// @license      MIT
// ==/UserScript==


// Built: 2026-08-05T13:36:35+08:00  commit: e654c5c  minify: off


(function () {
  'use strict';

  // 幂等守卫（审查#5：全局定时器/监听器从不清理 → 防止脚本被重复注入产生双倍 setInterval/监听器）：
  // 每个 frame(window) 仅初始化一次；多 frame 各自独立运行，不影响视频页面板可见性（v3.35 已撤销整体 return 守卫）。
  if (!window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY = {};   // 命名空间：非契约全局收敛于此（__cxAddonQueue/__cxRegisterAddon/__cxRegisterCommand 是副脚本注册契约，保留原 window.__cx* 名）
  if (window.__CX_FORCE_PLAY.started) return;
  window.__CX_FORCE_PLAY.started = true;

  // 诊断：全局捕获未处理错误，便于在浏览器控制台(F12)定位"脚本整体不执行/面板打不开"类问题。
  // 注意：必须置于幂等守卫之后注册——否则 Tampermonkey 重新安装/热重载时（started 已为 true、上方 return 跳过主逻辑），
  // 每次重装都会在此处重复叠加一个 error 监听，导致控制台错误日志逐次翻倍（幂等性缺陷 JS-幂等）。置于此处后每个页面生命周期仅注册一次。
  // 具名函数（架构·生命周期）：使 cleanupListeners / uninstall 可 removeEventListener，卸载后不残留监听。
  function globalErrorHandler(ev) {
    try { console.error('[CX-FORCE] 运行时错误:', ev.message, (ev.error && ev.error.stack) ? ev.error.stack : ''); } catch (e) {}
  }
  window.addEventListener('error', globalErrorHandler);

  // 注意：不在此处整体 return 掉同源 iframe 副本——超星播放器常嵌在同源 iframe 内，若直接退出则视频页里本脚本整段不执行、
  // 控制面板无法创建（用户反馈"有视频的页面打不开面板，无视频页可开"）。视频接管本身已被 __cxForcePaused 等标志幂等保护、
  // 顶层实例也会下钻同源 iframe 处理其视频，重复注入不会崩溃；桥/定时器重复开销极小且幂等，故每个匹配 frame 都完整运行以保证面板可见。


  // ===== 工具库（副程序）=====
  // 全局通用工具：调试日志 dbg / 静默容错 swallow。
  // 通用工具层：供核心与各功能模块（含副脚本 SDK）共享同一套日志/容错语义。
  // 【加载顺序陷阱·勿在本文件顶层即时调用 dbg()】本模块是构建顺序中的第一个，但 dbg 依赖的 DEBUG 声明在
  //   后加载的 meta-config/config.js。函数体内引用属运行时求值，安全；而在本文件顶层直接写 dbg('...') 会在
  //   脚本加载瞬间抛 ReferenceError，导致整个 IIFE 中断、脚本完全不执行。新增顶层语句时务必避开 DEBUG/CONFIG 等后置声明。
  // 可观测性：被 swallow 吞掉的错误计数与环形缓冲已迁至 state/metrics.js（可观测性状态层，与通用工具解耦）。
  // 本文件仅保留 swallow 写入侧逻辑；变量声明在 metrics.js（前向引用：utils 为首个模块、metrics 第 3 个，
  //   但 swallow 仅运行时调用且 IIFE 内 var 已 hoist，与 dbg→DEBUG 同型，安全）。
  function dbg() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[CX-FORCE]'].concat([].slice.call(arguments))); } catch (e) { swallow(e); }
  }
  function swallow(e, tag) {
    // 记录：始终计入，便于诊断（即使 DEBUG 关闭也保留可追溯性）
    _errCount++;
    try {
      _errBuf.push({ t: Date.now(), tag: tag || '?', msg: (e && e.message) ? e.message : String(e) });
      if (_errBuf.length > 50) _errBuf.shift();
    } catch (_) {}
    // 输出：仅 DEBUG 开启时打印，保持原有静默语义（DEBUG 关闭不影响线上行为）
    if (!DEBUG) return;
    try { console.warn('[CX-FORCE] ' + (tag || 'swallowed') + ':', (e && e.message) ? e.message : e); } catch (_) {}
  }

  // ===== 视频元素状态仓（WeakMap）=====
  // 把脚本“内部态”从视频/iframe/DOM 节点属性上移走，避免 DOM 节点属性污染：
  //  - 页面其他脚本遍历视频元素时不再可见未知属性；
  //  - 同名属性冲突（如平台也用 __ 前缀）风险消除；
  //  - 元素被垃圾回收时状态自动清理，无内存泄漏。
  // 注意：与副脚本的“跨脚本契约属性”必须留在节点上，不可移入 WeakMap：
  //  __cxForcePaused（tamper-guard 通过 prototype.pause.toString() 检测该字面量；且为原型级防暂停闸门）、
  //  __cxAN_hold（auto-next 写入）、__cxEndedLock（ended-notify 读取）、
  //  __cxUserPaused / __np（keyboard-shortcuts 读写）。
  var videoState = new WeakMap();
  function cxState(node) {
    var s = videoState.get(node);
    if (!s) { s = {}; videoState.set(node, s); }
    return s;
  }

  // ===== 错误容错收口（safeCall）=====
  // 把遍布全脚本的「try { fn(); } catch (e) { swallow(e); }」样板收口到一处：集中诊断、调用点更干净。
  // 返回 fn 的执行结果；异常已被 swallow 记录，调用点无需再包 try/catch。
  function safeCall(fn, tag) {
    try { return fn(); } catch (e) { swallow(e, tag || 'safeCall'); }
  }

  // ===== 频率控制（throttle / debounce）=====
  // 重 DOM 刷新（如 refreshPanelState）在高频事件（videos:scanned / panel:refresh / MutationObserver 兜底）下
  // 反复全量重绘会拖慢主线程。throttle 限频为「至少 wait ms 执行一次」并尾沿兜底补最后一帧；
  // debounce 则「停止触发 wait ms 后才执行」，适合输入类（搜索/滑块）场景。两者均不抛错（异常走 safeCall→swallow）。
  function throttle(fn, wait) {
    var last = 0, timer = null, ctxA = null, argsA = null;
    return function () {
      var now = Date.now(), ctx = this, args = arguments;
      var remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = now;
        safeCall(function () { fn.apply(ctx, args); }, 'throttle');
      } else if (!timer) {
        ctxA = ctx; argsA = args;
        timer = setTimeout(function () {
          last = Date.now(); timer = null;
          safeCall(function () { fn.apply(ctxA, argsA); }, 'throttle');
        }, remaining);
      }
    };
  }
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var ctx = this, args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        safeCall(function () { fn.apply(ctx, args); }, 'debounce');
      }, wait);
    };
  }

  // 接管策略开关（forcePlayEnabled / cxVideoOptOut）已迁至 biz/policy.js（业务·策略域），本文件不再持有。

  // ===== DOMAIN: utils/url (URL parsing helpers) =====
  // ===== MODULE: URL 解析 =====
  // 域：基础工具层 —— 与页面结构无关的纯 URL 解析，供定向(targeting)与本地桥(bridge)复用。
  // 【内聚性收敛】原寄居在 biz/targeting.js，与白名单业务、桥客户端混居；抽为独立工具后
  //   targeting / bridge 仅持有业务职责，URL 解析成为单一事实源（避免散落重复）。
  // 取顶层可访问的最上层同源窗口 href（跨 iframe 场景：播放页视频常嵌于同源 iframe，
  // 课程/章节参数挂在顶层路由上，必须从顶层读而非嵌入帧的 location）。
  function topHref() {
    var w = window, href = '';
    try {
      href = w.location.href;
      while (w.parent && w.parent !== w) { w = w.parent; href = w.location.href; }
    } catch (e) { swallow(e); }   // 跨域父帧读不到 href 即抛错，保留最近一层同源 href
    return href;
  }
  // 从 href 取首个匹配的参数值；兼容参数置于 hash（#kid=...）的新模板路由。
  function urlParam(href, names) {
    for (var i = 0; i < names.length; i++) {
      var m = href.match(new RegExp('[?&#]' + names[i] + '=([^&#]+)', 'i'));   // F-B5：兼容参数置于 hash（#kid=...）的新模板路由
      if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; } }
    }
    return null;
  }

  // ===== MODULE: 事件总线 + 状态镜像（原 P1「状态集中」）=====
  // ⚠️ 名实校准（架构审查）：本模块**当前的实际角色是事件总线**，而非名副其实的「状态集中层」。
  //   · 真正在用的能力：emit / onEv —— 如 bootstrap/main-loop.js 每轮发 'videos:scanned'、ui 层订阅刷新。
  //   · 名不副实的部分：Store.state 仅在 main-loop.js 末尾镜像了 TARGET/BRIDGE/ENDED_SRCS/_watchStats/_loopTimer
  //     这 5 个引用，而**全部业务调用点仍直接读写各自的顶层 var**，get/set 基本无人使用。
  //     故 Store.state 实为「只读调试快照」（便于诊断时一处查看核心状态），不是权威数据源。
  // 请勿据此误以为状态已收敛：修改状态时改的仍是各域顶层 var；对基本类型（如 _loopTimer 重启后的新 id）
  //   镜像不会自动同步，需在赋值处一并更新镜像。若将来要真正收敛，须逐个调用点迁移到 get/set，而非只加镜像。
  // 镜像语义：Store.state.X 与全局 X 指向同一对象引用（非拷贝），故对象内部字段的读写天然等价、零行为回归。
  var Store = (function () {
    var state = {};                 // 由各域声明后镜像注入（同引用，非拷贝）
    var subs = {};
    function get(k) { return state[k]; }
    function set(k, v, silent) {
      state[k] = v;
      if (!silent && subs[k]) subs[k].forEach(function (fn) { try { fn(v); } catch (e) { swallow(e, 'store.set'); } });
    }
    function on(k, fn) { (subs[k] = subs[k] || []).push(fn); }
    function emit(ev, payload) {   // P5c：透传变参（emit(ev, a, b) → fn(a, b)），向后兼容单 payload 调用
      var arr = subs['__ev:' + ev];
      if (arr) { var args = Array.prototype.slice.call(arguments, 1); arr.forEach(function (fn) { try { fn.apply(null, args); } catch (e) { swallow(e, 'store.emit'); } }); }
    }
    function onEv(ev, fn) { on('__ev:' + ev, fn); }
    return { state: state, get: get, set: set, on: on, emit: emit, onEv: onEv };
  })();

  // ===== MODULE: 运维指标与黑匣子（可观测性状态层）=====
  // 域：诊断 / 可观测性状态 —— 与续播业务逻辑无关，仅供面板仪表盘与黑匣子读取展示。
  // 归属说明（架构·作用域）：这些变量原先寄居在 biz/targeting.js 顶层，属于「诊断状态声明在业务模块」的
  //   归属错位，并把 targeting.js 的顶层 var 推到 18 个（占全项目一半）。现集中到状态层独立成模块。
  // 写入方：biz/playback.js（safePlay 计数）、biz/targeting.js 与 dom/dom.js（_bxLog 埋点）、ui/dashboard.js（采样累计）。
  // 读取方：ui/dashboard.js（仪表盘/Sparkline）、ui/panel-core.js（黑匣子列表与导出）。
  // 顺序无关性：本模块全部为顶层 var / 函数声明，与其余模块同处一个 IIFE 闭包，且所有使用点都在函数体内
  //   （运行时求值），故其在构建顺序中的位置不影响行为。

  // —— 运维仪表盘数据 ——
  var _moHistory = [];                        // MO 队列长度历史（最近 30 个采样点，用于 Sparkline）
  var _moHistMax = 30;                        // 历史采样点最大数量
  var _safePlayAttempts = 0;                  // safePlay 调用次数
  var _safePlaySuccesses = 0;                 // safePlay 成功次数（playing 事件触发）
  // 命中率累计采样（环形仪表：像精密仪器读数，实时但不跳动）
  var _targetHitSamples = 0;                  // 启用定向后仪表盘采样次数
  var _targetHitHits = 0;                     // 其中命中（matched）次数

  // —— 黑匣子（环形缓冲区，记录最近 N 条操作日志用于诊断）——
  var _bxBuffer = [];                         // { ts: Date.now(), action: string, detail: string }
  var _bxCap = 200;                           // 最多保留 200 条
  function _bxLog(action, detail) {           // 黑匣子记录（action 用短标签，detail 上下文）
    try {
      _bxBuffer.push({ ts: Date.now(), action: action, detail: detail || '' });
      if (_bxBuffer.length > _bxCap) _bxBuffer.shift();
    } catch (e) { swallow(e); }
  }

  // —— 错误环形缓冲（被 swallow 吞掉的错误，无论 DEBUG 是否开启都记录，供诊断追溯）——
  // 归属说明（架构·作用域）：原寄居在 utils/utils.js 顶层，与 dbg/swallow/cxState 等通用工具混居，属「诊断状态错位」。
  // 现集中到可观测性状态层。写入方：utils/utils.js 的 swallow（前向引用——utils 为首个模块、本模块第 3 个，
  //   但 swallow 仅在运行时调用且 IIFE 内 var 已 hoist，与 dbg→DEBUG 同型，安全）。
  var _errBuf = [];          // 被吞错误的环形缓冲（最多保留 50 条）
  var _errCount = 0;         // 累计被吞错误数（含 DEBUG 关闭时的静默错误）
  function recentErrors(n) { try { return _errBuf.slice(-(n || 10)); } catch (e) { return []; } }
  function errorCount() { return _errCount; }

  // ===== MODULE: 配置 =====
  // 层级：元信息与配置区 —— 定义 CONFIG 默认配置与 DEBUG 开关，安装原型 pause/rate neutralize 防暂停/防伪暂停，提供倍速/循环施加。调试工具(dbg/swallow)与持久化已分别归入 utils / storage 层。
  // ===== 配置 =====
  var CONFIG = {
    RESCAN_INTERVAL: 2000,  // 低频全量重扫间隔(ms)：对抗平台重定义 pause / 原型硬调用 / DOM 换血。2s 足够，高频空转徒增资源消耗
    PAUSE_HOTKEY: 'p',      // 控制面板开关键：非输入框聚焦时按此键开/关悬浮控制面板（面板内含暂停/恢复、计时器滑块）；空串=禁用
    AUTO_STOP_MIN: 0,       // 自动停止计时器：累计观看满 N 分钟自动暂停且不再续播；0=禁用
    RESUME_AFTER_MIN: 0,    // 暂停后自动恢复：N 分钟后自动续播；0=保持暂停直到手动恢复（"暂停后是否开启"开关）
    END_RELEASE_SEC: 15,    // 进度到底释放：距结尾 ≤ 此秒数（且未真正 ended）时关闭强制续播，交还平台/用户自然结束或暂停；0=禁用
    USER_RATE: 1,           // 自定义播放速率（仅对强制接管的任务点视频生效；0.25~4，默认 1）— 伪暂停回拉目标也用此值，使自定义倍速在伪暂停事件中存活
    LOOP_PLAY: false,      // 可控循环播放：开启后视频播完从头重播（取代默认"播完锁死防重播"行为）；默认关闭，保持原有自动跳课/防重播协同
    SINGLE_VIDEO: false,   // 只播放一个视频：开启后仅前台视频播放，其他视频全部暂停；同时取消所有逐视频开关
    NINJA_MODE: false,     // Ninja 模式：面板默认缩成窄条（仅标题+指示灯），鼠标悬停展开。适合录屏/隐私场景
    PANEL_W: 460,          // 面板宽度(px，288~760)：正常态与 Ninja 展开态共用，「系统」页滑块可调并持久化（默认加宽，避免 Ninja 悬停展开仍显窄）
    PANEL_POS: null,       // 面板拖拽落点 {x,y}（px，相对视口）；null=使用 CSS 默认右上角。解决 Ninja 模式无法上下/左右移动
    INTRUSION_MODE: 'auto', // #1 温和模式：原型中性化启用策略。'auto'=按站点自适应(超星激进/其余温和)；'gentle'=仅实例级+事件，绝不碰原型(超星有覆盖窗口)；'aggressive'=始终包装原型(现状默认，最稳)
    POLITE_MODE: false     // #1 礼貌模式：抗检测——pause.toString()/playbackRate setter 来源特征伪装为原生，规避平台基于字面量扫描的反篡改；默认关，开启后还原检测改为行为探测
  };
  Store.state.CONFIG = CONFIG;   // P1 状态集中：镜像 CONFIG（同对象引用，零行为回归）

  // 内部常量（非用户可调，集中管理便于维护 / 平台改版时统一调整）
  var CONST = {
    MAX_SCAN_DEPTH: 16,              // walkVideos 递归深度上限（防深 DOM 树主线程卡顿）
    ENDED_SRCS_CAP: 2000,            // 已结束 src 记录去重上限（防长时挂机无限增长）
    WATCH_STATS_CAP: 800,             // 本地已看时长统计上限（防 localStorage 无限增长撑爆配额）
    TARGET_FALLBACK_ROUNDS: 3,       // 定向连续 0 命中达此轮数 → 回退全续播（迟滞）
    MO_QUEUE_CAP: 1024,              // MutationObserver 合并队列上限
    MEM_SAMPLE_EVERY: 30,            // 内存采样间隔（轮）
    BRIDGE_PROBE_PORTS: [7531, 7532, 7533, 8543, 9090], // 桥接探测端口
    BRIDGE_TIMEOUT_MS: 5000             // 桥请求超时（AbortController），避免半死桥永久挂起
  };
  // DOM 选择器（集中，便于平台改版时适配不同页面结构）
  var SELECTORS = {
    VIDEO_BOX: '#videoBox',
    TASK_CONTAINER: '.ans-attach-ct'
  };

  // 视频节点 flag 名（跨脚本契约属性，集中定义以防拼写漂移）。线上属性名保持 __cx 前缀以兼容副脚本探针：
  //   forcePaused —— 原型级防暂停闸门（pause no-op）；
  //   anHold     —— auto-next 写入的暂停锁（跨脚本契约）；
  //   endedLock  —— ended-notify 读取的“已结束”锁（跨脚本契约）；
  //   userPaused —— 用户暂停态（keyboard-shortcuts 读写，跨脚本契约）；
  //   np         —— 原生 pause 备份（keyboard-shortcuts 读写，跨脚本契约）。
  // 注意：forcePaused 在原型 neutralize 函数体内「默认」保留字面量（tamper-guard 字串基线靠 pause.toString() 含该串判断）；
  //   但 #1 礼貌模式(POLITE_MODE=true)下，原型体会改用闭包变量 _CX_FP 引用该标记，使 pause.toString() / rate setter.toString()
  //   不含 '__cxForcePaused' 字面量，规避平台基于 toString 字串扫描的反篡改。该分支由 CONFIG.POLITE_MODE 门控，非礼貌模式保持字面量零回归。
  //   FLAGS.forcePaused 仍供原型体之外引用；礼貌模式的闭包别名见下方 _CX_FP。
  var FLAGS = {
    forcePaused: '__cxForcePaused',
    anHold:      '__cxAN_hold',
    endedLock:   '__cxEndedLock',
    userPaused:  '__cxUserPaused',
    np:          '__np',
    nearEndEndedGuard: '__cxNearEndEndedGuard'   // 近尾 ended 监听只安装一次
  };
  // #1 礼貌模式：标记名闭包引用（仅 POLITE_MODE 下原型体改用 this[_CX_FP]，使 pause.toString()/rate setter.toString() 不含 '__cxForcePaused' 字面量，
  //   规避平台基于 toString 字串扫描的反篡改）。非礼貌模式保持 this.__cxForcePaused 字面量，兼容现有 tamper-guard 字串扫描基线（零回归）。
  // 关键：此变量声明本身不在任何注入函数体内，故 pause.toString() 不会出现该字面量。
  var _CX_FP = FLAGS.forcePaused;   // === '__cxForcePaused'
  // #1 行为/引用探测状态：原型中性化是否仍在位（替代字串扫描，礼貌模式下唯一可靠判据）。
  var _installedProtoPause = null;   // 当前装上的原型 pause 函数引用（用于比对是否被平台还原）
  var _installedProtoRateSet = null; // 当前装上的 playbackRate setter 引用
  var _pauseNeutralized = null;      // true=中性化在位；false=被还原；null=未接管原型(温和/未装)
  var _rateNeutralized = null;

  // 注入样式（集中管理，便于主题定制 / 平台改版适配；避免 CSS 散落于各模块）
  // 【内聚性收敛】STYLES（设计令牌 + 面板/移动/Ninja/动效/按钮样式 + window.__cxUI 导出）已迁至 ui/styles.js。
  // 该块约 168 行纯 CSS 数据，原占 config.js 过半篇幅，与 CONFIG/CONST/FLAGS/原型 neutralize/业务动作混居。
  // 现 config.js 仅持有「元配置 + 引擎接管 + 业务施加」；STYLES 在 config.js 之后、ui 模块之前由 ui/styles.js 定义，
  //   ui/* 与 dom.js(toast) 在运行时统一读取同一 STYLES 对象（同一 IIFE 闭包）。

  // DEBUG 开关：运行时按 DEBUG 判定是否输出日志；dbg/swallow 实现见 utils/module-00-utils.js（工具层）。
  var DEBUG = false;
  // ===== 面板控制数据持久化（刷新网页后保持面板设置）=====
  // 控制面板里改动的 AUTO_STOP_MIN / RESUME_AFTER_MIN / RESCAN_INTERVAL / END_RELEASE_SEC / DEBUG
  // 原本只存在运行时变量，刷新即丢。现统一存到 localStorage.cx_panel_cfg（JSON），脚本启动即载入，
  // 面板各控件变更时即时写回 → 设置跨刷新保持不变。（当前导航区块 cx_panel_tab、副脚本开关已在各自逻辑持久化。）
  // 持久化实现见 storage/module-02-storage.js（存储与 API 通讯层）；此处仅保留启动载入调用。
  loadPanelCfg();   // 启动即载入上次设置（务必在 _loopTimer 启动之前，使 RESCAN_INTERVAL 立即生效）
  loadWatchStats(); // 载入本地已看时长统计（进度同步·本地估算用）

  // #3 修复：平台常在闭包/webpack 私有函数里直接调 video.pause()（绕过 window.ananas.pause 覆盖），
  // 仅覆盖全局对象/实例方法防不住。故将"防暂停"下沉到 HTMLMediaElement.prototype.pause：
  //   任何视频的 pause() 在 __cxForcePaused 为真(本脚本已强制续播)时变为 no-op，闭包私有暂停也走此路径被拦截；
  //   未命中的广告/插播视频(__cxForcePaused 未置)仍可正常暂停；
  //   auto-next 的 hold 暂停通过原生备份 NATIVE_PAUSE(经 v.__np)绕过拦截真正暂停，不受影响。
  var NATIVE_PAUSE = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype && HTMLMediaElement.prototype.pause)
    ? HTMLMediaElement.prototype.pause : null;
  // 原生 pause 属性描述符备份：与 NATIVE_RATE_DESC 对称。卸载还原时优先按描述符 defineProperty 写回，
  // 以正确处理 pause 原为 getter/访问器或被其他脚本定义为非 writable 的情况（函数引用写回仅覆盖最常见情形）。
  var NATIVE_PAUSE_DESC = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype)
    ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'pause') : null;
  var NATIVE_PLAY = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype && HTMLMediaElement.prototype.play)
    ? HTMLMediaElement.prototype.play : null;   // 原生 play 备份：用户暂停闸门放行时经此播放，绕过实例级覆盖
  var _protoPauseInstalled = false;   // #1 原型 pause 中性化当前是否已装（reconcileIntrusionMode 据此决策装/卸）
  function installPrototypePauseNeutralize() {
    if (!NATIVE_PAUSE) return;
    if (!forcePlayEnabled()) return;   // opt-out：页面/帧级停用强制播放（?cxforce=off 或 localStorage.cx_force_off）
    // 两个版本：礼貌模式用闭包变量引用(toString 不含字面量·抗字串扫描)；非礼貌保留字面量(兼容 tamper-guard 字串基线·零回归)
    function protoPauseNeutral() {
      try { if (this && this[_CX_FP]) return; } catch (e) { swallow(e); }
      return NATIVE_PAUSE.apply(this, arguments);
    }
    function protoPauseLiteral() {
      try { if (this && this.__cxForcePaused) return; } catch (e) { swallow(e); }
      return NATIVE_PAUSE.apply(this, arguments);
    }
    var protoPause = CONFIG.POLITE_MODE ? protoPauseNeutral : protoPauseLiteral;
    try { HTMLMediaElement.prototype.pause = protoPause; _protoPauseInstalled = true; _installedProtoPause = protoPause; _pauseNeutralized = true; }
    catch (e1) {
      try { Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: protoPause }); _protoPauseInstalled = true; _installedProtoPause = protoPause; _pauseNeutralized = true; }
      catch (e2) { swallow(e2); }
    }
  }
  // #1 卸载还原：按原生描述符写回 prototype.pause（与 cleanupListeners ① 同口径），并清安装标记
  function restorePrototypePause() {
    if (!NATIVE_PAUSE_DESC) return;
    try { Object.defineProperty(HTMLMediaElement.prototype, 'pause', NATIVE_PAUSE_DESC); _protoPauseInstalled = false; _installedProtoPause = null; _pauseNeutralized = false; } catch (e) { swallow(e); }
  }
  if (usePrototypeNeutralize()) installPrototypePauseNeutralize();

  // #2 进阶（对抗 playbackRate 伪暂停）：平台不调 pause()，而是直接 video.playbackRate = 0 让画面"冻结"。
  // 已有时有 ratechange 事件回拉 + 轮询断言；再下沉到原型 setter 更激进拦截：一旦对"已强制续播"视频
  // 赋 0/极小速率，直接改写为 1x（尊重 hold 锁与未命中视频）。不 Hook SourceBuffer（appendBuffer 风险花屏，故不采用）。
  var NATIVE_RATE_DESC = (typeof HTMLMediaElement !== 'undefined' && HTMLMediaElement.prototype)
    ? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate') : null;
  var _protoRateInstalled = false;    // #1 原型 playbackRate 中性化当前是否已装
  function installPlaybackRateNeutralize() {
    if (!NATIVE_RATE_DESC || !NATIVE_RATE_DESC.set) return;
    if (!forcePlayEnabled()) return;   // opt-out
    function rateSetNeutral(v) {
      try { if (this && this[_CX_FP] && !this[FLAGS.anHold] && !this[FLAGS.userPaused] && v <= 0.01) v = (CONFIG.USER_RATE || 1); } catch (e) { swallow(e); }
      return NATIVE_RATE_DESC.set.call(this, v);
    }
    function rateSetLiteral(v) {
      try { if (this && this.__cxForcePaused && !this[FLAGS.anHold] && !this[FLAGS.userPaused] && v <= 0.01) v = (CONFIG.USER_RATE || 1); } catch (e) { swallow(e); }
      return NATIVE_RATE_DESC.set.call(this, v);
    }
    var rateSet = CONFIG.POLITE_MODE ? rateSetNeutral : rateSetLiteral;
    try {
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        configurable: true, enumerable: true,
        get: NATIVE_RATE_DESC.get,
        set: rateSet
      });
      _protoRateInstalled = true; _installedProtoRateSet = rateSet; _rateNeutralized = true;
    } catch (e) { swallow(e); }
  }
  // #1 卸载还原：按原生描述符写回 prototype.playbackRate，并清安装标记
  function restorePrototypeRate() {
    if (!NATIVE_RATE_DESC) return;
    try { Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', NATIVE_RATE_DESC); _protoRateInstalled = false; _installedProtoRateSet = null; _rateNeutralized = false; } catch (e) { swallow(e); }
  }
  if (usePrototypeNeutralize()) installPlaybackRateNeutralize();

  // #1 温和/礼貌模式：是否启用原型中性化（prototype.pause / playbackRate）。
  //   'aggressive' → 始终包装（现状默认行为，最稳）；
  //   'gentle'     → 仅实例级(v.pause=pauseNoop，dom.js:_ovEnforce 已做)+事件，绝不碰原型（超星有覆盖窗口，已知）；
  //   'auto'（默认）→ 运行时按站点识别：仅检测为超星(chaoxing)才激进；其余(含 'unknown' / 智慧树TODO)降级温和。
  // 注：detectSite() 返回 'chaoxing' | 'zhihuishu' | 'unknown'（见 site-router.js），并不依赖任何 SITE 枚举；
  //   其函数体只读 window.location，故 config.js 加载期(早于 site-router.js 文本位置，但函数已提升)即可正确调用，
  //   无需保守兜底——仅在 detectSite 不可用/抛错时回落激进，保证核心续播不丢。
  function usePrototypeNeutralize() {
    var m = CONFIG.INTRUSION_MODE;
    if (m === 'aggressive') return true;
    if (m === 'gentle') return false;
    // 'auto'：仅超星需原型中性化（闭包 pause 必改原型）；其余站点实例级+事件已足够，降级温和以减侵入
    try { return (typeof detectSite === 'function' ? detectSite() === 'chaoxing' : true); } catch (e) { return true; }
  }
  // #1 收敛原型中性化的装/卸决策（运行期切换 INTRUSION_MODE 或 'auto' 站点解析后调用）：
  //   需温和 → 卸原型（还原原生），并全量重扫让 _ovEnforce 对每实例补 own-property 覆盖(pauseNoop)；
  //   需激进 → 未装则装。默认加载期已按 usePrototypeNeutralize() 装过一次。
  //   关键：运行期切换的「还原」与「全卸」(cleanupListeners ①②)走同一套 restorePrototype* 原语，单一事实源、避免两套还原逻辑漂移导致残留。
  function reconcileIntrusionMode() {
    try {
      var on = usePrototypeNeutralize();
      if (on) {
        if (!_protoPauseInstalled) installPrototypePauseNeutralize();
        if (!_protoRateInstalled) installPlaybackRateNeutralize();
        // 重装：原型已接管，但实例级 own-property(pauseNoop) 仍由 _ovEnforce 维护；全量重扫刷新之，使新插入/已存在的视频与新模式一致
        try { if (typeof scanVideos === 'function') scanVideos(document); } catch (e) { swallow(e); }
      } else {
        restorePrototypeNeutralization();
        // 降级温和：全量重扫（必须传 document 而非 true —— scanVideos(root) 要求 root 有 querySelectorAll，true 会让重扫成 no-op），
        // 使每个已扫描视频补上实例级 pause no-op（dom.js:_ovEnforce 接管路径），与原型卸除后「仅实例级」语义一致，杜绝两种中性化并存
        try { if (typeof scanVideos === 'function') scanVideos(document); } catch (e) { swallow(e); }
      }
    } catch (e) { swallow(e); }
  }
  // #1 还原原语统一封装：运行期切换(本函数)与全卸(cleanupListeners ①②)共用，避免两套还原逻辑漂移。
  function restorePrototypeNeutralization() {
    try { if (_protoPauseInstalled) restorePrototypePause(); } catch (e) { swallow(e); }
    try { if (_protoRateInstalled) restorePrototypeRate(); } catch (e) { swallow(e); }
  }

  // #1 礼貌模式·行为/引用探测：原型 pause/playbackRate 中性化是否仍在位（替代字串扫描）。
  //   比较 prototype 上当前函数引用是否仍等于我们装上的中性化函数（_installedProtoPause / _installedProtoRateSet）；
  //   相等即平台未重写原型 → 中性化在位；不等即被还原（Object.freeze/重新赋值绕过）→ 返回 false，供审计/副脚本/报警判据。
  //   温和模式(未装原型)返回 null（不适用）；结果同时缓存到 _pauseNeutralized / _rateNeutralized 供审计面板直读。
  function probePauseNeutralized() {
    try {
      if (!_protoPauseInstalled || !_installedProtoPause) { _pauseNeutralized = (_protoPauseInstalled ? true : null); return _pauseNeutralized; }
      _pauseNeutralized = (HTMLMediaElement.prototype.pause === _installedProtoPause);
      return _pauseNeutralized;
    } catch (e) { swallow(e); return _pauseNeutralized; }
  }
  function probeRateNeutralized() {
    try {
      if (!_protoRateInstalled || !_installedProtoRateSet) { _rateNeutralized = (_protoRateInstalled ? true : null); return _rateNeutralized; }
      var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      _rateNeutralized = !!(d && d.set === _installedProtoRateSet);
      return _rateNeutralized;
    } catch (e) { swallow(e); return false; }
  }
  function getPauseNeutralized() { try { return probePauseNeutralized(); } catch (e) { return false; } }
  function getRateNeutralized() { try { return probeRateNeutralized(); } catch (e) { return false; } }

  try {
    if (!window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY = {};
    var _ns = window.__CX_FORCE_PLAY;
    _ns.reconcileIntrusionMode = reconcileIntrusionMode;
    _ns.usePrototypeNeutralize = usePrototypeNeutralize;
    _ns.probePauseNeutralized = probePauseNeutralized;
    _ns.probeRateNeutralized = probeRateNeutralized;
    _ns.getPauseNeutralized = getPauseNeutralized;
    _ns.getRateNeutralized = getRateNeutralized;
    _ns.restorePrototypeNeutralization = restorePrototypeNeutralization;   // 暴露统一还原原语：运行期切换与全卸(cleanupListeners)共用
    _ns.CONFIG = CONFIG;                  // 暴露配置引用（副脚本 tamper-guard 读取 POLITE_MODE 以切换探测方式）
    _ns._pauseNeutralized = _pauseNeutralized;
    _ns._rateNeutralized = _rateNeutralized;
  } catch (e) { swallow(e); }

  // 把当前用户倍速(CONFIG.USER_RATE)施加到页面内所有视频（含 iframe 内），用于面板上调节倍速后即时生效、并持续压制平台重置。
  // 不局限于"已强制接管"的视频：定向模式下未命中白名单被释放的主视频、以及普通观看视频同样生效，避免速率形同虚设。
  // 仍尊重 auto-next 暂停锁(__cxAN_hold，锁定时平台可能用 rate=0 实现暂停，不得回拉)、用户手动暂停(__cxUserPaused)、
  // 已结束锁定(__cxEndedLock，停在末尾不应改动)；跳过 rate<=0.01 的伪暂停（交由 ratechange/coverVideo 拉回）。零网络、零上报。
  function applyUserRateAll() {
    if (!forcePlayEnabled()) return;   // opt-out：停用时不强行改速率
    try {
      var rate = (CONFIG.USER_RATE || 1);
      function walk(root) {
        if (!root || !root.getElementsByTagName) return;
        var vs = root.getElementsByTagName('video');
        for (var i = 0; i < vs.length; i++) {
          var v = vs[i];
          try {
            if (!v[FLAGS.anHold] && !v[FLAGS.userPaused] && !v[FLAGS.endedLock]
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
    if (!forcePlayEnabled()) return;   // opt-out：停用时不强行改循环
    try {
      var vs = allVideos();
      for (var i = 0; i < vs.length; i++) {
        try { vs[i].loop = CONFIG.LOOP_PLAY; } catch (e) { swallow(e); }
      }
    } catch (e) { swallow(e); }
  }

  // ===== DOMAIN: ui/styles (design tokens + injected CSS) =====
  // ===== MODULE: 样式/设计令牌 =====
  // 域：UI 层 —— 面板与通知相关的全部 CSS 字符串（设计令牌 + 注入样式），纯数据、无控制流。
  // 【内聚性收敛】原 STYLES 与 CONFIG/CONST/FLAGS/原型 neutralize/业务动作(applyUserRateAll/applyLoopAll)
  //   混居 meta-config/config.js（占该文件过半篇幅）。现样式成为单一事实源独立成模块，
  //   config.js 回归「元配置」职责；样式仅供 ui/* 与 dom.js(toast) 在运行时读取。
  // 导出：window.__cxUI = STYLES，供副脚本 addon 引用令牌保持视觉同构（设计 §5.3）。
  var STYLES = {
    // 宽度走 CSS 变量 --cx-panel-w（默认 380px）：单一事实源，面板正常态与 Ninja 展开态共用同一宽度，
    // 由「系统 → 面板宽度」滑块调节并持久化。旧版固定 288px 与 Ninja 展开宽度恰好相等，导致用户退出
    // Ninja 后看到的仍是同样窄的面板，误以为"没退出 n 模式"。
    PANEL_BOX:     'position:fixed;right:12px;top:12px;z-index:2147483647;box-sizing:border-box;width:var(--cx-panel-w,460px);max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow-y:auto;background:#F9FAFB;color:#1F2937;font:13px/1.5 sans-serif;border:1px solid #E5E7EB;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.06);padding:12px;user-select:none;',
    TOAST:         'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#FFFFFF;color:#1F2937;padding:6px 12px;border-radius:8px;font:12px/1.4 sans-serif;pointer-events:none;border:1px solid #E5E7EB;box-shadow:0 4px 14px rgba(0,0,0,.10);',
    PANEL_MOBILE:  '@media (max-width:480px){#__cxPanel{left:8px!important;right:8px!important;top:8px!important;width:auto!important;max-width:none!important;max-height:calc(100vh - 16px)!important;overflow-y:auto!important;font-size:12px!important;padding:10px!important;}#__cxPanel button{padding:11px!important;font-size:13px!important;}#__cxPanel .cx-nav-btn{padding:9px!important;}#__cxPanel input[type=range]{height:22px;}#__cxPanel #__cxAddons .cx-course button,#__cxPanel #__cxSubPanels button{padding:8px 12px!important;font-size:13px!important;}}',
    DIAG_BLOCK:    'margin-bottom:10px;font-size:12px;background:#FFFFFF;border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);',
    DIAG_HEAD:     'cursor:pointer;padding:6px 8px;background:#F3F4F6;color:#1F2937;font-weight:600;display:flex;justify-content:space-between;align-items:center;',
    DIAG_CARET:    'font-size:10px;',
    DIAG_BODY:     'padding:8px;max-height:50vh;overflow:auto;',
    DIAG_ROW:      'margin-bottom:6px;font-size:12px;',
    DIAG_BTN:      'width:100%;padding:6px;background:#F3F4F6;color:#1F2937;border:0;border-radius:6px;cursor:pointer;font-size:12px;',
    DIAG_LAB:      'display:block;cursor:pointer;',
    DIAG_CB:       'vertical-align:middle;margin-right:6px;',
    DIAG_NOTE:     'font-size:11px;color:#6b7280;margin-left:20px;',
    NINJA_DEFAULT: '',   // 占位前缀（#__cxPanelNinjaDefault 规则已并入 NINJA_STYLE）；保持旧拼接 STYLES.NINJA_DEFAULT 兼容
    // 动效与精密感样式（仅在 ensurePanel 注入一次）：呼吸灯/环形仪表/等宽数字/微交互（设计：可靠感指南）
    ANIM:          '.cx-statusled{transition:background-color .3s ease,box-shadow .3s ease;animation:cx-led-pulse 3s infinite ease-in-out;}' +
                   '@keyframes cx-led-pulse{0%,100%{opacity:.85;}50%{opacity:.4;}}' +
                   '#__cxPanel button:active{transform:scale(.97);transition:transform .1s ease;}' +
                   '#__cxPanel input[type=range]::-webkit-slider-thumb{transition:transform .15s ease;}' +
                   '#__cxPanel input[type=range]::-webkit-slider-thumb:active{transform:scale(1.2);}' +
                   '#__cxPanel input[type=range]::-moz-range-thumb:active{transform:scale(1.2);}' +
                   '.cx-gauge-txt{font-family:"SF Mono","Roboto Mono",monospace;font-variant-numeric:tabular-nums;letter-spacing:.3px;}' +
                   '.cx-mono{font-family:"SF Mono","Roboto Mono",monospace;font-variant-numeric:tabular-nums;letter-spacing:.5px;}' +
                   '.cx-titlebar{cursor:move;}'
  };

  // ===== P5a 设计令牌（Design Tokens）：单一事实源，面板所有颜色/字号/间距/圆角必须引用此表 =====
  // 语义命名；唯一新色值为 danger（破坏性操作），其余为对现有散值(#2a2e37→border 等)的收敛命名。
  // 副脚本可经 window.__cxUI.T 引用，保证 addon 视觉与原生组件同构（设计 §5.3）。
  STYLES.T = {
    // —— 色板（浅色主题：从视频深色背景隔离，像 macOS 控制中心浮于白页）——
    bg:        '#F9FAFB',             // 面板底色：极浅灰白（视觉隔离带，告别与视频黑底融合）
    surface:   '#FFFFFF',             // 输入框/卡片/嵌套卡底色（白，从面板浅灰底浮起）
    surface2:  '#F3F4F6',             // 内部区块底色（极浅灰，备用）
    border:    '#E5E7EB',             // 统一描边/分隔线（浅灰，清晰而不刺眼）
    text:      '#1F2937',             // 主文字：深炭灰，告别纯黑
    text2:     '#6B7280',             // 次级文字：中性灰（Tab 未选中着色）
    text3:     '#9CA3AF',             // 弱化文字/占位
    primary:   '#3B82F6',             // 主色：雾霾蓝（专业不刺眼，替代原霓虹亮蓝）
    success:   '#10B981',             // 成功：青绿
    warning:   '#F59E0B',             // 收藏/警告
    danger:    '#EF4444',             // 破坏性操作
    idle:      '#9CA3AF',             // 未激活/禁用态（开关 off 轨道/状态灰）
    // —— 派生色（浅色主题下重新映射，保持组件可用）——
    primary2:   '#3B82F6',            // sparkline 描线/进度条已看/桥徽章/命中 tag
    primary2A25:'rgba(59,130,246,0.25)', // sparkline 渐变填充（蓝 25%）
    primary2A0: 'rgba(59,130,246,0)',    // sparkline 渐变填充（蓝 0%）
    primaryTxt: '#2563EB',            // 深蓝字：Ghost 按钮/命令高亮（浅蓝在白底不可见，故加深）
    onPrimary2: '#1E40AF',            // 命令高亮态次级文字（更深蓝）
    star:       '#2563EB',            // 前台星标 ★（深蓝，白底可见）
    track:      '#E5E7EB',            // 进度条轨道底色（浅灰）
    buffered:   'rgba(156,163,175,0.4)', // 进度条缓存段（灰 40%）
    cmdHi:      '#EFF6FF',            // 命令下拉高亮底（极浅蓝）
    text2b:     '#6B7280',            // 面板诊断块次级文字
    surface3:   '#F3F4F6',            // 深面板底（黑匣子导出按钮）
    paused:     '#F59E0B',            // 状态徽章·用户暂停（琥珀，区别于未激活灰 idle=#9CA3AF）
    // —— 字阶（禁止 10px：归并到 9 或 11）——
    fs9: '9px', fs11: '11px', fs12: '12px', fs13: '13px', fs14: '14px',
    // —— 间距（4 的倍数：组件内 4-6，组件间 8，区块间 12）——
    sp4: '4px', sp6: '6px', sp8: '8px', sp12: '12px',
    // —— 圆角三级 ——
    r4: '4px', r6: '6px', r8: '8px',
    // —— 阴影 ——
    shadow:     '0 12px 32px rgba(0,0,0,.12)',     // 面板浮起（浅色，柔和）
    cardShadow: '0 1px 3px rgba(0,0,0,0.05)'        // 内部卡片悬浮感
  };
  // Ninja 模式样式：必须延迟到 STYLES.T 令牌定义之后赋值——若在 `var STYLES` 自初始化期间访问 STYLES.T，
  // 此时 STYLES 自身为 undefined，会抛 TypeError 使整个 IIFE 在加载期崩溃（表现为 P 键/续播全线失效）。
  STYLES.NINJA_STYLE =  // 缩成圆形悬浮钮（仅呼吸灯），悬停/点击展开。圆形对称，任意侧观感一致
    '#__cxPanelNinjaDefault{right:12px;top:12px;}' +
    '#__cxPanel.ninja{' +
      'width:44px!important;max-width:44px!important;min-width:44px!important;' +     // 整体缩小一档：比正圆更紧凑，仍保留"控制中枢"胶囊感
      'height:50px!important;min-height:50px!important;max-height:50px!important;' +
      'padding:0!important;border-radius:14px!important;' +   // 圆角矩形(胶囊)：替代正圆，更"硬件/中枢"
      'background:rgba(255,255,255,.22)!important;' +         // 全息玻璃：半透明白，透出网页纹理
      '-webkit-backdrop-filter:blur(10px)!important;backdrop-filter:blur(10px)!important;' +   // 核心磨砂
      'border:1px solid rgba(255,255,255,.5)!important;' +    // 高光细边
      'box-shadow:0 6px 18px rgba(15,23,42,.22),inset 0 1px 0 rgba(255,255,255,.35)!important;' +  // 悬浮投影 + 顶部内高光，制造体积感
      'overflow:visible!important;' +
      'display:flex!important;align-items:center;justify-content:center;' +
      'cursor:pointer!important;' +   // 折叠态明显可点，避免用户误以为面板"死了"
      'transition:width .28s ease,height .28s ease,padding .28s ease,border-radius .28s ease,max-height .28s ease,box-shadow .2s ease,background .2s ease;' +
    '}' +
    '#__cxPanel.ninja .cx-title,' +
    '#__cxPanel.ninja #__cxPanelClose,' +
    '#__cxPanel.ninja .cx-cmd-wrap,' +
    '#__cxPanel.ninja .cx-nav,' +
    '#__cxPanel.ninja .cx-tab{display:none!important;}' +
    '#__cxPanel.ninja .cx-titlebar{display:flex!important;align-items:center;justify-content:center;width:100%!important;height:100%!important;margin:0!important;}' +
    '#__cxPanel.ninja .cx-titlebar > div{display:flex!important;align-items:center;justify-content:center;gap:0!important;}' +
    '#__cxPanel.ninja .cx-titlebar > div > span:not(#__cxPanelBadge){display:none!important;}' +
    '#__cxPanel.ninja #__cxPanelBadge{' +
      'margin:0!important;' +
      'width:13px!important;height:13px!important;' +       // 呼吸灯放大居中，填充浮球
      'box-shadow:0 0 0 3px rgba(59,130,246,.14);' +         // 柔和蓝晕，避免空荡
      'position:relative;' +
    '}' +
    '#__cxPanel.ninja #__cxPanelBadge::after{' +             // 脉冲光环：悬浮球"活着"的观感
      'content:"";position:absolute;inset:-4px;border-radius:50%;' +
      'border:1.5px solid ' + STYLES.T.primary + ';opacity:.55;' +
      'animation:cx-orb-ring 2s infinite ease-out;pointer-events:none;' +
    '}' +
    // 折叠态(未展开)：隐藏标题/状态点，居中白色图标（发光 + 暗投影，深浅网页都清晰），外圈呼吸光环
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-titlebar > div,' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) #__cxPanelBadge{display:none!important;}' +
    // 折叠态图标：精致双状态 SVG（播放三角 / 暂停双竖条），父级 flex 居中；按 cx-playing/cx-paused 切换显示
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph{' +
      'display:block!important;position:relative;width:18px;height:18px;margin:0!important;' +   // 固定盒居中（父级 flex），图标真正居中
    '}' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph .cx-glyph{' +
      'position:absolute;inset:0;width:100%;height:100%;fill:#fff!important;' +   // 纯白图标，与玻璃胶囊协调
      'filter:drop-shadow(0 0 6px rgba(255,255,255,.6)) drop-shadow(0 1px 2px rgba(0,0,0,.4));' +  // 发光 + 暗投影，保证深浅背景均可见
    '}' +
    // 状态联动（折叠态图标是「当前状态指示器」，非可点击的操作按钮）：有视频在播 → 显示播放三角(▶)；全部暂停 → 显示暂停双竖条(‖)
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph.cx-playing .cx-glyph-pause{display:none!important;}' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open) .cx-ninja-glyph.cx-paused .cx-glyph-play{display:none!important;}' +
    '#__cxPanel.ninja:not(:hover):not(.ninja-open)::after{' +
      'content:"";position:absolute;inset:-3px;border-radius:16px;box-sizing:border-box;' +   // 圆角矩形光环，匹配胶囊外形
      'border:1.5px solid rgba(255,255,255,.55);' +
      'animation:cx-orb-ring 2s infinite ease-out;pointer-events:none;' +
    '}' +
    '#__cxPanel:not(.ninja) .cx-ninja-glyph{display:none!important;}' +
    '#__cxPanel.ninja:hover,#__cxPanel.ninja.ninja-open{' +
      // 展开宽度跟随 --cx-panel-w，与正常态一致；否则退出 Ninja 后宽度不变，用户无从分辨是否已退出
      'width:var(--cx-panel-w,460px)!important;max-width:calc(100vw - 24px)!important;min-width:auto!important;' +
      'height:auto!important;min-height:auto!important;max-height:calc(100vh - 24px)!important;' +
      'padding:12px!important;border-radius:12px!important;overflow-y:auto!important;overflow-x:hidden!important;' +
      'display:block!important;' +   // 关键：悬停/展开恢复块级布局。否则 .ninja 折叠态的 display:flex 会把标题栏/命令栏/标签页当成横向 flex 项排布，开关被拉伸变形
      'background:' + STYLES.T.surface + '!important;' +   // 展开态恢复浅色面板底，否则会沿用折叠态蓝渐变导致内容难读
    '}' +
    // 拖拽中保持圆形折叠（防止悬停展开造成尺寸突变）；left/top 由内联显式锚定，自由落点
    '#__cxPanel.ninja.cx-dragging,#__cxPanel.ninja.cx-dragging:hover{width:44px!important;max-width:44px!important;min-width:44px!important;height:50px!important;min-height:50px!important;max-height:50px!important;padding:0!important;border-radius:14px!important;}' +
    // 退出 n 模式按钮：仅在 Ninja 展开态(悬停/粘性)显示，给卡在窄条、够不到「系统」勾选框的用户一条逃生通道
    '#__cxPanel.ninja:hover .cx-exit-ninja,#__cxPanel.ninja.ninja-open .cx-exit-ninja{' +
      'display:inline-block!important;margin-left:6px;padding:2px 8px;font-size:11px;' +
      'background:' + STYLES.T.primary + ';color:#fff;border:0;border-radius:4px;cursor:pointer;white-space:nowrap;' +
    '}' +
    '#__cxPanel:not(.ninja) .cx-exit-ninja{display:none!important;}' +
    '#__cxPanel.ninja:hover .cx-title,' +
    '#__cxPanel.ninja.ninja-open .cx-title,' +
    '#__cxPanel.ninja:hover #__cxPanelClose,' +
    '#__cxPanel.ninja.ninja-open #__cxPanelClose,' +
    '#__cxPanel.ninja:hover .cx-cmd-wrap,' +
    '#__cxPanel.ninja.ninja-open .cx-cmd-wrap,' +
    '#__cxPanel.ninja:hover .cx-nav,' +
    '#__cxPanel.ninja.ninja-open .cx-nav,' +
    '#__cxPanel.ninja:hover .cx-tab,' +
    '#__cxPanel.ninja.ninja-open .cx-tab{display:block!important;}' +
    '#__cxPanel.ninja:hover .cx-nav-btn,' +
    '#__cxPanel.ninja.ninja-open .cx-nav-btn{display:inline-block!important;}' +
    '#__cxPanel.ninja:hover .cx-titlebar,' +
    '#__cxPanel.ninja.ninja-open .cx-titlebar{justify-content:space-between!important;margin-bottom:8px!important;height:auto!important;}' +
    '#__cxPanel.ninja:hover .cx-titlebar > div,' +
    '#__cxPanel.ninja.ninja-open .cx-titlebar > div{gap:6px!important;}' +
    '#__cxPanel.ninja:hover #__cxPanelBadge,' +
    '#__cxPanel.ninja.ninja-open #__cxPanelBadge{margin:0;}' +
    '@keyframes cx-orb-ring{0%{transform:scale(.7);opacity:.6;}100%{transform:scale(1.7);opacity:0;}}';
  // —— 按钮四级制样式（P5c 组件化：全面板仅一级操作用 PRIMARY）——
  STYLES.BTN_PRIMARY   = 'background:' + STYLES.T.primary + ';color:#fff;border:0;border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  STYLES.BTN_SECONDARY = 'background:' + STYLES.T.border + ';color:' + STYLES.T.text + ';border:0;border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  STYLES.BTN_GHOST     = 'background:' + STYLES.T.surface + ';color:' + STYLES.T.primaryTxt + ';border:1px solid ' + STYLES.T.primary + ';border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  STYLES.BTN_DANGER    = 'background:transparent;color:' + STYLES.T.danger + ';border:1px solid ' + STYLES.T.danger + ';border-radius:' + STYLES.T.r6 + ';cursor:pointer;';
  // 副脚本 UI 接入导出（设计 §5.3：addon 引用令牌保持视觉同构）
  try { window.__cxUI = STYLES; } catch (e) { swallow(e); }

  // ===== 存储与 API 通讯 =====
  // 面板配置持久化（localStorage: cx_panel_cfg）。爬虫桥的 fetch 类 API 通讯仍在其业务模块(bridge)，
  // 此处集中「本地存储」基础能力；后续看播统计等本地存储也可统一收口到此。
  function clampCfg() {                            // 载入后把越界值夹回面板控件允许范围
    CONFIG.AUTO_STOP_MIN = Math.max(0, Math.min(120, +CONFIG.AUTO_STOP_MIN || 0));
    CONFIG.RESUME_AFTER_MIN = Math.max(0, Math.min(60, +CONFIG.RESUME_AFTER_MIN || 0));
    CONFIG.RESCAN_INTERVAL = Math.max(500, Math.min(5000, +CONFIG.RESCAN_INTERVAL || 2000));
    CONFIG.END_RELEASE_SEC = Math.max(0, Math.min(120, +CONFIG.END_RELEASE_SEC || 0));
    CONFIG.USER_RATE = Math.max(0.25, Math.min(4, +CONFIG.USER_RATE || 1));
    CONFIG.PANEL_W = Math.max(288, Math.min(760, +CONFIG.PANEL_W || 380));
    if (CONFIG.INTRUSION_MODE !== 'gentle' && CONFIG.INTRUSION_MODE !== 'aggressive') CONFIG.INTRUSION_MODE = 'auto';
    CONFIG.POLITE_MODE = !!CONFIG.POLITE_MODE;
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
        LOOP_PLAY: CONFIG.LOOP_PLAY,
        SINGLE_VIDEO: CONFIG.SINGLE_VIDEO,
        NINJA_MODE: CONFIG.NINJA_MODE,
        PANEL_W: CONFIG.PANEL_W,
        PANEL_POS: CONFIG.PANEL_POS,
        INTRUSION_MODE: CONFIG.INTRUSION_MODE,
        POLITE_MODE: CONFIG.POLITE_MODE
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
      if (typeof o.SINGLE_VIDEO === 'boolean') CONFIG.SINGLE_VIDEO = o.SINGLE_VIDEO;
      if (typeof o.NINJA_MODE === 'boolean') CONFIG.NINJA_MODE = o.NINJA_MODE;
      if (typeof o.PANEL_W === 'number') CONFIG.PANEL_W = o.PANEL_W;
      if (o.PANEL_POS && typeof o.PANEL_POS.x === 'number' && typeof o.PANEL_POS.y === 'number') CONFIG.PANEL_POS = o.PANEL_POS;
      if (o.INTRUSION_MODE === 'gentle' || o.INTRUSION_MODE === 'aggressive' || o.INTRUSION_MODE === 'auto') CONFIG.INTRUSION_MODE = o.INTRUSION_MODE;
      if (typeof o.POLITE_MODE === 'boolean') CONFIG.POLITE_MODE = o.POLITE_MODE;
      clampCfg();
    } catch (e) { swallow(e); }
  }

  // ===== 站点适配 / 页面路由 =====
  // 站点检测与路由分发：当前聚焦超星学习通(chaoxing)；预留智慧树网(zhihuishu)等兼容点。
  // 路由结果可用于驱动白名单抽取 / 接管策略的差异（不同站点的 attachments 字段、播放器容器不同）。
  // 当前为骨架：detectSite() 识别站点，routeBySite() 预留分支；默认走既有 chaoxing 逻辑，不改动现有行为。
  function detectSite() {
    try {
      var h = (window.location && window.location.hostname) || '';
      if (/chaoxing\.com$/i.test(h)) return 'chaoxing';
      if (/zhihuishu\.com$/i.test(h)) return 'zhihuishu';
    } catch (e) { swallow(e); }
    return 'unknown';
  }
  function routeBySite() {
    var site = detectSite();
    // TODO: 智慧树网适配分支（白名单抽取 / 播放器容器 / 续播策略差异）在此扩展
    return site; // 业务模块可据此分支
  }

  // P4：平台适配收口——把站点私有全局/选择器集中于此，平台改版只改这里。
  // chaoxing 的定向白名单挂全局 window.attachments；属性名亦收口，便于 defineProperty 钩子与读取统一切换。
  function siteAttachments() { try { return window.attachments; } catch (e) { return undefined; } }
  function siteAttachmentsKey() { return 'attachments'; }
  // chaoxing 的全局暂停封装挂在 window.ananas（跨 iframe 需按窗口取，缺省回退顶层）。
  function siteAnanas(win) { try { return (win && win.ananas) || window.ananas; } catch (e) { return null; } }
  // 任务点播放器容器选择器（chaoxing 用 .ans-attach-ct）。
  function siteTaskContainerSel() { return SELECTORS.TASK_CONTAINER; }


  // ===== MODULE: 接管策略开关（biz/policy）=====
  // 域：业务·策略 —— 是否接管视频的「开关判定」，与通用工具解耦（原先错置于 utils/utils.js 顶层）。
  //   页面级 opt-out：?cxforce=off 或 localStorage.cx_force_off='1' → 全局停用（含原型 neutralize 与扫描接管）。
  //   元素级 opt-out：祖先含 [data-cx-force-skip] → 该视频不接管、保留原生暂停。
  // 使用方：meta-config/config.js（apply* 业务动作）、dom/dom.js（overrideVideo 接管前置判定），均为运行时调用。
  //   本模块仅依赖 utils/swallow（同 IIFE 闭包、函数声明 hoist，顺序无关）。

  // 帧级 / 页面级 opt-out：在 @match 限定的 chaoxing/edu.cn 内，仍允许用户关闭本页强制播放。
  //   URL 查询参数 ?cxforce=off 或 localStorage.cx_force_off === '1' 时全局停用（含原型 neutralize 与扫描接管）。
  function forcePlayEnabled() {
    try {
      if (/[?&]cxforce=off/i.test(window.location.search)) return false;
      if (localStorage.getItem('cx_force_off') === '1') return false;
    } catch (e) { swallow(e); }
    return true;
  }

  // 元素级 opt-out：给视频或其任意祖先加 data-cx-force-skip，使其不被接管、保留原生暂停。
  function cxVideoOptOut(v) {
    try {
      if (v && v.closest && v.closest('[data-cx-force-skip]')) return true;
    } catch (e) { swallow(e); }
    return false;
  }

  // ===== DOMAIN: biz/bridge (local crawler bridge client) =====
  // ===== MODULE: 本地桥客户端 =====
  // 域：核心业务模块 —— 本地桥客户端，对接爬虫端清单。
  // ===== 本地桥（cx_crawler/bridge.py）：读取爬虫权威清单 =====
  // 作用：① 当前章 completed 且无未完成任务点 → 本脚本整体避让（不覆盖 pause、不强制续播），
  //         避免重进已完成章节被重新续播；
  //      ② 当前章 objectids（爬虫 RENDER_JOBS=True 渲染产物）→ 预填定向白名单，
  //         早于 siteAttachments() 渲染就绪，定向更快更稳。
  // 桥服务不在线 / 无清单 / URL 缺参时静默回退原有行为（零新增依赖）。
  // 127.0.0.1 属 potentially-trustworthy origin，https 页面可直接 fetch，无混合内容拦截。
  // 【易误判·诊断#一】曾有审查误判 http://127.0.0.1 在 https 页会被混合内容拦截——错：回环地址依 Secure Contexts 规范豁免混合内容；
  //   且 https base 已可经 ?cxbridge= / localStorage.cx_bridge_base 配置，无需改代码。桥在生产环境可用。
  // 端口可配置化（v3.14）：桥地址优先级 = URL ?cxbridge= > localStorage.cx_bridge_base > 默认 127.0.0.1:7531；
  // 默认/指定地址不通时，自动探测候选端口挑首个可达者（与 bridge.py 启动端口对齐即可免手动配置）。
  // 【内聚性收敛】原本地桥逻辑与白名单业务、URL 解析同处 biz/targeting.js；现桥客户端独立成模块，
  //   白名单回归 biz/targeting.js、URL 解析归入 utils/url.js，三者单一职责、互不夹带。
  var BRIDGE = {
    base: null,         // 运行时解析得到
    chapter: null,      // 当前章清单条目
    skipResume: false,  // true = 当前章已完成，禁用强制续播
    version: null       // 修复 M5：桥服务 /ping 回报的版本，供面板/诊断展示，便于发现过旧的桥
  };
  // 桥接探测端口已集中到 CONST（元配置集中层）
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
      if (i >= CONST.BRIDGE_PROBE_PORTS.length) { cb(null); return; }
      var port = CONST.BRIDGE_PROBE_PORTS[i++];
      var url = 'http://127.0.0.1:' + port + '/ping';
      try {
        var _ac = ('AbortController' in window) ? new AbortController() : null;
        var _t = _ac ? setTimeout(function () { try { _ac.abort(); } catch (e) { swallow(e); } }, CONST.BRIDGE_TIMEOUT_MS || 5000) : null;
        fetch(url, _ac ? { mode: 'cors', signal: _ac.signal } : { mode: 'cors' }).then(function (r) {
          if (_t) clearTimeout(_t);
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
        cxState(v).released = true;                                   // F-B6：标记已释放，续播兜底监听不再自动续播
      } catch (e) { swallow(e); } }
    } catch (e) { swallow(e); }
    try {
      [].forEach.call(root.querySelectorAll('iframe'), function (f) {
        try { if (f.contentDocument) restoreNativePause(f.contentDocument); } catch (e) { swallow(e); }
      });
    } catch (e) { swallow(e); }
  }
  function bridgeFetch(cid, kid, base) {
    // 评审#7：严格 CSP(connect-src) 下 fetch 会同步抛异常（而非 promise reject）。
    // 本函数还会在 probe 回调（promise 链内）被调用，同步抛出会变成未处理 rejection，故就地兜住。
    var ac = ('AbortController' in window) ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { try { ac.abort(); } catch (e) { swallow(e); } }, CONST.BRIDGE_TIMEOUT_MS || 5000) : null;  // 桥半死(建连不响应)时避免 promise 永久挂起泄漏
    var p;
    try { p = fetch(base + '/playlist/' + cid, ac ? { signal: ac.signal } : undefined); } catch (e) { if (timer) clearTimeout(timer); dbg('bridge：fetch 被环境拦截(CSP?)，跳过桥'); return; }
    p.then(function (r) { if (timer) clearTimeout(timer); return r.ok ? r.json() : null; })
      .catch(function () { if (timer) clearTimeout(timer); return null; })
      .then(function (d) {
        if (!ac) { /* 超时分支已在上面 catch 处理 */ }
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
  // 桥(bridge.py)为可选组件：绝大多数用户不跑它，默认关闭桥探测，避免在控制台刷一堆
  // ERR_CONNECTION_REFUSED 噪声（浏览器会记录每一次对死端口的失败 fetch）。
  // 启用桥的两种方式（任一即可）：
  //   ① URL 带 ?cxbridge=端口/地址（本就支持的参数，指向你的桥）；
  //   ② localStorage 设 cx_bridge_on=1（手动开启）。
  // 强制关闭：localStorage 设 cx_bridge_off=1 优先于以上。
  function bridgeEnabledByConfig() {
    try {
      if (localStorage.getItem('cx_bridge_off') === '1') return false;       // 显式关闭优先
      if (/[?&]cxbridge=([^&]+)/i.test(window.location.search)) return true;  // URL 显式指定桥地址
      if (localStorage.getItem('cx_bridge_on') === '1') return true;         // 手动开启
    } catch (e) { swallow(e); }
    return false;                                                            // 默认关闭
  }
  function bridgeInit() {
    if (!bridgeEnabledByConfig()) {
      dbg('bridge：未启用（默认关闭，避免无桥时控制台刷红字）。如需启用桥：URL 加 ?cxbridge=端口，或 localStorage 设 cx_bridge_on=1');
      return;
    }
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
        var _ac2 = ('AbortController' in window) ? new AbortController() : null;
        var _t2 = _ac2 ? setTimeout(function () { try { _ac2.abort(); } catch (e) { swallow(e); } }, CONST.BRIDGE_TIMEOUT_MS || 5000) : null;
        fetch(base + '/ping', _ac2 ? { mode: 'cors', signal: _ac2.signal } : { mode: 'cors' }).then(function (r) {
          if (_t2) clearTimeout(_t2);
          if (r && r.ok) {
            // 修复 M5：默认地址可达，记录桥版本（非阻塞）
            try { r.json().then(function (d) { if (d && d.version) BRIDGE.version = d.version; }).catch(function () {}); } catch (e) { swallow(e); }
          } else {
            probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } });
          }
        }).catch(function () { if (_t2) clearTimeout(_t2); probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } }); });
      } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
  }

  // ===== DOMAIN: biz/targeting (targeting whitelist) =====
  // ===== MODULE: 定向/白名单 =====
  // 域：核心业务模块 —— 定向/白名单，驱动续播范围与回退策略。
  // ===== 定向续播：从 siteAttachments() 抽任务点视频白名单 =====
  // 播放页 JS 渲染后，顶层 siteAttachments() 是任务点数组，每项 { property: {...} }，
  // property.objectid / mid / id 为视频资源标识，property.type 标记类型(video/document/...)。
  // 据此只续任务点视频，广告/插播视频不在白名单内 → 跳过（不让 force-play 误续）。
  // 【内聚性收敛】本地桥客户端(BRIDGE / bridgeFetch / bridgeInit / …)已迁至同域 biz/bridge.js，
  //   URL 解析(topHref / urlParam)已迁至 utils/url.js；本文件现仅承载「白名单」单一职责。
  var TARGET = { enabled: false, ids: null, matchedAny: false };

  // 下钻收集 attachments 中所有可定位视频的 id（objectid/mid/id），兼容大小写与子附件
  function collectAttachmentIds() {
    try {
      var a = siteAttachments();
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

  // #1 修复：siteAttachments() 延迟/缺失导致"无米之炊"。
  // 该变量常在 AJAX 回包后异步挂到 window，早期轮询只能读到 undefined；某些旧版/移动端页甚至永不出现。
  // 故：①定义 setter 钩子——页面一旦 assign siteAttachments() 立即触发 refreshTargets，不等 2s 轮询；
  //    ②refreshTargets 退化时优先用桥清单 objectids（爬虫侧权威、早于 AJAX 渲染），保证白名单不空窗；
  //    ③保留轮询兜底，应对 setter 被平台劫持/描述符受限写不进的极端情况。
  var _attachHooked = false;
  // 钩子安装时捕获的 window.attachments 取值容器（跨模块供 cleanupListeners ③ 还原使用）；
  // 仅当 window 无自有属性时本钩子才会安装，故容器内即「注入前语义」的快照，cleanup 据此还原以免 delete 丢失平台数据。
  var _attachStore = null;
  function hookAttachments() {
    if (_attachHooked) return;
    try {
      if (Object.getOwnPropertyDescriptor(window, siteAttachmentsKey())) return;  // 已被平台定义（不可重定义）→ 退回轮询兜底
      _attachStore = { value: siteAttachments() };
      Object.defineProperty(window, siteAttachmentsKey(), {
        configurable: true,
        enumerable: true,
        get: function () { return _attachStore.value; },
        set: function (v) {
          _attachStore.value = v;
          try { refreshTargets(); } catch (e) { swallow(e); }   // 即时重建白名单，无需等下一个 2s 周期
        }
      });
      _attachHooked = true;
    } catch (e) { swallow(e); }
  }

  // 刷新定向目标：基于 siteAttachments() + 桥清单 objectids 重建任务点白名单。
  // 改进（吸收评审）：① 滞回——已启用状态下若本次 attachments 暂为空窗，保持稳定不回退，避免"定向↔全量"横跳误触广告；
  //                 ② 仅在"任务点 id 集合真变化"(真实章节/课程切换)时清空 ENDED_SRCS 黑名单，既保留重建重播保护，
  //                    又允许切到新一课/回看（原"任意新 video 即清空"写法会令黑名单失效，已删除）。
  // #1 强化：attachments 永不出现时，桥 objectids 可独立撑起白名单（ids 非空即启用），不再"无米之炊"。
  var _lastTaskKey = null;
  var _lastChapterKey = null;                 // 专项诊断#八：章节参数跟踪，跨章复用同 objectid 时强制清空 ENDED_SRCS 防误锁
  var _targetMissStreak = 0;                  // 定向 0 命中连续轮数（迟滞：连续 N 轮才回退全量，避免瞬时空窗横跳，专项诊断#三）
  // 定向回退轮数阈值已集中到 CONST（元配置集中层）
  var _dbgTargetState = null;                 // 诊断#刷屏修复：记录上次 dbg 输出的定向/全量状态，仅在状态切变时打印，避免每轮 2s 刷屏
  var _lockFg = null;                         // 锁定前台视频（不为 null 时，忽略自动前台计算，强制将此视频视为前台）
  // 运维仪表盘数据（_moHistory/_safePlay*/_targetHit*）与黑匣子（_bxBuffer/_bxLog）已迁出至
  // state/metrics.js（可观测性状态层）——它们不属于定向业务。本文件仍可直接调用 _bxLog（同一 IIFE 闭包）。
  // 原 _lastMoLen 为死变量（仅声明、无任何读写，趋势判断实际由 _moHistory 承担），已随迁移删除。
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
      // 诊断#刷屏修复：原先每轮(2s)都无条件打印"定向模式启用"刷屏控制台；
      // 改为仅在「全量↔定向」状态切换、或任务点 id 集真变化(_taskChanged)时打印，稳定态保持静默。
      if (_dbgTargetState !== 'target' || _taskChanged) {
        dbg('定向模式启用，任务点 id 数=', keyArr.length);
        _dbgTargetState = 'target';
      }
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
        // 诊断#刷屏修复：仅在「定向→全量」状态跃迁那一次打印，避免后续每轮重复刷屏。
        if (_dbgTargetState !== 'fallback') {
          dbg('无可用 attachments 任务点，回退全续播');
          _dbgTargetState = 'fallback';
        }
      }
    }
    try { Store.emit('targets:updated'); } catch (e) { swallow(e); }   // P3：定向目标变更信号（事件总线，供 UI 订阅刷新面板）
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
      try { var _hs = cxState(v).hostSigs; if (_hs) { for (var _hi = 0; _hi < _hs.length; _hi++) { if (_hs[_hi]) urls.push(_hs[_hi]); } } } catch (e) { swallow(e); }
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

  // ===== DOMAIN: biz/dedup (replay hardening / dedup) =====
  // ===== MODULE: 重播加固(去重) =====
  // 域：核心业务模块 —— 重播加固(去重)。
  // ===== 重播加固：用 currentSrc 去重"已播完任务的整元素重建" =====
  // 平台跳课时可能销毁旧 video 并以全新元素重建同一已播完视频（src 相同），旧 __cxEndedLock 失效 → 误续播。
  // 故：ended 锁定时登记其 currentSrc；任何"非 ended、地址命中已结束集合"的新 video = 同一任务点重建 → 锁死不播。
  var ENDED_SRCS = {};
  // 已结束 src 上限已集中到 CONST（元配置集中层）
  function _endedPrune() {
    try {
      var _ks = Object.keys(ENDED_SRCS);
      if (_ks.length > CONST.ENDED_SRCS_CAP) {
        var _drop = _ks.length - CONST.ENDED_SRCS_CAP;
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
      var _hs = cxState(v).hostSigs;
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

  // ===== DOMAIN: biz/playback (playback primitives / takeover helpers) =====
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
      // 手动实现 once 语义：老浏览器（Safari<10/IE）静默忽略 {once:true} 选项会导致监听器永久累积泄漏（吸收评审#H），
      // 故显式 removeEventListener 兜底，确保无论浏览器是否支持 once 选项都能在首次 playing 后自移除。
      // 【易误判·诊断#五】无需加去重标志：自移除保证 playing 触发即退订；仅"自动播放彻底被禁且永不 playing"的病理场景才暂存，可接受。
      try {
        var _cxOnPlaying = function () { try { v.removeEventListener('playing', _cxOnPlaying); } catch (e) { swallow(e); } _safePlaySuccesses++; restore(); };
        v.addEventListener('playing', _cxOnPlaying);
      } catch (e) { swallow(e); }
      _safePlayAttempts++;
      _bxLog('safePlay', 'src=' + (videoSrcOf(v) || '?').slice(-40) + ' muted=' + wasMuted);
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
  // F-B1 修复：定向模式下被"跳过"的视频，若此前已在全量续播阶段被本脚本接管
  // （siteAttachments() / 桥 objectids 晚于首扫到达），必须撤销接管交还平台；否则广告/插播视频会
  // 残留 v.pause=pauseNoop、__cxForcePaused=true，被永久强制续播且用户无法暂停，与"定向跳过"目标直接相悖。
  // 仅撤销"续播接管"，保留 __cxEndedLock / 重建去重（已结束任务不应被释放重播）。
  function releaseVideo(v) {
    if (!v || (!v.__cxForcePaused && !cxState(v).released)) return;   // 未接管或已释放则跳过（幂等）
    try { v.pause = v.__np || NATIVE_PAUSE; } catch (e) { swallow(e); }       // 恢复实例级原生 pause（绕过原型 no-op），用户/平台可正常暂停
    v.__cxForcePaused = false;                                   // 关闭原型 pause 的 no-op 拦截
    cxState(v).released = true;                                       // 标记已释放：续播兜底监听(pause/canplay/waiting/stalled)不再自动续播
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

  // ===== DOMAIN: biz/stats (watch stats, local estimate) =====
  // ===== MODULE: 看播统计 =====
  // 域：核心业务模块 —— 看播统计/进度本地估算。
  // ===== 本地观看时长统计（进度同步·本地估算，非平台上报）=====
  // 把每视频已看毫秒按「视频源」累计到 window.__CX_FORCE_PLAY.watchStats[src]={ms,courseId,updated}，
  // 节流持久化到 localStorage.cx_watch_stats（跨会话累计）。仅供进度面板做"本地估算"展示，
  // 不读取平台回看时长、不发起任何上报（符合只读 GET 章程与合规红线）。
  var _watchStats = {};
  var _watchPersistAt = 0;
  function loadWatchStats() {
    try { _watchStats = JSON.parse(localStorage.getItem('cx_watch_stats') || '{}') || {}; } catch (e) { _watchStats = {}; }
    try { window.__CX_FORCE_PLAY.watchStats = _watchStats; } catch (e) { swallow(e); }
  }
  // 淘汰最旧统计（按 updated 升序），防长时跨课程使用撑爆 localStorage 5MB 配额
  function _watchStatsPrune() {
    try {
      var ks = Object.keys(_watchStats);
      if (ks.length <= CONST.WATCH_STATS_CAP) return;
      ks.sort(function (a, b) { return (_watchStats[a].updated || 0) - (_watchStats[b].updated || 0); });
      var drop = ks.length - CONST.WATCH_STATS_CAP;
      for (var i = 0; i < drop; i++) delete _watchStats[ks[i]];
    } catch (e) { swallow(e); }
  }
  function recordWatchMs(src, dt, courseId) {
    if (!src || dt <= 0) return;
    var e = _watchStats[src] || { ms: 0, courseId: courseId || '', updated: 0 };
    e.ms = (e.ms || 0) + dt;
    e.courseId = courseId || e.courseId || '';
    e.updated = Date.now();
    _watchStats[src] = e;
    try { window.__CX_FORCE_PLAY.watchStats = _watchStats; } catch (e2) { swallow(e2); }
    var now = Date.now();
    if (now - _watchPersistAt > 10000) {   // 10s 节流写盘，避免每 2s 轮询都 JSON.stringify
      _watchPersistAt = now;
      _watchStatsPrune();   // 写盘前先淘汰最旧，避免配额溢出
      try { localStorage.setItem('cx_watch_stats', JSON.stringify(_watchStats)); } catch (e3) { swallow(e3); }
    }
  }

  // ===== DOMAIN: biz/foreground (foreground detection + display helpers) =====
  // ===== MODULE: 用户暂停开关 =====
  // 域：核心业务模块 —— 用户暂停开关闸门。
  // —— 用户暂停开关（手动暂停键 + 自动停止计时器）——
  // v.__cxUserPaused：用户主动暂停锁。置位后 overrideVideo 不再施加 noop 覆盖、各兜底监听与正常续播均避让，
  // 视频可正常暂停/播放；与原先 __cxReleased（定向跳过/桥避让的"交还平台"语义）分离，避免被重新接管逻辑误清除。


  // ===== MODULE: 前台判定（修复"多个视频同时播放"）=====
  // 域：核心业务模块 —— 前台判定（修复多视频同播）。
  // 仅在"明确可见且面积最大"的视频上强制续播，其余视频交还平台并主动压下，避免一页多视频同时播放。
  // 可见性以 getBoundingClientRect 面积判断：display:none / 零尺寸预加载预览会被排除；
  // 滚动出视口但仍布局的视频面积仍为正，视为前台（不希望因滚动就释放当前任务）。
  function foregroundVideo() {
    // 前台锁定：用户强制指定前台视频，忽略自动面积计算
    if (_lockFg) {
      try {
        if (_lockFg.isConnected && !_lockFg.ended) {
          var lr = _lockFg.getBoundingClientRect();
          if ((lr.width || 0) * (lr.height || 0) > 4) return _lockFg;
        }
      } catch (e) { swallow(e); }
      _lockFg = null; // 锁定视频已失效（脱离 DOM / 已结束 / 不可见），自动解锁
    }
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
  // HTML 转义：防止动态内容经 innerHTML 注入（XSS）。与 progress-panel.escapeHTML 实现一致。
  function escapeHTML(s) {
    return ('' + (s == null ? '' : s)).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function shortSrc(v) {
    var s = (v && (v.currentSrc || v.src)) || '';
    if (!s) return '(未知源)';
    try { s = decodeURIComponent(s); } catch (e) {}
    return s.length > 76 ? (s.slice(0, 48) + '…' + s.slice(-26)) : s;
  }

  // ===== DOMAIN: dom module-08-10-15 =====
  // ===== MODULE: 接管引擎(overrideVideo) =====
  // 域：DOM监听与注入层 —— 接管引擎(overrideVideo)。
  function overrideVideo(v, fg) {
    if (!v) return;
    if (cxVideoOptOut(v)) return;   // 元素级 opt-out：data-cx-force-skip 的视频不接管
    if (BRIDGE.skipResume) return;
    // 定向命中统计：即便视频被用户暂停（上方 _ovUserPaused 提前 return）也要计入，否则全部暂停时 matchedAny 恒 false → 误触 fallback 回退全量（复审确认）
    if (TARGET.enabled && !TARGET.matchedAny && videoBelongsToTask(v)) TARGET.matchedAny = true;
    if (_ovUserPaused(v)) return;
    if (_ovSkipNonTask(v)) return;
    if (_ovForegroundGate(v, fg)) return;
    if (_ovNearEnd(v)) return;
    if (cxState(v).released) { v[FLAGS.forcePaused] = true; cxState(v).released = false; }   // F-B1：曾被释放、现重新归属任务点 → 重新接管
    if (_ovEndedLock(v)) return;
    if (_ovRebuild(v)) return;
    _ovEnforce(v);
  }

  // —— overrideVideo 子阶段（P2 拆分，零行为回归）——
  // 每个 _ovX 返回 true 表示「本阶段已接管/应终止，overrideVideo 据此 return」。
  // 子函数与主函数同处一个 IIFE 闭包，直接捕获 BRIDGE/TARGET/CONFIG/safePlay 等，无需提升状态。

  function _ovUserPaused(v) {
    if (!v[FLAGS.userPaused]) return false;
    try { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; } catch (e) { swallow(e); }
    try { if (!v.paused) (v[FLAGS.np] || NATIVE_PAUSE).call(v); } catch (e2) { swallow(e2); }
    return true;
  }

  function _ovSkipNonTask(v) {
    if (!(TARGET.enabled && !videoBelongsToTask(v))) return false;
    dbg('跳过非任务点视频（广告/插播）');
    releaseVideo(v);   // F-B1：撤销全量阶段已施加的接管，交还平台（否则广告/插播被永久强制续播）
    return true;
  }

  function _ovForegroundGate(v, fg) {
    if (!fg || v === fg) return false;   // 无前台 或 本视频就是前台：不干预（跳过）
    if (!CONFIG.SINGLE_VIDEO && cxState(v).userKeep) return false;   // 非单视频模式：用户显式保留的视频不干预
    // 单视频模式：忽略 userKeep，强制暂停所有非前台视频
    if (v[FLAGS.forcePaused]) {
      try { releaseVideo(v); } catch (e) { swallow(e); }
      try { if (!v.paused) (v[FLAGS.np] || NATIVE_PAUSE).call(v); } catch (e2) { swallow(e2); }
    }
    return true;   // 非前台视频：已暂停，允许 overrideVideo 后续阶段检查（nearEnd/ended 等）
  }

  function _ovNearEnd(v) {
    if (!(nearEnd(v) && !CONFIG.LOOP_PLAY)) return false;
    try { if (!v[FLAGS.endedLock]) releaseVideo(v); } catch (e) { swallow(e); }   // 释放接管（保留 ended 锁/重建锁）
    // P0 修复（v4.7.replay）：releaseVideo 将 play 恢复为原生后，视频 ended 时页面可能立即调用 play() 导致重播。
    // 必须安装 ended 事件监听器，在页面 ended handler 之前（捕获阶段）将 play 重新封锁，消除竞赛窗口。
    if (!v[FLAGS.nearEndEndedGuard]) {
      try {
        v[FLAGS.nearEndEndedGuard] = true;
        v.addEventListener('ended', function nearEndEndedGuard() {
          if (CONFIG.LOOP_PLAY) return;   // 循环已开：交给 _ovEnforce 的循环分支处理
          if (v[FLAGS.endedLock]) return; // 已被其他路径锁住（如 _ovEnforce ended 分支）
          try {
            v.play = function () { return Promise.resolve(); };     // 封锁 play
            v.pause = pauseNoop;                                    // 封锁 pause
            v[FLAGS.endedLock] = true;                              // 后续扫描由 _ovEndedLock 维护
            v[FLAGS.forcePaused] = true;                            // 原型级 no-op 同步生效
            cxState(v).endedSrc = (videoSrcOf(v) || '');             // 换源识别用
            try { _markEnded(videoSrcOf(v)); } catch (e1) { swallow(e1); }
            try { _endedPrune(); } catch (e1) { swallow(e1); }
            try { if (isFinite(v.duration)) v.currentTime = v.duration; } catch (e1) { swallow(e1); }
            dbg('nearEnd·ended 锁：平台 ended handler 前封锁 play，阻断重播');
          } catch (e) { swallow(e); }
        }, true);
      } catch (e) { swallow(e); }
    }
    dbg('进度到底（剩 ' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's）：已关闭续播');
    try { if (typeof _bxLog === 'function') _bxLog('ov:NearEnd', 'rem=' + Math.max(0, (v.duration - v.currentTime)).toFixed(0) + 's'); } catch (e) { swallow(e); }
    return true;
  }

  function _ovEndedLock(v) {
    if (!v[FLAGS.endedLock]) return false;
    // 复用同元素跨"下一节"换源：旧 ended 锁会误锁新一课，使新视频停在末尾无法播放。
    // 判定当前 src 与当初被锁死的源不同 → 解除旧锁并重新接管（不 return，落到下方正常续播）。
    try {
      var _cur = videoSrcOf(v) || '';
      if (_cur && cxState(v).endedSrc && _cur !== cxState(v).endedSrc) {
        v[FLAGS.endedLock] = false;
        try { delete v.play; } catch (e0) { swallow(e0); }
        try { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; } catch (e0) { swallow(e0); }
        dbg('复用元素换源(new lesson)：解除旧 ended 锁，重新接管「' + shortSrc(v) + '」');
      }
    } catch (e) { swallow(e); }
    if (v[FLAGS.endedLock]) {   // 仍是同一已结束视频 → 持续维持锁，阻断重播
      try { v.pause = pauseNoop; } catch (e2) { swallow(e2); }
      v[FLAGS.forcePaused] = true;   // 原型级 no-op 也生效（即便实例 own 属性被重置）
      v.play = function () { return Promise.resolve(); };
      try { if (v.duration && isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e2) { swallow(e2); }
      dbg('ended 锁持续维持，阻断重播');
      return true;
    }
    return false;
  }

  function _ovRebuild(v) {
    if (!(v.ended && !v[FLAGS.endedLock] && isRebuildFinished(v))) return false;
    if (CONFIG.LOOP_PLAY) {
      dbg('循环播放：允许已结束任务的重建 video 重播');  // 不锁死，交给 _ovEnforce 正常续播 + loop 属性实现重播
      return false;   // 不终止：交给 _ovEnforce 正常续播
    }
    try { v.pause = pauseNoop; v.play = function () { return Promise.resolve(); }; v.loop = false; cxState(v).rebuild = true; } catch (e) { swallow(e); }
    v[FLAGS.forcePaused] = true;
    dbg('跳过已结束任务的重建 video（防整元素重播）');
    return true;
  }

  function _ovEnforce(v) {
    try {
      // MediaSession 劫持提到最前面：所有状态都执行（含 ended），应对锁屏界面续播。
      try {
        if (navigator.mediaSession) {
          // 懒保存注入前原始 pause handler 与 playbackState（仅首次），供 cleanupListeners ④ 还原（审查高优先级#3）。
          if (!_mediaSessionSaved) {
            try { _origMediaSessionPause = (typeof navigator.mediaSession.getActionHandler === 'function') ? navigator.mediaSession.getActionHandler('pause') : null; } catch (e) { _origMediaSessionPause = null; }
            try {             _origMediaSessionState = navigator.mediaSession.playbackState; } catch (e) { _origMediaSessionState = null; }
            _mediaSessionSaved = true;
            try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._mediaSessionHooked = true; } catch (e) { swallow(e); }   // 安全审计(建议#10)：标记 mediaSession 已接管，供面板实时盘点
          }
          navigator.mediaSession.setActionHandler('pause', function () {});
          navigator.mediaSession.playbackState = 'playing';   // 视频实则在播，状态标 playing 与"劫持 pause 为 no-op"语义一致，锁屏不误发暂停
        }
      } catch (msE) { swallow(msE); }

      if (!cxState(v).init) {
        v[FLAGS.np] = NATIVE_PAUSE;
        v[FLAGS.forcePaused] = true;
        v.loop = CONFIG.LOOP_PLAY;
        v.addEventListener('pause', function () {
          try { if (!v[FLAGS.anHold] && !BRIDGE.skipResume && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('ratechange', function () {
          try { if (!v[FLAGS.anHold] && !v[FLAGS.userPaused] && v.playbackRate <= 0.01) v.playbackRate = (CONFIG.USER_RATE || 1); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('canplay', function () {
          try { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused] && v.paused && v.readyState >= 2) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('waiting', function () {
          try { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        v.addEventListener('stalled', function () {
          try { if (!v.ended && !v[FLAGS.anHold] && !BRIDGE.skipResume && !v[FLAGS.endedLock] && !isRebuildFinished(v) && !cxState(v).released && !v[FLAGS.userPaused]) safePlay(v); } catch (e) { swallow(e); }
        }, true);
        cxState(v).init = true;
        try { Store.emit('video:state', { src: shortSrc(v), action: 'takeover' }); } catch (e) { swallow(e); }
        try { if (typeof _bxLog === 'function') _bxLog('ov:Takeover', 'init video ' + (shortSrc(v) || '?')); } catch (e) { swallow(e); }
      }
      v.pause = pauseNoop;
      v.loop = CONFIG.LOOP_PLAY;

      if (v.ended) {
        if (CONFIG.LOOP_PLAY) {
          try { v[FLAGS.endedLock] = false; } catch (e) { swallow(e); }
          try { v.loop = true; } catch (e) { swallow(e); }
          try { v.pause = pauseNoop; } catch (e) { swallow(e); }
          try { v.currentTime = 0; } catch (e) { swallow(e); }
          v[FLAGS.forcePaused] = true;
          if (v.paused) safePlay(v);
          dbg('循环播放：视频播完，从头重播');
          return true;   // 终止 enforce（即 overrideVideo 终止；下方正常续播不再执行）
        }
        v.play = function () { return Promise.resolve(); };  /* !!! 必须先封锁 play，再调原生 pause：否则 pause 事件监听器里的 safePlay 会调用尚未被替换的原生 play，导致已结束视频被打断→重播（swallow-all 循环） */
        try { if (v[FLAGS.np]) v[FLAGS.np](); } catch (e) { swallow(e); }
        try { v[FLAGS.endedLock] = true; } catch (e) { swallow(e); }
        try { cxState(v).endedSrc = (videoSrcOf(v) || ''); } catch (e) { swallow(e); }
        try { cxState(v).userKeep = false; } catch (e) { swallow(e); }
        try { _markEnded(videoSrcOf(v)); } catch (e) { swallow(e); }
        try { var _iss = videoIframeSrcsOf(v); for (var _i = 0; _i < _iss.length; _i++) _markEnded(_iss[_i]); } catch (e) { swallow(e); }
        _endedPrune();
        try { if (isFinite(v.duration)) v.currentTime = v.duration; } catch (e) { swallow(e); }
        if (!v.__seekArmed) {
          v.__seekArmed = true;
          v.addEventListener('seeking', function () {
            try { if (isFinite(v.duration) && v.currentTime < v.duration) v.currentTime = v.duration; } catch (e) { swallow(e); }
          }, true);
        }
        dbg('ended：已锁定 currentTime 并覆盖 play 为 no-op，阻断重播');
        return true;   // 终止 enforce
      }

      if (v.paused && !v[FLAGS.anHold] && !cxState(v).released && !v[FLAGS.userPaused] && v.readyState >= 2) { safePlay(v); }
      if (v.playbackRate <= 0.01 && !cxState(v).released && !v[FLAGS.anHold] && !v[FLAGS.userPaused]) { v.playbackRate = (CONFIG.USER_RATE || 1); }
      else if (CONFIG.USER_RATE && CONFIG.USER_RATE !== 1 && v[FLAGS.forcePaused] && !cxState(v).released && !v[FLAGS.anHold] && !v[FLAGS.userPaused] && v.playbackRate > 0.01 && v.playbackRate !== CONFIG.USER_RATE) { v.playbackRate = CONFIG.USER_RATE; }
    } catch (e) { swallow(e); }
  }

  // 中和平台暴露的全局暂停封装（如 window.ananas.pause）。
  // 'use strict' 下若属性不可写/不可配置，直接赋值会抛 TypeError 被静默吞掉导致中和失效。
  // 故优先用 defineProperty 在实例上创建 own 属性遮蔽——无论 pause 是自有还是原型继承都能遮蔽（吸收评审#2/#D）；
  // 仅当 defineProperty 失败（自有属性 non-configurable）再回退普通赋值，仍失败则 dbg 暴露。
  function neutralizeGlobalPause(win) {
    try {
      var a = siteAnanas(win);
      if (a && typeof a.pause === 'function') {
        var done = false;
        try {
          if (!a.__cxAnanasNativePause) a.__cxAnanasNativePause = a.pause;   // 仅首次保存注入前真原生 pause（重复下钻同一 ananas 不覆盖）
          Object.defineProperty(a, 'pause', { value: function () {}, configurable: true, writable: true });
          done = true;
        } catch (de) {
          try { a.pause = function () {}; done = true; } catch (ae) { swallow(ae); }
        }
        if (done) {
          if (_ananasNeutralized.indexOf(a) === -1) _ananasNeutralized.push(a);   // 记入还原清单（跨 iframe 各 ananas 独立实例）
        } else {
          dbg('window.ananas.pause 无法中和(描述符受限)');
        }
      }
    } catch (e) { dbg('neutralizeGlobalPause 异常', e); }
  }



  // ===== MODULE: 视频枚举(walkVideos · 审查 JS1-3「scanVideos 三合一」) =====
  // 域：DOM监听与注入层 —— 视频枚举原语(walkVideos/scanVideos/allVideos)。
  // scanVideos(强制接管)、allVideos(收集/诊断/面板)、installPlayWatch(iframe 内 play 即时接管)
  // 原本各有独立遍历(Shadow DOM + 同源 iframe)，口径不一致曾导致「视频在播但诊断 0 / 手动暂停被接管」矛盾。
  // 现统一为单一递归原语 walkVideos：onVideo(v, hostSigs) 对每个视频调用；onDoc(doc, frame) 进入每个同源 iframe 文档时调用。
  // 扫描深度上限集中到 CONST（元配置集中层）
  function walkVideos(root, hostSigs, depth, onVideo, onDoc) {
    if (!root || !root.querySelectorAll) return;
    depth = depth || 0;
    if (depth > CONST.MAX_SCAN_DEPTH) return;
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
        var _cts = root.querySelectorAll(SELECTORS.VIDEO_BOX + ', ' + siteTaskContainerSel());
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
      [].forEach.call(root.querySelectorAll('iframe'), function (f) {
        try {
          if (f.contentWindow && f.contentDocument) {
            var _hs = (hostSigs || []).concat(signatureOf(f));   // 宿主 iframe 签名下钻传入（修复复审#2）
            try { if (f.src) _hs.push(f.src); } catch (e2) { swallow(e2); }
            walkVideos(f.contentDocument, _hs, depth + 1, onVideo, onDoc);
            if (!cxState(f).pw) { cxState(f).pw = true; installPlayWatch(f.contentDocument); }   // 仅在首次下钻为 iframe 内视频装 play 即时接管（避免每轮重复挂载）
            try { neutralizeGlobalPause(f.contentWindow); } catch (e3) { swallow(e3); }
            try { if (onDoc) onDoc(f.contentDocument, f); } catch (e3) { swallow(e3); }
          }
          // 修时序：动态创建的播放器 iframe 可能尚未加载完，等 load 后再扫一次
          if (!cxState(f).loaded) {
            cxState(f).loaded = true;
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
    if (!forcePlayEnabled()) return;   // opt-out：全局停用时不接管任何视频
    var fg = foregroundVideo();   // 每轮仅算一次前台，避免 O(n²)；非前台视频在 overrideVideo 内被门控释放
    walkVideos(root, null, 0, function (v, hs) {
      try { if (hs) cxState(v).hostSigs = hs; } catch (e) { swallow(e); }
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
  // 【内聚性收敛】userPause / userResume / autoStopTick / resumeTick 已迁至 biz/session.js（观看会话：用户意图与计时），
  //   toast 已迁至 ui/toast.js（纯 UI 渲染，经 Store.emit('ui:toast') 触发）。本模块只保留 DOM 接管引擎与视频枚举。
  function currentVideo() {                       // 当前目标视频：优先正在播放者；否则优先已用户暂停者；否则首个 video（供面板操作）
    var act = activeVideo(); if (act) return act;
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try { if (vs[i][FLAGS.userPaused]) return vs[i]; } catch (e) { swallow(e); } }
    return vs[0] || null;
  }


  // ===== MODULE: DOM 变动驱动 + 自启动 =====
  // 域：DOM监听与注入层 —— DOM 变动驱动 + 自启动入口。
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
      if (_moQueue.length > CONST.MO_QUEUE_CAP) { try { _moFlush(); } catch (e) { swallow(e); } }   // 安全阀：极端高频/后台节流窗口兜底排空，防队列无限膨胀（专项#切屏崩溃）
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
      try { neutralizeGlobalPause(window); } catch (e) { swallow(e); }   // 切回时一并中和 全局暂停封装，防平台在隐藏期重置（吸收评审#5）
    }
  }
  try {
    document.addEventListener('visibilitychange', visibilityHandler, true);   // 捕获阶段，但绝不 stopPropagation
  } catch (e) { swallow(e); }

  // 【内聚性收敛】卸载还原（_ananasNeutralized / _playWatchDocs / cleanupListeners / pagehide 钩子 / uninstall 导出）
  //   已迁至 dom/lifecycle.js —— 接管引擎负责「加 Hook」，lifecycle 负责「拆 Hook」，职责相反故分离。



  // ===== DOMAIN: biz session =====
  // ===== MODULE: 观看会话（用户暂停/恢复 + 计时器） =====
  // 域：业务层 —— 「用户意图」与「观看时长」的会话状态管理。
  //
  // 【内聚性收敛】本块原寄居于 dom/dom.js，与 overrideVideo/walkVideos（DOM 接管）混居。
  // 但二者层次不同：接管引擎表达的是「脚本要让视频一直播」，本模块表达的是「用户/计时器要它停」——
  // 后者是前者的**覆盖层**（通过 FLAGS.userPaused 令接管引擎的 _ovUserPaused 提前 return）。
  // 把「用户意图」从「DOM 接管机制」里剥离出来，二者的优先级关系才显式可读。
  //
  // 【职责边界】
  //   userPause / userResume  —— 用户显式意图的写入口（含播放闸门 defineProperty）
  //   autoStopTick            —— 观看计时累计 + 满 AUTO_STOP_MIN 自动暂停
  //   resumeTick              —— 到点自动恢复
  // 三者共同维护 FLAGS.userPaused / cxState(v).{userKeep,resumeAt,watchMs} 这组会话状态。
  //
  // 依赖（均为顶层 var/function，同一 IIFE 闭包，运行时求值，不受拼接顺序影响）：
  //   allVideos / foregroundVideo（视频枚举与前台判定）、safePlay（biz/playback）、
  //   NATIVE_PAUSE / NATIVE_PLAY（config）、ENDED_SRCS（biz/dedup）、recordWatchMs（biz/stats）、
  //   urlParam / topHref（utils/url）、Store（state）。

  function userPause(v) {                         // 用户暂停：真正停住并置锁；按 RESUME_AFTER_MIN 排自动恢复
    if (!v) return;
    v[FLAGS.userPaused] = true;
    cxState(v).userKeep = false;                       // 用户主动暂停即取消"保留播放"标记（门控可重新管理该视频）
    try { (v[FLAGS.np] ? v[FLAGS.np] : NATIVE_PAUSE || v.pause).call(v); } catch (e) { swallow(e); }   // 原生 pause 真正停住（绕过原型/实例 noop）
    // 播放闸门：脚本此前只拦"暂停"从不拦"播放"，平台播放器自调 video.play() 会把用户暂停的视频拉回播放
    //（实测诊断：状态 playing 而 UserPaused=true 的矛盾态）。在实例上遮蔽 play：用户暂停期间一律拒绝。
    try {
      Object.defineProperty(v, 'play', { configurable: true, writable: true, value: function () {
        if (this[FLAGS.userPaused]) { dbg('播放闸门：用户暂停中，拒绝 play()'); return Promise.resolve(); }
        return NATIVE_PLAY ? NATIVE_PLAY.apply(this, arguments) : Promise.resolve();
      } });
    } catch (eG) { swallow(eG); }
    if (CONFIG.RESUME_AFTER_MIN > 0) cxState(v).resumeAt = Date.now() + CONFIG.RESUME_AFTER_MIN * 60000;
    try { Store.emit('ui:toast', '已暂停续播（手动/计时）', 'success'); } catch (e2) { swallow(e2); }
  }

  function userResume(v) {                        // 用户恢复：清锁并续播
    if (!v) return;
    v[FLAGS.userPaused] = false;
    if (v !== foregroundVideo()) cxState(v).userKeep = true;   // 用户对非前台视频显式恢复：打保留标记，门控不再误回收（修复"其他视频无法开启"）
    cxState(v).resumeAt = 0;
    cxState(v).watchMs = 0;                            // 重置自动停止计时，避免恢复后立刻再停
    // 修复复审（低-中危）：恢复续播应能重看已播完视频——清 ended 锁并解除全局黑名单，否则下一轮 overrideVideo 又把 play 设回 no-op 锁死
    if (v[FLAGS.endedLock]) {
      v[FLAGS.endedLock] = false;
      try { if (v.duration && isFinite(v.duration) && v.currentTime > 0) v.currentTime = 0; } catch (e) { swallow(e); }   // 从头重看
      try { delete ENDED_SRCS[videoSrcOf(v)]; } catch (e) { swallow(e); }                                          // 解除本视频地址黑名单
      try { var _hsg = cxState(v).hostSigs; if (_hsg) { for (var _hg = 0; _hg < _hsg.length; _hg++) { try { delete ENDED_SRCS[_hsg[_hg]]; } catch (e2) { swallow(e2); } } } } catch (e) { swallow(e); }
    }
    try { delete v.play; } catch (e3) { swallow(e3); }          // 拆除播放闸门，还原原型 play
    try { safePlay(v); } catch (e) { swallow(e); }
    try { Store.emit('ui:toast', '已恢复续播', 'success'); } catch (e2) { swallow(e2); }
  }

  var _lastWatchTick = Date.now();                // 上次计时采样点（真实墙钟差值，后台节流/休眠也不会多算或少算）
  function autoStopTick() {                       // 观看计时（始终累计，供面板"已看"显示）+ 满 AUTO_STOP_MIN 分钟自动暂停
    var now = Date.now();
    var dt = now - _lastWatchTick; _lastWatchTick = now;
    if (dt < 0 || dt > 60000) dt = CONFIG.RESCAN_INTERVAL;   // 防休眠唤醒/时钟回拨造成的大跳
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try {
      var v = vs[i];
      if (v[FLAGS.userPaused] || v.ended) continue;
      if (!v.paused && v.readyState >= 2) {
        cxState(v).watchMs = (cxState(v).watchMs || 0) + dt;
        recordWatchMs(videoSrcOf(v), dt, urlParam(topHref(), ['courseId']));  // 进度同步·本地估算：按课程累计已看时长
        if (CONFIG.AUTO_STOP_MIN > 0 && cxState(v).watchMs >= CONFIG.AUTO_STOP_MIN * 60000) userPause(v);
      }
    } catch (e) { swallow(e); } }
  }

  function resumeTick() {                         // 暂停后自动恢复：到 __cxResumeAt 时间则自动续播
    var vs = allVideos();
    for (var i = 0; i < vs.length; i++) { try {
      var v = vs[i];
      if (v[FLAGS.userPaused] && cxState(v).resumeAt && Date.now() >= cxState(v).resumeAt) userResume(v);
    } catch (e) { swallow(e); } }
  }

  // ===== DOMAIN: ui toast =====
  // ===== MODULE: 轻提示组件(toast) =====
  // 域：界面层 —— 全局轻提示（反馈分级）。
  //
  // 【内聚性收敛】本组件原寄居于 dom/dom.js（接管引擎），与 overrideVideo/walkVideos 等 DOM 接管逻辑混居。
  // 它实为纯 UI 渲染单元：只读 STYLES，只写一个 #__cxToast 节点，不触碰任何 video 状态，故迁入 ui 域。
  //
  // 【调用契约】全代码库一律通过 Store.emit('ui:toast', msg, level) 触发，从不直接调用 toast()。
  //   订阅侧在 ui/panel.js：Store.onEv('ui:toast', toast)。
  //   因此本次迁移是纯位置移动，零调用点改动——emit/on 的解耦让发布方无需知道渲染实现在哪个模块。
  //
  // 依赖：STYLES（ui/styles.js，构建顺序在前）/ cxState（utils）/ swallow（utils）。

  // P5c 反馈分级：toast(msg, level) —— info(默认黑边) / success(绿边) / warn(黄边) / error(红边)（设计 §6.1）
  function toast(msg, level) {
    try {
      var t = document.getElementById('__cxToast');
      if (!t) { t = document.createElement('div'); t.id = '__cxToast'; t.style.cssText = STYLES.TOAST; if (document.body) document.body.appendChild(t); }
      if (!t) return;
      var edge = { success: STYLES.T.success, warn: STYLES.T.warning, error: STYLES.T.danger }[level] || 'transparent';
      t.style.borderLeft = '3px solid ' + edge;
      t.textContent = '[CX] ' + msg;
      t.style.display = 'block';
      clearTimeout(cxState(t).timer); cxState(t).timer = setTimeout(function () { if (t) t.style.display = 'none'; }, 1500);
    } catch (e) { swallow(e); }
  }

  // ===== DOMAIN: dom lifecycle =====
  // ===== MODULE: 卸载还原与生命周期(cleanupListeners) =====
  // 域：DOM监听与注入层 —— 页面卸载时的侵入性还原（uninstall 语义的唯一实现处）。
  //
  // 【内聚性收敛】本块原寄居于 dom/dom.js 尾部，与 overrideVideo/walkVideos（施加接管）混居。
  // 但二者职责恰好相反：接管引擎负责「加 Hook」，本模块负责「拆 Hook」，且本模块的还原清单横跨
  // config.js / targeting.js / panel.js / main-loop.js / core.js 五个模块的侵入点——它本质是
  // 「全脚本生命周期终结者」，而非 DOM 接管的一部分。独立成模块后，新增侵入点时应改的位置一目了然。
  //
  // 【跨模块引用说明】下列符号定义在其他模块，均为顶层 var/function，同处一个 IIFE 闭包，
  //   函数声明 hoist + 运行时才执行，故不受模块拼接顺序影响：
  //     NATIVE_PAUSE / NATIVE_RATE_DESC   ← meta-config/config.js
  //     _attachHooked / siteAttachmentsKey ← biz/targeting.js（钩子标志）/ site/site-router.js
  //     keydownHandler                     ← ui/panel.js
  //     playWatchHandler / _loopTimer      ← bootstrap/main-loop.js
  //     globalErrorHandler                 ← bootstrap/core.js
  //     _mo / visibilityHandler            ← dom/dom.js（MO 实例与可见性处理器）
  //
  // 【还原清单归属】_ananasNeutralized 由 dom.js 的 neutralizeGlobalPause 写入；
  //   _playWatchDocs 由 main-loop.js 的 installPlayWatch 写入。二者的「读取/清空」都只发生在本模块，
  //   故声明随读取方集中于此（写入方在运行时才执行，此时变量早已初始化完毕）。

  // 还原清单：记录被中和的 window.ananas 全局暂停封装实例（跨 iframe 各 frame 独立），供 cleanupListeners 还原。
  // 写入方是 dom.js 的 neutralizeGlobalPause；必须在其首次执行前完成初始化——本模块在构建顺序上位于
  // dom.js 之后，但 var 声明在 IIFE 顶层求值阶段即完成，早于任何函数调用，故安全。
  var _ananasNeutralized = [];

  // 还原清单：记录装过 play 即时接管监听的 document（顶层 + 各同源 iframe），供 cleanupListeners 摘除。
  // 写入方是 main-loop.js 的 installPlayWatch，读取方是下方 cleanupListeners，二者均在运行时执行。
  var _playWatchDocs = [];

  // 还原清单：navigator.mediaSession 注入前的原始 pause handler / playbackState（仅首次 _ovEnforce 时懒保存一次），
  // 供 cleanupListeners ④ 还原为注入前语义，避免盲目置 null 破坏站点既有媒体按键交互。
  // 写入方是 dom.js 的 _ovEnforce（首次接管视频时保存）；读取方是下方 cleanupListeners ④。同处 IIFE 顶层，引用安全。
  var _origMediaSessionPause = null;
  var _origMediaSessionState = null;
  var _mediaSessionSaved = false;

  // 幂等守卫：pagehide 与 beforeunload 在多数浏览器会先后各触发一次，若无守卫则整个还原流程被执行两遍
  // （重复 defineProperty / setActionHandler）。还原是一次性终态操作，二次执行无意义。
  var _cleaned = false;

  // 监听器清理 + 侵入性还原（审查 JS1-2 / 侵入性治理）：页面卸载时断开 MutationObserver、清除轮询定时器、
  // 移除全局监听器，并撤销脚本对宿主页面的侵入性 Hook，避免页面软卸载/bfcache 后残留死 Hook，使页面回到注入前状态。
  // 还原清单（十一项，新增侵入点必须同步登记，否则 uninstall 语义即失真）：
  //   ① HTMLMediaElement.prototype.pause      ② prototype.playbackRate 描述符
  //   ③ window.attachments setter             ④ navigator.mediaSession 暂停处理（含原始 handler 还原）
  //   ⑤ window.ananas.pause 中和（含残留元数据清除）  ⑥ play 即时接管监听（顶层 + iframe 文档）
  //   ⑦ window error 诊断监听                 ⑧ pagehide/beforeunload 钩子自身
  //   ⑨ 撤销 window 全局导出符号（__cxRegisterAddon/Command/__cxUI/__cxAddonQueue）
  //   ⑩ 移除注入的 DOM/样式（面板 + 三个 style + Toast）
  //   ⑪ 删除本脚本命名空间 window.__CX_FORCE_PLAY（终结完全回到注入前全局态）
  // 注：@grant none 脚本无法感知 Tampermonkey 的"热禁用"事件，最干净的还原仍需刷新页面；此处还原在
  // pagehide/beforeunload 触发，另暴露 window.__CX_FORCE_PLAY.uninstall 供手动/副脚本触发干净还原。
  function cleanupListeners() {
    if (_cleaned) return;   // 幂等：pagehide + beforeunload 双触发时只还原一次
    _cleaned = true;
    try { if (_mo && _mo.disconnect) _mo.disconnect(); } catch (e) { swallow(e); }
    try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }
    try { document.removeEventListener('keydown', keydownHandler); } catch (e) { swallow(e); }
    try { document.removeEventListener('visibilitychange', visibilityHandler, true); } catch (e) { swallow(e); }
    // ① 还原 HTMLMediaElement.prototype.pause —— 复用 config.js 的 restorePrototypePause 原语（与运行期切换 INTRUSION_MODE 同一套还原逻辑，单一事实源，避免两套还原漂移导致残留）。
    //    该原语内部仅当本脚本已装(_protoPauseInstalled)才还原为 NATIVE_PAUSE_DESC，未装则跳过（不误改其他脚本的覆盖），语义等价原内联守卫。
    try { if (typeof restorePrototypePause === 'function') restorePrototypePause(); } catch (e) { swallow(e); }
    // ② 还原 HTMLMediaElement.prototype.playbackRate setter —— 同样复用 config.js 的 restorePrototypeRate 原语
    try { if (typeof restorePrototypeRate === 'function') restorePrototypeRate(); } catch (e) { swallow(e); }
    // ③ 还原 window.attachments（审查中优先级#5）：脚本自建 accessor 仅当 window 无自有属性时才安装；
    //    先移除 accessor，再以数据属性还原钩子期间平台最后写入的取值（_attachStore.value），避免 drop 直接丢失
    //    平台数据——即便卸载多在页面卸载时发生，仍保证「注入前语义」可恢复，而非回到裸 undefined。
    try {
      if (_attachHooked && typeof siteAttachmentsKey === 'function') {
        var _ak = siteAttachmentsKey();
        try { delete window[_ak]; } catch (e) { swallow(e); }
        try { Object.defineProperty(window, _ak, { configurable: true, enumerable: true, writable: true, value: _attachStore ? _attachStore.value : undefined }); } catch (e) { swallow(e); }
        _attachHooked = false;
      }
    } catch (e) { swallow(e); }
    // ④ 还原 navigator.mediaSession 暂停处理：还原为注入前的原始 handler 与 playbackState，
    //    而非盲目 setActionHandler('pause', null)——若页面原本设有 pause handler，盲目置 null 会破坏站点媒体按键交互（审查高优先级#3）。
    try {
      if (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function') {
        try { navigator.mediaSession.setActionHandler('pause', _origMediaSessionPause != null ? _origMediaSessionPause : null); } catch (e2) { swallow(e2); }
        if (_origMediaSessionState != null) { try { navigator.mediaSession.playbackState = _origMediaSessionState; } catch (e3) { swallow(e3); } }
      }
      try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._mediaSessionHooked = false; } catch (e) { swallow(e); }   // 安全审计(建议#10)：接管已还原，更新盘点标志
    } catch (e) { swallow(e); }
    // ⑤ 还原 window.ananas.pause 中和（逐个 frame 的 ananas 全局暂停封装还原为注入前真原生，清除全局死 Hook），
    //    并删除残留元数据 __cxAnanasNativePause，避免向宿主全局泄漏脚本内部标记（审查中优先级#4）。
    try {
      for (var _ai = 0; _ai < _ananasNeutralized.length; _ai++) {
        var _a = _ananasNeutralized[_ai];
        if (_a && _a.__cxAnanasNativePause) { try { _a.pause = _a.__cxAnanasNativePause; } catch (e) { swallow(e); } try { delete _a.__cxAnanasNativePause; } catch (e) { swallow(e); } }
      }
      _ananasNeutralized.length = 0;
    } catch (e) { swallow(e); }
    // ⑥ 摘除 play 即时接管监听（顶层文档 + 所有已下钻的同源 iframe 文档）
    //    若遗漏此项，卸载后该捕获监听仍会在用户暂停时把视频压回暂停，即「已卸载却仍在干预播放」。
    try {
      for (var _pi = 0; _pi < _playWatchDocs.length; _pi++) {
        var _d = _playWatchDocs[_pi];
        try { if (_d && _d.removeEventListener) _d.removeEventListener('play', playWatchHandler, true); } catch (e) { swallow(e); }
      }
      _playWatchDocs.length = 0;
    } catch (e) { swallow(e); }
    // ⑦ 摘除全局错误监听（core.js 注册的诊断钩子）
    try { window.removeEventListener('error', globalErrorHandler); } catch (e) { swallow(e); }
    // ⑧ 摘除卸载钩子自身：手动 uninstall() 后页面继续存活时，不留残余监听（页面真卸载时本项无副作用）
    try { window.removeEventListener('pagehide', cleanupListeners); } catch (e) { swallow(e); }
    try { window.removeEventListener('beforeunload', cleanupListeners); } catch (e) { swallow(e); }
    try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._uninstallHooked = false; } catch (e) { swallow(e); }   // 安全审计(建议#10)：卸载钩子已摘除
    // ⑨ 撤销命名空间导出：删除脚本在 window 上新增的全部全局符号（含副脚本注册契约），回到注入前全局态（审查高优先级#1）。
    //    若其它脚本已读取/缓存这些引用，不影响其既有行为；但卸载后不应再暴露可调用/可覆盖的接口。
    try { delete window.__cxRegisterAddon; } catch (e) { swallow(e); }
    try { delete window.__cxRegisterCommand; } catch (e) { swallow(e); }
    try { delete window.__cxUI; } catch (e) { swallow(e); }
    try { delete window.__cxAddonQueue; } catch (e) { swallow(e); }
    // ⑩ 移除注入的 DOM/样式：面板、Toast 与全部脚本 style 节点（审查高优先级#2）。
    //    面板/样式注入到 window.top.document（全站唯一），Toast 注入到 document.body；两处都尝试摘除以防残留 UI/内存泄漏。
    try {
      var _pd = (window.top && window.top.document) ? window.top.document : document;
      var _cxDomIds = ['__cxPanel', '__cxPanelNinjaStyle', '__cxPanelAnimStyle', '__cxPanelMobileStyle', '__cxToast'];
      for (var _di = 0; _di < _cxDomIds.length; _di++) {
        try { var _n = _pd.getElementById(_cxDomIds[_di]); if (_n && _n.parentNode) _n.parentNode.removeChild(_n); } catch (e) { swallow(e); }
        try { var _n2 = document.getElementById(_cxDomIds[_di]); if (_n2 && _n2.parentNode) _n2.parentNode.removeChild(_n2); } catch (e) { swallow(e); }
      }
    } catch (e) { swallow(e); }
    // ⑪ 终态：删除本脚本命名空间对象本身（含 uninstall 钩子）。_cleaned 守卫已保证幂等；
    //    删除后页面全局即完全回到注入前状态（仅遗留配置类 localStorage，可由 /cleardata 命令主动清除）。
    try { delete window.__CX_FORCE_PLAY; } catch (e) { swallow(e); }
  }
  try { window.addEventListener('pagehide', cleanupListeners); } catch (e) { swallow(e); }
  try { window.addEventListener('beforeunload', cleanupListeners); } catch (e) { swallow(e); }
  try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._uninstallHooked = true; } catch (e) { swallow(e); }   // 安全审计(建议#10)：标记卸载钩子已装
  try { window.__CX_FORCE_PLAY.uninstall = cleanupListeners; } catch (e) { swallow(e); }   // 暴露手动卸载还原钩子（应对热禁用）

  // ===== DOMAIN: ui/addons (addon registry) =====
  // ===== MODULE: 副脚本注册中心 =====
  // 域：核心业务模块 —— 副脚本注册中心 + 主循环 _loopTick 调度。
  // —— 副脚本注册中心（主脚本架构）——
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
          block.style.cssText = STYLES.DIAG_BLOCK;
          var head = document.createElement('div');
          head.style.cssText = STYLES.DIAG_HEAD;
          var titleSpan = document.createElement('span');
          titleSpan.textContent = a.label || id;
          var caret = document.createElement('span');
          caret.textContent = '▾';   // 默认展开
          caret.style.cssText = STYLES.DIAG_CARET;
          head.appendChild(titleSpan);
          head.appendChild(caret);
          var bodyEl = document.createElement('div');
          bodyEl.style.cssText = STYLES.DIAG_BODY;
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
        row.style.cssText = STYLES.DIAG_ROW;
        if (a.type === 'button') {
          var b = document.createElement('button');
          b.textContent = a.label;
          b.style.cssText = STYLES.DIAG_BTN;
          b.addEventListener('click', function () { try { a.onClick && a.onClick(); } catch (e) { swallow(e); } });
          row.appendChild(b);
        } else {
          var lab = document.createElement('label');
          lab.style.cssText = STYLES.DIAG_LAB;
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.style.cssText = STYLES.DIAG_CB;
          try { cb.checked = !!(a.get && a.get()); } catch (e) { swallow(e); }
          cb.addEventListener('change', function () { try { a.set && a.set(cb.checked); } catch (e) { swallow(e); } });
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode(a.label));
          row.appendChild(lab);
        }
        if (a.note) {
          var nt = document.createElement('div');
          nt.style.cssText = STYLES.DIAG_NOTE;
          nt.textContent = a.note;
          row.appendChild(nt);
        }
        box.appendChild(row);
      });
      if (wrap) {   // 空态成文（设计 §6.3）：无副脚本时显示占位文案而非隐藏区块
        wrap.style.display = 'block';
        if (!hasToggle && box) box.innerHTML = '<div style="font-size:12px;color:' + STYLES.T.text3 + ';text-align:center;padding:8px 0;">暂无副脚本接入</div>';
      }
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
  // 命令面板：暴露注册入口供副脚本扩展命令（initBuiltinCommands 在 MODULE 内、_cxCommands 初始化后调用，避免执行顺序问题）
  try { window.__cxRegisterCommand = registerCommand; } catch (e) { swallow(e); }

  // ===== DOMAIN: ui/panel (floating control panel) =====
  // ===== MODULE: 悬浮控制面板 =====
  // 域：UI/面板模块 —— 悬浮控制面板。
  // —— 悬浮控制面板（开关键 = PAUSE_HOTKEY，默认 p）——
  // 集中控制：暂停/恢复、自动停止计时(AUTO_STOP_MIN)、暂停后自动恢复(RESUME_AFTER_MIN)，并实时显示状态。
  // 仅懒创建一次，随状态刷新；不污染页面输入框，Esc/× 关闭。
  var SCRIPT_VERSION = '4.9';   // 与文件头 @version 保持一致（面板与诊断信息显示用）
  // 【共享契约·扇出最大的单例】_cxPanel 是面板根节点，被 7 个模块直接引用，为全项目耦合度最高的变量：
  //   写入方仅 2 处（必须保持）：本文件的显隐/销毁逻辑、ui/panel-core.js 的 ensurePanel 装配完成赋值；
  //   读取方 5 处（只读，勿写）：ui/addons.js、ui/dashboard.js、ui/commands.js、ui/panel-drag.js、bootstrap/main-loop.js。
  // 读取方一律先判空（面板未创建时为 null）。新增写入点前请三思：任何一处误置 null 都会静默影响其余全部读取方。
  var _cxPanel = null;
  var _lastVideoList = [];       // 面板视频列表渲染时缓存的视频引用快照，供点击委托回调定位目标视频（索引稳定）
  // 主从式导航当前激活区块（localStorage 持久化）：面板顶部分区导航，切换下方内容（主控/自动化/洞察/系统）。
  var _cxActiveTab = 'control';
  // v5 IA 重组：旧 tab 值迁移映射（pause→control, sub→automation, adv→insight, other→system），一次性改写后按新值持久化
  var _cxTabMigrate = { pause: 'control', sub: 'automation', adv: 'insight', other: 'system' };
  try {
    var _savedTab = (localStorage.getItem('cx_panel_tab') || 'control');
    if (_cxTabMigrate[_savedTab]) { _savedTab = _cxTabMigrate[_savedTab]; try { localStorage.setItem('cx_panel_tab', _savedTab); } catch (e2) { swallow(e2); } }
    _cxActiveTab = _savedTab;
  } catch (e) { swallow(e); }

  function syncPanelInputs() {                     // 把 CONFIG / 版本 / DEBUG 当前值回填到面板控件
    if (!_cxPanel) return;
    try {
      var auto = _cxPanel.querySelector('#__cxAuto'); if (auto) { auto.value = CONFIG.AUTO_STOP_MIN; _cxPanel.querySelector('#__cxAutoVal').textContent = CONFIG.AUTO_STOP_MIN; }
      var res = _cxPanel.querySelector('#__cxResume'); if (res) { res.value = CONFIG.RESUME_AFTER_MIN; _cxPanel.querySelector('#__cxResumeVal').textContent = CONFIG.RESUME_AFTER_MIN; }
      var resc = _cxPanel.querySelector('#__cxRescan'); if (resc) { resc.value = CONFIG.RESCAN_INTERVAL; _cxPanel.querySelector('#__cxRescanVal').textContent = CONFIG.RESCAN_INTERVAL; }
      var endrel = _cxPanel.querySelector('#__cxEndRel'); if (endrel) { endrel.value = CONFIG.END_RELEASE_SEC; _cxPanel.querySelector('#__cxEndRelVal').textContent = CONFIG.END_RELEASE_SEC; }
      var rateSel = _cxPanel.querySelector('#__cxRate'); if (rateSel) { rateSel.value = ('' + (CONFIG.USER_RATE || 1)); var rv = _cxPanel.querySelector('#__cxRateVal'); if (rv) rv.textContent = (CONFIG.USER_RATE || 1) + 'x'; }
      var tr = _cxPanel.querySelector('#__cxTopRate'); if (tr) tr.textContent = '· ' + (CONFIG.USER_RATE || 1) + 'x';   // 状态条常驻显示当前速率（设计文档 §4.1）
      var dbg = _cxPanel.querySelector('#__cxDebug'); if (dbg) dbg.checked = !!DEBUG;
      var lp = _cxPanel.querySelector('#__cxLoop'); if (lp) lp.checked = !!CONFIG.LOOP_PLAY;
      var sv = _cxPanel.querySelector('#__cxSingleVideo'); if (sv) sv.checked = !!CONFIG.SINGLE_VIDEO;
      var ninja = _cxPanel.querySelector('#__cxNinja'); if (ninja) ninja.checked = !!CONFIG.NINJA_MODE;
      var pw = _cxPanel.querySelector('#__cxPanelW'); if (pw) { pw.value = CONFIG.PANEL_W; var pwv = _cxPanel.querySelector('#__cxPanelWVal'); if (pwv) pwv.textContent = CONFIG.PANEL_W; }
      var ver = _cxPanel.querySelector('#__cxVer'); if (ver) ver.textContent = 'v' + SCRIPT_VERSION;
    } catch (e) { swallow(e); }
  }
  function refreshPanelLabels() {                   // 拖动滑块时实时刷新旁边的数值文字（syncPanelInputs 仅在面板创建时回填一次，否则显示滞后）
    if (!_cxPanel) return;
    try {
      var map = [['#__cxAutoVal', CONFIG.AUTO_STOP_MIN], ['#__cxResumeVal', CONFIG.RESUME_AFTER_MIN], ['#__cxRescanVal', CONFIG.RESCAN_INTERVAL], ['#__cxEndRelVal', CONFIG.END_RELEASE_SEC], ['#__cxPanelWVal', CONFIG.PANEL_W]];
      for (var i = 0; i < map.length; i++) { var n = _cxPanel.querySelector(map[i][0]); if (n) n.textContent = map[i][1]; }
    } catch (e) { swallow(e); }
  }
  function positionPanel() {                      // 副面板已内嵌主控面板，不再有独立浮动窗需避让；保留空壳以维持 showPanel/ensurePanel 调用一致
  }
  function showPanel() { try { ensurePanel(); if (_cxPanel) { _cxPanel.style.display = 'block'; syncPanelInputs(); positionPanel(); Store.emit('panel:refresh'); } } catch (e) { swallow(e); } }
  function hidePanel() { if (_cxPanel) _cxPanel.style.display = 'none'; }

  // P3：UI 与核心解耦（事件总线，复用 Store.onEv/emit）。核心只 emit，UI 只 onEv 订阅，互不直调。
  // 事件契约：ui:toast / panel:refresh / videos:scanned（UI 订阅刷新面板）；
  // targets:updated / video:state（核心观测信号，本步未订阅刷新以免与 videos:scanned 重复渲染）；cmd:scan（UI 触发重扫）。
  try { Store.onEv('ui:toast', toast); } catch (e) { swallow(e); }
  try { Store.onEv('panel:refresh', refreshPanelState); } catch (e) { swallow(e); }
  // videos:scanned 由主循环高频触发，刷新面板属重 DOM 操作；节流到 ~150ms 一帧（尾沿兜底），
  // 避免主线程被反复全量重绘拖慢。panel:refresh 为用户主动操作（开关面板/改设置），保持即时刷新。
  try { Store.onEv('videos:scanned', throttle(refreshPanelState, 150)); } catch (e) { swallow(e); }
  try { Store.onEv('cmd:scan', function () { try { _loopTick(); } catch (e) { swallow(e); } }); } catch (e) { swallow(e); }
  // 安全审计（建议#10）：面板「洞察」页实时渲染当前侵入点清单；开面板/手动刷新时重算，扫描节流兜底。
  function renderInvasionReport() {
    if (!_cxPanel) return;
    var box = _cxPanel.querySelector('#__cxInvasionReport');
    if (!box) return;
    try {
      var rows = buildInvasionReport();
      var html = '';
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        var col = r.on ? STYLES.T.warning : STYLES.T.idle;   // 活跃=黄(侵入中) · 干净=绿(已还原)
        var mark = r.on ? '●' : '○';
        html += '<div style="display:flex;gap:6px;align-items:baseline;font-size:11px;padding:3px 0;border-bottom:1px dashed ' + STYLES.T.border + ';">' +
          '<span style="color:' + col + ';flex:0 0 auto;">' + mark + '</span>' +
          '<span style="flex:0 0 96px;color:' + STYLES.T.text2 + ';">' + escapeHTML(r.area) + '</span>' +
          '<span style="flex:1;color:' + STYLES.T.text + ';word-break:break-all;">' + escapeHTML(r.detail) + '</span>' +
        '</div>';
      }
      box.innerHTML = html;
    } catch (e) { swallow(e); }
  }
  try { Store.onEv('panel:refresh', renderInvasionReport); } catch (e) { swallow(e); }
  try { Store.onEv('videos:scanned', throttle(renderInvasionReport, 1500)); } catch (e) { swallow(e); }
  function togglePanel() { if (_cxPanel && _cxPanel.style.display !== 'none') hidePanel(); else showPanel(); }
  // 一键退出/进入 Ninja 模式：卡在窄条、够不到「系统」勾选框时的逃生通道（键盘 N / 面板内「退出 n 模式」按钮共用）
  function toggleNinjaMode() {
    try {
      ensurePanel();
      if (!_cxPanel) return;
      var nin = _cxPanel.querySelector('#__cxNinja');
      if (nin) { nin.checked = !nin.checked; nin.dispatchEvent(new Event('change')); }
    } catch (e) { swallow(e); }
  }
  // 控制面板开关键：非输入框聚焦时按 PAUSE_HOTKEY 开/关悬浮控制面板（用户暂停开关的可视化控制，含暂停/恢复 + 计时器滑块）
  function keydownHandler(e) {   // 审查 JS1-2：命名以便卸载时 removeEventListener
    if (e.key === 'Escape') { try { hidePanel(); } catch (e3) { swallow(e3); } return; }   // Esc 关闭面板
    var t = e.target;
    var inEditable = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    // N 键（逃生键）：即使在滑块/复选框/下拉等 input 上聚焦也能退出/进入 Ninja。
    // 但若焦点在「命令输入框」或文本框里输入字母 n，则不能拦截，否则没法正常打字。
    if (e.key && e.key.toLowerCase() === 'n') {
      if (t && (t.id === '__cxCmd' || (t.tagName === 'TEXTAREA'))) return;  // 命令框/文本框内输入 n：放行
      try { toggleNinjaMode(); e.preventDefault(); } catch (e2) { swallow(e2); }
      return;
    }
    if (!CONFIG.PAUSE_HOTKEY) return;
    if (inEditable) return;   // 其余热键（P 开关面板）在输入框内不触发，避免误触
    if (e.key && e.key.toLowerCase() === String(CONFIG.PAUSE_HOTKEY).toLowerCase()) {
      try { togglePanel(); e.preventDefault(); } catch (e2) { swallow(e2); }
    }
  }
  try {
    document.addEventListener('keydown', keydownHandler);
  } catch (e) { swallow(e); }
  // 折叠态图标状态联动（当前状态指示器，非操作按钮）：任意视频在播 → 显示播放三角(▶)；全部暂停 → 显示暂停双竖条(‖)。
  function syncNinjaGlyph() {
    try {
      var p = _cxPanel; if (!p || !p.classList.contains('ninja')) return;
      var g = p.querySelector('.cx-ninja-glyph'); if (!g) return;
      var vs = document.getElementsByTagName('video'); var playing = false;
      for (var i = 0; i < vs.length; i++) { if (vs[i] && !vs[i].paused) { playing = true; break; } }
      g.classList.toggle('cx-playing', playing);
      g.classList.toggle('cx-paused', !playing);
    } catch (e2) { swallow(e2); }
  }
  try {
    document.addEventListener('play', syncNinjaGlyph, true);   // 捕获阶段可监听不冒泡的媒体事件
    document.addEventListener('pause', syncNinjaGlyph, true);
    Store.onEv('panel:refresh', syncNinjaGlyph);   // 扫描刷新时兜底同步
  } catch (e) { swallow(e); }


  // ===== DOMAIN: ui/panel-template (panel HTML view) =====
  // Panel HTML template (view layer): returns the floating panel skeleton string, injected by ensurePanel.
  // Depends only on STYLES and the passed _inFrame flag (cross-origin iframe fallback marker).
  function buildPanelHTML(_inFrame) {
    return (
      // 标题栏（状态徽章 + 版本 + 关闭按钮）
      '<div class="cx-titlebar" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
          '<span id="__cxPanelBadge" class="cx-statusled" title="脚本运行状态" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + STYLES.T.idle + ';flex:0 0 auto;"></span>' +
          '<b class="cx-title" style="font-size:14px;">学习通·主控面板 <span id="__cxVer" style="color:' + STYLES.T.text3 + ';font-weight:normal;font-size:11px;"></span></b>' +
          '<span id="__cxTopRate" style="font-size:11px;color:' + STYLES.T.text3 + ';margin-left:6px;"></span>' +
          (_inFrame ? '<span style="font-size:9px;color:' + STYLES.T.warning + ';">frame 内</span>' : '') +
        '</div>' +
        '<button id="__cxExitNinja" class="cx-exit-ninja" style="display:none;cursor:pointer;">退出 n 模式</button>' +
        '<span class="cx-ninja-glyph cx-playing" aria-hidden="true" style="display:none;">' +   // 折叠态图标：默认 playing（强制播放中→显示播放三角 ▶；全部暂停→由 JS 切到 cx-paused 显示双竖条 ‖）
          '<svg class="cx-glyph cx-glyph-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.5 L8.5 18.5 L20.5 12 Z"/></svg>' +   // 质心 x=(8.5+8.5+20.5)/3=12.5，压在 viewBox 中心并微右移补偿左重，视觉真正居中
          '<svg class="cx-glyph cx-glyph-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.8"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.8"/></svg>' +
        '</span>' +
        '<span id="__cxPanelClose" style="cursor:pointer;padding:0 6px;font-size:18px;line-height:1;">×</span>' +
      '</div>' +
      // 命令输入栏：输入 / 唤起命令下拉，支持参数与 ↑↓/Tab/Enter/Esc
      '<div class="cx-cmd-wrap" style="position:relative;margin-bottom:8px;">' +
        '<input id="__cxCmd" type="text" placeholder="输入 / 唤起命令…" autocomplete="off" spellcheck="false" style="width:100%;box-sizing:border-box;padding:6px 8px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;font-size:12px;outline:none;">' +
        '<div id="__cxCmdList" style="display:none;position:absolute;left:0;right:0;top:100%;margin-top:4px;max-height:200px;overflow-y:auto;background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;z-index:10;"></div>' +
      '</div>' +
      // 顶部导航栏（主从式布局）：点击切换下方内容区块（v5 IA：主控/自动化/洞察/系统）
      '<div class="cx-nav" style="display:flex;gap:4px;margin-bottom:8px;">' +
        '<button class="cx-nav-btn" data-tab="control" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">主控</button>' +
        '<button class="cx-nav-btn" data-tab="automation" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">自动化</button>' +
        '<button class="cx-nav-btn" data-tab="insight" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">洞察</button>' +
        '<button class="cx-nav-btn" data-tab="system" style="flex:1;padding:6px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">系统</button>' +
      '</div>' +
      // 区块：主控（日操播放控制：暂停/恢复 + 视频开关列表）
      '<div id="__cxTab_control" class="cx-tab">' +
        '<button id="__cxBtnPause" style="width:100%;padding:9px;margin-bottom:8px;background:' + STYLES.T.primary + ';color:#fff;border:0;border-radius:6px;cursor:pointer;font-size:13px;">暂停 / 恢复</button>' +
        '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:8px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:4px;">视频开关（逐个续播/暂停 · ★=前台）</div>' +
          // 快切按钮栏
          '<div style="display:flex;gap:4px;margin-bottom:6px;">' +
            '<button id="__cxBtnOnlyFg" style="flex:1;padding:4px;font-size:11px;background:' + STYLES.T.border + ';color:' + STYLES.T.text + ';border:0;border-radius:4px;cursor:pointer;" title="暂停所有其他视频，只保留前台播放">仅播此轨</button>' +
            '<button id="__cxBtnResumeAll" style="flex:1;padding:4px;font-size:11px;background:' + STYLES.T.border + ';color:' + STYLES.T.text + ';border:0;border-radius:4px;cursor:pointer;" title="恢复所有视频的续播控制">全部续播</button>' +
            '<label style="display:flex;align-items:center;gap:2px;flex:0 0 auto;font-size:11px;color:' + STYLES.T.text2 + ';cursor:pointer;white-space:nowrap;" title="锁定后滚动不会丢失前台资格"><input id="__cxLockFg" type="checkbox" style="margin:0;">锁定</label>' +
          '</div>' +
          '<div id="__cxVideoList" style="max-height:190px;overflow-y:auto;"></div>' +   // 超过 5 个视频时滚动兜住（>5 的折叠/分页方案另做打算）
        '</div>' +
      '</div>' +
      // 区块：自动化（让脚本自己跑：计时器/循环/速率/副脚本开关）
      '<div id="__cxTab_automation" class="cx-tab">' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;">自动停止计时 (分钟): <b id="__cxAutoVal" class="cx-mono">0</b>' +
          '<input id="__cxAuto" type="range" min="0" max="120" step="1" value="0" style="width:100%;"></label>' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;">暂停后自动恢复 (分钟): <b id="__cxResumeVal" class="cx-mono">0</b>' +
          '<input id="__cxResume" type="range" min="0" max="60" step="1" value="0" style="width:100%;"></label>' +
        '<label style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxLoop" type="checkbox" style="vertical-align:middle;margin-right:6px;">循环播放（播完从头重播）</label>' +
        '<div id="__cxRateRow" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;">' +
          '<span>播放速率</span>' +
          '<span><b id="__cxRateVal" class="cx-mono">' + (CONFIG.USER_RATE || 1) + 'x</b>' +
          '<select id="__cxRate" style="font-size:12px;margin-left:6px;">' +
            '<option value="0.5">0.5x</option><option value="0.75">0.75x</option><option value="1">1x</option>' +
            '<option value="1.25">1.25x</option><option value="1.5">1.5x</option><option value="1.75">1.75x</option><option value="2">2x</option>' +
          '</select></span>' +
        '</div>' +
        '<div id="__cxAddonsWrap" style="border-top:1px solid ' + STYLES.T.border + ';margin-top:4px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:6px;">副脚本（已接入主面板）</div>' +
          '<div id="__cxAddons"></div>' +
        '</div>' +
      '</div>' +
      // 区块：洞察（周操看运行状况：仪表盘/视频信息/诊断/内嵌副面板）
      '<div id="__cxTab_insight" class="cx-tab">' +
        // 运维仪表盘：实时资源监控小面板
        '<div id="__cxDashboard" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px;">' +
          // — 左列：MO 队列（Sparkline 走势图 + 当前深度） —
          '<div style="background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';border-radius:8px;padding:6px;box-shadow:' + STYLES.T.cardShadow + ';">' +
            '<div style="font-size:9px;color:' + STYLES.T.text3 + ';margin-bottom:2px;">MO队列</div>' +
            '<div style="display:flex;align-items:flex-end;gap:2px;">' +
              '<canvas id="__cxMoSpark" width="80" height="20" style="flex:1;height:20px;"></canvas>' +
              '<b id="__cxMoVal" class="cx-mono" style="font-size:13px;color:' + STYLES.T.text + ';min-width:24px;text-align:right;">0</b>' +
            '</div>' +
          '</div>' +
          // — 右列：命中率 / 续播率 环形仪表（精密感：像汽车转速表）—
          '<div style="background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';border-radius:8px;padding:6px;box-shadow:' + STYLES.T.cardShadow + ';display:flex;gap:4px;">' +
            '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;">' +
              '<svg width="34" height="34" viewBox="0 0 34 34" style="display:block;">' +
                '<circle cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.border + '" stroke-width="2"/>' +
                '<circle id="__cxHitGauge" cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.idle + '" stroke-width="2" stroke-dasharray="87.96" stroke-dashoffset="87.96" stroke-linecap="round" transform="rotate(-90 17 17)" style="transition:stroke-dashoffset .5s ease-out,stroke .3s ease;"/>' +
                '<text id="__cxHitGaugeTxt" class="cx-gauge-txt" x="17" y="20" text-anchor="middle" fill="' + STYLES.T.text + '" font-size="9">—</text>' +
              '</svg>' +
              '<span style="font-size:9px;color:' + STYLES.T.text3 + ';">命中率</span>' +
            '</div>' +
            '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1;">' +
              '<svg width="34" height="34" viewBox="0 0 34 34" style="display:block;">' +
                '<circle cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.border + '" stroke-width="2"/>' +
                '<circle id="__cxPlayGauge" cx="17" cy="17" r="14" fill="none" stroke="' + STYLES.T.idle + '" stroke-width="2" stroke-dasharray="87.96" stroke-dashoffset="87.96" stroke-linecap="round" transform="rotate(-90 17 17)" style="transition:stroke-dashoffset .5s ease-out,stroke .3s ease;"/>' +
                '<text id="__cxPlayGaugeTxt" class="cx-gauge-txt" x="17" y="20" text-anchor="middle" fill="' + STYLES.T.text + '" font-size="9">—</text>' +
              '</svg>' +
              '<span style="font-size:9px;color:' + STYLES.T.text3 + ';">续播率</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        // 视频信息：当前视频状态/进度/已看
        '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:4px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:4px;">视频信息</div>' +
          '<div id="__cxPanelState" style="font-size:12px;color:' + STYLES.T.text2 + ';margin-bottom:8px;word-break:break-all;white-space:pre-line;"></div>' +
        '</div>' +
        '<div id="__cxPanelInfo" style="font-size:11px;color:' + STYLES.T.text2b + ';margin-bottom:10px;white-space:pre-line;background:' + STYLES.T.surface + ';border:1px solid ' + STYLES.T.border + ';padding:8px;border-radius:8px;box-shadow:' + STYLES.T.cardShadow + ';"></div>' +
        '<div id="__cxSubPanelsWrap" style="border-top:1px solid ' + STYLES.T.border + ';margin-top:8px;padding-top:8px;">' +
          '<div style="font-size:11px;color:' + STYLES.T.text2 + ';margin-bottom:6px;">副面板（内嵌显示，可折叠）</div>' +
          '<div id="__cxSubPanels"></div>' +
        '</div>' +
        // 安全审计（建议#10）：实时展示当前对宿主页面的侵入面，落实审计透明化诉求。置于「洞察」栏：运行状况/侵入透明视角更贴切。
        '<div style="border-top:1px solid ' + STYLES.T.border + ';margin-top:10px;padding-top:8px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
            '<div style="font-size:12px;color:' + STYLES.T.text + ';">安全审计 · 当前侵入点（实时）</div>' +
            '<button id="__cxBtnAudit" style="padding:3px 8px;font-size:11px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:5px;cursor:pointer;">刷新</button>' +
          '</div>' +
          '<div id="__cxInvasionReport" style="font-size:11px;color:' + STYLES.T.text2 + ';">— 开面板后自动盘点 —</div>' +
          '<div style="font-size:10px;color:' + STYLES.T.text3 + ';margin-top:4px;">绿○=未侵入/已还原 · 黄●=当前已接管 · 卸载时全部还原（/cleardata 清配置）</div>' +
        '</div>' +
      '</div>' +
      // 区块：系统（月操维护：低频设置 + 诊断导出 + 帮助）
      '<div id="__cxTab_system" class="cx-tab">' +
        '<label id="__cxPanelWRow" style="display:block;margin-bottom:6px;font-size:12px;">面板宽度 (px): <b id="__cxPanelWVal" class="cx-mono">460</b>' +
          '<input id="__cxPanelW" type="range" min="288" max="760" step="4" value="460" style="width:100%;"></label>' +
        '<label id="__cxRescanRow" style="display:block;margin-bottom:6px;font-size:12px;">轮询间隔 (ms): <b id="__cxRescanVal" class="cx-mono">2000</b>' +
          '<input id="__cxRescan" type="range" min="500" max="5000" step="500" value="2000" style="width:100%;"></label>' +
        '<label id="__cxEndRelRow" style="display:block;margin-bottom:6px;font-size:12px;">进度到底释放 (秒): <b id="__cxEndRelVal" class="cx-mono">15</b>' +
          '<input id="__cxEndRel" type="range" min="0" max="120" step="5" value="15" style="width:100%;"></label>' +
        '<label id="__cxSingleVideoRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxSingleVideo" type="checkbox" style="vertical-align:middle;margin-right:6px;">只播放一个视频（仅前台播放，同开时取消视频开关）</label>' +
        '<label id="__cxNinjaRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxNinja" type="checkbox" style="vertical-align:middle;margin-right:6px;">Ninja 模式（缩成窄条，悬停展开）</label>' +
        '<label id="__cxDebugRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxDebug" type="checkbox" style="vertical-align:middle;margin-right:6px;">调试日志 (DEBUG → 控制台)</label>' +
        // #1 温和/礼貌模式：入侵模式（原型中性化策略）+ 礼貌模式（抗检测）开关
        '<div id="__cxIntrusionRow" style="display:block;margin-bottom:6px;font-size:12px;">入侵模式: ' +
          '<select id="__cxIntrusion" style="margin-left:6px;font-size:12px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text + ';border:1px solid ' + STYLES.T.border + ';border-radius:5px;padding:2px 4px;">' +
            '<option value="auto">auto（按站点自适应）</option>' +
            '<option value="gentle">gentle（仅实例级·最小侵入）</option>' +
            '<option value="aggressive">aggressive（始终改原型·最稳）</option>' +
          '</select>' +
        '</div>' +
        '<label id="__cxPoliteRow" style="display:block;margin-bottom:6px;font-size:12px;"><input id="__cxPolite" type="checkbox" style="vertical-align:middle;margin-right:6px;">礼貌模式（pause.toString 伪装·抗检测）</label>' +
        '<button id="__cxBtnCopy" style="width:100%;padding:7px;margin-bottom:4px;background:' + STYLES.T.surface + ';color:' + STYLES.T.text2 + ';border:1px solid ' + STYLES.T.border + ';border-radius:6px;cursor:pointer;font-size:12px;font-weight:400;">复制诊断信息（反馈用）</button>' +
        '<button id="__cxBtnExport" style="width:100%;padding:7px;margin-top:4px;' + STYLES.BTN_GHOST + 'font-size:12px;">导出最近操作日志（黑匣子）</button>' +
        '<button id="__cxBtnClearBx" style="width:100%;padding:7px;margin-top:4px;' + STYLES.BTN_DANGER + 'font-size:12px;">清空黑匣子日志</button>' +
        '<div style="font-size:11px;color:' + STYLES.T.text3 + ';margin-top:6px;">按 <b>P</b> 开关本面板 · <b>Esc</b> 关闭 · 0 = 禁用</div>' +
      '</div>'
    );
  }

  // ===== DOMAIN: ui/panel-core (panel assembly + event binding) =====
  // Panel assembly: create DOM, inject styles, bind all control events and navigation.
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
          // 手动实现 once 语义：老浏览器(Safari<10/IE)静默忽略 {once:true} 选项，显式 removeEventListener 兜底
          var _cxBuildOnce = function () { try { pd.removeEventListener('DOMContentLoaded', _cxBuildOnce); } catch (e) {} _cxBuildLater(); };
          pd.addEventListener('DOMContentLoaded', _cxBuildOnce);
        } else {
          // rAF 在后台标签页会被节流/暂停，极端环境可能缺失；兜底用 setTimeout 保证面板总能构建
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_cxBuildLater);
          else setTimeout(_cxBuildLater, 0);
        }
      } catch (e) { swallow(e); }
      return null;
    }
    var el = pd.createElement('div');
    el.id = '__cxPanel';
    el.style.cssText = STYLES.PANEL_BOX;
    // 应用持久化的面板宽度（CSS 变量单一事实源：正常态与 Ninja 展开态共用，见 STYLES.PANEL_BOX / NINJA_STYLE）
    try { el.style.setProperty('--cx-panel-w', (CONFIG.PANEL_W || 380) + 'px'); } catch (e) { swallow(e); }
    // 空态成文（设计 §6.3）：面板未能挂顶层文档（跨域 iframe 回退）时标题栏给出可见标记
    var _inFrame = !(window.top && window.top.document && window.top.document.body);
    el.innerHTML = buildPanelHTML(_inFrame);
    if (pd.body) pd.body.appendChild(el);
    // —— 移动端适配：窄屏下主控面板自适应宽度、放大点按区、缩小字号（仅注入一次）——
    if (!pd.getElementById('__cxPanelMobileStyle')) {
      try {
        var ms = pd.createElement('style');
        ms.id = '__cxPanelMobileStyle';
        ms.textContent = STYLES.PANEL_MOBILE;
        if (pd.head) pd.head.appendChild(ms);
      } catch (e) { swallow(e); }
    }
    // —— Ninja 模式样式：面板默认缩成窄条，鼠标悬停展开（仅注入一次）——
    if (!pd.getElementById('__cxPanelNinjaStyle')) {
      try {
        var ns = pd.createElement('style');
        ns.id = '__cxPanelNinjaStyle';
        ns.textContent = STYLES.NINJA_DEFAULT + STYLES.NINJA_STYLE;
        if (pd.head) pd.head.appendChild(ns);
      } catch (e) { swallow(e); }
    }
    // —— 动效与精密感样式：呼吸灯/环形仪表/等宽数字/微交互（仅注入一次）——
    if (!pd.getElementById('__cxPanelAnimStyle')) {
      try {
        var as = pd.createElement('style');
        as.id = '__cxPanelAnimStyle';
        as.textContent = STYLES.ANIM;
        if (pd.head) pd.head.appendChild(as);
      } catch (e) { swallow(e); }
    }
    // Ninja 模式：应用/移除 ninja CSS class
    if (CONFIG.NINJA_MODE) el.classList.add('ninja');
    el.title = CONFIG.NINJA_MODE ? 'n 模式：点击面板展开 / 再次点击收起' : '';
    // 位置策略（v4.9 修订）：禁用拖拽，面板始终使用 CSS 默认右上角安全位。
    // 旧版拖拽会把"Ninja 窄态(40px)坐标"套到"退出后 460px 宽态面板"上，
    // 导致 left 不变、右侧大半被屏幕右边缘裁掉、只剩左侧一点可见。
    // 故不再应用/写入 PANEL_POS（其旧值可能已在屏外），面板恒居右上角、完整可见。
    // 如确需移动，应改用"相对视口比例 + 退出 Ninja 时按当前宽度重算落点"的健壮方案再开放。

    el.querySelector('#__cxPanelClose').addEventListener('click', hidePanel);
    // —— 命令面板：输入 / 唤起命令下拉，↑↓/Tab/Enter/Esc ——
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
          // 星标按钮：收藏/取消收藏
          var favBtn = ev.target && ev.target.closest ? ev.target.closest('[data-fav]') : null;
          if (favBtn) {
            try { _cxFavToggle(favBtn.getAttribute('data-fav')); } catch (e) { swallow(e); }
            return;
          }
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
      var v = currentVideo(); if (!v) { Store.emit('ui:toast', '无目标视频'); return; }
      if (v.__cxUserPaused) userResume(v); else userPause(v);
      Store.emit('panel:refresh');
    });
    // 视频列表：事件委托，逐个暂停/恢复（修复"多视频下只能控制单个视频"）
    var vlist = el.querySelector('#__cxVideoList');
    if (vlist) vlist.addEventListener('click', function (ev) {
      try {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-vi]') : null;
        if (!btn) return;
        if (btn.getAttribute('data-dis')) return;          // 已结束 或 单视频模式：开关禁用
        if (CONFIG.SINGLE_VIDEO) return;                   // 双保险：单视频模式下不响应点击
        var idx = +btn.getAttribute('data-vi');
        var vv = (_lastVideoList && _lastVideoList[idx]) || allVideos()[idx];
        if (!vv) return;
        if (vv.__cxUserPaused) userResume(vv); else userPause(vv);
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    // 快切按钮：仅播此轨（暂停所有其他视频，只保留前台）
    var btnOnlyFg = el.querySelector('#__cxBtnOnlyFg');
    if (btnOnlyFg) btnOnlyFg.addEventListener('click', function () {
      try {
        var fg = _lockFg || foregroundVideo();
        if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var vs = allVideos();
        for (var i = 0; i < vs.length; i++) {
          if (vs[i] !== fg) try { userPause(vs[i]); } catch (e2) { swallow(e2); }
          else try { if (vs[i].__cxUserPaused) userResume(vs[i]); } catch (e2) { swallow(e2); }
        }
        Store.emit('ui:toast', '仅播此轨：已暂停其他 ' + (vs.length - 1) + ' 个视频', 'success');
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    // 快切按钮：全部续播（恢复所有视频）
    var btnResumeAll = el.querySelector('#__cxBtnResumeAll');
    if (btnResumeAll) btnResumeAll.addEventListener('click', function () {
      try {
        var vs = allVideos();
        for (var i = 0; i < vs.length; i++) { try { if (vs[i].__cxUserPaused) userResume(vs[i]); } catch (e2) { swallow(e2); } }
        Store.emit('ui:toast', '全部续播：已恢复 ' + vs.length + ' 个视频', 'success');
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    // 锁定前台开关
    var lockFg = el.querySelector('#__cxLockFg');
    if (lockFg) lockFg.addEventListener('change', function () {
      try {
        if (lockFg.checked) {
          _lockFg = foregroundVideo();
          Store.emit('ui:toast', '已锁定前台：滚动不会丢失前台资格');
        } else {
          _lockFg = null;
          Store.emit('ui:toast', '已解锁前台：恢复自动前台检测');
        }
        Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    var auto = el.querySelector('#__cxAuto');
    if (auto) auto.addEventListener('input', function () { CONFIG.AUTO_STOP_MIN = +auto.value; savePanelCfg(); Store.emit('panel:refresh'); });
    var res = el.querySelector('#__cxResume');
    res.addEventListener('input', function () { CONFIG.RESUME_AFTER_MIN = +res.value; savePanelCfg(); Store.emit('panel:refresh'); });
    var resc = el.querySelector('#__cxRescan');
    resc.addEventListener('input', function () {
      CONFIG.RESCAN_INTERVAL = +resc.value;
      try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }   // 实时重启轮询，使间隔立即生效
      try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }
      savePanelCfg(); Store.emit('panel:refresh');
    });
    var endrel = el.querySelector('#__cxEndRel');
    endrel.addEventListener('input', function () { CONFIG.END_RELEASE_SEC = +endrel.value; savePanelCfg(); Store.emit('panel:refresh'); });
    // 面板宽度：实时改 CSS 变量（正常态与 Ninja 展开态同步生效），并持久化
    var pw = el.querySelector('#__cxPanelW');
    if (pw) {
      pw.addEventListener('input', function () {
        CONFIG.PANEL_W = +pw.value;
        clampCfg();
        try { el.style.setProperty('--cx-panel-w', CONFIG.PANEL_W + 'px'); } catch (e) { swallow(e); }
        var pwv = el.querySelector('#__cxPanelWVal'); if (pwv) pwv.textContent = CONFIG.PANEL_W;
        savePanelCfg();
      });
    }
    var rateSel = el.querySelector('#__cxRate');
    if (rateSel) {
      rateSel.value = ('' + (CONFIG.USER_RATE || 1));
      rateSel.addEventListener('change', function () {
        var r = parseFloat(this.value);
        CONFIG.USER_RATE = (isNaN(r) ? 1 : r);
        clampCfg(); CONFIG.USER_RATE = (CONFIG.USER_RATE || 1);
        var rv = el.querySelector('#__cxRateVal'); if (rv) rv.textContent = CONFIG.USER_RATE + 'x';
        var tr = el.querySelector('#__cxTopRate'); if (tr) tr.textContent = '· ' + CONFIG.USER_RATE + 'x';   // 同步状态条速率
        savePanelCfg(); applyUserRateAll();
        Store.emit('panel:refresh');
      });
    }
    // Ninja 模式开关
    var ninja = el.querySelector('#__cxNinja');
    if (ninja) {
      ninja.addEventListener('change', function () {
        CONFIG.NINJA_MODE = !!ninja.checked;
        if (CONFIG.NINJA_MODE) {
          el.classList.add('ninja');
          el.classList.remove('ninja-open');
          Store.emit('ui:toast', 'Ninja 模式已开：面板缩成圆形，悬停或点击展开');
        } else {
          el.classList.remove('ninja', 'ninja-open');
          Store.emit('ui:toast', 'Ninja 模式已关');
        }
        savePanelCfg();
      });
    }
    // 退出 n 模式按钮（仅 Ninja 展开态显示）：一键恢复常驻宽面板，给卡在窄条的用户逃生通道
    var exitNinjaBtn = el.querySelector('#__cxExitNinja');
    if (exitNinjaBtn) exitNinjaBtn.addEventListener('click', function (e) { try { e.stopPropagation(); toggleNinjaMode(); } catch (e2) { swallow(e2); } });
    // Ninja 点击展开/收起：用 mouseup 而非 click——拖拽的 mousedown 调了 preventDefault，
    // 部分浏览器会吞掉后续 click，导致窄条点不开、永久卡死。mouseup 不受其影响，且 ninja-open
    // 为粘性展开态（不依赖 :hover），点开后保持，便于够到“退出 n 模式”复选框。
    var ninjaBar = el.querySelector('.cx-titlebar');
    if (ninjaBar) {
      ninjaBar.addEventListener('mouseup', function (e) {
        if (!el.classList.contains('ninja')) return;
        if (el.classList.contains('cx-dragging')) return;
        if (el._cxDragMoved) { el._cxDragMoved = false; return; }  // 拖拽结束后的误触，跳过
        if (e && e.button !== undefined && e.button !== 0) return;
        el.classList.toggle('ninja-open');
      });
    }
    try {
      pd.addEventListener('mousedown', function (e) {
        if (el.classList.contains('ninja') && el.classList.contains('ninja-open') && !el.contains(e.target)) {
          el.classList.remove('ninja-open');
        }
      });
    } catch (e3) { swallow(e3); }
    var dbg = el.querySelector('#__cxDebug');
    if (dbg) dbg.addEventListener('change', function () { try { DEBUG = !!dbg.checked; Store.emit('ui:toast', DEBUG ? '调试日志已开' : '调试日志已关'); } catch (e) { swallow(e); } savePanelCfg(); });
    var sv = el.querySelector('#__cxSingleVideo');
    if (sv) {
      sv.addEventListener('change', function () {
        CONFIG.SINGLE_VIDEO = !!sv.checked;
        if (CONFIG.SINGLE_VIDEO) {
          // 取消所有逐视频开关（userPaused 状态全部清除）
          try {
            var avs = allVideos();
            for (var ai = 0; ai < avs.length; ai++) { try { if (avs[ai][FLAGS.userPaused]) userResume(avs[ai]); } catch (e2) { swallow(e2); } }
          } catch (e) { swallow(e); }
          Store.emit('ui:toast', '单视频模式已开：仅前台播放，其他视频暂停', 'warn');
        } else {
          Store.emit('ui:toast', '单视频模式已关：恢复逐视频独立控制', 'warn');
        }
        savePanelCfg();
        Store.emit('panel:refresh');
      });
    }
    var lp = el.querySelector('#__cxLoop');
    if (lp) {
      lp.addEventListener('change', function () {
        CONFIG.LOOP_PLAY = !!lp.checked;
        try {
          if (CONFIG.LOOP_PLAY) Store.emit('ui:toast', '循环播放已开（当前视频播完将从头重播）', 'warn');
          else Store.emit('ui:toast', '循环播放已关（恢复默认防重播）', 'warn');
        } catch (e) { swallow(e); }
        savePanelCfg();
        applyLoopAll();        // 立即对当前所有视频施加 loop 状态，使开关即时生效（无需等下一轮重扫）
        Store.emit('panel:refresh');
      });
    }
    // #1 温和/礼貌模式：入侵模式选择（原型中性化策略）
    var intr = el.querySelector('#__cxIntrusion');
    if (intr) {
      try { intr.value = CONFIG.INTRUSION_MODE || 'auto'; } catch (e) { swallow(e); }
      intr.addEventListener('change', function () {
        CONFIG.INTRUSION_MODE = intr.value;
        savePanelCfg();
        try { if (typeof reconcileIntrusionMode === 'function') reconcileIntrusionMode(); } catch (e) { swallow(e); }
        try { Store.emit('ui:toast', '入侵模式 → ' + intr.value + (intr.value === 'gentle' ? '（超星可能偶发漏拦）' : '')); } catch (e) { swallow(e); }
        Store.emit('panel:refresh');
      });
    }
    // #1 礼貌模式开关（抗检测：pause.toString 伪装）
    var polite = el.querySelector('#__cxPolite');
    if (polite) {
      try { polite.checked = !!CONFIG.POLITE_MODE; } catch (e) { swallow(e); }
      polite.addEventListener('change', function () {
        CONFIG.POLITE_MODE = !!polite.checked;
        savePanelCfg();
        try { Store.emit('ui:toast', CONFIG.POLITE_MODE ? '礼貌模式已开（抗检测）' : '礼貌模式已关'); } catch (e) { swallow(e); }
        Store.emit('panel:refresh');
      });
    }
    // —— 主从式导航：切换下方内容区块（localStorage 记住当前 tab）——
    function switchTab(name) {
      if (!_cxPanel) return;
      try {
        var tabs = _cxPanel.querySelectorAll('.cx-tab');
        for (var i = 0; i < tabs.length; i++) tabs[i].style.display = (tabs[i].id === '__cxTab_' + name) ? 'block' : 'none';
        var btns = _cxPanel.querySelectorAll('.cx-nav-btn');
        for (var j = 0; j < btns.length; j++) {
          var _sel = (btns[j].getAttribute('data-tab') === name);
          btns[j].style.background = _sel ? STYLES.T.primary : STYLES.T.surface;
          btns[j].style.color = _sel ? '#ffffff' : STYLES.T.text2;
          btns[j].style.fontWeight = _sel ? '600' : '400';
          btns[j].style.border = '1px solid ' + (_sel ? STYLES.T.primary : STYLES.T.border);
        }
        try { localStorage.setItem('cx_panel_tab', name); } catch (e2) { swallow(e2); }
        _cxActiveTab = name;
      } catch (e) { swallow(e); }
    }
    try { Store.onEv('ui:switchTab', function (name) { try { switchTab(name); } catch (e) { swallow(e); } }); } catch (e) { swallow(e); }   // 供命令框 /tab 调用
    var navBtns = el.querySelectorAll('.cx-nav-btn');
    for (var ni = 0; ni < navBtns.length; ni++) {
      (function (b) { b.addEventListener('click', function () { switchTab(b.getAttribute('data-tab')); }); })(navBtns[ni]);
    }
    el.querySelector('#__cxBtnCopy').addEventListener('click', copyDiagnostics);
    // 安全审计（建议#10）：刷新「洞察」页侵入点清单
    var btnAudit = el.querySelector('#__cxBtnAudit');
    if (btnAudit) btnAudit.addEventListener('click', function () { try { Store.emit('panel:refresh'); Store.emit('ui:toast', '已刷新侵入点清单'); } catch (e) { swallow(e); } });
    // 黑匣子导出按钮
    var btnExport = el.querySelector('#__cxBtnExport');
    if (btnExport) btnExport.addEventListener('click', function () {
      try {
        var lines = [];
        var now = Date.now();
        lines.push('=== 黑匣子日志 ===');
        lines.push('导出时间: ' + new Date().toLocaleString());
        lines.push('记录条数: ' + _bxBuffer.length + ' / ' + _bxCap + ' 条');
        lines.push('最近1分钟: ' + _bxBuffer.filter(function(e) { return (now - e.ts) <= 60000; }).length + ' 条');
        lines.push('');
        for (var i = 0; i < _bxBuffer.length; i++) {
          var e = _bxBuffer[i];
          var age = Math.round((now - e.ts) / 1000) + 's前';
          var time = new Date(e.ts).toLocaleTimeString();
          lines.push('[' + time + ' | -' + age + '] ' + e.action + (e.detail ? '  ' + e.detail : ''));
        }
        var text = lines.join('\n');
        try {
          navigator.clipboard.writeText(text).then(function () {
            Store.emit('ui:toast', '已复制 ' + _bxBuffer.length + ' 条日志到剪贴板');
          }, function () { alert(text); });
        } catch (e2) {
          // Fallback: 弹窗显示
          var w = window.open('', '_blank', 'width=700,height=500');
          if (w) { w.document.write('<pre>' + text.replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</pre>'); }
          else alert(text);
        }
      } catch (e) { swallow(e); }
    }, false);
    // 清空黑匣子（Danger 级：破坏性操作，confirm 二次确认，设计 §6.1）
    var btnClearBx = el.querySelector('#__cxBtnClearBx');
    if (btnClearBx) btnClearBx.addEventListener('click', function () {
      try {
        if (!confirm('确认清空黑匣子日志？（' + _bxBuffer.length + ' 条，清空后不可恢复）')) return;
        _bxBuffer.length = 0;
        Store.emit('ui:toast', '黑匣子日志已清空', 'warn');
      } catch (e) { swallow(e); }
    });
    _cxPanel = el;
    syncPanelInputs();
    drainAddonQueue();   // 面板建成后渲染已注册的副脚本开关（含晚于本脚本注册的）
    switchTab(_cxActiveTab || 'control');   // 主从式导航：应用上次选中的区块（默认 主控）
    positionPanel();   // 适配 progress-panel：若其已挂载，则下沉避让避免同角重叠
    return el;
  }

  // ===== DOMAIN: ui/panel-drag (panel drag + ninja side) =====
  // Panel dragging (compositor-layer optimization) and Ninja strip side detection.
  // 拖拽移动面板（修复 Ninja 模式无法上下/左右移动）：标题栏空白、卡片间隙、折叠态呼吸灯条均可拖动；
  // 输入框/按钮/开关/链接/关闭钮不触发拖动。落点写入 CONFIG.PANEL_POS 持久化，跨刷新保留。
  // 性能优化（修复移动卡顿）：用 transform:translate3d 仅驱动合成层、不触发重排/重绘；
  //   rAF 合并高频 mousemove；拖拽前缓存宽高（避免每帧强制同步布局）；will-change 提升独立图层。
  function makeDraggable(el) {
    if (!el) return;
    var dragging = false, sx = 0, sy = 0, ax = 0, ay = 0, w = 0, h = 0;
    var pending = false, dx = 0, dy = 0;
    function paint() {                 // 仅写 transform（合成层），不读布局、不重排
      pending = false;
      el.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
    }
    function onMove(e) {
      if (!dragging) return;
      el._cxDragMoved = true;   // 标记本次为拖拽（非点击），供 Ninja 点击展开去抖
      var nx = ax + (e.clientX - sx);
      var ny = ay + (e.clientY - sy);
      nx = Math.max(0, Math.min(nx, window.innerWidth - w));   // w/h 已在 mousedown 缓存
      ny = Math.max(0, Math.min(ny, Math.max(0, window.innerHeight - h)));
      dx = nx - ax; dy = ny - ay;
      if (!pending) { pending = true; requestAnimationFrame(paint); }  // 合并到下一帧，避免一帧多次写入
    }
    function onUp() {
      dragging = false;
      el.classList.remove('cx-dragging');
      el.style.willChange = '';          // 释放图层，避免常驻内存占用
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        // 结算为绝对 left/top（与 transform 视觉位置一致，无跳变），覆盖 right 锚定，持久化落点
        var r = el.getBoundingClientRect();
        var fl = Math.round(r.left), ft = Math.round(r.top);
        el.style.transform = '';
        el.style.left = fl + 'px';
        el.style.top = ft + 'px';
        el.style.right = 'auto';
        CONFIG.PANEL_POS = { x: fl, y: ft };
        savePanelCfg();
      } catch (e) { swallow(e); }
    }
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var t = e.target;
      if (!t || !t.closest) return;
      // —— 白名单把手：仅标题栏、或"点中面板但未命中任何实质内容/交互元素"的空白区可拖动 ——
      // 其余（按钮/输入/滑块/复选框/下拉/链接/纯文字标签/卡片内容/刷新区块/诊断文本等）一律不触发，避免误拖。
      var onTitlebar = !!t.closest('.cx-titlebar');
      var onInteractive = !!(t.closest('input,button,select,textarea,a,label,#__cxPanelClose,[data-no-drag]'));
      var onSubstantial = !!(t.closest('.cx-cmd-wrap,.cx-nav,.cx-tab,#__cxPanelInfo,#__cxSubPanelsWrap,#__cxAddonsWrap,.cx-diag'));
      if (!onTitlebar && (onInteractive || onSubstantial)) return;
      dragging = true;
      el.classList.add('cx-dragging');   // Ninja 模式下保持折叠态，避免悬停展开造成宽度突变
      el.style.willChange = 'transform'; // 提升为独立合成层：移动只重排(合成)不重绘内容
      var rect = el.getBoundingClientRect();
      ax = rect.left; ay = rect.top; w = el.offsetWidth; h = el.offsetHeight;  // 缓存一次尺寸
      el.style.left = ax + 'px'; el.style.top = ay + 'px'; el.style.right = 'auto';  // 锚定为绝对定位，transform 在其上叠加
      sx = e.clientX; sy = e.clientY; dx = 0; dy = 0;
      e.preventDefault();
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Ninja 已改为圆形悬浮钮（对称，任意位置观感一致），无需左/右贴边判定；位置由 PANEL_POS 自由落点决定

  // ===== DOMAIN: ui/diagnostics (diagnostics + blackbox) =====
  function buildDiagnostics() {                    // 一键反馈：汇总共全部状态/开关/标志为文本
    var L = [];
    L.push('=== 学习通·强制续播 诊断信息 ===');
    L.push('版本: ' + SCRIPT_VERSION + ' · 时间: ' + new Date().toLocaleString());
    var vs = allVideos();
    L.push('视频总数: ' + vs.length + ' · moQueue: ' + _moQueue.length + ' · ENDED_SRCS: ' + Object.keys(ENDED_SRCS).length);
    var _rec = recentErrors(3);
    L.push('错误累计: ' + errorCount() + ' · 最近(tag): ' + (_rec.length ? _rec.map(function (r) { return r.tag; }).join(',') : '无'));
    var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    L.push('heap: ' + (m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB / ' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a'));
    L.push('桥: ' + (BRIDGE && BRIDGE.base ? ('已连 ' + BRIDGE.base) : '离线') + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter));
    L.push('定向: enabled=' + (TARGET && TARGET.enabled) + ' matchedAny=' + (TARGET && TARGET.matchedAny) + ' 0命中连击=' + _targetMissStreak + '/' + CONST.TARGET_FALLBACK_ROUNDS);
    L.push('CONFIG: AUTO_STOP_MIN=' + CONFIG.AUTO_STOP_MIN + ' RESUME_AFTER_MIN=' + CONFIG.RESUME_AFTER_MIN + ' RESCAN_INTERVAL=' + CONFIG.RESCAN_INTERVAL + ' END_RELEASE_SEC=' + CONFIG.END_RELEASE_SEC + ' LOOP_PLAY=' + CONFIG.LOOP_PLAY + ' SINGLE_VIDEO=' + CONFIG.SINGLE_VIDEO + ' NINJA=' + CONFIG.NINJA_MODE + ' PAUSE_HOTKEY=' + CONFIG.PAUSE_HOTKEY + ' DEBUG=' + DEBUG + ' INTRUSION_MODE=' + CONFIG.INTRUSION_MODE + ' POLITE_MODE=' + CONFIG.POLITE_MODE);
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
          ' Released=' + !!cxState(v).released + ' EndedLock=' + !!v.__cxEndedLock +
          ' 原生pause=' + !!v.__np + ' nearEnd=' + nearEnd(v) + ' keep=' + !!cxState(v).userKeep +
          ' 进度=' + fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? '/' + fmtTime(v.duration) : '') +
          ' 已看=' + ((cxState(v).watchMs || 0) / 60000).toFixed(1) + 'min' +
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
        navigator.clipboard.writeText(txt).then(function () { Store.emit('ui:toast', '已复制诊断信息'); }, function () { fallbackCopy(txt); });
      } else fallbackCopy(txt);
    } catch (e) { fallbackCopy(txt); }
  }
  function fallbackCopy(txt) {                     // 非安全上下文/剪贴板 API 不可用时的降级
    try {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px';
      if (document.body) { document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
      Store.emit('ui:toast', '已复制诊断信息');
    } catch (e2) { Store.emit('ui:toast', '复制失败，请手动复制'); }
  }

  // ===== 安全审计（建议#10）：实时侵入点盘点 =====
  // 仅读取可观测事实（全局符号 / 注入 DOM id / prototype 包装特征 / mediaSession 钩子标志 / localStorage），
  // 不修改任何运行状态。供面板「系统」页透明展示脚本当前的全局侵入面，落实审计透明化诉求。
  var _CX_AUDIT_GLOBALS = ['__CX_FORCE_PLAY', '__cxRegisterAddon', '__cxRegisterCommand', '__cxUI', '__cxAddonQueue'];
  var _CX_AUDIT_DOM_IDS = ['__cxPanel', '__cxPanelNinjaStyle', '__cxPanelAnimStyle', '__cxPanelMobileStyle', '__cxToast'];
  function _cxAuditDomPresent(id) {
    try {
      if (document.getElementById(id)) return true;
      if (window.top && window.top !== window && window.top.document && window.top.document.getElementById(id)) return true;
    } catch (e) { swallow(e); }
    return false;
  }
  function _cxAuditProtoPause() {   // #1 礼貌模式原型体 toString 已伪装(不含 '__cxForcePaused')，字串扫描恒 false 会撒谎；故礼貌模式改用行为/引用探测判据
    try {
      if (CONFIG.POLITE_MODE) {
        var n = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.getPauseNeutralized === 'function') ? window.__CX_FORCE_PLAY.getPauseNeutralized() : null;
        return !!n;   // true=中性化在位；false=被还原；null(未装原型)→false
      }
      return String(HTMLMediaElement.prototype.pause).indexOf('__cxForcePaused') >= 0;
    } catch (e) { return false; }
  }
  function _cxAuditProtoRate() {
    try {
      if (CONFIG.POLITE_MODE) {
        var n = (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.getRateNeutralized === 'function') ? window.__CX_FORCE_PLAY.getRateNeutralized() : null;
        return !!n;
      }
      var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      return !!(d && d.set && String(d.set).indexOf('__cxForcePaused') >= 0);
    } catch (e) { return false; }
  }
  function _cxAuditMediaSession() {
    try { return !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY._mediaSessionHooked); } catch (e) { return false; }
  }
  function _cxAuditUninstallHook() {
    try { return !!(window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY._uninstallHooked); } catch (e) { return false; }
  }
  function _cxAuditLsKeys() {
    var ks = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('cx_') === 0) ks.push(k); } } catch (e) { swallow(e); }
    return ks;
  }
  // 返回结构化清单：[{area, item, on, detail}] —— on=true 表示当前已侵入/已接管
  function buildInvasionReport() {
    var rows = [];
    function add(area, item, on, detail) { rows.push({ area: area, item: item, on: !!on, detail: detail || (on ? item : '未启用/已还原') }); }
    var g = [], i;
    for (i = 0; i < _CX_AUDIT_GLOBALS.length; i++) { try { if (typeof window[_CX_AUDIT_GLOBALS[i]] !== 'undefined') g.push(_CX_AUDIT_GLOBALS[i]); } catch (e) { swallow(e); } }
    add('全局符号', 'window 导出(namespace+副脚本契约)', g.length > 0, g.length ? g.join(', ') : '无');
    var d = [];
    for (i = 0; i < _CX_AUDIT_DOM_IDS.length; i++) { if (_cxAuditDomPresent(_CX_AUDIT_DOM_IDS[i])) d.push(_CX_AUDIT_DOM_IDS[i]); }
    add('注入 DOM', '面板/style/Toast 节点', d.length > 0, d.length ? d.join(', ') : '无');
    add('prototype.pause', 'HTMLMediaElement.prototype.pause 包装(抗平台还原)', _cxAuditProtoPause());
    add('prototype.playbackRate', 'playbackRate setter 包装', _cxAuditProtoRate());
    add('navigator.mediaSession', 'pause handler 已接管(卸载还原)', _cxAuditMediaSession());
    add('事件监听', 'pagehide/beforeunload 卸载钩子', _cxAuditUninstallHook());
    var ls = _cxAuditLsKeys();
    add('localStorage', 'cx_* 配置键(' + ls.length + ')', ls.length > 0, ls.length ? ls.slice(0, 8).join(', ') + (ls.length > 8 ? ' …' : '') : '无');
    // #1 温和/礼貌模式：当前入侵策略（透明展示，便于用户核对与 #10 审计协同）
    add('策略', 'INTRUSION_MODE=' + CONFIG.INTRUSION_MODE, CONFIG.INTRUSION_MODE !== 'gentle',
      '原型中性化' + (CONFIG.INTRUSION_MODE === 'gentle' ? '已关（仅实例级·最小侵入）' : (CONFIG.INTRUSION_MODE === 'aggressive' ? '始终启用' : '按站点自适应')));
    add('策略', 'POLITE_MODE=' + CONFIG.POLITE_MODE, CONFIG.POLITE_MODE, CONFIG.POLITE_MODE ? 'pause.toString 伪装·抗检测（行为还原检测）' : '关');
    return rows;
  }
  try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.buildInvasionReport = buildInvasionReport; } catch (e) { swallow(e); }   // 暴露为公开 API（面板审计/测试可调用）

  // ===== DOMAIN: ui/dashboard (state refresh + badge + dashboard + video list) =====
  function fmtTime(sec) {                          // 秒 → m:ss / h:mm:ss
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = (h > 0 && m < 10 ? '0' : '') + m, ss = (s < 10 ? '0' : '') + s;
    return (h > 0 ? h + ':' + mm : m) + ':' + ss;
  }
  // 环形仪表：把百分比映射到 dashoffset（r=14 → 周长≈87.96），并同步中心文字
  function _gauge(ring, txt, pct, color, label) {
    if (!ring) return;
    var C = 87.96;
    var p = Math.max(0, Math.min(100, pct));
    ring.style.strokeDashoffset = (C * (1 - p / 100)).toFixed(2);
    ring.style.stroke = color;
    if (txt) txt.textContent = label;
  }
  // 十六进制色 → rgba（用于呼吸灯辉光，与状态色一致）
  function _hexA(hex, a) {
    try {
      var h = String(hex).replace('#', '');
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    } catch (e) { return 'rgba(16,185,129,' + a + ')'; }
  }
  function refreshPanelState() {
    if (!_cxPanel) return;
    refreshPanelLabels();   // 拖动滑块即时刷新数值文字（修复：拖动时显示不变）
    updateBadge();          // 状态徽章：标题栏 LED 指示灯
    renderDashboard();      // 运维仪表盘实时刷新
    var st = _cxPanel.querySelector('#__cxPanelState');
    var v = activeVideo();
    if (!v) {
      // 没有正在播放的：尝试展示已用户暂停的目标
      v = currentVideo();
      if (st) { if (!v) st.textContent = '当前无视频'; else st.textContent = '视频已暂停(用户) · 按按钮恢复'; }
    } else if (st) {
      var src = (v.currentSrc || v.src || '').split('/').pop() || '(未知)';
      var status = v.__cxAN_hold ? '插播题锁定(auto-next)' : (v.__cxUserPaused ? '已暂停(用户)' : (v.paused ? '暂停' : '播放中'));
      var watchMin = ((cxState(v).watchMs || 0) / 60000).toFixed(1);
      var autoRemain = CONFIG.AUTO_STOP_MIN > 0 ? Math.max(0, CONFIG.AUTO_STOP_MIN - (cxState(v).watchMs || 0) / 60000).toFixed(1) : '关闭';
      var resumeRemain = (v.__cxUserPaused && cxState(v).resumeAt) ? Math.max(0, (cxState(v).resumeAt - Date.now()) / 60000).toFixed(1) : '—';
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
        var bridge = (BRIDGE && BRIDGE.base) ? ('已连 ' + escapeHTML(BRIDGE.base) + (BRIDGE.version ? ' v' + BRIDGE.version : '')) : '离线';
        // 空态成文（设计 §6.3）：桥离线时诊断块首行黄色警示（innerHTML 以着色单行，内容均为内部生成无注入面）
        var warnLine = (BRIDGE && BRIDGE.base) ? '' : '<div style="color:' + STYLES.T.warning + ';">桥离线 · DOM 兜底中</div>';
        info.innerHTML = warnLine +
          'v' + SCRIPT_VERSION + ' · 视频 ' + vs.length + ' · moQueue ' + _moQueue.length + ' · ended ' + Object.keys(ENDED_SRCS).length + '\n' +
          'heap ' + heap + '\n' +
          '桥 ' + bridge + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter) + '\n' +
          '定向 enabled=' + (TARGET && TARGET.enabled) + ' 命中=' + (TARGET && TARGET.matchedAny) + ' 0命中 ' + _targetMissStreak + '/' + CONST.TARGET_FALLBACK_ROUNDS + '\n' +
          '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms · 热键 P';
      }
    } catch (e) { swallow(e); }
    renderVideoList();                  // 实时刷新逐视频控制列表
  }
  // —— 状态徽章（Badge）：标题栏 LED 指示灯，一眼看清脚本当前状态 ——
  function updateBadge() {
    try {
      var b = _cxPanel.querySelector('#__cxPanelBadge');
      if (!b) return;
      var vs = allVideos();
      // 优先级：桥连接 > 锁定态 > 用户暂停 > 已释放 > 正常续播
      var color = STYLES.T.idle, title = '未运行 / 初始化中';
      if (BRIDGE && BRIDGE.base) {
        color = STYLES.T.primary2; title = '桥已连接 (' + BRIDGE.base + ')';
      }
      // 扫描所有视频，找最优先的状态
      var hasEndLock = false, hasUserPause = false, hasForcePause = false, hasPlaying = false, hasReleased = false;
      for (var i = 0; i < vs.length; i++) {
        var v = vs[i];
        if (v[FLAGS.endedLock]) hasEndLock = true;
        if (v[FLAGS.userPaused]) hasUserPause = true;
        if (v[FLAGS.forcePaused]) hasForcePause = true;
        if (!v.paused && !v.ended) hasPlaying = true;
        // nearEnd 已释放：forcePaused=false 但已在近尾 — 用 ended + nearEnd 判断
        if (v.ended && !v[FLAGS.endedLock]) hasReleased = true;
      }
      // 优先级覆盖（从高到低）
      if (BRIDGE && BRIDGE.skipResume && !hasForcePause && !hasPlaying) {
        color = STYLES.T.warning; title = '桥避让：章节已完成，脚本休眠';
      } else if (hasEndLock) {
        color = STYLES.T.danger; title = '已锁死：防重播，视频播完被锁定';
      } else if (hasUserPause && !hasForcePause && !hasPlaying) {
        color = STYLES.T.paused; title = '用户暂停：手动暂停中';
      } else if (!hasForcePause && !hasPlaying && vs.length > 0) {
        color = STYLES.T.warning; title = '已释放：无视频在播放（可能是近尾释放/非任务点/定向过滤）';
      } else if (hasForcePause || hasPlaying) {
        color = STYLES.T.success; title = '续播中：脚本正在工作';
      }
      b.style.background = color;
      b.style.boxShadow = '0 0 8px ' + _hexA(color, 0.6);   // 呼吸灯辉光，随状态色变化
      b.title = title;
    } catch (e) { swallow(e); }
  }
  // —— 运维仪表盘：MO Sparkline + 命中率 LED + 续播成功率 ——
  function renderDashboard() {
    try {
      // 采集 MO 队列历史
      var moLen = (typeof _moQueue !== 'undefined' ? _moQueue : []).length || 0;
      if (_moHistory.length === 0 || _moHistory[_moHistory.length - 1] !== moLen) {
        _moHistory.push(moLen);
        if (_moHistory.length > _moHistMax) _moHistory.shift();
      }
      // 更新 MO 队列数值
      var moVal = _cxPanel.querySelector('#__cxMoVal');
      if (moVal) { moVal.textContent = moLen; moVal.style.color = moLen > 10 ? STYLES.T.danger : STYLES.T.text; }
      // Sparkline 画布（迷你走势图）
      var cvs = _cxPanel.querySelector('#__cxMoSpark');
      if (cvs) {
        var w = cvs.width, h = cvs.height, ctx = cvs.getContext('2d');
        ctx.clearRect(0, 0, w, h);
        var hist = _moHistory;
        if (hist.length > 0) {
          var max = Math.max.apply(null, hist) || 1, n = hist.length;
          if (n > 1) {
            var step = w / Math.max(1, n - 1);
            ctx.strokeStyle = STYLES.T.primary2; ctx.lineWidth = 1.2;
            ctx.beginPath();
            for (var i = 0; i < n; i++) {
              var x = i * step, y = h - (hist[i] / max) * (h - 2) - 1;
              (i === 0) ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.stroke();
            // 填充渐变区域
            ctx.lineTo((n-1)*step, h); ctx.lineTo(0, h); ctx.closePath();
            var grd = ctx.createLinearGradient(0, 0, 0, h);
            grd.addColorStop(0, STYLES.T.primary2A25); grd.addColorStop(1, STYLES.T.primary2A0);
            ctx.fillStyle = grd; ctx.fill();
          }
        }
      }
      // 命中率环形仪表（累计命中率，像精密仪器读数，实时但不跳动）
      var targetEnabled = !!(TARGET && TARGET.enabled);
      if (targetEnabled) { _targetHitSamples++; if (TARGET.matchedAny) _targetHitHits++; }
      var hitPct = targetEnabled ? Math.round(_targetHitHits / Math.max(1, _targetHitSamples) * 100) : 0;
      var hitCol = !targetEnabled ? STYLES.T.idle : (hitPct >= 80 ? STYLES.T.success : (hitPct >= 50 ? STYLES.T.warning : STYLES.T.danger));
      _gauge(_cxPanel.querySelector('#__cxHitGauge'), _cxPanel.querySelector('#__cxHitGaugeTxt'), hitPct, hitCol, targetEnabled ? (hitPct + '%') : '—');
      // 续播成功率环形仪表
      var playPct = _safePlayAttempts > 0 ? Math.round(_safePlaySuccesses / _safePlayAttempts * 100) : 0;
      var playCol = _safePlayAttempts > 0 ? (playPct >= 80 ? STYLES.T.success : (playPct >= 50 ? STYLES.T.warning : STYLES.T.danger)) : STYLES.T.idle;
      _gauge(_cxPanel.querySelector('#__cxPlayGauge'), _cxPanel.querySelector('#__cxPlayGaugeTxt'), playPct, playCol, _safePlayAttempts > 0 ? (playPct + '%') : '—');
    } catch (e) { swallow(e); }
  }
  function renderVideoList() {          // 逐视频暂停/恢复：修复"多视频下只能控制单个视频"的缺陷
    if (!_cxPanel) return;
    var wrap = _cxPanel.querySelector('#__cxVideoList');
    if (!wrap) return;
    var vs = allVideos(), fg = foregroundVideo();
    _lastVideoList = vs;
    var html = '';
    if (!vs.length) html = '<div style="font-size:12px;color:' + STYLES.T.text3 + ';text-align:center;padding:12px 0;">未检测到视频</div>';
    for (var i = 0; i < vs.length; i++) {
      try {
        var v = vs[i];
        var isEnded = v.ended;
        var isSingleDisabled = CONFIG.SINGLE_VIDEO;   // 单视频模式：所有逐视频开关禁用
        var on = !v.__cxUserPaused && !v.paused && !isEnded;   // 开关 ON = 当前处于续播/播放态（蓝）；OFF = 暂停（灰）
        var star = (v === fg) ? '★' : '';
        var tag = isEnded ? '[结束]' : (v.__cxUserPaused ? '[暂停]' : (v.__cxForcePaused ? '[续播]' : ''));
        var trackBg = (isEnded || isSingleDisabled) ? STYLES.T.border : (on ? STYLES.T.primary2 : STYLES.T.idle);
        var knobLeft = (isEnded || isSingleDisabled) ? '2px' : (on ? '16px' : '2px');
        var cur = (isEnded || isSingleDisabled) ? 'default' : 'pointer';
        // —— 进度条数据 ——
        var dur = (isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
        var pctWatched = dur ? Math.min(100, (v.currentTime / dur) * 100) : 0;
        // buffered 范围：取包含 currentTime 的最大缓冲点
        var pctBuffered = 0;
        if (dur && v.buffered && v.buffered.length) {
          try { for (var bi = 0; bi < v.buffered.length; bi++) { var be = v.buffered.end(bi); if (be > v.currentTime) pctBuffered = Math.max(pctBuffered, Math.min(100, (be / dur) * 100)); } } catch (e) {}
        }
        var hasLoop = CONFIG.LOOP_PLAY && !v.ended;
        html += '<div style="display:flex;align-items:center;gap:8px;margin:3px 0;font-size:11px;">' +
          '<span data-vi="' + i + '"' + (isEnded || isSingleDisabled ? ' data-dis="1"' : '') + ' title="' + (isSingleDisabled ? '单视频模式：仅前台播放（关闭「只播放一个视频」恢复独立控制）' : '点击切换续播/暂停') + '" style="display:inline-block;width:32px;height:18px;border-radius:9px;position:relative;flex:0 0 auto;cursor:' + cur + ';background:' + trackBg + ';">' +
            '<span style="position:absolute;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);left:' + knobLeft + ';"></span>' +
          '</span>' +
          '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' + (star ? 'color:' + STYLES.T.star + ';' : '') + (isEnded ? 'color:' + STYLES.T.text3 + ';' : '') + '">#' + (i + 1) + star + ' ' + tag + ' ' + escapeHTML(shortSrc(v)) + '</span>' +
        '</div>' +
        // —— 进度条（已看+缓存+循环标记）——
        (dur > 0 ? '<div style="position:relative;height:4px;background:' + STYLES.T.track + ';border-radius:2px;margin-left:40px;margin-bottom:4px;' + (isEnded ? 'opacity:.3;' : '') + '">' +
          // 已看部分（蓝色）
          '<div style="position:absolute;left:0;top:0;height:100%;background:' + STYLES.T.primary2 + ';border-radius:2px;width:' + pctWatched.toFixed(1) + '%;"></div>' +
          // 缓存部分（浅灰，在已看之后）
          (pctBuffered > pctWatched ? '<div style="position:absolute;left:' + pctWatched.toFixed(1) + '%;top:0;height:100%;background:' + STYLES.T.buffered + ';border-radius:2px;width:' + (pctBuffered - pctWatched).toFixed(1) + '%;"></div>' : '') +
          // 循环标记（末尾小箭头）
          (hasLoop ? '<span style="position:absolute;right:-8px;top:-3px;font-size:8px;color:' + STYLES.T.warning + ';">↻</span>' : '') +
        '</div>' : '') +
        // 进度文字
        (dur > 0 ? '<div style="font-size:9px;color:' + STYLES.T.text3 + ';margin-left:40px;margin-bottom:4px;display:flex;justify-content:space-between;">' +
          '<span>' + fmtTime(v.currentTime) + '</span>' +
          (v.ended ? '<span style="color:' + STYLES.T.text3 + ';">已结束</span>' : '<span>' + fmtTime(dur) + '</span>') +
        '</div>' : '');
      } catch (e) { swallow(e); }
    }
    wrap.innerHTML = html;
  }

  // ===== DOMAIN: ui/commands (command palette) =====
  // ===== MODULE: 命令面板 =====
  // 域：UI/面板模块 —— 命令面板。
  // 在控制面板内提供「/命令」输入：输入 / 唤起下拉、↑↓ 选择、Tab 补全、Enter 执行、Esc 关闭下拉。
  // 命令可带参数（如 /rate 2 /autostop 5）；无参数命令鼠标点击即执行，有参数命令点击后填入待补全。
  // registerCommand 同时暴露到 window.__cxRegisterCommand，供副脚本/其它脚本扩展命令。
  var _cxCommands = [];                 // [{name, desc, args, exec}]
  var _cxCmdFilter = [];                // 当前过滤后的命令（用于 ↑↓ 高亮）
  var _cxCmdHi = -1;                    // 高亮索引（过滤列表内）
  // —— 命令收藏夹：星标系统，持久化到 localStorage ——
  var _cxFavorites = [];                // 收藏的命令名数组
  try { _cxFavorites = JSON.parse(localStorage.getItem('cx_cmd_fav') || '[]'); } catch (e) { _cxFavorites = []; }
  function _cxFavSave() { try { localStorage.setItem('cx_cmd_fav', JSON.stringify(_cxFavorites)); } catch (e) { swallow(e); } }
  function _cxFavToggle(name) {
    var idx = _cxFavorites.indexOf(name);
    if (idx >= 0) { _cxFavorites.splice(idx, 1); Store.emit('ui:toast', '已取消收藏 /' + name); }
    else { _cxFavorites.push(name); Store.emit('ui:toast', '已收藏 /' + name); }
    _cxFavSave();
    _cxCmdUpdate();  // 刷新下拉
  }
  function registerCommand(name, desc, hasArgs, exec) {   // name 不含斜杠；exec(rawInput, argStr)
    name = ('' + (name || '')).replace(/^\//, '').trim().toLowerCase();
    if (!name) return;
    for (var i = 0; i < _cxCommands.length; i++) { if (_cxCommands[i].name === name) { _cxCommands[i].desc = desc; _cxCommands[i].args = !!hasArgs; _cxCommands[i].exec = exec; return; } }
    _cxCommands.push({ name: name, desc: desc || '', args: !!hasArgs, exec: exec });
  }
  function executeRawCmd(raw) {         // 解析并执任何输入（含参数），下拉关闭与否都执行——修复「参数命令下拉关闭后 Enter 不执行」
    raw = ('' + (raw || '')).trim();
    if (!raw) { Store.emit('ui:toast', '请输入命令，如 /pause（输入 / 查看全部）'); return false; }
    var sp = raw.indexOf(' ');
    var head = (sp < 0 ? raw : raw.slice(0, sp)).replace(/^\//, '').toLowerCase();
    var arg = (sp < 0 ? '' : raw.slice(sp + 1)).trim();
    if (!head) { Store.emit('ui:toast', '请输入命令名称，如 /pause'); return false; }
    for (var i = 0; i < _cxCommands.length; i++) {
      if (_cxCommands[i].name === head) {
        try { _cxCommands[i].exec(raw, arg); } catch (e) { swallow(e); Store.emit('ui:toast', '命令执行出错: ' + head, 'error'); }
        return true;
      }
    }
    Store.emit('ui:toast', '未知命令: /' + head + '（输入 / 查看全部）', 'warn');
    return false;
  }
  function _videoByArg(arg) {           // 参数为空→前台/当前视频；数字→该序号视频
    if (!arg) { var v = currentVideo(); if (!v) { Store.emit('ui:toast', '未找到当前视频，无法执行'); return undefined; } return v; }
    var n = parseInt(arg, 10); if (isNaN(n)) { Store.emit('ui:toast', '参数需为数字序号，如 /pause 2'); return undefined; }
    var vs = allVideos(); var v = vs[n - 1];
    if (!v) { Store.emit('ui:toast', '无第 ' + n + ' 个视频（共 ' + vs.length + ' 个）'); return undefined; }
    return v;
  }
  function initBuiltinCommands() {      // 注册内置命令（幂等）
    if (_cxCommands.length) return;     // 已注册则跳过，避免重复
    registerCommand('pause', '暂停视频（可带序号，如 /pause 2）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userPause(v); Store.emit('panel:refresh'); Store.emit('ui:toast', '已暂停视频', 'success');
    });
    registerCommand('resume', '恢复续播（可带序号）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userResume(v); Store.emit('panel:refresh'); Store.emit('ui:toast', '已恢复续播', 'success');
    });
    registerCommand('loop', '循环播放 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); CONFIG.LOOP_PLAY = on; clampCfg(); applyLoopAll(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '循环播放 ' + (on ? '开' : '关'));
    });
    registerCommand('rate', '设置播放速率，如 /rate 1.5', true, function (raw, arg) {
      var r = parseFloat(arg); if (isNaN(r)) { Store.emit('ui:toast', '用法: /rate 0.5~2'); return; } CONFIG.USER_RATE = r; clampCfg(); applyUserRateAll(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '播放速率 ' + CONFIG.USER_RATE + 'x');
    });
    registerCommand('autostop', '自动停止计时(分钟)，如 /autostop 30', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { Store.emit('ui:toast', '用法: /autostop 0~120'); return; } CONFIG.AUTO_STOP_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '自动停止 ' + CONFIG.AUTO_STOP_MIN + ' 分钟');
    });
    registerCommand('autoresume', '暂停后自动恢复(分钟)，如 /autoresume 10', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { Store.emit('ui:toast', '用法: /autoresume 0~60'); return; } CONFIG.RESUME_AFTER_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '自动恢复 ' + CONFIG.RESUME_AFTER_MIN + ' 分钟');
    });
    registerCommand('debug', '调试日志 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); DEBUG = on; savePanelCfg(); Store.emit('ui:toast', '调试日志 ' + (on ? '开' : '关'));
    });
    registerCommand('copy', '复制诊断信息', false, function () { copyDiagnostics(); });
    registerCommand('refresh', '立即重扫视频与状态', false, function () { try { Store.emit('cmd:scan'); } catch (e) { swallow(e); } Store.emit('panel:refresh'); Store.emit('ui:toast', '已重扫'); });
    registerCommand('audit', '刷新安全审计清单(洞察页)', false, function () { try { Store.emit('ui:switchTab', 'insight'); showPanel(); Store.emit('panel:refresh'); Store.emit('ui:toast', '已刷新侵入点清单'); } catch (e) { swallow(e); } });
    registerCommand('rescan', '重启轮询(ms)，如 /rescan 1000', true, function (raw, arg) {
      var ms = parseInt(arg, 10); if (isNaN(ms)) { Store.emit('ui:toast', '用法: /rescan 500~5000'); return; } CONFIG.RESCAN_INTERVAL = ms; clampCfg(); savePanelCfg();
      try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }
      try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }
      syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms');
    });
    registerCommand('cleardata', '彻底清除脚本写入的 localStorage(cx_* 键)', false, function () {
      try {
        var n = 0;
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var k = localStorage.key(i);
          if (k && k.indexOf('cx_') === 0) { try { localStorage.removeItem(k); n++; } catch (e2) { swallow(e2); } }
        }
        Store.emit('ui:toast', '已清除 ' + n + ' 个 cx_* 键（刷新后配置/统计归零）', 'success');
      } catch (e) { swallow(e); Store.emit('ui:toast', '清除失败', 'error'); }
    });
    registerCommand('help', '显示命令帮助', false, function () {
      var names = _cxCommands.map(function (c) { return '/' + c.name + (c.args ? ' …' : ''); }).join('  ');
      Store.emit('ui:toast', '命令: ' + names);
      _cxCmdShowAll && _cxCmdShowAll();
    });
    registerCommand('close', '关闭面板', false, function () { hidePanel(); });
    registerCommand('hide', '关闭面板', false, function () { hidePanel(); });
    // —— 视频快捷操作 ——
    registerCommand('only', '仅播此轨：暂停其他视频，只留前台播放', false, function () {
      try { var fg = foregroundVideo(); if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var vs = allVideos(); for (var i = 0; i < vs.length; i++) { if (vs[i] !== fg && !vs[i].__cxUserPaused) userPause(vs[i]); }
        Store.emit('ui:toast', '已仅播前台视频'); Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    registerCommand('resumeall', '全部续播：恢复所有被暂停的视频', false, function () {
      try { var vs = allVideos(); for (var i = 0; i < vs.length; i++) { if (vs[i].__cxUserPaused) userResume(vs[i]); }
        Store.emit('ui:toast', '已全部续播'); Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    registerCommand('mute', '前台视频静音 on/off（默认切换）', true, function (raw, arg) {
      try { var fg = foregroundVideo(); if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var on = arg ? !/^off$/i.test(arg.trim()) : !fg.muted; fg.muted = !!on;
        Store.emit('ui:toast', '前台视频已' + (fg.muted ? '静音' : '取消静音'));
      } catch (e) { swallow(e); }
    });
    registerCommand('seek', '前台视频跳转到指定秒数', true, function (raw, arg) {
      try { var fg = foregroundVideo(); if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var s = parseFloat(arg); if (isNaN(s)) { Store.emit('ui:toast', '用法: /seek 120'); return; }
        try { fg.currentTime = s; } catch (e2) { swallow(e2); }
        Store.emit('ui:toast', '已跳到 ' + Math.round(s) + ' 秒');
      } catch (e) { swallow(e); }
    });
    // —— 面板 / 模式控制 ——
    registerCommand('ninja', '切换 n 模式（可加 on/off）', true, function (raw, arg) {
      try { if (arg) { var on = !/^off$/i.test(arg.trim()); if (!!CONFIG.NINJA_MODE === on) { Store.emit('ui:toast', 'n 模式已是 ' + (on ? 'on' : 'off')); return; } }
        toggleNinjaMode(); Store.emit('ui:toast', 'n 模式已' + (CONFIG.NINJA_MODE ? '关' : '开'));
      } catch (e) { swallow(e); }
    });
    registerCommand('single', '单视频模式 on/off（只控制前台视频）', true, function (raw, arg) {
      try { var on = arg ? !/^off$/i.test(arg.trim()) : !CONFIG.SINGLE_VIDEO; CONFIG.SINGLE_VIDEO = !!on;
        savePanelCfg(); syncPanelInputs(); Store.emit('ui:toast', '单视频模式 ' + (CONFIG.SINGLE_VIDEO ? '开' : '关'));
      } catch (e) { swallow(e); }
    });
    registerCommand('width', '设置面板宽度(px, 288-760)', true, function (raw, arg) {
      try { var w = parseInt(arg, 10); if (isNaN(w)) { Store.emit('ui:toast', '用法: /width 520'); return; }
        CONFIG.PANEL_W = w; clampCfg(); savePanelCfg();
        if (_cxPanel) _cxPanel.style.setProperty('--cx-panel-w', CONFIG.PANEL_W + 'px');
        syncPanelInputs(); Store.emit('ui:toast', '面板宽度 → ' + CONFIG.PANEL_W + 'px');
      } catch (e) { swallow(e); }
    });
    registerCommand('tab', '切换标签页: control|automation|insight|system', true, function (raw, arg) {
      try { var m = { control: 'control', automation: 'automation', insight: 'insight', system: 'system', 控制: 'control', 自动: 'automation', 洞察: 'insight', 系统: 'system' };
        var name = m[(arg || '').trim().toLowerCase()]; if (!name) { Store.emit('ui:toast', '用法: /tab system'); return; }
        Store.emit('ui:switchTab', name); Store.emit('ui:toast', '已切到「' + name + '」');
      } catch (e) { swallow(e); }
    });
  }
  // —— 下拉渲染与交互（依赖面板内 #__cxCmd / #__cxCmdList，缺失时安全降级）——
  function _cxCmdRender(list, hi, showFav) {
    var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList'); if (!box) return;
    _cxCmdFilter = list; _cxCmdHi = hi;
    if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var html = '';
    if (showFav && _cxFavorites.length) {
      html += '<div style="padding:2px 8px;font-size:9px;color:' + STYLES.T.warning + ';border-bottom:1px solid ' + STYLES.T.border + ';">★ 收藏命令</div>';
    }
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var isFav = _cxFavorites.indexOf(c.name) >= 0;
      html += '<div data-ci="' + i + '" style="display:flex;align-items:center;padding:5px 8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
        (i === hi ? 'background:' + STYLES.T.primary + ';color:#fff;' : 'color:' + STYLES.T.text + ';') + '"' +
        ' title="' + escapeHTML(c.desc || ('/' + c.name)) + '">' +
        '<span data-fav="' + escapeHTML(c.name) + '" title="' + (isFav ? '取消收藏' : '收藏命令') + '" style="cursor:pointer;color:' + (isFav ? STYLES.T.warning : STYLES.T.idle) + ';margin-right:6px;font-size:13px;flex:0 0 auto;">' + (isFav ? '★' : '☆') + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">' +
          '<b>/' + escapeHTML(c.name) + '</b>' + (c.args ? ' …' : '') +
          (c.desc ? ' <span style="color:' + (i === hi ? STYLES.T.onPrimary2 : STYLES.T.text2b) + ';">— ' + escapeHTML(c.desc) + '</span>' : '') +
        '</span>' +
        '</div>';
    }
    box.innerHTML = html; box.style.display = 'block';
  }
  function _cxCmdUpdate() {
    var inp = _cxPanel && _cxPanel.querySelector('#__cxCmd'); if (!inp) return;
    var q = ('' + (inp.value || '')).trim().toLowerCase();
    if (!q) {
      // 输入为空时，收藏命令优先显示在最前
      var all = _cxCommands.slice();
      var favs = [], rest = [];
      for (var i = 0; i < all.length; i++) {
        if (_cxFavorites.indexOf(all[i].name) >= 0) favs.push(all[i]);
        else rest.push(all[i]);
      }
      _cxCmdRender(favs.concat(rest), -1, true);  // showFav=true：渲染星标图标
      return;
    }
    var head = q.replace(/^\//, '');
    var list = [];
    // 收藏匹配项优先
    for (var i2 = 0; i2 < _cxCommands.length; i2++) { if (_cxCommands[i2].name.indexOf(head) === 0 && _cxFavorites.indexOf(_cxCommands[i2].name) >= 0) list.push(_cxCommands[i2]); }
    for (var i3 = 0; i3 < _cxCommands.length; i3++) { if (_cxCommands[i3].name.indexOf(head) === 0 && _cxFavorites.indexOf(_cxCommands[i3].name) < 0) list.push(_cxCommands[i3]); }
    if (!list.length) { for (var j = 0; j < _cxCommands.length; j++) { if (_cxCommands[j].name.indexOf(head) >= 0) list.push(_cxCommands[j]); } }
    _cxCmdRender(list, list.length ? 0 : -1, false);
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

  // ===== DOMAIN: bootstrap/main-loop (startup + main loop scheduler) =====
  // 即时接管：任何 video 一开始 play 即立刻 override，无需等 2s 轮询（吸收 chaoxing-media-collector 的 play 捕获思路）。
  // 缩短动态插入播放器的接管空窗，使手动暂停开关对"新插入、尚未轮询到"的视频也可靠生效；overrideVideo 自身幂等且
  // 在 __cxUserPaused 时交还原生 pause 提前返回，故对暂停态/已接管视频无副作用。
  // 即时接管 play 事件（修复复审：同源 iframe 内视频的 play 事件不冒泡到顶层 document，需在 iframe 文档内也装一份）
  // 【架构·生命周期】handler 必须是具名函数、且安装过的 document 需登记到 _playWatchDocs（dom/lifecycle.js 声明）：
  //   否则 cleanupListeners / window.__CX_FORCE_PLAY.uninstall() 无法 removeEventListener，卸载后该捕获监听
  //   仍然存活并继续在用户暂停时把视频压回暂停，与 uninstall「回到注入前状态」的语义承诺相违背。
  //   切勿改回内联匿名函数。
  function playWatchHandler(e) {
    try {
      if (e && e.target && e.target.tagName === 'VIDEO') {
        var _pv = e.target;
        // 用户暂停期间任何 play 事件（平台绕过闸门直接触发播放）→ 立即压回暂停，保证暂停锁真正锁得住
        if (_pv[FLAGS.userPaused]) { try { (_pv[FLAGS.np] || NATIVE_PAUSE).call(_pv); } catch (e3) { swallow(e3); } return; }
        overrideVideo(_pv, foregroundVideo());   // 传前台，使非前台视频即时接管时被门控释放（修复多视频同播）
      }
    } catch (e2) { swallow(e2); }
  }
  function installPlayWatch(doc) {
    if (!doc || !doc.addEventListener) return;
    try {
      doc.addEventListener('play', playWatchHandler, true);   // 捕获阶段，最先拿到 play 事件
      // 登记以便卸载还原（同一 doc 重复安装时 addEventListener 天然去重，此处仅需保证清单不重复）
      if (_playWatchDocs.indexOf(doc) === -1) _playWatchDocs.push(doc);
    } catch (e) { swallow(e); }
  }
  try { installPlayWatch(document); } catch (e) { swallow(e); }   // 顶层文档
  // 首次安装：先拉桥清单（异步、失败静默），再刷新定向目标（读 siteAttachments()），再扫描
  try { hookAttachments(); } catch (e) { swallow(e); }   // #1：安装 setter 钩子，attachments 异步到达即重建白名单
  try { bridgeInit(); } catch (e) { swallow(e); }
  try { refreshTargets(); } catch (e) { swallow(e); }
  try { scanVideos(document); neutralizeGlobalPause(window); } catch (e) { swallow(e); }

  var _tamperAlarmed = false;   // #1 原型还原报警去抖（跨轮保持）
  // 低频全量重扫：应对平台重定义 pause / 原型硬调用 / DOM 换血（间隔由 CONFIG.RESCAN_INTERVAL 控制，面板可实时调整）
  function _loopTick() {                            // 提取为命名函数：使面板改 RESCAN_INTERVAL 时能 clearInterval 后重启立即生效
    try { refreshTargets(); } catch (e) { swallow(e); }                 // 重置 matchedAny 并重建任务点 id 集
    try { scanVideos(document); neutralizeGlobalPause(window); } catch (e) { swallow(e); }
    // 【易误判·诊断#六】此处每轮重装是 F-B4 刻意设计（防 use strict 下描述符被平台还原绕过），切勿改为"仅首装幂等"，否则还原该缺陷。
    // #1 行为探测还原检测：F-B4 重装前比对原型 pause/playbackRate 是否仍引用我们装上的中性化函数（probePauseNeutralized/probeRateNeutralized）；
    //   若被平台还原（Object.freeze/重新赋值绕过）→ 报警一次（去抖），随后 F-B4 重装自愈。温和模式(未装原型)探测返回 null，跳过。
    try {
      if (typeof probePauseNeutralized === 'function' && typeof probeRateNeutralized === 'function') {
        var _pn = probePauseNeutralized(), _rn = probeRateNeutralized();
        if (_pn === false || _rn === false) {
          if (!_tamperAlarmed) {
            _tamperAlarmed = true;
            dbg('原型 pause/playbackRate 中性化被平台还原，触发重装');
            try { if (typeof window !== 'undefined' && window.Store && window.Store.emit) window.Store.emit('ui:toast', '⚠ 检测到原型被平台还原，已自动重装续播守卫'); } catch (e2) {}
          }
        } else { _tamperAlarmed = false; }
      }
    } catch (e) { swallow(e); }
    try { if (usePrototypeNeutralize()) installPrototypePauseNeutralize(); } catch (e) { swallow(e); }   // F-B4：每轮重新 neutralize 原型 pause，防个别页 use strict 下描述符被平台还原绕过；#1 温和模式下跳过（usePrototypeNeutralize 据 INTRUSION_MODE 决策）
    // 定向启用但本轮无任何 video 命中：不在本轮回退（避免章节切换间隙 / 视频延迟渲染的瞬时空窗触发
    // 定向↔全量横跳、误强播广告/插播）。连续 N 轮稳定 0 命中才判定"白名单失效"回退全量（专项诊断#三，迟滞）。
    try {
      if (TARGET.enabled && !TARGET.matchedAny) {
        if (++_targetMissStreak >= CONST.TARGET_FALLBACK_ROUNDS) { dbg('定向连续 ' + _targetMissStreak + ' 轮 0 命中，回退全续播'); TARGET.enabled = false; _dbgTargetState = 'fallback'; }
      } else { _targetMissStreak = 0; }
    } catch (e) { swallow(e); }
    // 内存埋点（切屏崩溃观测）：DEBUG 时每 30 轮（~1min）采样一次，持续观察 heap 与队列趋势
    if (DEBUG && (++_memPoll % CONST.MEM_SAMPLE_EVERY) === 0) { try { _memSample('loop'); } catch (e) { swallow(e); } }
    // 观看计时始终运行（修复面板"已看"恒为 0：原先仅 AUTO_STOP_MIN>0 才累计）；自动暂停判定在 tick 内部按开关生效
    try { autoStopTick(); } catch (e) { swallow(e); }
    if (CONFIG.RESUME_AFTER_MIN > 0) { try { resumeTick(); } catch (e) { swallow(e); } }
    try { applyUserRateAll(); } catch (e) { swallow(e); }   // 周期性把用户倍速施加到所有视频，压制平台把 playbackRate 重置回 1x（防倍速形同虚设）
    if (_cxPanel && _cxPanel.style.display !== 'none') { try { Store.emit('videos:scanned'); } catch (e) { swallow(e); } }  // P3：面板可见时发扫描结束信号（事件总线），订阅方刷新（等价旧行为）
  }
  var _loopTimer = null;
  try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }

  // #1 温和/礼貌模式：全模块加载、站点识别(SITE)已就绪后，按 INTRUSION_MODE 收敛原型中性化装/卸。
  // 加载期(config.js 早于 site-router.js)usePrototypeNeutralize 保守返回 true 已先装原型；
  // 此处对 'auto' 做精确站点解析、对持久化 'gentle' 执行卸载降级，使刷新后的设置即时生效。
  try { if (typeof reconcileIntrusionMode === 'function') reconcileIntrusionMode(); } catch (e) { swallow(e); }

  // P1 状态集中：将核心业务状态镜像进 Store.state（与全局变量同一对象引用，零行为回归）
  Store.state.TARGET = TARGET;
  Store.state.BRIDGE = BRIDGE;
  Store.state.ENDED_SRCS = ENDED_SRCS;
  Store.state._watchStats = _watchStats;
  Store.state._loopTimer = _loopTimer;

})();
