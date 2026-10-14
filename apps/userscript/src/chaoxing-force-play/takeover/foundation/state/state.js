// @provides: EventBus
// @requires: swallow
  // ===== MODULE: 事件总线 + 状态镜像（原 P1「状态集中」）=====
  // 4.20.0：运行许可由 runtime.js 的 CoreState 管理；state.runtime 镜像其不可变快照。
  // EventBus 继续负责事件及各域调试镜像，不承担运行状态转换。
  // ⚠️ 名实校准（架构审查）：本模块**当前的实际角色是事件总线**，而非名副其实的「状态集中层」。
  //   · 真正在用的能力：emit / onEv —— 如 takeover/bootstrap/main-loop.js 每轮发 'videos:scanned'、ui 层订阅刷新。
  //   · 名不副实的部分：EventBus.state 仅在 main-loop.js 末尾镜像了 TARGET/BRIDGE/ENDED_SRCS/_watchStats/_loopTimer
  //     这 5 个引用，而**全部业务调用点仍直接读写各自的顶层 var**，get/set 基本无人使用。
  //     故 EventBus.state 实为「只读调试快照」（便于诊断时一处查看核心状态），不是权威数据源。
  // 请勿据此误以为状态已收敛：修改状态时改的仍是各域顶层 var；对基本类型（如 _loopTimer 重启后的新 id）
  //   镜像不会自动同步，需在赋值处一并更新镜像。若将来要真正收敛，须逐个调用点迁移到 get/set，而非只加镜像。
  // 镜像语义：EventBus.state.X 与全局 X 指向同一对象引用（非拷贝），故对象内部字段的读写天然等价、零行为回归。
  /**
   * 事件总线 + 只读状态快照（Store）。
   * 实际角色是事件总线（emit/onEv 为主），EventBus.state 仅镜像各域顶层 var 供诊断一处查看，
   * 并非权威数据源——修改状态仍应改各域顶层 var，并在赋值处同步镜像。
   * @type {{state: Object, get: Function, set: Function, on: Function, emit: Function, onEv: Function}}
   */
  // 幂等性修复(审查 G-4)：模块级具名 handler（声明在 EventBus IIFE 外），供 takeover/dom/lifecycle.js 的
  // cleanupListeners removeEventListener——旧实现为匿名函数且未列入清理清单，uninstall 后全局监听器仍残留。
  var _topFeedMessageHandler = null;
  var EventBus = (function () {
    var state = {};                 // 由各域声明后镜像注入（同引用，非拷贝）
    var subs = {};
    /** 读镜像状态值（基本无人使用，保留兼容）。@param {string} k @returns {*} */
    function get(k) { return state[k]; }
    /** 写镜像状态值并通知订阅者（silent=true 时不通知）。@param {string} k @param {*} v @param {boolean} [silent] */
    function set(k, v, silent) {
      state[k] = v;
      if (!silent && subs[k]) subs[k].forEach(function (fn) { try { fn(v); } catch (e) { swallow(e, 'store.set'); } });
    }
    /** 订阅状态键变化。@param {string} k @param {Function} fn */
    function on(k, fn) { (subs[k] = subs[k] || []).push(fn); }
    /** 发布事件：变参透传 emit(ev, a, b) → fn(a, b)，向后兼容单 payload 调用。@param {string} ev @param {...*} payload */
    function emit(ev, payload) {   // P5c：透传变参（emit(ev, a, b) → fn(a, b)），向后兼容单 payload 调用
      var arr = subs['__ev:' + ev];
      if (arr) { var args = Array.from(arguments).slice(1); arr.forEach(function (fn) { try { fn.apply(null, args); } catch (e) { swallow(e, 'store.emit'); } }); }
      // 跨帧透传（修复信息流丢提示）：子帧(如视频 iframe)的轻提示经 postMessage 转发到顶层帧，
      // 使顶层「洞察」页提示流与悬浮 toast 能聚合所有帧的提示；顶层帧 window===top 不回传，避免回环。
      if (ev === 'ui:toast' && typeof window !== 'undefined' && window !== window.top) {
        try {
          // §9.2-1 安全收紧：目标从 '*' 收窄到顶层帧真实 origin，避免把提示广播给任意 origin 窗口（同站点 iframe 同源仍正常收到）
          var _topOrigin = (window.top && window.top.origin) ? window.top.origin : '*';
          window.top.postMessage({ __cxFeedToast: Array.from(arguments).slice(1) }, _topOrigin);
        } catch (e) { swallow(e, 'store.emit.fwd'); }
      }
    }
    /** 订阅事件（语法糖：on('__ev:'+ev, fn)）。@param {string} ev @param {Function} fn */
    function onEv(ev, fn) { on('__ev:' + ev, fn); }
      /** 退订状态键变化（H3：事件总线无退订 → 补充 off）。@param {string} k @param {Function} fn */
    function off(k, fn) {
      var arr = subs[k];
      if (!arr) return;
      if (!fn) { delete subs[k]; return; }   // 无 fn 时清空该键全部订阅（SPA 重建面板用）
      for (var i = arr.length - 1; i >= 0; i--) if (arr[i] === fn) arr.splice(i, 1);
      if (arr.length === 0) delete subs[k];
    }
    /** 退订事件（语法糖：off('__ev:'+ev, fn)）。@param {string} ev @param {Function} fn */
    function offEv(ev, fn) { off('__ev:' + ev, fn); }
    /** 清空全部订阅（H3：卸载/热禁用时避免残留死订阅叠加泄漏）。@param {string} [keepKey] 可选保留键（如跨帧透传监听） */
    function clearSubs(keepKey) {
      if (keepKey) { var _keep = subs[keepKey]; subs = {}; if (_keep) subs[keepKey] = _keep; }
      else { subs = {}; }
    }
    // 顶层帧：接收子帧转发的轻提示并汇入本帧事件总线（仅顶层执行，避免回环）。
    // 幂等性修复(审查 G-4)：具名 handler 赋值给模块级 _topFeedMessageHandler（勿在 IIFE 内重新 var 声明，
    // 否则赋值落在局部变量、lifecycle 引用不到），供 cleanupListeners removeEventListener——旧实现匿名注册、
    // 未列入清理清单，uninstall 后全局监听器仍残留。
    if (typeof window !== 'undefined' && window === window.top) {
      try {
        _topFeedMessageHandler = function (e) {
          try {
            // P3 加固：仅接受同源消息，拒绝任意跨源页伪造的轻提示注入
            if (e && e.origin && e.origin !== window.location.origin) return;
            var d = e && e.data;
            if (d && d.__cxFeedToast && Array.isArray(d.__cxFeedToast)) emit.apply(null, ['ui:toast'].concat(d.__cxFeedToast));
          } catch (err) { swallow(err, 'store.feed.rcv'); }
        };
        window.addEventListener('message', _topFeedMessageHandler);
      } catch (e) { swallow(e, 'store.feed.bind'); }
    }
    return { state: state, get: get, set: set, on: on, off: off, emit: emit, onEv: onEv, offEv: offEv, clearSubs: clearSubs };
  })();
  // 暴露到 window 使独立 addon/toolkit 脚本也能 emit('ui:toast') 等
  // Phase 3：主名 EventBus，保留 window.Store 别名向后兼容（外部 addon 可能仍用旧名检查存在性）
  // 沙箱独立性修复：保存注入前的全局值（含「不存在」），供 lifecycle.cleanupListeners ⑪ 还原——
  // 旧实现无条件覆盖且卸载后不清理，window.EventBus/Store 残留闭包状态（泄漏面）。
  var _origEventBus = (typeof window !== 'undefined') ? window.EventBus : undefined;
  var _origStore = (typeof window !== 'undefined') ? window.Store : undefined;
  if (typeof window !== 'undefined') { window.EventBus = EventBus; window.Store = EventBus; }
