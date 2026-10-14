// @provides: CoreState
// @requires: CONFIG, EventBus, SAFETY, swallow
  // 自动化唯一运行状态入口。持久配置是输入；epoch 与 scope 代次永不回退。
  // Token 只属于本次注入：停止后恢复、重置、卸载后重新注入均不能复活旧任务。
  var CoreState = (function () {
    var owner = {}, current = 'INITIALIZING', reason = 'initializing', epoch = 0;
    var scopes = Object.create(null), cancellations = [], changes = [];
    var disposed = false, notifying = false;
    function parents(nearestOnly) {
      var list = [], frame = window;
      try {
        while (frame.parent && frame.parent !== frame) {
          frame = frame.parent;
          var controller = frame.__CX_FORCE_PLAY && frame.__CX_FORCE_PLAY.CoreState;
          if (controller) { list.push(controller); if (nearestOnly) break; }
        }
      } catch (e) { /* 跨域边界：各帧独立管理 */ }
      return list;
    }
    function lineage() {
      // sync 已沿最近父控制器检查整条祖先链，此处只读代次，保持 O(depth)。
      return parents().map(function (controller) {
        var view = controller.peekSnapshot ? controller.peekSnapshot() : controller.getSnapshot();
        return { controller: controller, epoch: view.epoch };
      });
    }
    function refreshChildren(frame) {
      try {
        for (var i = 0; i < frame.frames.length; i++) {
          var child = frame.frames[i];
          try {
            var controller = child.__CX_FORCE_PLAY && child.__CX_FORCE_PLAY.CoreState;
            if (controller) controller.canRun();
            else refreshChildren(child);
          } catch (e) { /* 不可访问的跨域帧 */ }
        }
      } catch (e) {}
    }
    function snapshot() { return Object.freeze({ state: current, reason: reason, epoch: epoch }); }
    function notifyCancel(scope, why) {
      var copy = cancellations.slice();
      for (var i = 0; i < copy.length; i++) {
        if (!copy[i].active || (scope !== null && copy[i].scope !== scope)) continue;
        try { copy[i].fn(why); } catch (e) { swallow(e, 'runtime.cancel'); }
      }
    }
    function transition(next, why) {
      if (current === next && reason === why) return;
      current = next; reason = why; epoch++;
      var view = snapshot();
      if (typeof EventBus !== 'undefined' && EventBus) EventBus.state.runtime = view;
      // 状态先提交，后通知；清理回调中的 canRun 不会重复进入同一转换。
      if (!notifying) {
        notifying = true;
        try {
          notifyCancel(null, why);
          changes.slice().forEach(function (fn) { try { fn(view); } catch (e) { swallow(e, 'runtime.change'); } });
          if (typeof EventBus !== 'undefined' && EventBus) EventBus.emit('runtime:state', view);
          refreshChildren(window);
        } finally { notifying = false; }
      }
    }
    function sync() {
      if (disposed) return false;
      if (typeof CONFIG === 'undefined' || !CONFIG) { transition('INITIALIZING', 'initializing'); return false; }
      var ancestors = parents(true), parent = ancestors.length ? ancestors[0].getSnapshot() : null;
      if (typeof SAFETY !== 'undefined' && SAFETY && SAFETY.tripped) transition('SAFETY_STOPPED', SAFETY.reason || 'safety-stop');
      else if (parent && parent.state === 'SAFETY_STOPPED') transition('SAFETY_STOPPED', 'parent-' + parent.reason);
      else if (CONFIG.ENABLED === false) transition('DISABLED', 'global-disabled');
      else if (!forcePlayEnabled()) transition('DISABLED', 'page-disabled');
      else if (_courseInDisabledList()) transition('DISABLED', 'course-disabled');
      else if (parent && parent.state !== 'RUNNING') transition('DISABLED', 'parent-' + parent.reason);
      else transition('RUNNING', 'enabled');
      return current === 'RUNNING';
    }
    function capture(scope) {
      sync(); scope = String(scope || 'default');
      return Object.freeze({ owner: owner, scope: scope, epoch: epoch, generation: scopes[scope] || 0, parents: lineage() });
    }
    function valid(token) {
      if (!sync() || !token || token.owner !== owner || token.epoch !== epoch || token.generation !== (scopes[token.scope] || 0)) return false;
      var ancestors = lineage();
      return token.parents.length === ancestors.length && ancestors.every(function (parent, i) {
        return parent.controller === token.parents[i].controller && parent.epoch === token.parents[i].epoch;
      });
    }
    function invalidateScope(scope, why) {
      if (disposed) return;
      scope = String(scope || 'default'); scopes[scope] = (scopes[scope] || 0) + 1;
      notifyCancel(scope, why || 'scope-reset');
    }
    function onCancel(scope, fn) {
      if (disposed || typeof fn !== 'function') return function () {};
      var entry = { scope: String(scope || 'default'), fn: fn, active: true };
      cancellations.push(entry);
      return function () {
        if (!entry.active) return;
        entry.active = false;
        var i = cancellations.indexOf(entry); if (i >= 0) cancellations.splice(i, 1);
      };
    }
    function onChange(fn) {
      if (disposed || typeof fn !== 'function') return function () {};
      changes.push(fn);
      return function () { var i = changes.indexOf(fn); if (i >= 0) changes.splice(i, 1); };
    }
    function dispose() {
      if (disposed) return;
      disposed = true; transition('DISPOSED', 'uninstalled');
      cancellations = []; changes = [];
    }
    return { state: function () { sync(); return current; }, getSnapshot: function () { sync(); return snapshot(); }, peekSnapshot: snapshot,
      canRun: sync, capture: capture, valid: valid, invalidateScope: invalidateScope,
      onCancel: onCancel, onChange: onChange, dispose: dispose };
  })();
  window.__CX_FORCE_PLAY.CoreState = CoreState;
