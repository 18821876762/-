// @requires: CoreState, EventBus, FLAGS, _cxPanel, _loopTimer, allVideos, bestEffort
  // ===== DOMAIN: dom lifecycle =====
  // ===== MODULE: 卸载还原与生命周期(cleanupListeners) =====
  // 域：DOM监听与注入层 —— 页面卸载时的侵入性还原（uninstall 语义的唯一实现处）。
  //
  // 【内聚性收敛】本块原寄居于 takeover/dom/dom.js 尾部，与 overrideVideo/walkVideos（施加接管）混居。
  // 但二者职责恰好相反：接管引擎负责「加 Hook」，本模块负责「拆 Hook」，且本模块的还原清单横跨
  // config.js / targeting.js / panel.js / main-loop.js / core.js 五个模块的侵入点——它本质是
  // 「全脚本生命周期终结者」，而非 DOM 接管的一部分。独立成模块后，新增侵入点时应改的位置一目了然。
  //
  // 【跨模块引用说明】下列符号定义在其他模块，均为顶层 var/function，同处一个 IIFE 闭包，
  //   函数声明 hoist + 运行时才执行，故不受模块拼接顺序影响：
  //     NATIVE_PAUSE / NATIVE_RATE_DESC   ← takeover/foundation/meta-config/config.js
  //     _attachHooked / siteAttachmentsKey ← takeover/engine/targeting.js（钩子标志）/ takeover/foundation/site/site-router.js
  //     keydownHandler                     ← presentation/panel.js
  //     playWatchHandler / _loopTimer      ← takeover/bootstrap/main-loop.js
  //     globalErrorHandler                 ← takeover/bootstrap/core.js
  //     _mo / visibilityHandler            ← takeover/dom/dom.js（MO 实例与可见性处理器）
  //
  // 【还原清单归属】_ananasNeutralized 由 dom.js 的 neutralizeGlobalPause 写入；
  //   _playWatchDocs 由 main-loop.js 的 installPlayWatch 写入。二者的「读取/清空」都只发生在本模块，
  //   故声明随读取方集中于此（写入方在运行时才执行，此时变量早已初始化完毕）。

  // 还原清单：记录被中和的 window.ananas 全局暂停封装实例（跨 iframe 各 frame 独立），供 cleanupListeners 还原。
  // 写入方是 dom.js 的 neutralizeGlobalPause；必须在其首次执行前完成初始化——本模块在构建顺序上位于
  // dom.js 之后，但 var 声明在 IIFE 顶层求值阶段即完成，早于任何函数调用，故安全。
  var _ananasNeutralized = [];
  // 停用、停机与卸载共用还原入口；平台已替换的暂停函数保留其新值。
  function restoreGlobalPause() {
    for (var i = 0; i < _ananasNeutralized.length; i++) {
      var a = _ananasNeutralized[i];
      if (a && a.__cxAnanasNativePause) {
        bestEffort(function () { if (a.pause === _ananasPauseNoop) a.pause = a.__cxAnanasNativePause; }, 'cleanup.ananas.pause');
        // 被平台锁成只读时保留原函数，no-op 的停止分支仍可转交调用。
        if (a.pause !== _ananasPauseNoop) bestEffort(function () { delete a.__cxAnanasNativePause; }, 'cleanup.ananas.meta');
      }
    }
    _ananasNeutralized.length = 0;
  }

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
  // 还原清单（十二项，新增侵入点必须同步登记，否则 uninstall 语义即失真）：
  //   ① HTMLMediaElement.prototype.pause      ② prototype.playbackRate 描述符
  //   ③ window.attachments setter             ④ navigator.mediaSession 暂停处理（含原始 handler 还原）
  //   ⑤ window.ananas.pause 中和（含残留元数据清除）  ⑥ play 即时接管监听（顶层 + iframe 文档）
  //   ⑦ window error 诊断监听                 ⑧ pagehide/beforeunload 钩子自身
  //   ⑨ 撤销 window 全局导出符号（__cxRegisterAddon/Command/__cxpresentation/__cxAddonQueue）
  //   ⑩ 移除注入的 DOM/样式（面板 + 三个 style + Toast）
  //   ⑪ 删除本脚本命名空间 window.__CX_FORCE_PLAY（终结完全回到注入前全局态）
  //   ⑫ 清理 DeepSeek 跨标签定时器（课程页巡检 + 应答端广播 setInterval）
  // 注：本脚本 @grant GM_setValue / GM_addValueChangeListener（GM_* 沙箱隔离模式），脚本全局落在沙箱代理层、与页面真实全局隔离；
  // 沙箱模式无法直接感知 Tampermonkey 的"热禁用"事件，最干净的还原仍需刷新页面；此处还原在
  // pagehide/beforeunload 触发，另暴露 window.__CX_FORCE_PLAY.uninstall 供手动/工具库项触发干净还原。
  function cleanupListeners() {
    if (_cleaned) return;   // 幂等：pagehide + beforeunload 双触发时只还原一次
    _cleaned = true;
    CoreState.dispose();
    bestEffort(function () { if (_mo && _mo.disconnect) _mo.disconnect(); }, 'cleanup.mo');
    // S10 修复：断开题目 MO（真答题引擎），与 _mo 一致，避免页面卸载后孤立回调滞留
    bestEffort(function () { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizDisconnect === 'function') window.__CX_FORCE_PLAY.quizDisconnect(); }, 'cleanup.quiz');
    // ⑫ 清理 DeepSeek 跨标签定时器（课程页巡检 + 应答端广播），避免卸载后孤立 setInterval 泄漏
    // P1：DS 定时器经 quizVisionDeepSeekStop 显式停止(审查 §2.1)；主循环/DS/篡改检测/DS控制台 等所有登记定时器统一由 TimerRegistry.clearAll() 兜底清理
    bestEffort(function () { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.quizVisionDeepSeekStop === 'function') window.__CX_FORCE_PLAY.quizVisionDeepSeekStop(); }, 'cleanup.dsTimers');
    bestEffort(function () { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry) { var _tr = window.__CX_FORCE_PLAY.TimerRegistry; if (_loopTimer) _tr.clearInterval(_loopTimer); _tr.clearAll(); } }, 'cleanup.timers');
    bestEffort(function () { document.removeEventListener('keydown', keydownHandler); }, 'cleanup.key');
    bestEffort(function () { document.removeEventListener('visibilitychange', visibilityHandler, true); }, 'cleanup.vis');
    // 幂等性修复(审查 G-7)：移除主循环降频监听（main-loop.js 的 visThrottleHandler）——旧实现为匿名函数无法移除，
    // 手动 uninstall 后每次切前后台都会经 restartLoopTimer 重新 setInterval 主循环（clearAll 之后复活孤儿定时器）。
    bestEffort(function () { document.removeEventListener('visibilitychange', visThrottleHandler, true); }, 'cleanup.visThrottle');
    // 幂等性修复(审查 G-4)：移除 EventBus 顶层帧 message 透传监听（state.js 注册的具名 handler）——旧实现匿名注册、
    // 未列入清理清单，uninstall 后仍残留全局监听器。
    bestEffort(function () { if (typeof _topFeedMessageHandler === 'function') window.removeEventListener('message', _topFeedMessageHandler); }, 'cleanup.topFeed');
    // 跨帧信号灯接收端（quiz.js 注册的具名 handler）：uninstall 后移除，杜绝残留监听器。
    bestEffort(function () { if (typeof _topQuizLightsHandler === 'function') window.removeEventListener('message', _topQuizLightsHandler); }, 'cleanup.topQuizLights');
    // v4.19.22：跨帧手动提交命令接收端（quiz.js 注册）一并移除
    bestEffort(function () { if (typeof _quizCmdHandler === 'function') window.removeEventListener('message', _quizCmdHandler); }, 'cleanup.quizCmd');
    // 逆向接口 reverse-api.js：移除 postMessage 监听 + 关闭 BroadcastChannel（资源残留治理）
    bestEffort(function () { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.reverseApiStop === 'function') window.__CX_FORCE_PLAY.reverseApiStop(); }, 'cleanup.reverseApi');
    // ① 还原 HTMLMediaElement.prototype.pause —— 复用 config.js 的 restorePrototypePause 原语（与运行期切换 INTRUSION_MODE 同一套还原逻辑，单一事实源，避免两套还原漂移导致残留）。
    //    该原语内部仅当本脚本已装(_protoPauseInstalled)才还原为 NATIVE_PAUSE_DESC，未装则跳过（不误改其他脚本的覆盖），语义等价原内联守卫。
    bestEffort(function () { if (typeof restorePrototypePause === 'function') restorePrototypePause(); }, 'cleanup.pause');
    // ② 还原 HTMLMediaElement.prototype.playbackRate setter —— 同样复用 config.js 的 restorePrototypeRate 原语
    bestEffort(function () { if (typeof restorePrototypeRate === 'function') restorePrototypeRate(); }, 'cleanup.rate');
    // ③ 还原 window.attachments（审查中优先级#5）
    bestEffort(function () {
      if (_attachHooked && typeof siteAttachmentsKey === 'function') {
        var _ak = siteAttachmentsKey();
        // 幂等性修复(审查 G-6)：仅当当前属性仍是本脚本安装的 getter 时才还原——若会话期间平台/其他脚本已
        // 重定义该属性，旧实现直接 delete + 注入前旧快照 defineProperty 写回，会覆盖平台的新值（还原不幂等）。
        // 非本脚本属性则原样交还（不清除 _attachHooked 之外的状态，平台属性不被触碰）。
        var _cur = null;
        try { _cur = Object.getOwnPropertyDescriptor(window, _ak); } catch (e) {}
        if (_cur && _attachGetter && _cur.get === _attachGetter) {
          // 沙箱独立性修复：只 delete、不重建——hookAttachments 的安装前提就是「注入前无自有属性」
          // （`if (Object.getOwnPropertyDescriptor(window, key)) return;`），故还原目标 = 属性不存在；
          // 旧实现的「delete + defineProperty(注入前快照)」在注入前无属性时会重建一个 value=undefined
          // 的 data property，卸载后 window 上残留空属性（沙箱泄漏面）。
          bestEffort(function () { delete window[_ak]; }, 'cleanup.att.del');
        }
        _attachHooked = false;
      }
    }, 'cleanup.att');
    // ④ 还原 navigator.mediaSession 暂停处理
    bestEffort(function () {
      if (navigator.mediaSession && typeof navigator.mediaSession.setActionHandler === 'function') {
        bestEffort(function () { navigator.mediaSession.setActionHandler('pause', _origMediaSessionPause != null ? _origMediaSessionPause : null); }, 'cleanup.med.session');
        if (_origMediaSessionState != null) { bestEffort(function () { navigator.mediaSession.playbackState = _origMediaSessionState; }, 'cleanup.med.state'); }
      }
      bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._mediaSessionHooked = false; }, 'cleanup.med.flag');
    }, 'cleanup.med');
    // ⑤ 还原 window.ananas.pause 中和 + 清理残留元数据
    bestEffort(restoreGlobalPause, 'cleanup.ananas');
    // ⑤-b（R3 修复）：还原实例级 own 属性覆盖（play/pause/Fpool 标记），使已接管视频回到"注入前实例态"，避免卸载后视频仍被 no-op 锁死
    bestEffort(function () {
      var _ivs = allVideos(true);
      for (var _ii = 0; _ii < _ivs.length; _ii++) {
        (function (_iv) {
          // v4.19.20：先拆除已挂监听（续播监听/nearEnd ended 守卫/seeking 守卫）——否则卸载后监听仍会
          // safePlay 拉起用户暂停的视频、ended 守卫重新封锁 play、seek 被钉回结尾（注入前实例态契约失真）。
          bestEffort(function () { if (typeof _disarmVideoListeners === 'function') _disarmVideoListeners(_iv); }, 'cleanup.instVideo.disarm');
          bestEffort(function () {
            delete _iv.pause; delete _iv.play;
            for (var _fk in FLAGS) { if (Object.prototype.hasOwnProperty.call(FLAGS, _fk)) { try { delete _iv[FLAGS[_fk]]; } catch (e) {} } }
          }, 'cleanup.instVideo');
        })(_ivs[_ii]);
      }
    }, 'cleanup.instVideos');
    // v4.19.20：取消在途 MO flush 调度（隐藏页 setTimeout / rAF），卸载后不再执行 _moFlush 重写接管属性
    bestEffort(function () {
      if (_moFlushTimer) { try { clearTimeout(_moFlushTimer); } catch (e) {} _moFlushTimer = null; }
      if (_moFlushRaf) { try { cancelAnimationFrame(_moFlushRaf); } catch (e) {} _moFlushRaf = null; }
    }, 'cleanup.moFlush');
    // ⑥ 摘除 play 即时接管监听
    bestEffort(function () {
      for (var _pi = 0; _pi < _playWatchDocs.length; _pi++) {
        (function (_d) {
          bestEffort(function () { if (_d && _d.removeEventListener) _d.removeEventListener('play', playWatchHandler, true); }, 'cleanup.play');
        })(_playWatchDocs[_pi]);
      }
      _playWatchDocs.length = 0;
    }, 'cleanup.playdocs');
    // ⑦ 摘除全局错误监听（core.js 注册的诊断钩子）
    bestEffort(function () { window.removeEventListener('error', globalErrorHandler); }, 'cleanup.err');
    // ⑧ 摘除卸载钩子自身
    bestEffort(function () { window.removeEventListener('pagehide', cleanupListeners); }, 'cleanup.hide');
    bestEffort(function () { window.removeEventListener('beforeunload', cleanupListeners); }, 'cleanup.before');
    bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._uninstallHooked = false; }, 'cleanup.flag');
    // ⑨ 撤销命名空间导出
    bestEffort(function () { delete window.__cxRegisterAddon; }, 'cleanup.ns.addon');
    bestEffort(function () { delete window.__cxRegisterCommand; }, 'cleanup.ns.cmd');
    bestEffort(function () { delete window.__cxUI; }, 'cleanup.ns.ui');
    bestEffort(function () { delete window.__cxAddonQueue; }, 'cleanup.ns.queue');
    // ⑨-c NEW-5 修复：调用工具库项的卸载清理（反注册定时器/具名监听器），避免脚本卸载后残留全局监听
    // 注意：须先遍历执行回调、再 delete 属性——旧实现先 delete 再读取会导致 _acs 为 undefined、回调永不执行（清理失效）。
    bestEffort(function () {
      var _acs = window.__cxAddonCleanups;
      if (_acs && _acs.length) {
        for (var _aci = 0; _aci < _acs.length; _aci++) { bestEffort(_acs[_aci], 'cleanup.addon'); }
        _acs.length = 0;
      }
    }, 'cleanup.addons');
    // 沙箱独立性修复：__cxAddonCleanups 在 ⑨-c 调用并清空数组后，属性本身仍残留（全局泄漏面），最后删除
    bestEffort(function () { delete window.__cxAddonCleanups; }, 'cleanup.ns.addonCleanups');
    // ⑨-b 撤销启动守卫标志
    bestEffort(function () {
      ['__cxAutoNextStarted', '__cxZhAutoNextStarted', '__cxEndedNotifyStarted', '__cxTgStarted', '__cxQuietPopupsStarted', '__cxKbStarted', '__CX_ZHE_STARTED'].forEach(function (k) {
        bestEffort(function () { delete window[k]; }, 'cleanup.flag.' + k);
      });
    }, 'cleanup.flags');
    // ⑩ 移除注入的 DOM/样式
    // R10 修复（真·多帧沙箱 sim-multiframe 发现）：面板挂在**顶层文档**且被各帧共享。
    // 旧实现里任意一帧卸载都会把顶层文档的 #__cxPanel 删掉——超星切换章节时播放器 iframe 被换掉，
    // 子帧 pagehide 就把存活的顶层帧正在用的面板一起删了，且存活帧的 _cxPanel 仍指向已脱离的节点
    // → 面板消失且再按 P 也回不来（幽灵面板）。
    // 规则：**只有顶层帧自己卸载时才清顶层文档的共享 DOM**（此时整页本就要销毁，清理是收尾语义）；
    //       子帧卸载只清理自己文档里的注入物，共享面板交还给存活帧（owner 已在 ⑦-b 释放）。
    bestEffort(function () {
      var _isTop = !(window.top && window.top !== window);
      var _pd = (window.top && window.top.document) ? window.top.document : document;
      // 幂等性修复(审查·幂等)：清理清单补漏 5 个注入节点——旧清单只含面板/3 个 style/toast，
      // 漏掉 DeepSeek 状态徽标(cx-ds-status)、智慧树 FAB 三件套(__cxZhsStyle/__cxZhsFab/__cxZhsPop)与
      // 瞬态右键菜单(__cxNinjaMenu)。漏项导致手动 uninstall 后这些节点仍留在页面（且 FAB 点击闭包仍可用）。
      var _cxDomIds = ['__cxPanel', '__cxPanelNinjaStyle', '__cxPanelAnimStyle', '__cxPanelMobileStyle', '__cxToast',
                       'cx-ds-status', '__cxZhsStyle', '__cxZhsFab', '__cxZhsPop', '__cxNinjaMenu'];
      for (var _di = 0; _di < _cxDomIds.length; _di++) {
        (function (_di) {
          if (_isTop || _pd === document) {
            bestEffort(function () { var _n = _pd.getElementById(_cxDomIds[_di]); if (_n && _n.parentNode) _n.parentNode.removeChild(_n); }, 'cleanup.dom.top');
          }
          bestEffort(function () { var _n2 = document.getElementById(_cxDomIds[_di]); if (_n2 && _n2.parentNode) _n2.parentNode.removeChild(_n2); }, 'cleanup.dom.doc');
        })(_di);
      }
    }, 'cleanup.dom');
    // ⑪ 终态：清空事件总线订阅 + 删除命名空间对象
    bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.clearSubs) EventBus.clearSubs(); }, 'cleanup.subs');   // 审查整改 #1.3：teardown 清空全部订阅（原传 '__ev:ui:toast' 会保留该键、清其余，语义错配）
    // 沙箱独立性修复：还原注入前全局（EventBus/Store 为 state.js 有意导出、dsAvailable/_dsIsLoggedIn 为
    // vision-deepseek-web.js 有意导出）——旧实现卸载后这些全局仍残留（含 EventBus 内部闭包状态），
    // 与「回到注入前全局态」契约不符。保存的注入前值在各自模块（state.js / vision-deepseek-web.js），
    // 有值则还原、无值（注入前不存在）则 delete。
    bestEffort(function () {
      if (typeof _origEventBus !== 'undefined') { try { window.EventBus = _origEventBus; } catch (e) {} }
      else { try { delete window.EventBus; } catch (e) {} }
      if (typeof _origStore !== 'undefined') { try { window.Store = _origStore; } catch (e) {} }
      else { try { delete window.Store; } catch (e) {} }
    }, 'cleanup.ns.eventBus');
    bestEffort(function () {
      var _oA = (window.__CX_FORCE_PLAY && '_origDsAvailable' in window.__CX_FORCE_PLAY) ? window.__CX_FORCE_PLAY._origDsAvailable : undefined;
      var _oL = (window.__CX_FORCE_PLAY && '_origDsIsLoggedIn' in window.__CX_FORCE_PLAY) ? window.__CX_FORCE_PLAY._origDsIsLoggedIn : undefined;
      if (typeof _oA !== 'undefined') { try { window.dsAvailable = _oA; } catch (e) {} }
      else { try { delete window.dsAvailable; } catch (e) {} }
      if (typeof _oL !== 'undefined') { try { window._dsIsLoggedIn = _oL; } catch (e) {} }
      else { try { delete window._dsIsLoggedIn; } catch (e) {} }
    }, 'cleanup.ns.dsGlobals');
    // D9 修复：补全"卸载还原清单"缺口——以下全局/跨文档监听此前未反注册，造成卸载后全局监听器泄漏。
    bestEffort(function () {   // Ninja 面板外点击收起（window.top 文档上的全局 mousedown）
      var _pd = (window.top && window.top.document) ? window.top.document : document;
      if (typeof panelNinjaOutsideClick === 'function') _pd.removeEventListener('mousedown', panelNinjaOutsideClick, true);
    }, 'cleanup.panelOutside');
    bestEffort(function () {   // Ninja 圆点随播放状态变色（document 级 capture 监听）
      if (typeof syncNinjaGlyph === 'function') { document.removeEventListener('play', syncNinjaGlyph, true); document.removeEventListener('pause', syncNinjaGlyph, true); }
    }, 'cleanup.ninjaEvents');
    bestEffort(function () {   // Ninja 圆点订阅 panel:refresh 事件
      if (typeof EventBus !== 'undefined' && EventBus.offEv && typeof syncNinjaGlyph === 'function') EventBus.offEv('panel:refresh', syncNinjaGlyph);
    }, 'cleanup.ninjaEvSubs');
    // ⑦-b（R5 修复）：显式退订 owner 卸载监听并释放 owner，使 uninstall 后存活帧可重新接管面板
    bestEffort(function () { if (typeof _ownerReleaseFn === 'function') { window.removeEventListener('pagehide', _ownerReleaseFn, false); _ownerReleaseFn = null; } }, 'cleanup.ownerRelease');
    bestEffort(function () { if (typeof _cxPanel !== 'undefined' && _cxPanel && _cxPanel._cxPanelOwner === window) _cxPanel._cxPanelOwner = null; }, 'cleanup.ownerClear');
    bestEffort(function () { delete window.__CX_FORCE_PLAY; }, 'cleanup.ns.root');
  }
  bestEffort(function () { window.addEventListener('pagehide', cleanupListeners, { once: true }); }, 'setup.hide');
  bestEffort(function () { window.addEventListener('beforeunload', cleanupListeners, { once: true }); }, 'setup.before');
  bestEffort(function () { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY._uninstallHooked = true; }, 'setup.flag');
  bestEffort(function () { window.__CX_FORCE_PLAY.uninstall = cleanupListeners; }, 'setup.uninstall');
