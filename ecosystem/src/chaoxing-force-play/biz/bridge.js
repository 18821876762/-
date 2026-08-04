  // ===== DOMAIN: biz/bridge (local crawler bridge client) =====
  // ===== MODULE: 本地桥客户端 =====
  // 域：核心业务模块 —— 本地桥客户端，对接爬虫端清单。
  // ===== 本地桥（cx_crawler/bridge.py）：读取爬虫权威清单 =====
  // 作用：① 当前章 completed 且无未完成任务点 → 本脚本整体避让（不覆盖 pause、不强制续播），
  //         避免重进已完成章节被重新续播；
  //      ② 当前章 objectids（爬虫 RENDER_JOBS=True 渲染产物）→ 预填定向白名单，
  //         早于 siteAttachments() 渲染就绪，定向更快更稳。
  // 桥服务不在线 / 无清单 / URL 缺参时静默回退原有行为（零新增依赖）。
  // 127.0.0.1 属 potentially-trustworthy origin，https 页面可直接 fetch，无混合内容拦截。
  // 【易误判·诊断#一】曾有审查误判 http://127.0.0.1 在 https 页会被混合内容拦截——错：回环地址依 Secure Contexts 规范豁免混合内容；
  //   且 https base 已可经 ?cxbridge= / localStorage.cx_bridge_base 配置，无需改代码。桥在生产环境可用。
  // 端口可配置化（v3.14）：桥地址优先级 = URL ?cxbridge= > localStorage.cx_bridge_base > 默认 127.0.0.1:7531；
  // 默认/指定地址不通时，自动探测候选端口挑首个可达者（与 bridge.py 启动端口对齐即可免手动配置）。
  // 【内聚性收敛】原本地桥逻辑与白名单业务、URL 解析同处 biz/targeting.js；现桥客户端独立成模块，
  //   白名单回归 biz/targeting.js、URL 解析归入 utils/url.js，三者单一职责、互不夹带。
  var BRIDGE = {
    base: null,         // 运行时解析得到
    chapter: null,      // 当前章清单条目
    skipResume: false,  // true = 当前章已完成，禁用强制续播
    version: null       // 修复 M5：桥服务 /ping 回报的版本，供面板/诊断展示，便于发现过旧的桥
  };
  // 桥接探测端口已集中到 CONST（元配置集中层）
  function resolveBridgeBase() {
    try {
      var q = (window.location.search.match(/[?&]cxbridge=([^&]+)/i) || [])[1];
      if (q) {
        if (/^https?:\/\//i.test(q)) return q.replace(/\/+$/, '');
        if (/^\d{1,5}$/.test(q)) return 'http://127.0.0.1:' + q;
        return 'http://' + q.replace(/\/+$/, '');   // host:port 形式
      }
      try { var ls = localStorage.getItem('cx_bridge_base'); if (ls) return String(ls).replace(/\/+$/, ''); } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
    return 'http://127.0.0.1:7531';   // 修复 #14：默认端口须与 cx_crawler/config.py 的 BRIDGE_PORT 保持一致；改端口时两边同步修改
  }
  // 探测候选端口：依次 GET /ping，返回首个 200 的 base（无则 null）。结果写入 BRIDGE.base 缓存。
  function probeBridgeBase(cb) {
    var i = 0;
    function next() {
      if (i >= CONST.BRIDGE_PROBE_PORTS.length) { cb(null); return; }
      var port = CONST.BRIDGE_PROBE_PORTS[i++];
      var url = 'http://127.0.0.1:' + port + '/ping';
      try {
        var _ac = ('AbortController' in window) ? new AbortController() : null;
        var _t = _ac ? setTimeout(function () { try { _ac.abort(); } catch (e) { swallow(e); } }, CONST.BRIDGE_TIMEOUT_MS || 5000) : null;
        fetch(url, _ac ? { mode: 'cors', signal: _ac.signal } : { mode: 'cors' }).then(function (r) {
          if (_t) clearTimeout(_t);
          if (r && r.ok) {
            // 修复 M5：ping 回报含桥版本，缓存到 BRIDGE.version 供诊断展示（非阻塞，版本不一致仅提示）
            try { r.json().then(function (d) { if (d && d.version) BRIDGE.version = d.version; }).catch(function () {}); } catch (e) { swallow(e); }
            cb('http://127.0.0.1:' + port);
          } else next();
        }).catch(function () { next(); });
      } catch (e) { next(); }
    }
    next();
  }
  // skipResume 迟到时（fetch 异步），已被覆盖的 video 需恢复原生 pause + 清除续播标记，还用户暂停/播放能力。
  // F-B2 修复：仅恢复 v.pause 不够——原型/实例的 pause 中性化与 play 包装仍由 __cxForcePaused 控制，
  // 不清除该标志会导致用户既无法暂停（原型 noop 检查到 true）也无法播放（neutralVideoPlay 返回 noop）。
  function restoreNativePause(root) {
    if (!root || !root.getElementsByTagName) return;
    try {
      var vs = root.getElementsByTagName('video');
      for (var i = 0; i < vs.length; i++) { var v = vs[i]; try {
        if (v.__np) v.pause = v.__np;                            // 恢复实例级原生 pause（绕过原型 noop）
        v.__cxForcePaused = false;                               // F-B2：关闭原型 pause/play/playbackRate 的 noop 拦截
        cxState(v).released = true;                                   // F-B6：标记已释放，续播兜底监听不再自动续播
      } catch (e) { swallow(e); } }
    } catch (e) { swallow(e); }
    try {
      [].forEach.call(root.querySelectorAll('iframe'), function (f) {
        try { if (f.contentDocument) restoreNativePause(f.contentDocument); } catch (e) { swallow(e); }
      });
    } catch (e) { swallow(e); }
  }
  function bridgeFetch(cid, kid, base) {
    // 评审#7：严格 CSP(connect-src) 下 fetch 会同步抛异常（而非 promise reject）。
    // 本函数还会在 probe 回调（promise 链内）被调用，同步抛出会变成未处理 rejection，故就地兜住。
    var ac = ('AbortController' in window) ? new AbortController() : null;
    var timer = ac ? setTimeout(function () { try { ac.abort(); } catch (e) { swallow(e); } }, CONST.BRIDGE_TIMEOUT_MS || 5000) : null;  // 桥半死(建连不响应)时避免 promise 永久挂起泄漏
    var p;
    try { p = fetch(base + '/playlist/' + cid, ac ? { signal: ac.signal } : undefined); } catch (e) { if (timer) clearTimeout(timer); dbg('bridge：fetch 被环境拦截(CSP?)，跳过桥'); return; }
    p.then(function (r) { if (timer) clearTimeout(timer); return r.ok ? r.json() : null; })
      .catch(function () { if (timer) clearTimeout(timer); return null; })
      .then(function (d) {
        if (!ac) { /* 超时分支已在上面 catch 处理 */ }
        if (!d || !Array.isArray(d.chapters)) return;
        for (var i = 0; i < d.chapters.length; i++) {
          if (String(d.chapters[i].knowledgeId) === String(kid)) { BRIDGE.chapter = d.chapters[i]; break; }
        }
        var ch = BRIDGE.chapter;
        if (!ch) return;
        if (ch.completed && !(ch.unfinishedCount > 0)) {
          BRIDGE.skipResume = true;
          try { restoreNativePause(document); } catch (e) { swallow(e); }
          dbg('bridge：当前章已完成，禁用强制续播并恢复原生 pause');
        }
        try { refreshTargets(); } catch (e) { swallow(e); }   // 桥异步到达后即时用 objectids 撑起白名单（#1）
        dbg('bridge：清单命中当前章', ch.title || kid);
      })
      .catch(function () {});                    // 桥不在线：静默回退
  }
  // 桥(bridge.py)为可选组件：绝大多数用户不跑它，默认关闭桥探测，避免在控制台刷一堆
  // ERR_CONNECTION_REFUSED 噪声（浏览器会记录每一次对死端口的失败 fetch）。
  // 启用桥的两种方式（任一即可）：
  //   ① URL 带 ?cxbridge=端口/地址（本就支持的参数，指向你的桥）；
  //   ② localStorage 设 cx_bridge_on=1（手动开启）。
  // 强制关闭：localStorage 设 cx_bridge_off=1 优先于以上。
  function bridgeEnabledByConfig() {
    try {
      if (localStorage.getItem('cx_bridge_off') === '1') return false;       // 显式关闭优先
      if (/[?&]cxbridge=([^&]+)/i.test(window.location.search)) return true;  // URL 显式指定桥地址
      if (localStorage.getItem('cx_bridge_on') === '1') return true;         // 手动开启
    } catch (e) { swallow(e); }
    return false;                                                            // 默认关闭
  }
  function bridgeInit() {
    if (!bridgeEnabledByConfig()) {
      dbg('bridge：未启用（默认关闭，避免无桥时控制台刷红字）。如需启用桥：URL 加 ?cxbridge=端口，或 localStorage 设 cx_bridge_on=1');
      return;
    }
    try {
      var href = topHref();
      var cid = urlParam(href, ['courseId']);
      var kid = urlParam(href, ['chapterId', 'knowledgeId']);
      if (!cid || !kid) return;                    // 非播放页（无课程/章节参数）不拉桥
      var base = BRIDGE.base || resolveBridgeBase();
      BRIDGE.base = base;
      bridgeFetch(cid, kid, base);
      // 默认/指定地址不通 → 自动探测候选端口；命中后缓存 base 并重新拉取（v3.14 端口可配置化）
      try {
        var _ac2 = ('AbortController' in window) ? new AbortController() : null;
        var _t2 = _ac2 ? setTimeout(function () { try { _ac2.abort(); } catch (e) { swallow(e); } }, CONST.BRIDGE_TIMEOUT_MS || 5000) : null;
        fetch(base + '/ping', _ac2 ? { mode: 'cors', signal: _ac2.signal } : { mode: 'cors' }).then(function (r) {
          if (_t2) clearTimeout(_t2);
          if (r && r.ok) {
            // 修复 M5：默认地址可达，记录桥版本（非阻塞）
            try { r.json().then(function (d) { if (d && d.version) BRIDGE.version = d.version; }).catch(function () {}); } catch (e) { swallow(e); }
          } else {
            probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } });
          }
        }).catch(function () { if (_t2) clearTimeout(_t2); probeBridgeBase(function (okBase) { if (okBase) { BRIDGE.base = okBase; bridgeFetch(cid, kid, okBase); } }); });
      } catch (e) { swallow(e); }
    } catch (e) { swallow(e); }
  }
