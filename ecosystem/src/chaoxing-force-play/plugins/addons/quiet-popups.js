// ===== 工具库项：关闭脚本弹窗（静默模式）（v4.16 新增） =====
// 用户诉求：悬浮提示只在关键时出现，且可在工具库一键「关闭除控制面板外的所有脚本弹窗」。
// 本项提供一个总开关：开启后所有悬浮 toast / 篡改报警红条 / OS 通知都不弹，
// 全部提示仍只进「洞察」页提示流（控制面板内），便于回看、不再刷屏。
// 站点无关：静默是全局偏好，不限超星/智慧树等特定站点，故不做站点隔离。
(function () {
  'use strict';

  // 幂等守卫
  if (window.__cxQuietPopupsStarted) return;
  window.__cxQuietPopupsStarted = true;

  var STORAGE_KEY = 'cx_quiet_popups';

  function isOn() {
    try { return (typeof window.__CX_FORCE_PLAY !== 'undefined' && typeof window.__CX_FORCE_PLAY.isQuietPopups === 'function') ? window.__CX_FORCE_PLAY.isQuietPopups() : (localStorage.getItem(STORAGE_KEY) === '1'); }
    catch (e) { return false; }
  }
  function setOn(v) {
    try {
      if (typeof window.__CX_FORCE_PLAY !== 'undefined' && typeof window.__CX_FORCE_PLAY.setQuietPopups === 'function') window.__CX_FORCE_PLAY.setQuietPopups(v);
      else localStorage.setItem(STORAGE_KEY, v ? '1' : '0');
      if (window.Store && window.Store.emit) window.Store.emit('ui:toast', v ? '已关闭脚本弹窗（仅留洞察页提示流）' : '已恢复悬浮提示', v ? 'info' : 'success');
    } catch (e) {}
  }

  // 注入工具库
  (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
    id: 'quiet-popups',
    type: 'toggle',
    label: '关闭脚本弹窗（仅留洞察页）',
    note: '关闭除控制面板外的所有悬浮提示/红条/OS通知；全部提示仍进「洞察」页提示流',
    get: isOn,
    set: setOn,
  });

  if (typeof window.__cxRegisterAddon === 'function') window.__cxRegisterAddon();
})();
