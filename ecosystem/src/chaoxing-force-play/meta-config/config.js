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
  //   其中 'chaoxing' 含 *.chaoxing.com 与 *.edu.cn（高校承载超星，#1 已覆盖），故 auto 模式在这两类域均激进中性化；
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
    _ns.detectSite = detectSite;          // 暴露站点识别（#1 回归需断言 edu.cn 视为 chaoxing；UI/审计亦可复用）
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
