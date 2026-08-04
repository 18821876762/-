  // ===== 工具库（副程序）=====
  // 全局通用工具：调试日志 dbg / 静默容错 swallow。
  // 通用工具层：供核心与各功能模块（含副脚本 SDK）共享同一套日志/容错语义。
  // 【加载顺序陷阱·勿在本文件顶层即时调用 dbg()】本模块是构建顺序中的第一个，但 dbg 依赖的 DEBUG 声明在
  //   后加载的 meta-config/config.js。函数体内引用属运行时求值，安全；而在本文件顶层直接写 dbg('...') 会在
  //   脚本加载瞬间抛 ReferenceError，导致整个 IIFE 中断、脚本完全不执行。新增顶层语句时务必避开 DEBUG/CONFIG 等后置声明。
  // 可观测性：被 swallow 吞掉的错误计数与环形缓冲已迁至 state/metrics.js（可观测性状态层，与通用工具解耦）。
  // 本文件仅保留 swallow 写入侧逻辑；变量声明在 metrics.js（前向引用：utils 为首个模块、metrics 第 3 个，
  //   但 swallow 仅运行时调用且 IIFE 内 var 已 hoist，与 dbg→DEBUG 同型，安全）。
  function dbg() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[CX-FORCE]'].concat([].slice.call(arguments))); } catch (e) { swallow(e); }
  }
  function swallow(e, tag) {
    // 记录：始终计入，便于诊断（即使 DEBUG 关闭也保留可追溯性）
    _errCount++;
    try {
      _errBuf.push({ t: Date.now(), tag: tag || '?', msg: (e && e.message) ? e.message : String(e) });
      if (_errBuf.length > 50) _errBuf.shift();
    } catch (_) {}
    // 输出：仅 DEBUG 开启时打印，保持原有静默语义（DEBUG 关闭不影响线上行为）
    if (!DEBUG) return;
    try { console.warn('[CX-FORCE] ' + (tag || 'swallowed') + ':', (e && e.message) ? e.message : e); } catch (_) {}
  }

  // ===== 视频元素状态仓（WeakMap）=====
  // 把脚本“内部态”从视频/iframe/DOM 节点属性上移走，避免 DOM 节点属性污染：
  //  - 页面其他脚本遍历视频元素时不再可见未知属性；
  //  - 同名属性冲突（如平台也用 __ 前缀）风险消除；
  //  - 元素被垃圾回收时状态自动清理，无内存泄漏。
  // 注意：与副脚本的“跨脚本契约属性”必须留在节点上，不可移入 WeakMap：
  //  __cxForcePaused（tamper-guard 通过 prototype.pause.toString() 检测该字面量；且为原型级防暂停闸门）、
  //  __cxAN_hold（auto-next 写入）、__cxEndedLock（ended-notify 读取）、
  //  __cxUserPaused / __np（keyboard-shortcuts 读写）。
  var videoState = new WeakMap();
  function cxState(node) {
    var s = videoState.get(node);
    if (!s) { s = {}; videoState.set(node, s); }
    return s;
  }

  // 接管策略开关（forcePlayEnabled / cxVideoOptOut）已迁至 biz/policy.js（业务·策略域），本文件不再持有。
