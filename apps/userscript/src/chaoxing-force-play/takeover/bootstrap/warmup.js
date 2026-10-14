// @requires: CX_KEYS, CoreState, EventBus
// 开源版首次使用确认：未确认状态跨刷新恢复；确认/停机/卸载取消提示。
(function () {
  if (typeof __CX_VARIANT === 'undefined' || __CX_VARIANT !== 'open') return;
  var ns = window.__CX_FORCE_PLAY, registry = ns.TimerRegistry;
  ns.variant = 'open';
  var key = 'cx_warmup_v1', armed = false, timers = [];
  // 必须读写成对，避免只提供 GM_setValue 时写 GM、读 localStorage。
  var gm = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  function get() { try { return gm ? GM_getValue(key, null) : localStorage.getItem(key); } catch (e) { return null; } }
  function set(value) { try { if (gm) GM_setValue(key, value); else localStorage.setItem(key, value); } catch (e) {} }
  function cancel() { timers.forEach(function (id) { registry.clearTimeout(id); }); timers = []; }
  function acknowledge() {
    if (!armed) return;
    armed = false; set('done'); cancel(); CoreState.invalidateScope('warmup', 'acknowledged');
    EventBus.emit('ui:toast', '预热结束：已确认自动作答设置，可随时在面板关闭', 'success');
  }
  function notice(message, delay, token) {
    timers.push(registry.setTimeout(function () {
      if (armed && CoreState.valid(token)) EventBus.emit('ui:toast', message);
    }, delay, 'warmup'));
  }
  CoreState.onCancel('warmup', cancel);
  ns.warmup = { active: function () { return armed; }, acknowledge: acknowledge };
  var previous = get();
  if (previous === 'done') return;
  armed = true; set('armed');
  try { localStorage.setItem(CX_KEYS.QUIZ_AUTO_START, '0'); } catch (e) {}
  if (!previous && CoreState.canRun()) {
    var token = CoreState.capture('warmup');
    notice('【开源版·首次预热】自动作答已暂停，请先确认课程与脚本设置。', 2500, token);
    notice('首次使用请在页面内确认题目和答案；遇到验证提示，脚本会停止自动化。', 6500, token);
    notice('在面板勾选“检测到题目后自动开始”可结束预热；该选择会保存。', 10500, token);
  }
})();
