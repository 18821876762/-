// @provides: CONFIG, CONST, DEBUG, DEFAULT_CONFIG, FLAGS, SELECTORS
// @requires: EventBus
// @source-group: takeover/foundation/meta-config/config.js
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
    SINGLE_VIDEO_COURSES: [],   // 按 courseId 强制单视频的课程名单（实践发现部分课程并发续播会触发风控，仅这些课程单视频，其余保留并发）
    NINJA_MODE: false,     // Ninja 模式：面板默认缩成窄条（仅标题+指示灯），鼠标悬停展开。适合录屏/隐私场景
    PANEL_W: 340,          // 面板宽度(px，288~760)：正常态与 Ninja 展开态共用，「系统」页滑块可调并持久化（专业工具 UI 规范：默认 340，工具面板宜窄）
    PANEL_POS: null,       // 面板拖拽落点 {x,y}（px，相对视口）；null=使用 CSS 默认右上角。解决 Ninja 模式无法上下/左右移动
    INTRUSION_MODE: 'auto', // #1 温和模式：原型中性化启用策略。'auto'=按站点自适应(超星激进/其余温和)；'gentle'=仅实例级+事件，绝不碰原型(超星有覆盖窗口)；'aggressive'=始终包装原型(现状默认，最稳)
    // v4.19.51：默认改为开。学习通/超星已升级反作弊（播放逻辑检测 + 服务端校验），默认关时
    //   HTMLMediaElement.prototype.pause.toString() 函数体内明文含 '__cxForcePaused'，平台一次 toString 扫描即命中风控。
    // 开启后：① 原型体用「方法简写」并统一引用 FLAGS.forcePaused（已 Symbol 化），自有属性与原生一致（['length','name']）；
    //         ② name 伪装为 'pause' / 'set playbackRate'（name 本就是自有属性，重定义不新增键、不留指纹）；
    //         ③ 本脚本自检（probePauseNeutralized / tamper-guard / 审计面板）走引用或行为比对，不依赖字串。
    // 注意：不再伪装 toString——那需要全局改写 Function.prototype.toString，风险大于收益（详见原型体处注释）。
    POLITE_MODE: true,     // #1 礼貌模式：抗检测——pause/playbackRate setter 伪装为原生，规避平台「播放逻辑检测」
    // ── 安全停机（fail-safe）──────────────────────────────────────────────
    // 检测到验证码/风控验证时**立即停止全部自动化并提示**，而不是压在触发阈值之下继续运行。
    // 这是有意的安全取向：继续伪装运行会把风险从"被识别"升级为"账号被判定作弊"，
    // 停机后由真人完成验证对账号与课程进度都最安全。
    SAFETY_STOP_ON_CHALLENGE: true,   // 总开关：false = 关闭安全停机（不推荐）
    SAFETY_AUTO_RESUME: false,        // 预留：验证消失后自动恢复（默认 false，须人工确认后恢复）
    // 验证控件选择器命中即停机（仅列已知验证码厂商的显式容器，避免过宽选择器导致误停机）
    SAFETY_CHALLENGE_SELECTORS: [
      '.yidun', '.yidun_popup',        // 网易易盾
      '#captcha', '.geetest_panel',    // 通用 / 极验
      '.nc_wrapper', '.nc_scale',      // 阿里滑动验证
      'iframe[src*="captcha"]', 'iframe[src*="verify"]'
    ],
    // 关键词命中即停机（只在弹层/浮层候选容器内匹配，不扫整页）
    SAFETY_CHALLENGE_KEYWORDS: [
      '验证码', '滑动验证', '请完成安全验证', '人机验证', '安全验证', '身份验证',
      '请进行验证', '向右滑动', '拼图验证', '拖动滑块'
    ],
    // —— 接管总开关 / 课程黑名单（按需关闭续播与自动答题）——
    ENABLED: true,            // 全局接管总开关：false = 关闭全部自动化（续播/答题），仅留面板与诊断
    DISABLED_COURSES: [],      // 按 courseId 关闭接管的课程黑名单（面板可一键增删）；命中即跳过续播/答题
    // v4.19.29·答题缓存出清：满足特定条件即出清全部自动答题缓存(已作答去重/在途题解/失败登记/信号灯/DS宽限…)，使上一答题时段干净收尾、下一时段从零作答。
    // 学习通/智慧树等平台严格限制多开视频：同平台下「开始下一个视频」即视为答题时段结束 → 出清（避免把上一节作答状态/指纹带入下一节）。
    QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE: true,  // 同平台下一视频开始(前台视频稳定键变化) → 出清
    // v4.19.50：视频「播放事件」作为完全出清标志（用户需求：视频播放 = 上一题时段结束，双端等同刷新）。
    // 与 QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE（轮询比对稳定键）互补：本项是事件驱动、更即时——课程页任意视频
    // play 且稳定键变化(换节/换视频) → 写 GM 通知键 cx_quiz_evict_v1 → 课程页各帧 quizHardReset(等同刷新)
    // + DeepSeek 应答端 _dsEvictAll(应答器/队列/最近请求全清)。同视频暂停恢复/循环播放 key 不变不重复触发。
    QUIZ_EVICT_ON_VIDEO_PLAY: true,
    QUIZ_CACHE_EVICT_ON_URL_CHANGE: true,    // 课程/章节 URL 变化(去 hash 的 pathname+search) → 出清
    QUIZ_CACHE_EVICT_ON_IDLE_MIN: 0,         // 答题空闲 N 分钟(无新作答活动) → 出清；0=禁用
    // v4.19.30·统一数据治理：周期巡检(分钟)——低频出清「统计/中继」类累积数据(stats/relay)，
    // 与事件触发(换视频/换课/空闲，出清 session+relay)互补：周期巡检出清 stats 防长会话 localStorage 缓慢膨胀。0=禁用(仅事件/命令触发)。
    DATA_GOV_PERIOD_MIN: 0
  };
  // 默认配置快照：供「恢复默认」使用（深拷贝，避免被运行期修改污染）
  var DEFAULT_CONFIG = JSON.parse(JSON.stringify(CONFIG));
  // EventBus 在 state.js 定义；本模块已在 build-manifest.txt 中排于 state.js 之后，故此处 EventBus 已就绪。
  // 仍加防御性守卫：任何 manifest 顺序变动导致 EventBus 未就绪时仅跳过镜像（不崩溃），避免整段启动失败。
  if (typeof EventBus !== 'undefined' && EventBus && EventBus.state) EventBus.state.CONFIG = CONFIG;   // P1 状态集中：镜像 CONFIG（同对象引用，零行为回归）

  // 内部常量（非用户可调，集中管理便于维护 / 平台改版时统一调整）
  var CONST = {
    MAX_SCAN_DEPTH: 16,              // walkVideos 递归深度上限（防深 DOM 树主线程卡顿）
    ENDED_SRCS_CAP: 2000,            // 已结束 src 记录去重上限（防长时挂机无限增长）
    PQ_HANDLED_CAP: 2000,            // 弹窗指纹去重上限（防长会话无限增长，对应 A1）
    QUIZ_HANDLED_CAP: 4000,          // 答题指纹去重上限（对应 A2）
    QUIZ_REVIEW_CAP: 500,            // 人工复核队列上限（对应 A4）
    QUIZ_PENDING_CAP: 1000,          // 待确认提交队列上限（对应 A3）
    QUIZ_PENDING_TTL_MS: 1800000,    // 待确认提交残留 TTL（30min，超时淘汰，对应 A3）
    WATCH_STATS_CAP: 800,             // 本地已看时长统计上限（防 localStorage 无限增长撑爆配额）
    TARGET_FALLBACK_ROUNDS: 3,       // 定向连续 0 命中达此轮数 → 回退全续播（迟滞）
    MO_QUEUE_CAP: 1024,              // MutationObserver 合并队列上限
    MEM_SAMPLE_EVERY: 30,            // 内存采样间隔（轮）
    BRIDGE_PROBE_PORTS: [7531, 7532, 7533, 8543, 9090], // 桥接探测端口
    BRIDGE_TIMEOUT_MS: 5000,            // 桥请求超时（AbortController），避免半死桥永久挂起
    // 伪暂停判定阈值：平台常以 playbackRate<=0.01 表达"暂停"，需拉回 USER_RATE。
    // 集中管理，避免该魔法数字散落 config/dom/playback 多处，平台改判定口径时统一调整。
    PSEUDO_PAUSE_RATE: 0.01
  };
  // DOM 选择器（集中，便于平台改版时适配不同页面结构）
  var SELECTORS = {
    VIDEO_BOX: '#videoBox',
    TASK_CONTAINER: '.ans-attach-ct'
  };

  // 视频节点 flag 名（跨脚本契约属性，集中定义以防拼写漂移）。
  // v4.19.51：全部改为 Symbol（见下方 _sx 说明）。跨模块/跨脚本一律经 FLAGS.xxx 访问，
  //   **不得再使用 '__cx*' / '__np' 字符串字面量**——否则读写的是两个不同的键，会静默失效。
  //   forcePaused —— 原型级防暂停闸门（pause no-op）；
  //   anHold     —— auto-next 写入的暂停锁（跨脚本契约）；
  //   endedLock  —— ended-notify 读取的“已结束”锁（跨脚本契约）；
  //   userPaused —— 用户暂停态（keyboard-shortcuts 读写，跨脚本契约）；
  //   np         —— 原生 pause 备份（keyboard-shortcuts 读写，跨脚本契约）；
  //   listeners / nearEndGuard / nearEndEndedGuard —— 内部维护（监听器注册表、近尾 ended 句柄）。
  // 注意（v4.19.51 更新）：forcePaused 已由字符串键改为 Symbol，原型体统一经 FLAGS.forcePaused 访问，
  //   原「礼貌 / 字面量」两版因此语义等价并已合并，两者函数源码都不含 '__cxForcePaused' 字面量。
  //   原本依赖「pause.toString() 含该字面量」的 tamper-guard 基线判据，同步改为引用/行为探测
  //   （见 presentation/diagnostics.js 的 _cxAuditProtoPause / _cxAuditProtoRate，与 getPauseNeutralized 同口径）。
  // v4.19.51：视频节点标记全部改为 Symbol（原为 '__cx*' / '__np' 字符串键）。
  //   原实现把这些字符串键直接挂在 video 元素上，平台只需
  //     Object.getOwnPropertyNames(video).filter(k => k.indexOf('__cx') === 0 || k === '__np')
  //   即可稳定检出；且这与 POLITE_MODE 无关（后者只改函数源码，不改属性落点）。
  //   改 Symbol 后：getOwnPropertyNames / hasOwnProperty(字符串) 均不可见（仅 getOwnPropertySymbols 可见）。
  //   不传 description（Symbol() 而非 Symbol('cx')），避免 String(sym) 泄露语义。
  //   降级：环境无 Symbol 时回退字符串键，功能等价（仅失去隐藏效果）。
  var _sx = function (fallback) { return (typeof Symbol === 'function') ? Symbol() : fallback; };
  var FLAGS = {
    forcePaused: _sx('__cxForcePaused'),
    anHold:      _sx('__cxAN_hold'),
    endedLock:   _sx('__cxEndedLock'),
    userPaused:  _sx('__cxUserPaused'),
    np:          _sx('__np'),
    nearEndEndedGuard: _sx('__cxNearEndEndedGuard'),   // 近尾 ended 监听只安装一次
    listeners:   _sx('__cxListeners'),                  // 实例监听器注册表（卸载时统一摘除）
    nearEndGuard: _sx('__cxNearEndGuard')               // 近尾 ended 监听句柄（卸载时摘除）
  };
  // v4.19.51：原闭包别名 _CX_FP 已移除——forcePaused 改 Symbol 后两版原型体等价并已合并，
  //   统一直接引用 FLAGS.forcePaused，不再需要「用闭包别名隐藏字面量」这一中间层。
  // #1 行为/引用探测状态：原型中性化是否仍在位（替代字串扫描，礼貌模式下唯一可靠判据）。
  var _installedProtoPause = null;   // 当前装上的原型 pause 函数引用（用于比对是否被平台还原）
  var _installedProtoRateSet = null; // 当前装上的 playbackRate setter 引用
  var _pauseNeutralized = null;      // true=中性化在位；false=被还原；null=未接管原型(温和/未装)
  var _rateNeutralized = null;

  // 注入样式（集中管理，便于主题定制 / 平台改版适配；避免 CSS 散落于各模块）
  // 【内聚性收敛】STYLES（设计令牌 + 面板/移动/Ninja/动效/按钮样式 + window.__cxUI 导出）已迁至 presentation/styles.js。
  // 该块约 168 行纯 CSS 数据，原占 config.js 过半篇幅，与 CONFIG/CONST/FLAGS/原型 neutralize/业务动作混居。
  // 现 config.js 仅持有「元配置 + 引擎接管 + 业务施加」；STYLES 在 config.js 之后、ui 模块之前由 presentation/styles.js 定义，
  //   presentation/* 与 takeover/dom/dom.js(toast) 在运行时统一读取同一 STYLES 对象（同一 IIFE 闭包）。

  // DEBUG 开关：运行时按 DEBUG 判定是否输出日志；dbg/swallow 实现见 takeover/foundation/utils/utils.js（工具层）。
  var DEBUG = false;
  // ===== 面板控制数据持久化（刷新网页后保持面板设置）=====
  // 控制面板里改动的 AUTO_STOP_MIN / RESUME_AFTER_MIN / RESCAN_INTERVAL / END_RELEASE_SEC / DEBUG
  // 原本只存在运行时变量，刷新即丢。现统一存到 localStorage.cx_panel_cfg（JSON），脚本启动即载入，
  // 面板各控件变更时即时写回 → 设置跨刷新保持不变。（当前导航区块 cx_panel_tab、工具库项开关已在各自逻辑持久化。）
  // 持久化实现见 takeover/foundation/storage/storage.js（存储与 API 通讯层）；此处仅保留启动载入调用。
  loadPanelCfg();   // 启动即载入上次设置（务必在 _loopTimer 启动之前，使 RESCAN_INTERVAL 立即生效）
  loadWatchStats(); // 载入本地已看时长统计（进度同步·本地估算用）

