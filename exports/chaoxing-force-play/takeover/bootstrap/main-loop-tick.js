// @requires: CONFIG, CONST, CoreState, DEBUG, EventBus, SAFETY, TARGET, _cxPanel, _loopTicks, _targetMissStreak, applyUserRateAll, bestEffort, dbg, detectSite, foregroundVideo, refreshTargets, scanVideos, videoDriftStableKeys
// @source-group: takeover/bootstrap/main-loop.js
  // 低频全量重扫：应对平台重定义 pause / 原型硬调用 / DOM 换血（间隔由 CONFIG.RESCAN_INTERVAL 控制，面板可实时调整）
  function _loopTick() {                            // 提取为命名函数：使面板改 RESCAN_INTERVAL 时能 clearInterval 后重启立即生效
    var _now = Date.now();
    if (_loopLastTick > 0) { var _td = _now - _loopLastTick; _loopTickDeltas.push(_td); if (_loopTickDeltas.length > 30) _loopTickDeltas.shift(); }
    ++_loopTicks; _loopLastTick = _now;        // 诊断#七：累计轮次 + 刷新 tick 时间戳
    // 改进 A（docs/script-direction-review.md 三·A）：deepseek 站点仅作「应答端控制台」，无视频/续播对象。
    // 短路续播轮询以省无谓开销；应答端由 ds-ask 事件驱动，不依赖本 tick，故短路不影响作答。诊断计数仍递增，便于确认主循环活跃。
    var _tickSite = detectSite();
    if (_tickSite === 'deepseek') { return; }
    // 安全停机（fail-safe）：先于本轮任何自动化动作检测验证码/风控验证，
    // 命中即停机并提示；停机后后续 tick 不再执行（定时器已停，此处为双保险）。
    bestEffort(function () { if (typeof safetyScan === 'function') safetyScan(); }, 'loop.tick.safety');
    if (SAFETY && SAFETY.tripped) return;
    // —— 接管开关：全局关闭或当前课程在黑名单 → 不续播、不自动答题（仅留诊断/面板，循环保持存活）——
    if (!takeoverActive()) { _onTakeoverInactive(); return; }
    _onTakeoverActive();
    // 页面/配置身份与会话冷却去重；同时发现无事件的 pushState 切章。
    bestEffort(function () { syncBridgeFrames(window); }, 'loop.tick.bridgeIdentity');
    var _tickToken = CoreState.capture('main-loop');
    // edu 站也接管：SITES.edu 为安全基线(空 attachmentsKey/ananasKey、不钩 window.attachments/ananas 私有全局)，
    // 仅全量扫描 + 原型级 pause 中性化、无私有全局副作用；原「完全惰性 return」违反 #1 回归(edu.cn 视为 chaoxing 须接管视频)
    // → 移除 return 让 edu 每轮也重扫接管（与 dom.js 注释及 #1 回归一致；#19 收窄由 SITES.edu 空键满足，不靠惰性跳过）。
    // P0-1 脏检查短路：仅在「DOM 结构变化(_domDirty) 或 视频活动(_videoActivity)」时才全量接管扫描
    // (walkVideos 全树遍历 + 对所有 video 调 overrideVideo)。挂机/静止页跳过，CPU 与掉帧显著下降。
    // 状态机优化(卡顿排查·主循环调度)：结构变更(_domDirty，新视频必经) → 每轮全量；
    // 播放活动(_videoActivity，timeupdate 高频置位) → 扫描降频为每 2 轮一次（播放稳态 2s→4s 全量，
    // 新视频/重建元素仍由 MutationObserver→_domDirty 即时发现，零语义损失；老版本无脏检查时为每 2s 固定全量）。
    // 抗平台还原的全局暂停中和(neutralizeGlobalPause)与计时类 tick(autoStop/resume/rate) 仍每轮运行(零行为回归硬约束)。
    var _domChanged = consumeDomDirty();
    var _vidActive = consumeVideoActivity();
    if (_domChanged || (_vidActive && (++_vidScanTick % 2 === 0))) {
      bestEffort(function () { refreshTargets(); }, 'loop.tick.refreshTargets');
      // 性能修复(交互延迟)：全量扫描推迟到事件循环队尾（setTimeout 0）——主循环同步段只做轻活，
      // 排队中的按键/点击事件先于扫描执行（单线程下 setTimeout 排到队尾）；扫描延迟 ~0-50ms 无感知，
      // 新视频/重建元素仍由 MutationObserver→_domDirty 即时发现，语义零损失。
      // v4.19.20：经 TimerRegistry 登记（owner 'main-loop'），卸载 clearAll 可取消在途延迟扫描。
      var _scanTo = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry && typeof window.__CX_FORCE_PLAY.TimerRegistry.setTimeout === 'function')
        ? window.__CX_FORCE_PLAY.TimerRegistry.setTimeout(function () { if (CoreState.valid(_tickToken)) bestEffort(function () { scanVideos(document, null, 0, true); }, 'loop.tick.scan'); }, 0, 'main-loop')
        : setTimeout(function () { if (CoreState.valid(_tickToken)) bestEffort(function () { scanVideos(document, null, 0, true); }, 'loop.tick.scan'); }, 0);
    }
    bestEffort(function () { neutralizeGlobalPause(window); }, 'loop.tick.neut');
    bestEffort(function () {
      if (typeof probePauseNeutralized === 'function' && typeof probeRateNeutralized === 'function') {
        var _pn = probePauseNeutralized(), _rn = probeRateNeutralized();
        if (_pn === false || _rn === false) {
          if (!_tamperAlarmed) {
            _tamperAlarmed = true;
            dbg('原型 pause/playbackRate 中性化被平台还原，触发重装');
            bestEffort(function () { if (typeof window !== 'undefined' && window.EventBus && window.EventBus.emit) window.EventBus.emit('ui:toast', '⚠ 检测到原型被平台还原，已自动重装续播守卫'); }, 'loop.toast.tamper');
          }
        } else { _tamperAlarmed = false; }
      }
    }, 'loop.tick.probe');
    bestEffort(function () {
      if (usePrototypeNeutralize()) {
        // 幂等性修复(审查 G-2)：仅当探测到原型中性化被平台还原(probe===false)才重装——旧实现每轮无条件重装，
        // 每 2s 用新闭包覆盖 prototype.pause（顶掉第三方 patch + GC 抖动）。probe 在位(true)时跳过，语义零回归
        // （被还原后的抢回语义保留；温和模式 usePrototypeNeutralize()=false 不进此分支）。
        var _pn = (typeof probePauseNeutralized === 'function') ? probePauseNeutralized() : null;
        if (_pn === false) installPrototypePauseNeutralize();
      }
    }, 'loop.tick.protoNeut');
    bestEffort(function () {
      if (TARGET.enabled && !TARGET.matchedAny) {
        if (++_targetMissStreak >= CONST.TARGET_FALLBACK_ROUNDS) { dbg('定向连续 ' + _targetMissStreak + ' 轮 0 命中，回退全续播'); TARGET.enabled = false; _dbgTargetState = 'fallback'; }
      } else { _targetMissStreak = 0; }
    }, 'loop.tick.targetFallback');
    if (DEBUG && (++_memPoll % CONST.MEM_SAMPLE_EVERY) === 0) { bestEffort(function () { _memSample('loop'); }, 'loop.tick.memSample'); }
    bestEffort(function () { autoStopTick(); }, 'loop.tick.autoStop');
    if (CONFIG.RESUME_AFTER_MIN > 0) { bestEffort(function () { resumeTick(); }, 'loop.tick.resume'); }
    bestEffort(function () { applyUserRateAll(); }, 'loop.tick.applyRate');
    bestEffort(function () { tickDriftGuards(); }, 'loop.tick.driftGuards');   // 进度漂移守卫：每轮对所有视频检测平台回拨/重建元素并回补（详见 dom.js）
    // 性能修复(交互延迟)：站点 tick（答题扫描/弹窗扫描等重活）推迟到事件循环队尾——
    // 主循环同步段不再因全文档扫描阻塞排队中的按键/点击；答题即时性由 quizObserve 的 MO 短防抖保证，
    // 站点 tick 仅作兜底（推迟 ~0-50ms 无感知）。v4.19.20：经 TimerRegistry 登记，卸载 clearAll 可取消。
    if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry && typeof window.__CX_FORCE_PLAY.TimerRegistry.setTimeout === 'function') {
      window.__CX_FORCE_PLAY.TimerRegistry.setTimeout(function () {
        bestEffort(function () {
          var _site = detectSite();
          if (CoreState.valid(_tickToken)) runSiteTick(_site);
        }, 'loop.tick.siteTick');
      }, 0, 'main-loop');
    } else {
      setTimeout(function () {
        bestEffort(function () {
          var _site = detectSite();
          if (CoreState.valid(_tickToken)) runSiteTick(_site);
        }, 'loop.tick.siteTick');
      }, 0);
    }
    if (_cxPanel && _cxPanel.style.display !== 'none') { bestEffort(function () { EventBus.emit('videos:scanned'); }, 'loop.tick.emitScan'); }
    // v4.19.29·出清系统：满足特定条件 → 出清全部自动答题缓存（答题时段边界）。
    // 同平台下「开始下一个视频」即视为上一答题时段结束（学习通/智慧树等严格限制多开视频，换视频=换节）：
    //   用前台视频稳定键(videoDriftStableKeys，跨 blob 重建存活)判定「不同视频」，避免同一视频 blob 重生成误触发。
    // 课程/章节 URL 变化(pathname+search，去 hash) 同样视为换节；空闲超时(默认禁用)作长空闲兜底。
    bestEffort(function () {
      var _fp = window.__CX_FORCE_PLAY;
      var dg = (_fp && _fp.dataGovernance && typeof _fp.dataGovernance.evict === 'function') ? _fp.dataGovernance : null;
      var _ev = (_fp && typeof _fp.quizCacheEvict === 'function') ? _fp.quizCacheEvict : null;  // 回退兼容
      var _evicted = false;
      // 事件触发：换视频 / 换课 → 出清 session+relay（答题时段边界，下一节从零作答）
      if (CONFIG.QUIZ_CACHE_EVICT_ON_VIDEO_CHANGE) {
        var _fg = foregroundVideo();
        if (_fg && typeof videoDriftStableKeys === 'function') {
          var _k = (videoDriftStableKeys(_fg) || []).join('|');
          if (_k) {
            if (_evictLastVideoKey && _evictLastVideoKey !== _k) { if (dg) dg.evict(['session', 'relay'], 'video-changed'); else if (_ev) _ev('video-changed'); _evicted = true; }
            _evictLastVideoKey = _k;
          }
        }
      }
      if (CONFIG.QUIZ_CACHE_EVICT_ON_URL_CHANGE) {
        var _u = location.pathname + location.search;
        if (_evictLastUrl && _evictLastUrl !== _u) { if (dg) dg.evict(['session', 'relay'], 'url-changed'); else if (_ev) _ev('url-changed'); _evicted = true; }
        _evictLastUrl = _u;
      }
      if (CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN > 0) {
        var _la = (_fp.quizStats && _fp.quizStats.lastAnswerTs) || 0;
        if (_la && (Date.now() - _la) > CONFIG.QUIZ_CACHE_EVICT_ON_IDLE_MIN * 60000) { if (dg) dg.evict(['session', 'relay'], 'idle-timeout'); else if (_ev) _ev('idle-timeout'); _evicted = true; }
      }
      // v4.19.30·周期巡检：低频出清 stats+relay（防长会话 localStorage 缓慢膨胀），默认禁用；启用时与事件触发互斥避免同轮双清
      if (CONFIG.DATA_GOV_PERIOD_MIN > 0) {
        var _now = Date.now();
        if (!_evicted && (_now - _evictPeriodTs) > CONFIG.DATA_GOV_PERIOD_MIN * 60000) { _evictPeriodTs = _now; if (dg) dg.evict(['stats', 'relay'], 'period'); }
        else if (_evicted) { _evictPeriodTs = _now; }   // 事件已清，刷新周期基准
      } else {
        _evictPeriodTs = Date.now();   // 禁用时持续刷新基准，避免启用瞬间立即触发
      }
    }, 'loop.evict');
  }
