






(function () {
  'use strict';
  // 注意：本文件（core.js）自身**故意不闭合**此 IIFE——构建脚本 build-force-play.ps1 在拼接产物末尾统一追加 `})();`
  // 将全部域模块包进同一闭包。因此**单文件 `node --check core.js` 会报 "Unexpected end of input"，属正常现象（非语法缺陷）**，
  // 只有对最终构建产物 `chaoxing-force-play.user.js` 做语法校验才有效。请勿为此误报而"修复"闭合——会破坏构建包裹契约。

  // 幂等守卫（审查#5：全局定时器/监听器从不清理 → 防止脚本被重复注入产生双倍 setInterval/监听器）：
  // 每个 frame(window) 仅初始化一次；多 frame 各自独立运行，不影响视频页面板可见性（v3.35 已撤销整体 return 守卫）。
  if (!window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY = {};   // 命名空间：非契约全局收敛于此（__cxAddonQueue/__cxRegisterAddon/__cxRegisterCommand 是工具库项注册契约，保留原 window.__cx* 名）
  if (window.__CX_FORCE_PLAY.started) return;
  window.__CX_FORCE_PLAY.started = true;

  // P1 集中式定时器注册表（防审查#5「全局定时器从不清理」泄漏）：
  // 所有长生命周期、需卸载清理的 setInterval/setTimeout 经此登记，uninstall()/cleanupListeners 时一次性 clearAll() 兜底，
  // 杜绝散落定时器在脚本热禁用/页面软卸载后孤立运行。短生命周期局部定时器（debounce/fetch 超时/静音轮询）仍用原生，
  // 因其自带 clear 且不需跨模块清理。注册表返回自增 id（非原生句柄），clear 经此 id。
  window.__CX_FORCE_PLAY.TimerRegistry = (function () {
    var _intervals = {}, _timeouts = {};
    var _seq = 1;
    function setInterval(fn, ms, owner) {
      var id = 'i' + (_seq++);
      var h = window.setInterval(fn, ms);
      _intervals[id] = { h: h, owner: owner || 'global' };
      return id;
    }
    function clearInterval(id) {
      if (_intervals[id]) { try { window.clearInterval(_intervals[id].h); } catch (e) {} delete _intervals[id]; }
    }
    function setTimeout(fn, ms, owner) {
      var id = 't' + (_seq++);
      var h = window.setTimeout(function () { if (_timeouts[id]) { delete _timeouts[id]; } try { fn(); } catch (e) {} }, ms);
      _timeouts[id] = { h: h, owner: owner || 'global' };
      return id;
    }
    function clearTimeout(id) {
      if (_timeouts[id]) { try { window.clearTimeout(_timeouts[id].h); } catch (e) {} delete _timeouts[id]; }
    }
    function clearAll(owner) {
      for (var k in _intervals) { if (_intervals.hasOwnProperty(k) && (!owner || _intervals[k].owner === owner)) { try { window.clearInterval(_intervals[k].h); } catch (e) {} delete _intervals[k]; } }
      for (var k2 in _timeouts) { if (_timeouts.hasOwnProperty(k2) && (!owner || _timeouts[k2].owner === owner)) { try { window.clearTimeout(_timeouts[k2].h); } catch (e) {} delete _timeouts[k2]; } }
    }
    // v4.19.36 诊断：活跃定时器统计（总数 + owner 分布）——线程健康一眼可见（如 quiz-retry 恒运行=待答重扫未停）
    function stats() {
      var byOwner = {};
      for (var k in _intervals) { if (_intervals.hasOwnProperty(k)) { var o = _intervals[k].owner || 'global'; byOwner[o] = (byOwner[o] || 0) + 1; } }
      for (var k2 in _timeouts) { if (_timeouts.hasOwnProperty(k2)) { var o2 = _timeouts[k2].owner || 'global'; byOwner[o2] = (byOwner[o2] || 0) + 1; } }
      return { intervals: Object.keys(_intervals).length, timeouts: Object.keys(_timeouts).length, byOwner: byOwner };
    }
    return { setInterval: setInterval, clearInterval: clearInterval, setTimeout: setTimeout, clearTimeout: clearTimeout, clearAll: clearAll, stats: stats };
  })();

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

