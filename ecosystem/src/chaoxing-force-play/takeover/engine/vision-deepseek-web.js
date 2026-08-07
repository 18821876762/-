  // ===== DOMAIN: biz/vision-deepseek-web (站点无关·DeepSeek 网页版视觉后端) =====
  // ===== MODULE: rev3 视觉识别层的 "deepseek-web" 后端 —— 把题目截图交给已登录的 DeepSeek 网页版作答 =====
  // 用户方案（已确认）：同标签注入+轮询 DOM / 能传图 / 脚本内置提示词。
  // 本模块职责：
  //   ① 登录态探测：DeepSeek 页检测是否登录，跨标签页 BroadcastChannel 广播状态；课程页监听并渲染"可用/不可用"状态徽标。
  //   ② 跨页问答骨架：课程页把截图+提示词发给 DeepSeek 页 responder；responder 注入图片+提示词→发送→轮询回复完成→解析下标→回传。
  //      （responder 的 DOM 驱动选择器待真实站点校准，先留 TODO 骨架；用户要求"不登录就显示不可用状态"本模块已落地。）
  // 为什么做登录探测+状态：避免静默超时兜底，让用户一眼看清后端就绪与否。
  // TODO(校准)：DEEPSEEK 各选择器（登录按钮/头像/输入框/发送/回复/生成中）需在真实 DeepSeek 页用 DevTools 校准一次。
  var DEEPSEEK = {
    host: 'chat.deepseek.com',
    loginBtnSel: 'TODO',        // 未登录："登录"按钮（存在=未登录）
    avatarSel: 'TODO',          // 已登录：用户头像/账户菜单（存在=已登录）
    // 以下为 responder DOM 驱动（待真实站点校准，先 TODO）
    inputSel: 'TODO', fileInputSel: 'TODO', sendBtnSel: 'TODO',
    msgListSel: 'TODO', lastReplySel: 'TODO', generatingSel: 'TODO'
  };
  var DS_CHANNEL = 'cx-deepseek-vision';

  // ---- 跨页通道：优先 GM 存储中继（跨源可用），回退同源 BroadcastChannel ----
  // BroadcastChannel 同源隔离：课程页(chaoxing.com)与 DeepSeek 页(chat.deepseek.com)不同源，状态广播永远到不了，
  // 导致课程页 DS_STATUS 恒为未连接（症状："DeepSeek 已链接但页面没显示"）。改用脚本级 GM 存储——
  // 按脚本而非按源共享，GM_addValueChangeListener 的 remote=true 即来自其他标签页的变更，实现跨源跨标签页通信。
  // 若运行环境未授权 GM_*（@grant none），自动回退到 BroadcastChannel（仅同源可用）。
  var _GM = (typeof GM_setValue === 'function' && typeof GM_addValueChangeListener === 'function')
    ? { set: GM_setValue, on: GM_addValueChangeListener } : null;
  var DS_BRIDGE_KEY = 'cx_ds_bridge_v1';
  var _myTabId = 't' + Math.random().toString(36).slice(2);
  var _chanListeners = [];
  var _bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(DS_CHANNEL) : null;
  function _postChannel(msg) {
    msg = msg || {}; msg._from = _myTabId; msg._ts = Date.now();
    try { if (_GM) { _GM.set(DS_BRIDGE_KEY, JSON.stringify(msg)); return; } } catch (e) {}
    try { if (_bc) _bc.postMessage(msg); } catch (e2) {}
  }
  function _onChannel(cb) { if (cb) _chanListeners.push(cb); }
  function _offChannel(cb) { var i = _chanListeners.indexOf(cb); if (i >= 0) _chanListeners.splice(i, 1); }
  function _emitChannel(m) { if (!m || m._from === _myTabId) return; for (var i = 0; i < _chanListeners.length; i++) { try { _chanListeners[i](m); } catch (e) {} } }
  if (_GM) {
    try { _GM.on(DS_BRIDGE_KEY, function (name, oldV, newV, remote) { if (!remote) return; try { _emitChannel(JSON.parse(newV)); } catch (e) {} }); } catch (e) {}
  }
  if (_bc) { _bc.onmessage = function (e) { try { _emitChannel(e.data); } catch (e2) {} }; }

  // 跨页共享状态：课程页据此判断后端可用性并渲染徽标
  var DS_STATUS = { connected: false, loggedIn: null, ts: 0 };

  // 登录态探测（在 DeepSeek 页内执行）。
  // 校准前的真实 DOM 启发式：未登录特征=存在文本精确为“登录”/“Log in”的按钮或链接；已登录特征=存在可输入对话的输入框(textarea/contenteditable)。
  // 注意：不再扫描整页 innerText（已登录页其他位置可能含“登录”字样→误判未登录），也不再使用 'TODO' 占位选择器（会导致 querySelector 抛错走异常分支）。
  function _dsIsLoggedIn() {
    try {
      if (typeof document === 'undefined' || !document.body) return undefined;
      // 1) 校准后的选择器优先（'TODO' 占位视为未校准，跳过，避免 querySelector 抛错）
      if (DEEPSEEK.avatarSel && DEEPSEEK.avatarSel !== 'TODO' && document.querySelector(DEEPSEEK.avatarSel)) return true;
      if (DEEPSEEK.loginBtnSel && DEEPSEEK.loginBtnSel !== 'TODO' && document.querySelector(DEEPSEEK.loginBtnSel)) return false;
      // 2) 未登录特征：精确匹配“登录”按钮/链接（避免整页文本误判；用精确匹配以避开“退出登录”等反向字样）
      var loginNodes = document.querySelectorAll('button, a');
      for (var i = 0; i < loginNodes.length; i++) {
        var lt = (loginNodes[i].getAttribute('aria-label') || loginNodes[i].textContent || '').trim().toLowerCase();
        if (lt === '登录' || lt === 'log in' || lt === 'sign in' || lt === '登录 deepseek' || lt === '登录以继续' || lt === '登录/注册') return false;
      }
      // 3) 已登录特征：存在可输入的对话输入框
      if (document.querySelector('textarea, [contenteditable="true"], div[role="textbox"]')) return true;
      // 4) 无法判定：返回 undefined（状态未知），由面板/徽标显示“状态未知”而非误报未登录
      return undefined;
    } catch (e) { swallow(e); }
    return undefined;
  }

  // 课程页可用性：已连接且已登录才可用
  function dsAvailable() { return !!DS_STATUS.connected && DS_STATUS.loggedIn === true; }

  // 渲染状态徽标（课程页左下角固定小条），并同步给面板事件总线
  function _dsRenderStatus() {
    try {
      if (typeof document === 'undefined' || !document.body) return;
      var el = document.getElementById('cx-ds-status');
      // 静默模式（关闭脚本弹窗）：不显示悬浮状态条（状态仍在控制面板 DS 控制台内反映）
      if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.isQuietPopups === 'function' && window.__CX_FORCE_PLAY.isQuietPopups()) {
        if (el) el.style.display = 'none';
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.id = 'cx-ds-status';
        el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483646;padding:4px 8px;border-radius:6px;font:12px/1.4 sans-serif;background:rgba(0,0,0,.78);color:#fff;pointer-events:none;max-width:70vw;';
        document.body.appendChild(el);
      }
      var txt, color;
      if (!DS_STATUS.connected) { txt = 'DeepSeek 视觉后端：未连接（不可用）'; color = '#e74c3c'; }
      else if (DS_STATUS.loggedIn === false) { txt = 'DeepSeek 视觉后端：未登录（不可用）'; color = '#e74c3c'; }
      else if (DS_STATUS.loggedIn === true) { txt = 'DeepSeek 视觉后端：已登录（可用）'; color = '#2ecc71'; }
      else { txt = 'DeepSeek 视觉后端：状态未知'; color = '#f39c12'; }
      el.textContent = txt; el.style.color = color;
      try { if (typeof Store !== 'undefined' && Store.emit) Store.emit('ui:status', { deepseek: txt }); } catch (e) {}
    } catch (e) { swallow(e); }
  }

  // ---- 课程页侧：监听 DeepSeek 状态 + 心跳超时判定 ----
  function _dsInitCourseSide() {
    try {
      _onChannel(function (m) {
        try {
          if (m && m.type === 'ds-state') {
            DS_STATUS.connected = true; DS_STATUS.loggedIn = m.loggedIn; DS_STATUS.ts = m.ts || Date.now();
            _dsRenderStatus();
          }
        } catch (e2) { swallow(e2); }
      });
      _postChannel({ type: 'ds-ping' });
      setInterval(function () {
        if (DS_STATUS.connected && Date.now() - DS_STATUS.ts > 12000) { DS_STATUS.connected = false; _dsRenderStatus(); }
      }, 4000);
      _dsRenderStatus();
    } catch (e) { swallow(e); }
  }

  // ---- DeepSeek 页侧：广播登录态（含心跳 + 响应 ping）----
  function _dsBroadcastState() {
    try {
      // 通过跨页通道广播登录态（GM 中继跨源可用 / BroadcastChannel 仅同源）
      var send = function () { try { _postChannel({ type: 'ds-state', loggedIn: _dsIsLoggedIn(), ts: Date.now() }); } catch (e) {} };
      send();
      setInterval(send, 5000);
      _onChannel(function (m) { try { if (m && m.type === 'ds-ping') send(); } catch (e2) {} });
    } catch (e) { swallow(e); }
  }

  // ---- DeepSeek 页侧 responder：收到答题请求 → 检查登录 → (TODO) 驱动 DOM 作答 → 回传 ----
  function _dsInitResponder() {
    try {
      _onChannel(function (e) {
        try {
          var m = e;
          if (!m || m.type !== 'ds-ask') return;
          var reply = { type: 'ds-answer', reqId: m.reqId };
          // 应答端开关闸门：面板「允许本页作为应答端」关闭后，直接回 not-available，课程页随机兜底
          if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DS_RESPONDER_ENABLED === false) {
            reply.error = 'responder-disabled';
            _postChannel(reply);
            return;
          }
          if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_LAST_ASK = Date.now();   // 供应答端控制台显示最近请求
          var _li = _dsIsLoggedIn();
          if (_li === false) { reply.error = 'not-logged-in'; _postChannel(reply); return; }   // 明确未登录
          if (_li === undefined) { reply.error = 'login-unknown'; _postChannel(reply); return; }  // 登录态未知（DOM 未识别），如实上报而非误判未登录
          // TODO(待真实站点校准选择器后实现)：注入图片+提示词→发送→轮询回复→解析下标
          // 当前仅占位：返回 null → 课程页随机兜底；并提示尚未实现驱动逻辑
          reply.text = null; reply.answer = null; reply.notImplemented = true;
          if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_LAST_ANSWER = '(尚未实现自动作答，待站点校准)';
          _postChannel(reply);
        } catch (e2) { swallow(e2); }
      });
    } catch (e) { swallow(e); }
  }

  // 课程页侧：把截图交给 DeepSeek 页作答，返回 Promise<{text, answer}>（超时走 reject → quiz.js 随机兜底）
  function quizAskDeepSeek(dataUrl, opts) {
    return new Promise(function (resolve, reject) {
      try {
        var reqId = 'r' + Date.now() + Math.random().toString(36).slice(2);
        var done = false;
        var to = setTimeout(function () {
          if (!done) { done = true; _offChannel(listener); reject(new Error('deepseek timeout')); }
        }, (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_TIMEOUT) || 60000);
        var listener = function (e) {
          var m = e;
          if (m && m.type === 'ds-answer' && m.reqId === reqId) {
            done = true; clearTimeout(to); _offChannel(listener);
            if (m.error) reject(new Error(m.error));
            else resolve({ text: m.text != null ? m.text : null, answer: m.answer != null ? m.answer : null });
          }
        };
        _onChannel(listener);
        _postChannel({ type: 'ds-ask', reqId: reqId, image: dataUrl, options: opts || [] });
      } catch (e) { reject(e); }
    });
  }

  // 自初始化：按所在域名决定角色（DeepSeek 页承载 responder+广播；其余页监听状态）
  // 跨窗口幂等锁：超星播放器常在 iframe 内，顶层窗口与播放器 iframe 都会跑本脚本；若各自初始化 DS 角色，
  // 会重复注册监听/心跳 → 状态/提示出现两份。用 window.top 共享标志确保全页只初始化一份；
  // 跨域 iframe 取不到 top 标志时回退为各帧独立（仍保留同帧守卫），避免抛错。
  try {
    var _dsTopDoc = window;
    try { if (window.top && window.top !== window && window.top.document) _dsTopDoc = window.top; } catch (e) { _dsTopDoc = window; }
    // 收敛进命名空间：跨 frame 共用 window.__CX_FORCE_PLAY 同一对象（沙箱 window 代理共享真实 window 属性），去掉 top/iframe 双写。
    var _dsNs = function () { try { return (window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {}); } catch (e) { return (window.__CX_FORCE_PLAY = {}); } };
    var _dsLockOwner = function () { try { return !!_dsNs().dsRoleInited; } catch (e) { return false; } };
    var _dsSetLock = function () { try { _dsNs().dsRoleInited = true; } catch (e) {} };
    if (!_dsLockOwner()) {
      _dsSetLock();
      if (typeof location !== 'undefined' && location.host && new RegExp(DEEPSEEK.host + '$').test(location.host)) {
        _dsBroadcastState();
        _dsInitResponder();
      } else {
        _dsInitCourseSide();
      }
    }
  } catch (e) { swallow(e); }

  try {
    window.__CX_FORCE_PLAY.dsAvailable = dsAvailable;
    window.__CX_FORCE_PLAY._dsIsLoggedIn = _dsIsLoggedIn;
    window.__CX_FORCE_PLAY._dsRenderStatus = _dsRenderStatus;
    window.__CX_FORCE_PLAY.quizAskDeepSeek = quizAskDeepSeek;
    window.__CX_FORCE_PLAY.DS_STATUS = DS_STATUS;
    window.__CX_FORCE_PLAY.DEEPSEEK = DEEPSEEK;
  } catch (e) {}
