  // ===== DOMAIN: bootstrap/main-loop (startup + main loop scheduler) =====
  // 即时接管：任何 video 一开始 play 即立刻 override，无需等 2s 轮询（吸收 chaoxing-media-collector 的 play 捕获思路）。
  // 缩短动态插入播放器的接管空窗，使手动暂停开关对"新插入、尚未轮询到"的视频也可靠生效；overrideVideo 自身幂等且
  // 在 __cxUserPaused 时交还原生 pause 提前返回，故对暂停态/已接管视频无副作用。
  // 即时接管 play 事件（修复复审：同源 iframe 内视频的 play 事件不冒泡到顶层 document，需在 iframe 文档内也装一份）
  // 【架构·生命周期】handler 必须是具名函数、且安装过的 document 需登记到 _playWatchDocs（takeover/dom/lifecycle.js 声明）：
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
    ++_loopTicks; _loopLastTick = Date.now();        // 诊断#七：累计轮次 + 刷新 tick 时间戳
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
    // 多平台站点专属调度（rev2）：按 detectSite() 分发，各平台函数内部对站点做了二层守卫，跨站零副作用。
    // 续播本身由通用 dom.js（scanVideos/原型中性化）对所有站点兜底，此处仅调度「弹窗消干扰 / 真答题」。
    try {
      var _site = detectSite();
      if (_site === 'zhihuishu') {
        var _zhsAns = zhihuishuTickQuestions();
        try { zhihuishuFabTick(_zhsAns); } catch (e2) { swallow(e2); }
        // 作业/考试答题主体页：题目区面板（FAB 场景自适应）驱动作答/自动交卷；状态机硬闸门含 DeepSeek 连接
        try {
          if (typeof window.__CX_FORCE_PLAY !== 'undefined' && typeof window.__CX_FORCE_PLAY.zhihuishuExamEnabled === 'function' && window.__CX_FORCE_PLAY.zhihuishuExamEnabled() && typeof window.__CX_FORCE_PLAY.zhihuishuExamTick === 'function') window.__CX_FORCE_PLAY.zhihuishuExamTick();
        } catch (e3) { swallow(e3); }
        try {
          if (typeof window.__CX_FORCE_PLAY !== 'undefined' && typeof window.__CX_FORCE_PLAY.zhihuishuExamAutoSubmitTick === 'function') window.__CX_FORCE_PLAY.zhihuishuExamAutoSubmitTick();
        } catch (e4) { swallow(e4); }
      } else if (_site === 'icourse163') {
        try { icourse163TickQuestions(); } catch (e) { swallow(e); }
      } else if (_site === 'xuetangx') {
        try { xuetangxTickQuestions(); } catch (e) { swallow(e); }
      } else if (_site === 'icve') {
        try { icveTickQuestions(); } catch (e) { swallow(e); }
      } else if (_site === 'renwei') {
        try { renweiTickQuiz(); } catch (e) { swallow(e); }
      } else if (_site === 'unipus') {
        try { unipusTickQuiz(); } catch (e) { swallow(e); }
      } else if (_site === 'ucampus') {
        try { ucampusTickQuiz(); } catch (e) { swallow(e); }
      } else if (_site === 'ilabx') {
        try { ilabxTickQuiz(); } catch (e) { swallow(e); }
      } else if (_site === 'chaoxing') {
        // 超星作业/考试题目页：调度通用 quiz 真答题引擎（无题目容器自动 no-op，不影响视频续播）
        try { chaoxingTickQuiz(); } catch (e) { swallow(e); }
      }
      // unknown 走通用续播，无站点专属弹窗/答题逻辑（xueyinonline 已并入 chaoxing 经上分支调度）
    } catch (e) { swallow(e); }
    if (_cxPanel && _cxPanel.style.display !== 'none') { try { Store.emit('videos:scanned'); } catch (e) { swallow(e); } }  // P3：面板可见时发扫描结束信号（事件总线），订阅方刷新（等价旧行为）
  }
  var _loopTimer = null;
  var _loopTicks = 0, _loopLastTick = 0;   // 诊断#七：主循环健康遥测（已运行轮次 + 上次 tick 时间），供诊断一处查看续播调度是否仍在跑
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
