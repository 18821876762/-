  // ===== 工具库（副程序）=====
  // 全局通用工具：调试日志 dbg / 静默容错 swallow。
  // 通用工具层：供核心与各功能模块（含工具库项 SDK）共享同一套日志/容错语义。
  // 【加载顺序陷阱·勿在本文件顶层即时调用 dbg()】本模块是构建顺序中的第一个，但 dbg 依赖的 DEBUG 声明在
  //   后加载的 takeover/foundation/meta-config/config.js。函数体内引用属运行时求值，安全；而在本文件顶层直接写 dbg('...') 会在
  //   脚本加载瞬间抛 ReferenceError，导致整个 IIFE 中断、脚本完全不执行。新增顶层语句时务必避开 DEBUG/CONFIG 等后置声明。
  // 可观测性：被 swallow 吞掉的错误计数与环形缓冲已迁至 takeover/foundation/state/metrics.js（可观测性状态层，与通用工具解耦）。
  // 本文件仅保留 swallow 写入侧逻辑；变量声明在 metrics.js（前向引用：utils 为首个模块、metrics 第 3 个，
  //   但 swallow 仅运行时调用且 IIFE 内 var 已 hoist，与 dbg→DEBUG 同型，安全）。
  /**
   * 调试日志输出（受 CONFIG.DEBUG / DEBUG 全局开关控制）。
   * 仅在调试态打印，生产环境静默；自身不抛错，失败时由内部 swallow 兜底。
   */
  function dbg() {
    if (!DEBUG) return;
    try { console.log.apply(console, ['[CX-FORCE]'].concat([].slice.call(arguments))); } catch (e) { swallow(e); }
  }
  /**
   * 安全吞掉异常并记录到环形缓冲，避免单点错误中断主流程（评审#1 可观测化：记录 e.stack）。
   * @param {*} e - 错误对象或任意值（非 Error 时降级记录字符串）
   * @param {string} [tag] - 错误来源标签，便于分类检索
   */
  function swallow(e, tag) {
    // 记录：始终计入（即使 DEBUG 关闭也保留可追溯性）。附 stack 便于根因诊断而无需改动线上行为。
    _errCount++;
    try {
      var _entry = { t: Date.now(), tag: tag || '?', msg: (e && e.message) ? e.message : String(e) };
      if (e && e.stack) _entry.stack = e.stack;   // 评审#1：保留堆栈，DEBUG 或诊断导出时可追溯
      _errBuf.push(_entry);
      if (_errBuf.length > 50) _errBuf.shift();
    } catch (_) {}
    // 输出：仅 DEBUG 开启时打印完整错误对象（console 自动附带 stack），保持原有静默语义
    if (!DEBUG) return;
    try { console.warn('[CX-FORCE] ' + (tag || 'swallowed') + ':', e); } catch (_) {}
  }

  // ===== 视频元素状态仓（WeakMap）=====
  // 把脚本“内部态”从视频/iframe/DOM 节点属性上移走，避免 DOM 节点属性污染：
  //  - 页面其他脚本遍历视频元素时不再可见未知属性；
  //  - 同名属性冲突（如平台也用 __ 前缀）风险消除；
  //  - 元素被垃圾回收时状态自动清理，无内存泄漏。
  // 注意：与工具库项的“跨脚本契约属性”必须留在节点上，不可移入 WeakMap：
  //  __cxForcePaused（tamper-guard 通过 prototype.pause.toString() 检测该字面量；且为原型级防暂停闸门）、
  //  __cxAN_hold（auto-next 写入）、__cxEndedLock（ended-notify 读取）、
  //  __cxUserPaused / __np（keyboard-shortcuts 读写）。
  var videoState = new WeakMap();
  function cxState(node) {
    var s = videoState.get(node);
    if (!s) { s = {}; videoState.set(node, s); }
    return s;
  }

  // ===== 错误容错收口（safeCall）=====
  // 把遍布全脚本的「try { fn(); } catch (e) { swallow(e); }」样板收口到一处：集中诊断、调用点更干净。
  // 返回 fn 的执行结果；异常已被 swallow 记录，调用点无需再包 try/catch。
  /**
   * 安全调用函数：包裹 try/catch，异常经 swallow 记录，调用方不被中断。
   * 评审#11 收口原散落 try/catch 的通用写法。
   * @param {Function} fn - 待执行函数
   * @param {string} [tag] - 错误标签
   * @returns {*} fn 的返回值；异常时 undefined
   */
  function safeCall(fn, tag) {
    try { return fn(); } catch (e) { swallow(e, tag || 'safeCall'); }
  }

  // ===== 频率控制（throttle / debounce）=====
  // 重 DOM 刷新（如 refreshPanelState）在高频事件（videos:scanned / panel:refresh / MutationObserver 兜底）下
  // 反复全量重绘会拖慢主线程。throttle 限频为「至少 wait ms 执行一次」并尾沿兜底补最后一帧；
  // debounce 则「停止触发 wait ms 后才执行」，适合输入类（搜索/滑块）场景。两者均不抛错（异常走 safeCall→swallow）。
  /**
   * 节流：限制 fn 在 wait 毫秒窗口内最多执行一次（尾沿触发最近一次调用）。
   * @param {Function} fn - 目标函数
   * @param {number} wait - 节流窗口毫秒
   * @returns {Function} 节流后的函数
   */
  function throttle(fn, wait) {
    var last = 0, timer = null, ctxA = null, argsA = null;
    return function () {
      var now = Date.now(), ctx = this, args = arguments;
      var remaining = wait - (now - last);
      if (remaining <= 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        last = now;
        safeCall(function () { fn.apply(ctx, args); }, 'throttle');
      } else if (!timer) {
        ctxA = ctx; argsA = args;
        timer = setTimeout(function () {
          last = Date.now(); timer = null;
          safeCall(function () { fn.apply(ctxA, argsA); }, 'throttle');
        }, remaining);
      }
    };
  }
  /**
   * 防抖：fn 在最后一次调用后 wait 毫秒内无新调用才执行。
   * @param {Function} fn - 目标函数
   * @param {number} wait - 防抖窗口毫秒
   * @returns {Function} 防抖后的函数
   */
  function debounce(fn, wait) {
    let timer = null;
    return function () {
      const ctx = this, args = arguments;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        timer = null;
        safeCall(function () { fn.apply(ctx, args); }, 'debounce');
      }, wait);
    };
  }

  // ===== 工具库对外件（供「工具库」项复用，单一实现）=====
  // 各独立工具项历史上各自重定义了 swallow / escapeHTML / isTextEntry / localStorage 包装 / toast 等重复轮子。
  // 此处提供唯一实现并挂到 window.__CX_FORCE_PLAY.toolkit；工具项运行时优先复用，
  // 核心脚本未注入时回退本地最小实现（保证独立安装仍可运行，不依赖核心脚本存在）。
  /**
   * 转义 HTML 特殊字符，防止注入到面板 innerHTML 造成 XSS。
   * @param {*} s - 待转义值（非字符串会被强制转换为字符串）
   * @returns {string} 转义后的安全字符串
   */
  function escapeHTML(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // 输入焦点避让：文本框/文本域/下拉/可编辑区放行 Space（让用户输入空格），其余接管为快捷键
  /**
   * 判断元素是否为可输入文本域（input[type=text]/textarea 等），用于接管 opt-out 判定。
   * @param {Element} el - 待检测元素
   * @returns {boolean}
   */
  function isTextEntry(el) {
    if (!el) return false;
    if (el.isContentEditable === true) return true;
    const t = (el.tagName || '').toLowerCase();
    if (t === 'textarea' || t === 'select') return true;
    if (t === 'input') {
      const ty = ((el.getAttribute && el.getAttribute('type')) || 'text').toLowerCase();
      return ['text', 'password', 'search', 'email', 'number', 'url', 'tel'].indexOf(ty) >= 0;
    }
    return false;
  }
  /**
   * 判断当前 window 是否顶层框架（非 iframe），用于区分注入作用域与重复初始化。
   * @returns {boolean}
   */
  function isTopFrame() {
    try { return window.top === window.self; } catch (e) { return true; }
  }
  /**
   * 读取 localStorage（原始字符串；缺失或异常回退默认值 d）。
   * 注意：不做 JSON.parse，存什么取什么（如需对象请调用方自行 JSON.parse）。
   * @param {string} k - 键名
   * @param {*} [d] - 读取失败/缺失时的默认值
   * @returns {string|*} 命中时返回原始字符串，否则返回默认 d
   */
  function lsGet(k, d) {
    try { const v = window.localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; }
  }
  /**
   * 写入 localStorage（原始值经 String(v) 转字符串；异常被 swallow 静默返回 false）。
   * 注意：不做 JSON.stringify，对象会成 "[object Object]"（如需结构化存储请调用方自行 JSON.stringify）。
   * @param {string} k - 键名
   * @param {*} v - 待写入值
   */
  function lsSet(k, v) {
    try { window.localStorage.setItem(k, String(v)); return true; } catch (e) { return false; }
  }
  /**
   * 轻提示：经事件总线 emit('ui:toast') 触发面板/toast 组件展示；未注入核心时降级为 console。
   * @param {string} msg - 提示文本
   * @param {number} [ms] - 展示时长毫秒（具体由 toast 组件决定）
   */
  function toast(msg, ms) {
    try {
      // 静默模式（关闭脚本弹窗）：仅进洞察页提示流，不悬浮
      if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.isQuietPopups === 'function' && window.__CX_FORCE_PLAY.isQuietPopups()) {
        if (window.Store && window.Store.emit) window.Store.emit('ui:toast', msg);
        return;
      }
      const d = document.createElement('div');
      d.textContent = msg;
      d.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;max-width:320px;' +
        'background:rgba(20,22,28,.92);color:#fff;font:12px/1.5 sans-serif;padding:8px 12px;border-radius:8px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.35);opacity:0;transition:opacity .2s;pointer-events:none;';
      (document.body || document.documentElement).appendChild(d);
      requestAnimationFrame(function () { d.style.opacity = '1'; });
      setTimeout(function () { d.style.opacity = '0'; setTimeout(function () { try { d.remove(); } catch (_) {} }, 220); }, ms || 2200);
    } catch (e) {}
  }
  /**
   * 轻量 DOM 构建助手（审查整改 #2：运行时动态内容走 DOM 而非 innerHTML 拼接，杜绝 XSS）。
   * @param {string} tag - 标签名
   * @param {Object} [attrs] - 属性/样式/事件：{class, style(字符串或对象), text, onXxx(函数), 其余走 setAttribute}
   * @param {Node|string|number|Array} [children] - 子节点（文本自动 createTextNode，节点直接 append）
   * @returns {Element}
   */
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!attrs.hasOwnProperty(k)) continue;
        var v = attrs[k];
        if (v == null) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k === 'style' && typeof v === 'object') { for (var sk in v) { if (v.hasOwnProperty(sk)) el.style[sk] = v[sk]; } }
        else if (k.length > 2 && k.indexOf('on') === 0 && typeof v === 'function') {
          var _evt = k.slice(2).toLowerCase();
          // 仅绑定真实事件属性，避免 only/once/onto 等被误判为事件
          if (('on' + _evt) in el) el.addEventListener(_evt, v);
          else el.setAttribute(k, v);
        }
        else el.setAttribute(k, v);
      }
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c == null) continue;
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode('' + c) : c);
      }
    }
    return el;
  }

  /**
   * 安全文本回填（审查整改 #2）：用 textContent 写入，杜绝 HTML 注入。
   * @param {Element} el - 目标元素
   * @param {*} text - 文本（非字符串转字符串；null/undefined 清空）
   */
  function setSafeText(el, text) { if (el) el.textContent = (text == null ? '' : '' + text); }

  try {
    if (!window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY = {};
    window.__CX_FORCE_PLAY.toolkit = {
      dbg: dbg, swallow: swallow, safeCall: safeCall, throttle: throttle, debounce: debounce,
      escapeHTML: escapeHTML, isTextEntry: isTextEntry, isTopFrame: isTopFrame,
      lsGet: lsGet, lsSet: lsSet, toast: toast,
      h: h, setSafeText: setSafeText,   // 评审#2：DOM 构建/安全文本回填助手
      recentErrors: recentErrors, errorCount: errorCount   // 评审#1：只读暴露被吞错误遥测(含 stack)，供诊断/测试 inspect
    };
  } catch (e) {}

  // 接管策略开关（forcePlayEnabled / cxVideoOptOut）已迁至 takeover/engine/policy.js（业务·策略域），本文件不再持有。
