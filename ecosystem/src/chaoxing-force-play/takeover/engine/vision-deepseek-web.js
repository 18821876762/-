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
    // 以下为 responder DOM 驱动（用户已用 DevTools 校准输入框选择器，其余 best-effort 待校准）
    inputSel: 'textarea[placeholder^="给 DeepSeek 发送消息"]', fileInputSel: 'TODO', sendBtnSel: 'TODO',
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

  // ---- DeepSeek 页侧 responder：收到答题请求 → 检查登录 → 驱动 DOM 作答 → 回传 ----
  // 校准后的 DOM 驱动（选择器在真实 DeepSeek 页用 DevTools 校准；用户已提供输入框选择器）：
  //   输入框：textarea[placeholder^="给 DeepSeek 发送消息"]（或其容器 textarea，统一用 [contenteditable] 与 textarea 兜底）
  //   发送按钮：底部发送按钮（button，aria-label 含"发送"/"send"，或存在 svg 的最后一个主按钮）—— best-effort 待校准
  //   回复气泡：对话区消息容器（[role="list"]/聊天容器）末尾最后一条 AI 回复，且非用户输入
  //   生成中：回复气泡内出现"正在生成…/DeepSeek 正在思考"等占位或 loading 转圈 → 轮询等待消失
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
          // DOM 驱动作答：注入题目图(若提供) + 提示词 → 发送 → 轮询回复完成 → 解析答案下标回传
          _dsRespond(m, function (ans) {
            if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.DS_LAST_ANSWER = ans ? (ans.text || ans.answer || '已作答') : '未获取到回复';
            _postChannel(ans || { type: 'ds-answer', reqId: m.reqId, error: 'no-answer' });
          });
        } catch (e2) { swallow(e2); }
      });
    } catch (e) { swallow(e); }
  }

  // 向 DeepSeek 输入框注入内容并发送，轮询获取回复文本。
  // dataUrl 为题目截图(可选)，promptText 为提示词/选项文本。
  function _dsRespond(m, done) {
    try {
      var promptText = (m && m.prompt) || (m && m.options && m.options.join('\n')) || '请根据题目作答';
      // 1) 定位输入框：优先校准选择器，回退通用 textarea/contenteditable
      var DEEPSEEK = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var inputSel = (DEEPSEEK && DEEPSEEK.inputSel && DEEPSEEK.inputSel !== 'TODO') ? DEEPSEEK.inputSel : 'textarea[placeholder^="给 DeepSeek 发送消息"], textarea, [contenteditable="true"]';
      var ta = null;
      try { ta = document.querySelector(inputSel); } catch (e) {}
      if (!ta) { done({ type: 'ds-answer', reqId: m.reqId, error: 'no-input' }); return; }

      // 2) 记录发送前消息条数（用于识别新回复）
      var _countBefore = _dsCountMessages();

      // 3) 注入文字：对 textarea 用原生 value + input 事件（React 受控），对 contenteditable 用 execCommand/textContent
      var ok = false;
      try {
        if (ta.tagName === 'TEXTAREA') {
          var proto = Object.getPrototypeOf(ta);
          var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          setter.call(ta, promptText);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ok = true;
        } else {
          ta.focus();
          ta.textContent = promptText;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ok = true;
        }
      } catch (e) { swallow(e); }
      if (!ok) { done({ type: 'ds-answer', reqId: m.reqId, error: 'inject-failed' }); return; }

      // 4) 注入图片（若提供 dataUrl）：DeepSeek 支持粘贴图片到输入框 → 触发 paste 事件构造 File
      if (m && m.image) {
        try {
          _dsPasteImage(ta, m.image);
        } catch (e) { swallow(e); }   // 图片注入失败不阻断文字作答
      }

      // 5) 点击发送按钮：优先校准选择器，回退"输入框附近/底部含发送语义的 button"
      var sendSel = (DEEPSEEK && DEEPSEEK.sendBtnSel && DEEPSEEK.sendBtnSel !== 'TODO') ? DEEPSEEK.sendBtnSel : 'button[aria-label*="发送"], button[aria-label*="send"], button:last-of-type';
      var sent = false;
      try {
        var sb = document.querySelector(sendSel);
        // 校准选择器未命中时，回退：输入框最近祖先容器内最后一个可点 button
        if (!sb) {
          var box = ta.closest('form') || ta.parentElement;
          var btns = box ? box.querySelectorAll('button') : [];
          for (var i = btns.length - 1; i >= 0; i--) { if (!btns[i].disabled) { sb = btns[i]; break; } }
        }
        if (sb) { sb.click(); sent = true; }
      } catch (e) { swallow(e); }
      if (!sent) { done({ type: 'ds-answer', reqId: m.reqId, error: 'no-send-btn' }); return; }

      // 6) 轮询：等待新回复出现且"生成中"结束，最多 ~90s
      var deadline = Date.now() + 90000;
      var poll = function () {
        try {
          if (Date.now() > deadline) { done({ type: 'ds-answer', reqId: m.reqId, error: 'timeout-wait-reply' }); return; }
          var txt = _dsLatestReply(_countBefore);
          if (txt === '__GENERATING__') { setTimeout(poll, 800); return; }   // 仍在生成，继续等
          if (txt) {
            // 解析答案：尝试提取选项下标 A/B/C/D 或 1)2)3)4)
            var ans = _dsParseAnswer(txt);
            done({ type: 'ds-answer', reqId: m.reqId, text: txt, answer: ans });
            return;
          }
          setTimeout(poll, 800);
        } catch (e) { swallow(e); setTimeout(poll, 800); }
      };
      setTimeout(poll, 1200);   // 先等发送生效
    } catch (e) { swallow(e); done && done({ type: 'ds-answer', reqId: m.reqId, error: 'respond-exception' }); }
  }

  // 统计当前对话消息条数（best-effort：聊天容器内的消息元素）
  function _dsCountMessages() {
    try {
      var DEEPSEEK = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var sel = (DEEPSEEK && DEEPSEEK.msgListSel && DEEPSEEK.msgListSel !== 'TODO') ? DEEPSEEK.msgListSel : '[role="list"], .chat-messages, .ds-chat-messages, main [class*="message"], [class*="conversation"]';
      var box = document.querySelector(sel);
      if (!box) return 0;
      return box.querySelectorAll('[class*="message"], [data-message-id], [role="listitem"], > div > div').length;
    } catch (e) { return 0; }
  }

  // 获取最新一条 AI 回复文本；仍在生成返回 '__GENERATING__'，无新回复返回 ''
  function _dsLatestReply(countBefore) {
    try {
      var DEEPSEEK = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var sel = (DEEPSEEK && DEEPSEEK.lastReplySel && DEEPSEEK.lastReplySel !== 'TODO') ? DEEPSEEK.lastReplySel : '[role="list"], .chat-messages, .ds-chat-messages, main [class*="message"], [class*="conversation"]';
      var box = document.querySelector(sel);
      if (!box) return '';
      var nodes = box.querySelectorAll('[class*="message"], [data-message-id], [role="listitem"], > div > div');
      if (nodes.length <= countBefore) return '';   // 尚无新回复
      var last = nodes[nodes.length - 1];
      var t = (last.textContent || '').trim();
      // 生成中检测：占位文本或 loading 转圈
      var genSel = (DEEPSEEK && DEEPSEEK.generatingSel && DEEPSEEK.generatingSel !== 'TODO') ? DEEPSEEK.generatingSel : '[class*="loading"], [class*="spinner"], [class*="thinking"], [class*="generating"]';
      if (last.querySelector(genSel)) return '__GENERATING__';
      if (/正在生成|正在思考|正在输入|DeepSeek 正在思考|生成中|Thinking/i.test(t)) return '__GENERATING__';
      return t || '';
    } catch (e) { return ''; }
  }

  // 把题目截图(URL)作为图片注入。优先走 file input 上传（DeepSeek 真实是附件/图片上传，
  // textarea 不吃 paste 图片）；fileInputSel 未校准时回退到 paste 事件（best-effort）。
  function _dsPasteImage(ta, dataUrl) {
    try {
      var fetchImg = function (cb) {
        try {
          var img = new Image();
          img.onload = function () { try { var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); c.toBlob(function (b) { cb(b); }, 'image/png'); } catch (e) { cb(null); } };
          img.onerror = function () { cb(null); };
          img.src = dataUrl;
        } catch (e) { cb(null); }
      };
      fetchImg(function (blob) {
        if (!blob) return;
        try {
          var file = new File([blob], 'question.png', { type: 'image/png' });
          // 主路径：file input 上传（querySelector 命中上传控件后赋值 + dispatch input/change）
          var fi = null;
          if (DEEPSEEK && DEEPSEEK.fileInputSel && DEEPSEEK.fileInputSel !== 'TODO') {
            try { fi = document.querySelector(DEEPSEEK.fileInputSel); } catch (e) { fi = null; }
          }
          if (!fi) { try { fi = document.querySelector('input[type=file]'); } catch (e) { fi = null; } }
          if (fi) {
            try {
              var dt = new DataTransfer();
              dt.items.add(file);
              try { fi.files = dt.files; } catch (e) { /* 只读 files 时回退 dispatch */ }
              fi.dispatchEvent(new Event('input', { bubbles: true }));
              fi.dispatchEvent(new Event('change', { bubbles: true }));
              return;
            } catch (e) { swallow(e); }
          }
          // 回退：paste 事件（多数 textarea 不吃图片，仅作 best-effort）
          var dt2 = new DataTransfer();
          dt2.items.add(file);
          var ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt2 });
          ta.dispatchEvent(ev);
        } catch (e) { swallow(e); }
      });
    } catch (e) { swallow(e); }
  }

  // 从回复文本解析选项下标（A/B/C/D）。优先"答案：X"强模式，避免把"选项有 A、B、C、D"误命中。
  function _dsParseAnswer(text) {
    try {
      if (!text) return null;
      // 强模式：显式答案标注（如 "答案：B" / "选择 C" / "答案为 A"）
      var m3 = text.match(/(?:答案|正确选项|应选|选择|选)[：:\s为]*([A-D])/i);
      if (m3) return m3[1];
      // 弱模式：孤立大写字母（仅在无强模式时启用，且排除连续选项列举）
      var m1 = text.match(/(?:^|[\s，。、])([A-D])(?:[\s，。、]|$)/);
      if (m1) {
        // 若同一句出现多个 A-D 并列（如 "A. B. C. D."），视为列举，不采信
        var listed = (text.match(/[A-D][)．.、]|\b[A-D]\s*[A-D]\b/g) || []).length;
        if (listed <= 1) return m1[1];
      }
      var m2 = text.match(/(\d)[)．.]/);
      if (m2) return m2[1];
      return null;
    } catch (e) { return null; }
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
      if (typeof location !== 'undefined' && location.host && (location.host === DEEPSEEK.host || location.host.endsWith('.' + DEEPSEEK.host))) {
        _dsBroadcastState();
        _dsInitResponder();
      } else {
        _dsInitCourseSide();
      }
    }
  } catch (e) { swallow(e); }

  try {
    // 暴露为全局（window.dsAvailable），因为 zhihuishu-exam / quiz / zhihuishu-fab 等模块以裸标识符 dsAvailable() 引用本函数；
    // 仅挂到命名空间会导致裸引用恒为 undefined、DeepSeek 闸门永远打不开（真机失效）。命名空间副本保留以便显式访问。
    window.dsAvailable = dsAvailable;
    window._dsIsLoggedIn = _dsIsLoggedIn;
    window.__CX_FORCE_PLAY.dsAvailable = dsAvailable;
    window.__CX_FORCE_PLAY._dsIsLoggedIn = _dsIsLoggedIn;
    window.__CX_FORCE_PLAY._dsRenderStatus = _dsRenderStatus;
    window.__CX_FORCE_PLAY.quizAskDeepSeek = quizAskDeepSeek;
    window.__CX_FORCE_PLAY.DS_STATUS = DS_STATUS;
    window.__CX_FORCE_PLAY.DEEPSEEK = DEEPSEEK;
  } catch (e) {}
