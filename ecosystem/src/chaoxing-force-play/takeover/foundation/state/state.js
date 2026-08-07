  // ===== MODULE: 事件总线 + 状态镜像（原 P1「状态集中」）=====
  // ⚠️ 名实校准（架构审查）：本模块**当前的实际角色是事件总线**，而非名副其实的「状态集中层」。
  //   · 真正在用的能力：emit / onEv —— 如 takeover/bootstrap/main-loop.js 每轮发 'videos:scanned'、ui 层订阅刷新。
  //   · 名不副实的部分：Store.state 仅在 main-loop.js 末尾镜像了 TARGET/BRIDGE/ENDED_SRCS/_watchStats/_loopTimer
  //     这 5 个引用，而**全部业务调用点仍直接读写各自的顶层 var**，get/set 基本无人使用。
  //     故 Store.state 实为「只读调试快照」（便于诊断时一处查看核心状态），不是权威数据源。
  // 请勿据此误以为状态已收敛：修改状态时改的仍是各域顶层 var；对基本类型（如 _loopTimer 重启后的新 id）
  //   镜像不会自动同步，需在赋值处一并更新镜像。若将来要真正收敛，须逐个调用点迁移到 get/set，而非只加镜像。
  // 镜像语义：Store.state.X 与全局 X 指向同一对象引用（非拷贝），故对象内部字段的读写天然等价、零行为回归。
  /**
   * 事件总线 + 只读状态快照（Store）。
   * 实际角色是事件总线（emit/onEv 为主），Store.state 仅镜像各域顶层 var 供诊断一处查看，
   * 并非权威数据源——修改状态仍应改各域顶层 var，并在赋值处同步镜像。
   * @type {{state: Object, get: Function, set: Function, on: Function, emit: Function, onEv: Function}}
   */
  var Store = (function () {
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
      if (arr) { var args = Array.prototype.slice.call(arguments, 1); arr.forEach(function (fn) { try { fn.apply(null, args); } catch (e) { swallow(e, 'store.emit'); } }); }
      // 跨帧透传（修复信息流丢提示）：子帧(如视频 iframe)的轻提示经 postMessage 转发到顶层帧，
      // 使顶层「洞察」页提示流与悬浮 toast 能聚合所有帧的提示；顶层帧 window===top 不回传，避免回环。
      if (ev === 'ui:toast' && typeof window !== 'undefined' && window !== window.top) {
        try { window.top.postMessage({ __cxFeedToast: Array.prototype.slice.call(arguments, 1) }, '*'); } catch (e) { swallow(e, 'store.emit.fwd'); }
      }
    }
    /** 订阅事件（语法糖：on('__ev:'+ev, fn)）。@param {string} ev @param {Function} fn */
    function onEv(ev, fn) { on('__ev:' + ev, fn); }
    // 顶层帧：接收子帧转发的轻提示并汇入本帧事件总线（仅顶层执行，避免回环）。
    if (typeof window !== 'undefined' && window === window.top) {
      try {
        window.addEventListener('message', function (e) {
          try {
            var d = e && e.data;
            if (d && d.__cxFeedToast && Array.isArray(d.__cxFeedToast)) emit.apply(null, ['ui:toast'].concat(d.__cxFeedToast));
          } catch (err) { swallow(err, 'store.feed.rcv'); }
        });
      } catch (e) { swallow(e, 'store.feed.bind'); }
    }
    return { state: state, get: get, set: set, on: on, emit: emit, onEv: onEv };
  })();
