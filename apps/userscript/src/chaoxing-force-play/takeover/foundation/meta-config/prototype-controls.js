// @provides: NATIVE_PAUSE, applyUserRateAll, reconcileIntrusionMode
// @requires: CONFIG, CONST, CoreState, FLAGS, allVideos, bestEffort, cxState, dbg, detectSite, safeGet, scanVideos
// @source-group: takeover/foundation/meta-config/config.js
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

  // ==========================================================================
  // #1 抗检测·降低指纹（仅礼貌模式 POLITE_MODE 生效）
  // 审查结论（v4.19.51）：曾尝试把 pause / playbackRate setter 完全伪装成原生
  //   （toString 返回 '[native code]'，并包装 Function.prototype.toString 使 .call() 也返回原生串），
  //   复查后判定代价大于收益并已撤销：
  //   ① 改 Function.prototype.toString 是**全局**篡改，平台新建 iframe 取原生副本一比即穿；
  //   ② 给函数加自有 toString 反而多一个指纹——原生函数自有属性只有 ['length','name']，没有 toString；
  //   ③ 撤销全局守卫后，自有 toString 会被 Function.prototype.toString.call() 直接绕过，收益归零。
  // 故改为只做「零代价对齐」：
  //   - 原型体用**方法简写**（自有属性恰为 ['length','name']，与原生一致；函数声明会多出 prototype）；
  //   - 礼貌模式下把 name 伪装为 'pause' / 'set playbackRate'（name 本就是自有属性，重定义不新增键）。
  // 诚实边界：toString() 仍返回真实源码（不含 '__cxForcePaused'——该标记已 Symbol 化），
  //   因此能抗「字面量扫描」，但抗不住 `[native code]` 校验；后者只能靠
  //   INTRUSION_MODE='gentle'（完全不碰原型）根治。
  // 本脚本自检走引用比对（HTMLMediaElement.prototype.pause === _installedProtoPause），不依赖 toString。
  // ==========================================================================
  function spoofNameAs(fn, nameText, tag) {
    if (!fn) return fn;
    bestEffort(function () { Object.defineProperty(fn, 'name', { value: nameText, configurable: true }); }, tag + '.name');
    return fn;
  }
  function installPrototypePauseNeutralize() {
    if (!NATIVE_PAUSE) return;
    if (!CoreState.canRun()) return;
    // v4.19.51：forcePaused 已 Symbol 化，原「礼貌/字面量」两版原型体语义等价，合并为一个。
    //   关键：用**方法简写**而非函数声明——函数声明自带 .prototype 自有属性，而原生方法没有，
    //   平台一次 Object.getOwnPropertyNames(HTMLMediaElement.prototype.pause) 即可看出多出 prototype。
    //   方法简写的自有属性恰为 ['length','name']，与原生一致。
    var _pauseFns = {
      pause() {
        var _self = this;
        var _ret = false;
        bestEffort(function () { if (CoreState.canRun() && _self && _self[FLAGS.forcePaused]) _ret = true; }, 'cfg.protoPause');
        if (_ret) return;
        return NATIVE_PAUSE.apply(this, arguments);
      }
    };
    var protoPause = _pauseFns.pause;
    // 抗检测：仅把 name 伪装为 'pause'（name 本就是自有属性，重定义不新增自有属性键）
    if (CONFIG.POLITE_MODE) spoofNameAs(protoPause, 'pause', 'cfg.pauseSpoof');
    try { HTMLMediaElement.prototype.pause = protoPause; _protoPauseInstalled = true; _installedProtoPause = protoPause; _pauseNeutralized = true; }
    catch (e1) {
      bestEffort(function () { Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, writable: true, value: protoPause }); _protoPauseInstalled = true; _installedProtoPause = protoPause; _pauseNeutralized = true; }, 'cfg.pauseDefineProp');
    }
  }
  // #1 卸载还原：按原生描述符写回 prototype.pause（与 cleanupListeners ① 同口径），并清安装标记
  function restorePrototypePause() {
    if (!NATIVE_PAUSE_DESC) return;
    bestEffort(function () { Object.defineProperty(HTMLMediaElement.prototype, 'pause', NATIVE_PAUSE_DESC); _protoPauseInstalled = false; _installedProtoPause = null; _pauseNeutralized = false; }, 'cfg.restorePause');
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
    if (!CoreState.canRun()) return;
    // 同 pause：改用对象方法（避免函数声明的 .prototype 自有属性）
    var _rateFns = {
      setPlaybackRate(v) {
        var _self = this;
        var _newV = v;
        bestEffort(function () { if (CoreState.canRun() && _self && _self[FLAGS.forcePaused] && !_self[FLAGS.anHold] && !_self[FLAGS.userPaused] && v <= CONST.PSEUDO_PAUSE_RATE) _newV = (CONFIG.USER_RATE || 1); }, 'cfg.rateSet');
        return NATIVE_RATE_DESC.set.call(this, _newV);
      }
    };
    var rateSet = _rateFns.setPlaybackRate;
    // 抗检测：仅把 name 伪装为原生 setter 形态（'set playbackRate'）
    if (CONFIG.POLITE_MODE) spoofNameAs(rateSet, 'set playbackRate', 'cfg.rateSpoof');
    bestEffort(function () {
      Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', {
        configurable: true, enumerable: true,
        get: NATIVE_RATE_DESC.get,
        set: rateSet
      });
      _protoRateInstalled = true; _installedProtoRateSet = rateSet; _rateNeutralized = true;
    }, 'cfg.installRate');
  }
  // #1 卸载还原：按原生描述符写回 prototype.playbackRate，并清安装标记
  function restorePrototypeRate() {
    if (!NATIVE_RATE_DESC) return;
    bestEffort(function () { Object.defineProperty(HTMLMediaElement.prototype, 'playbackRate', NATIVE_RATE_DESC); _protoRateInstalled = false; _installedProtoRateSet = null; _rateNeutralized = false; }, 'cfg.restoreRate');
  }
  if (usePrototypeNeutralize()) installPlaybackRateNeutralize();

  // #1 温和/礼貌模式：是否启用原型中性化（prototype.pause / playbackRate）。
  //   'aggressive' → 始终包装（现状默认行为，最稳）；
  //   'gentle'     → 仅实例级(v.pause=pauseNoop，dom.js:_ovEnforce 已做)+事件，绝不碰原型（超星有覆盖窗口，已知）；
  //   'auto'（默认）→ 运行时按站点识别：超星(chaoxing，含 *.chaoxing.com 与正向识别为超星的 *.edu.cn 高校镜像)与智慧树(zhihuishu)均激进；其余('unknown'/edu/未来站点)降级温和。
  // 注：detectSite() 返回 'chaoxing' | 'zhihuishu' | 'edu' | 'unknown' 等（见 site-router.js），并不依赖任何 SITE 枚举；
  //   其中 'chaoxing' 含 *.chaoxing.com 与「主机/路径/运行时全局呈超星特征」的 *.edu.cn 高校镜像（P0 收窄：非超星 edu.cn 回落 'edu' 安全基线，不再误钩 window.attachments/ananas，见评审 #19 / #6842）；
  //   'zhihuishu' 为智慧树网；故 auto 模式在超星与智慧树均激进中性化；
  //   其函数体只读 window.location，故 config.js 加载期(早于 site-router.js 文本位置，但函数已提升)即可正确调用，
  //   无需保守兜底——仅在 detectSite 不可用/抛错时回落激进，保证核心续播不丢。
  function usePrototypeNeutralize() {
    var m = CONFIG.INTRUSION_MODE;
    if (m === 'aggressive') return true;
    if (m === 'gentle') return false;
    // 'auto'：超星依赖平台私有暂停指令(window.ananas.pause)、智慧树无可靠自定义暂停封装可依赖，二者必用原型级 pause 拦截；其余站点实例级+事件已足够，降级温和以减侵入
    return safeGet(function () { return (typeof detectSite === 'function' ? (detectSite() === 'chaoxing' || detectSite() === 'zhihuishu') : true); }, true);
  }
  // #1 收敛原型中性化的装/卸决策（运行期切换 INTRUSION_MODE 或 'auto' 站点解析后调用）：
  //   需温和 → 卸原型（还原原生），并全量重扫让 _ovEnforce 对每实例补 own-property 覆盖(pauseNoop)；
  //   需激进 → 未装则装。默认加载期已按 usePrototypeNeutralize() 装过一次。
  //   关键：运行期切换的「还原」与「全卸」(cleanupListeners ①②)走同一套 restorePrototype* 原语，单一事实源、避免两套还原逻辑漂移导致残留。
  function reconcileIntrusionMode() {
    if (!CoreState.canRun()) { restorePrototypeNeutralization(); return; }
    bestEffort(function () {
      var on = usePrototypeNeutralize();
      if (on) {
        if (!_protoPauseInstalled) installPrototypePauseNeutralize();
        if (!_protoRateInstalled) installPlaybackRateNeutralize();
        // 重装：原型已接管，但实例级 own-property(pauseNoop) 仍由 _ovEnforce 维护；全量重扫刷新之，使新插入/已存在的视频与新模式一致
        bestEffort(function () { if (typeof scanVideos === 'function') scanVideos(document); }, 'cfg.rescanOn');
      } else {
        restorePrototypeNeutralization();
        bestEffort(function () { if (typeof scanVideos === 'function') scanVideos(document); }, 'cfg.rescanOff');
      }
    }, 'cfg.reconcile');
  }
  // #1 还原原语统一封装：运行期切换(本函数)与全卸(cleanupListeners ①②)共用，避免两套还原逻辑漂移。
  function restorePrototypeNeutralization() {
    bestEffort(function () { if (_protoPauseInstalled) restorePrototypePause(); }, 'ctrl.restorePause');
    bestEffort(function () { if (_protoRateInstalled) restorePrototypeRate(); }, 'ctrl.restoreRate');
  }

  // #1 礼貌模式·行为/引用探测：原型 pause/playbackRate 中性化是否仍在位（替代字串扫描）。
  //   比较 prototype 上当前函数引用是否仍等于我们装上的中性化函数（_installedProtoPause / _installedProtoRateSet）；
  //   相等即平台未重写原型 → 中性化在位；不等即被还原（Object.freeze/重新赋值绕过）→ 返回 false，供审计/工具库项/报警判据。
  //   温和模式(未装原型)返回 null（不适用）；结果同时缓存到 _pauseNeutralized / _rateNeutralized 供审计面板直读。
  function probePauseNeutralized() {
    return safeGet(function () {
      if (!_protoPauseInstalled || !_installedProtoPause) { _pauseNeutralized = (_protoPauseInstalled ? true : null); return _pauseNeutralized; }
      _pauseNeutralized = (HTMLMediaElement.prototype.pause === _installedProtoPause);
      return _pauseNeutralized;
    }, _pauseNeutralized);
  }
  function probeRateNeutralized() {
    return safeGet(function () {
      if (!_protoRateInstalled || !_installedProtoRateSet) { _rateNeutralized = (_protoRateInstalled ? true : null); return _rateNeutralized; }
      var d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
      _rateNeutralized = !!(d && d.set === _installedProtoRateSet);
      return _rateNeutralized;
    }, false);
  }
  function getPauseNeutralized() { return safeGet(probePauseNeutralized, false); }
  function getRateNeutralized() { return safeGet(probeRateNeutralized, false); }

  bestEffort(function () {
    if (!window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY = {};
    var _ns = window.__CX_FORCE_PLAY;
    _ns.reconcileIntrusionMode = reconcileIntrusionMode;
    _ns.usePrototypeNeutralize = usePrototypeNeutralize;
    _ns.probePauseNeutralized = probePauseNeutralized;
    _ns.probeRateNeutralized = probeRateNeutralized;
    _ns.getPauseNeutralized = getPauseNeutralized;
    _ns.getRateNeutralized = getRateNeutralized;
    _ns.restorePrototypeNeutralization = restorePrototypeNeutralization;   // 暴露统一还原原语：运行期切换与全卸(cleanupListeners)共用
    // 暴露装/卸原语（评估清单#7：供卸载对称测试与审计工具驱动，单一事实源，避免两套还原漂移）
    _ns.installPrototypePauseNeutralize = installPrototypePauseNeutralize;
    _ns.restorePrototypePause = restorePrototypePause;
    _ns.installPlaybackRateNeutralize = installPlaybackRateNeutralize;
    _ns.restorePrototypeRate = restorePrototypeRate;
    _ns.CONFIG = CONFIG;                  // 暴露配置引用（工具库项 tamper-guard 读取 POLITE_MODE 以切换探测方式）
    _ns.FLAGS = FLAGS;                    // v4.19.51：暴露视频节点标记。forcePaused 已改为 Symbol（元素属性不再暴露），
                                          //   测试/工具须经 window.__CX_FORCE_PLAY.FLAGS.forcePaused 访问，不可再用字符串字面量 '__cxForcePaused'。
    _ns.applyLoopAll = applyLoopAll;      // 暴露循环开关即时施加（#切换循环播放开关即时生效：供面板循环解除已 ended 锁死视频、测试驱动）
    _ns.detectSite = detectSite;          // 暴露站点识别（#1 回归需断言 edu.cn 视为 chaoxing；presentation/审计亦可复用）
    _ns._pauseNeutralized = _pauseNeutralized;
    _ns._rateNeutralized = _rateNeutralized;
  }, 'ns.export');

  // 把当前用户倍速(CONFIG.USER_RATE)施加到页面内所有视频（含 iframe 内），用于面板上调节倍速后即时生效、并持续压制平台重置。
  // 不局限于"已强制接管"的视频：定向模式下未命中白名单被释放的主视频、以及普通观看视频同样生效，避免速率形同虚设。
  // 仍尊重 auto-next 暂停锁(__cxAN_hold，锁定时平台可能用 rate=0 实现暂停，不得回拉)、用户手动暂停(__cxUserPaused)、
  // 已结束锁定(__cxEndedLock，停在末尾不应改动)；跳过 rate<=0.01 的伪暂停（交由 ratechange/coverVideo 拉回）。零网络、零上报。
  function applyUserRateAll() {
    if (!CoreState.canRun()) return;
    bestEffort(function () {
      var rate = (CONFIG.USER_RATE || 1);
      function walk(root) {
        if (!root || !root.getElementsByTagName) return;
        var vs = root.getElementsByTagName('video');
        for (var i = 0; i < vs.length; i++) {
          bestEffort(function () {  // 跨域视频属性访问可能抛 SecurityError，静默跳过
            var v = vs[i];
            // §9.2-5：跳过已被释放(released)的视频——released 由桥/卸载路径设置，释放后不应再被倍速压制覆盖
            var _released = (typeof cxState === 'function') ? !!cxState(v).released : false;
            if (!v[FLAGS.anHold] && !v[FLAGS.userPaused] && !v[FLAGS.endedLock] && !_released
                && v.playbackRate > CONST.PSEUDO_PAUSE_RATE && v.playbackRate !== rate) v.playbackRate = rate;
          }, 'config.applyRate.v');
        }
        var fs = root.getElementsByTagName('iframe');
        for (var j = 0; j < fs.length; j++) { bestEffort(function () { if (fs[j].contentDocument) walk(fs[j].contentDocument); }, 'config.applyRate.if'); }
      }
      walk(document);
    }, 'config.applyRate');
  }
  // 立即把当前循环开关(CONFIG.LOOP_PLAY)施加到所有视频（含 iframe 内），用于面板上切换循环后即时生效（无需等下一轮重扫）。
  // 仅改 loop 属性：续播接管/防暂停/倍速压制等逻辑不变。零网络、零上报。
  function applyLoopAll() {
    if (!CoreState.canRun()) return;
    bestEffort(function () {
      var vs = allVideos();
      for (var i = 0; i < vs.length; i++) {
        bestEffort(function () {
          var v = vs[i];
          v.loop = CONFIG.LOOP_PLAY;
          // 【循环播放·开开关即时生效】scanVideos(incremental) 会跳过已稳定接管的视频，而 endedLock 视频
          // 同样被标记 forcePaused 属"已接管"，可能不被每轮重扫。故此处即时解除已锁死的 ended 视频，
          // 使勾选「循环播放」开关后无需等主循环重扫即可从头重播（与 dom.js _ovEndedLock 的每轮解除互为双保险）。
          if (CONFIG.LOOP_PLAY && v[FLAGS.endedLock]) {
            v[FLAGS.endedLock] = false;
            bestEffort(function () { delete v.play; }, 'config.loop.delPlay');
            bestEffort(function () { if (v[FLAGS.np]) v.pause = v[FLAGS.np]; }, 'config.loop.pauseRestore');
            // 已 ended 的视频：立即回到开头。主循环 scanVideos(incremental) 会跳过已稳定接管(含 endedLock)的视频，
            // 不靠主循环重扫也能让浏览器 loop 语义从头重播（currentTime 设 0 + 上方 v.loop=true）。
            bestEffort(function () { if (v.ended) { try { v.currentTime = 0; } catch (e) {} } }, 'config.loop.seek0');
            dbg('循环播放已开：即时解除 ended 锁并回到开头（开关生效）');
          }
        }, 'config.loop');
      }
    }, 'config.applyLoop');
  }
