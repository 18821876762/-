  // ===== MODULE: 事件总线 + 状态镜像（原 P1「状态集中」）=====
  // ⚠️ 名实校准（架构审查）：本模块**当前的实际角色是事件总线**，而非名副其实的「状态集中层」。
  //   · 真正在用的能力：emit / onEv —— 如 bootstrap/main-loop.js 每轮发 'videos:scanned'、ui 层订阅刷新。
  //   · 名不副实的部分：Store.state 仅在 main-loop.js 末尾镜像了 TARGET/BRIDGE/ENDED_SRCS/_watchStats/_loopTimer
  //     这 5 个引用，而**全部业务调用点仍直接读写各自的顶层 var**，get/set 基本无人使用。
  //     故 Store.state 实为「只读调试快照」（便于诊断时一处查看核心状态），不是权威数据源。
  // 请勿据此误以为状态已收敛：修改状态时改的仍是各域顶层 var；对基本类型（如 _loopTimer 重启后的新 id）
  //   镜像不会自动同步，需在赋值处一并更新镜像。若将来要真正收敛，须逐个调用点迁移到 get/set，而非只加镜像。
  // 镜像语义：Store.state.X 与全局 X 指向同一对象引用（非拷贝），故对象内部字段的读写天然等价、零行为回归。
  var Store = (function () {
    var state = {};                 // 由各域声明后镜像注入（同引用，非拷贝）
    var subs = {};
    function get(k) { return state[k]; }
    function set(k, v, silent) {
      state[k] = v;
      if (!silent && subs[k]) subs[k].forEach(function (fn) { try { fn(v); } catch (e) { swallow(e, 'store.set'); } });
    }
    function on(k, fn) { (subs[k] = subs[k] || []).push(fn); }
    function emit(ev, payload) {   // P5c：透传变参（emit(ev, a, b) → fn(a, b)），向后兼容单 payload 调用
      var arr = subs['__ev:' + ev];
      if (arr) { var args = Array.prototype.slice.call(arguments, 1); arr.forEach(function (fn) { try { fn.apply(null, args); } catch (e) { swallow(e, 'store.emit'); } }); }
    }
    function onEv(ev, fn) { on('__ev:' + ev, fn); }
    return { state: state, get: get, set: set, on: on, emit: emit, onEv: onEv };
  })();
