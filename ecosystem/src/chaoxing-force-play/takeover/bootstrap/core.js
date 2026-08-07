
(function () {
  'use strict';

  // 幂等守卫（审查#5：全局定时器/监听器从不清理 → 防止脚本被重复注入产生双倍 setInterval/监听器）：
  // 每个 frame(window) 仅初始化一次；多 frame 各自独立运行，不影响视频页面板可见性（v3.35 已撤销整体 return 守卫）。
  if (!window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY = {};   // 命名空间：非契约全局收敛于此（__cxAddonQueue/__cxRegisterAddon/__cxRegisterCommand 是工具库项注册契约，保留原 window.__cx* 名）
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

