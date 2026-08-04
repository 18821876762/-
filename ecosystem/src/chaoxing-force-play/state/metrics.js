  // ===== MODULE: 运维指标与黑匣子（可观测性状态层）=====
  // 域：诊断 / 可观测性状态 —— 与续播业务逻辑无关，仅供面板仪表盘与黑匣子读取展示。
  // 归属说明（架构·作用域）：这些变量原先寄居在 biz/targeting.js 顶层，属于「诊断状态声明在业务模块」的
  //   归属错位，并把 targeting.js 的顶层 var 推到 18 个（占全项目一半）。现集中到状态层独立成模块。
  // 写入方：biz/playback.js（safePlay 计数）、biz/targeting.js 与 dom/dom.js（_bxLog 埋点）、ui/dashboard.js（采样累计）。
  // 读取方：ui/dashboard.js（仪表盘/Sparkline）、ui/panel-core.js（黑匣子列表与导出）。
  // 顺序无关性：本模块全部为顶层 var / 函数声明，与其余模块同处一个 IIFE 闭包，且所有使用点都在函数体内
  //   （运行时求值），故其在构建顺序中的位置不影响行为。

  // —— 运维仪表盘数据 ——
  var _moHistory = [];                        // MO 队列长度历史（最近 30 个采样点，用于 Sparkline）
  var _moHistMax = 30;                        // 历史采样点最大数量
  var _safePlayAttempts = 0;                  // safePlay 调用次数
  var _safePlaySuccesses = 0;                 // safePlay 成功次数（playing 事件触发）
  // 命中率累计采样（环形仪表：像精密仪器读数，实时但不跳动）
  var _targetHitSamples = 0;                  // 启用定向后仪表盘采样次数
  var _targetHitHits = 0;                     // 其中命中（matched）次数

  // —— 黑匣子（环形缓冲区，记录最近 N 条操作日志用于诊断）——
  var _bxBuffer = [];                         // { ts: Date.now(), action: string, detail: string }
  var _bxCap = 200;                           // 最多保留 200 条
  function _bxLog(action, detail) {           // 黑匣子记录（action 用短标签，detail 上下文）
    try {
      _bxBuffer.push({ ts: Date.now(), action: action, detail: detail || '' });
      if (_bxBuffer.length > _bxCap) _bxBuffer.shift();
    } catch (e) { swallow(e); }
  }

  // —— 错误环形缓冲（被 swallow 吞掉的错误，无论 DEBUG 是否开启都记录，供诊断追溯）——
  // 归属说明（架构·作用域）：原寄居在 utils/utils.js 顶层，与 dbg/swallow/cxState 等通用工具混居，属「诊断状态错位」。
  // 现集中到可观测性状态层。写入方：utils/utils.js 的 swallow（前向引用——utils 为首个模块、本模块第 3 个，
  //   但 swallow 仅在运行时调用且 IIFE 内 var 已 hoist，与 dbg→DEBUG 同型，安全）。
  var _errBuf = [];          // 被吞错误的环形缓冲（最多保留 50 条）
  var _errCount = 0;         // 累计被吞错误数（含 DEBUG 关闭时的静默错误）
  function recentErrors(n) { try { return _errBuf.slice(-(n || 10)); } catch (e) { return []; } }
  function errorCount() { return _errCount; }
