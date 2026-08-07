// ===== 工具库项：智慧树自动下一视频（v4.15 新增） =====
// 站点归属：智慧树(知到)（detectSite()==='zhihuishu'），与超星 auto-next.js 刻意并列、互不干扰。
// 需求：智慧树视频为「同页自动续播」——视频 A 结束由平台自动切到下一集，脚本不应像超星那样锁死 ended 防重播。
//   本工具库项只负责「开关 + 持久化 + 状态位」，真正的放行逻辑在核心 dom.js 的 _ovEnforce(ended 分支)：
//   开启时把 window.__CX_FORCE_PLAY.zhsAllowEndedReplay 置真，dom.js 据此在智慧树视频 ended 时不锁死、交还平台自动续播。
//   默认关（与超星一致：锁死 ended 防重播），需用户在面板「工具库」区手动开启。
(function () {
  'use strict';

  // 幂等守卫：防止重复注入叠加状态机与 ended/storage 监听导致重复导航
  if (window.__cxZhAutoNextStarted) return;
  window.__cxZhAutoNextStarted = true;

  // 站点隔离：核心脚本为多平台脚本，本工具库项为智慧树专属逻辑，须按站点隔离，避免在其他平台(超星/MOOC等)误触发放行
  if (!(window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.detectSite === 'function' && window.__CX_FORCE_PLAY.detectSite() === 'zhihuishu')) return;

  var LS_KEY = 'cx_zh_auto_next';

  function isOn() {
    try { return '1' === localStorage[LS_KEY]; } catch (e) { return false; }
  }

  // 写入持久化 + 同步核心标志位（dom.js 每轮 _loopTick 读最新值，故时序无碍）
  function setOn(v) {
    try { localStorage[LS_KEY] = v ? '1' : '0'; } catch (e) {}
    try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.zhsAllowEndedReplay = !!v; } catch (e) {}
  }

  function bootstrap() {
    // 应用当前持久化状态到核心标志（刷新后即时生效）
    try { if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.zhsAllowEndedReplay = isOn(); } catch (e) {}

    var addon = {
      id: 'zh-auto-next',
      type: 'toggle',
      label: '自动下一视频',
      note: '视频播完由平台自动续播下一集（同页切换，不锁死 ended）',
      get: isOn,
      set: function (v) { setOn(v); },
    };
    try {
      if (!Array.isArray(window.__cxAddonQueue)) window.__cxAddonQueue = [];
      window.__cxAddonQueue.push(addon);
      if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
    } catch (e) {}

    // 跨标签页 / 同页面 storage 同步（保持核心标志与开关一致）
    try {
      window.addEventListener('storage', function (e) { if (e.key === LS_KEY) setOn(e.newValue === '1'); });
    } catch (e) {}
  }

  // 延迟启动：给核心脚本先初始化的窗口（与 auto-next.js 一致）
  setTimeout(bootstrap, 300);
})();
