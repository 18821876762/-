// @provides: dsAvailable
// @requires: DS_STATUS, EventBus, _dsLoop, _onChannel, _postChannel, bestEffort, safeGet
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：登录探测、课程侧状态与心跳；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 登录态探测（在 DeepSeek 页内执行）。
  // 校准前的真实 DOM 启发式：未登录特征=存在文本精确为"登录"/"Log in"的按钮或链接；已登录特征=存在可输入对话的输入框(textarea/contenteditable)。
  // 注意：不再扫描整页 innerText（已登录页其他位置可能含"登录"字样→误判未登录），也不再使用 'TODO' 占位选择器（会导致 querySelector 抛错走异常分支）。
  function _dsIsLoggedIn() {
    return safeGet(function () {
      if (typeof document === 'undefined' || !document.body) return undefined;
      if (DEEPSEEK.avatarSel && DEEPSEEK.avatarSel !== 'TODO' && document.querySelector(DEEPSEEK.avatarSel)) return true;
      if (DEEPSEEK.loginBtnSel && DEEPSEEK.loginBtnSel !== 'TODO' && document.querySelector(DEEPSEEK.loginBtnSel)) return false;
      var loginNodes = document.querySelectorAll('button, a');
      for (var i = 0; i < loginNodes.length; i++) {
        var lt = (loginNodes[i].getAttribute('aria-label') || loginNodes[i].textContent || '').trim().toLowerCase();
        if (lt === '登录' || lt === 'log in' || lt === 'sign in' || lt === '登录 deepseek' || lt === '登录以继续' || lt === '登录/注册') return false;
      }
      if (document.querySelector('textarea, [contenteditable="true"], div[role="textbox"]')) return true;
      return undefined;
    }, undefined);
  }

  // 课程页可用性：已连接且已登录才可用
  // 修复②·同源顶层回读：子帧（学习通作业 iframe）自身无通道、DS_STATUS 恒未连接 → 直接回读顶层
  // （面板挂载处、有通道）的 DS_STATUS；跨源不可达时 safeGet 兜底回退本地状态。
  function dsAvailable() {
    if (!DS_STATUS.connected) {
      var _t = safeGet(function () {
        if (typeof window === 'undefined' || !window.top || window.top === window) return null;
        var _tn = window.top.__CX_FORCE_PLAY;
        return (_tn && _tn.DS_STATUS) ? _tn.DS_STATUS : null;
      }, null);
      if (_t && _t.connected) return _t.connected && _t.loggedIn === true && !_t.hidden;
    }
    return !!DS_STATUS.connected && DS_STATUS.loggedIn === true && !DS_STATUS.hidden;
  }

  // 渲染状态徽标（课程页左下角固定小条），并同步给面板事件总线
  function _dsRenderStatus() {
    bestEffort(function () {
      if (typeof document === 'undefined' || !document.body) return;
      var el = document.getElementById('cx-ds-status');
      // 安静模式（工具库「关闭脚本弹窗」）：彻底不展示状态条
      if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.isQuietPopups === 'function' && window.__CX_FORCE_PLAY.isQuietPopups()) {
        if (el) el.style.display = 'none';
        return;
      }
      // 仅在 DeepSeek 实际可达（已连接）时才展示状态条。
      // 未连接时不显示"不可用"噪声——课程页跨域本就收不到登录态、dsAvailable 恒 false，
      // 且用户未开启任何答题开关时不应出现 DeepSeek 弹窗（可用状态已在面板诊断区展示）。
      if (!DS_STATUS.connected) { if (el) el.style.display = 'none'; return; }
      if (!el) {
        el = document.createElement('div');
        el.id = 'cx-ds-status';
        el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483646;padding:4px 8px;border-radius:6px;font:12px/1.4 sans-serif;background:rgba(0,0,0,.78);color:#fff;pointer-events:none;max-width:70vw;';
        document.body.appendChild(el);
      }
      el.style.display = '';
      var txt, color;
      if (DS_STATUS.loggedIn === false) { txt = 'DeepSeek 视觉后端：未登录（不可用）'; color = '#e74c3c'; }
      else if (DS_STATUS.loggedIn === true) { txt = 'DeepSeek 视觉后端：已登录（可用）'; color = '#2ecc71'; }
      else { txt = 'DeepSeek 视觉后端：状态未知'; color = '#f39c12'; }
      el.textContent = txt; el.style.color = color;
      bestEffort(function () { if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('ui:status', { deepseek: txt }); }, 'ds.renderStatus.event');
    }, 'ds.renderStatus');
  }

  // ---- 课程页侧：监听 DeepSeek 状态 + 心跳超时判定 ----
  function _dsInitCourseSide() {
    bestEffort(function () {
      // 幂等性修复(审查 S-2)：课程侧角色只在「有跨页通道的帧」初始化。旧实现每个匹配 iframe 都执行本函数——
      // 无通道的帧（非顶层、非 deepseek 站的同源 iframe）注册一个永远收不到消息的监听 + 空转 _postChannel，
      // 并各起一个每 4s 空转的心跳定时器（多帧页面 N 份冗余，与 main-loop 顶层帧编排的收敛意图相悖）。
      if (!_dsNeedChannel) return;
      _onChannel(function (m) {
        bestEffort(function () {
          if (m && m.type === 'ds-state') {
            DS_STATUS.connected = true; DS_STATUS.loggedIn = m.loggedIn; DS_STATUS.ts = m.ts || Date.now();
            if (m.loop) DS_STATUS.loop = m.loop;   // v4.19.37：应答端循环快照随心跳落课程页
            _dsRenderStatus();
          }
        }, 'ds.courseSide.channel');
      });
      _postChannel({ type: 'ds-ping' });
      _dsCourseTimer = window.__CX_FORCE_PLAY.TimerRegistry.setInterval(function () {
        // v4.19.48：看门狗从 25s 放宽到 120s——实测 DS 页后台时被浏览器重度节流，5s 心跳被拉到 ~28s+，
        // 旧 25s 阈值会误判「连接断开」→ DS_STATUS.connected 翻转 → dsAvailable() 假阴性、诊断恒显「连=否」。
        // 真实断开仍由 quiz.js 的 ask 超时自身报错(reject)兜底；看门狗只防心跳键彻底消失的极端情形。
        if (DS_STATUS.connected && Date.now() - DS_STATUS.ts > 120000) { DS_STATUS.connected = false; _dsRenderStatus(); }
      }, 4000, 'deepseek');
      _dsRenderStatus();
    }, 'ds.courseSide');
  }

  // ---- DeepSeek 页侧：广播登录态（含心跳 + 响应 ping）----
  function _dsBroadcastState() {
    bestEffort(function () {
      // v4.19.37：应答端循环快照随心跳广播——课程页 DS_STATUS.loop 由此获得「应答端收/回/看门狗/去重/队列丢弃」闭环可见
      var send = function () { bestEffort(function () {
        // v4.19.48：应答端自身须维护 DS_STATUS——本页即后端连接端点，旧实现只对外广播、从不置自身 connected/loggedIn/ts，
        // 致本页诊断恒显「连=否 · 登录=? · 心跳=无」、dsAvailable() 恒 false。现自认已连接并刷新登录态/心跳时间戳/可见性。
        DS_STATUS.connected = true;
        DS_STATUS.loggedIn = _dsIsLoggedIn();
        DS_STATUS.ts = Date.now();
        DS_STATUS.hidden = (document.visibilityState === 'hidden');
        _postChannel({ type: 'ds-state', loggedIn: DS_STATUS.loggedIn, ts: DS_STATUS.ts, hidden: DS_STATUS.hidden,
          loop: { received: _dsLoop.received, sent: _dsLoop.sent, watchdog: _dsLoop.watchdog, dedupe: _dsLoop.dedupe, qdrop: _dsLoop.qdrop, lastAskAt: _dsLoop.lastAskAt, lastAnswerAt: _dsLoop.lastAnswerAt, lastErr: _dsLoop.lastErr } });
      }, 'ds.broadcast.send'); };
      send();
      _dsBroadcastTimer = window.__CX_FORCE_PLAY.TimerRegistry.setInterval(send, 5000, 'deepseek');
      // v4.19.48：标签页显隐切换时立即重广播，使前台化/后台化在 ≤1 个心跳周期内被课程页感知
      bestEffort(function () { document.addEventListener('visibilitychange', send); }, 'ds.broadcast.visibility');
      _onChannel(function (m) { bestEffort(function () { if (m && m.type === 'ds-ping') send(); }, 'ds.broadcast.ping'); });
    }, 'ds.broadcast');
  }
