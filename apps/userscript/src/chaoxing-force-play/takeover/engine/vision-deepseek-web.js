// @provides: DS_STATUS, _dsLastReplyBefore, _dsLoop, _dsRegTimer, _onChannel, _postChannel
// @requires: EventBus, bestEffort, detectSite
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：GM 存储通道、跨帧信号与遥测状态；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  // ===== DOMAIN: biz/vision-deepseek-web (站点无关·DeepSeek 网页版视觉后端) =====
  // ===== MODULE: rev3 视觉识别层的 "deepseek-web" 后端 —— 把题目截图交给已登录的 DeepSeek 网页版作答 =====
  // 用户方案（已确认）：同标签注入+轮询 DOM / 能传图 / 脚本内置提示词。
  // 本模块职责：
  //   ① 登录态探测：DeepSeek 页检测是否登录，跨标签页 BroadcastChannel 广播状态；课程页监听并渲染"可用/不可用"状态徽标。
  //   ② 跨页问答骨架：课程页把截图+提示词发给 DeepSeek 页 responder；responder 注入图片+提示词→发送→轮询回复完成→解析下标→回传。
  //      （responder 的 DOM 驱动选择器待真实站点校准，先留 TODO 骨架；用户要求"不登录就显示不可用状态"本模块已落地。）
  // 为什么做登录探测+状态：避免静默超时兜底，让用户一眼看清后端就绪与否。
  // [RQ-09 校准状态] 已在真实 chat.deepseek.com 用 DevTools 校准：inputSel/lastReplySel/sendBtnSel/generatingSel 已用 ds- 稳定前缀实证；
  // msgListSel 的容器名(.ds-virtual-list)实页未实证（实页回传容器=消息项本身），已加全文档兜底(见 _dsMessageItems)，不阻塞轮询；
  // avatarSel 真实页未暴露稳定头像 img（AVATAR_CANDIDATES 仅命中 site_logo 站点 logo），登录态改靠输入框存在判定（见第82行）。
  // 选择器说明（基于 deep seek元素.txt 模拟校准）：
  //   SPA 外壳(#root 空壳) + 运行时聊天 DOM（输入框/发送/消息/回复/生成中是 JS 运行时渲染的）。
  //   以下为 best-effort 回退选择器，已用 _sim/fixtures-dump-elements.js 的模拟 DOM 验证命中；
  //   真实站点若与模拟结构不同，需在 chat.deepseek.com 运行时用 DevTools 复核并覆盖本对象。
  var DEEPSEEK = {
    host: 'chat.deepseek.com',
    // 未登录：精确"登录"按钮/链接（存在=未登录）；已登录：头像/账户菜单（存在=已登录）
    loginBtnSel: 'a[href*="login"], a[href*="auth"], button[class*="login"], [class*="登录-btn"], [class*="signin"]',
    // 头像：[RQ-09] 实测 DeepSeek 真实页未暴露稳定可定位的用户头像 img（AVATAR_CANDIDATES 仅命中 site_logo 站点 logo），
    // 故头像选择器保留 best-effort 但登录态探测实际依赖输入框存在(见 _dsIsLoggedIn 第82行)，不阻塞可用性判定。
    avatarSel: '[class*="avatar"], [aria-label*="账户"], [aria-label*="profile"], header [class*="user"], button[class*="account"]',
    // responder DOM 驱动：输入框已校准（[RQ-09] 实测 textarea.ds-scroll-area 为输入框稳定容器）
    inputSel: 'textarea[placeholder^="给 DeepSeek 发送消息"], textarea.ds-scroll-area, textarea, [contenteditable="true"]',
    // 图片上传：DeepSeek 真实走附件/图片上传控件（非 textarea paste），回退 input[type=file]
    fileInputSel: 'input[type=file], input[accept*="image"], [class*="upload"] input[type=file]',
    // 发送按钮：[RQ-09] 实测为 div.ds-button--iconLabelPrimary（新 UI 无 <button>、无文本/aria-label）；
    // 同页存在多个该 class 候选（侧栏新建对话等），由 _dsFindSendBtn 取输入框所在 composer 内/屏幕最靠下者区分。
    sendBtnSel: 'div.ds-button--iconLabelPrimary, div[role="button"][class*="ds-button--iconLabelPrimary"], button[aria-label*="发送"], button[aria-label*="send"]',
    // 消息列表容器：[RQ-09] 实页未实证真实容器名（calibrate-dump 容器选择器未含 .ds-virtual-list，实页回传 MSG_LIST=div.ds-message 即消息项本身）。
    // 故本字段为 best-effort 候选；_dsMessageItems() 会在容器失配时自动全文档收集 .ds-message(已实证存在)，保证轮询不静默超时。
    msgListSel: '.ds-virtual-list, [role="list"], .chat-messages, .ds-chat-messages, main [class*="message"], [class*="conversation"]',
    // 末条回复块：[RQ-09] 实测 .ds-markdown.ds-assistant-message-main-content 为 AI 回复内容块（位于最新一条 .ds-message 内）
    lastReplySel: '.ds-markdown.ds-assistant-message-main-content, .ds-virtual-list [class*="assistant-message"]',
    // 生成中占位：[RQ-09] 实测两类信号——①初始 logo 动画 div.site_logo_loading.site_logo_fallback（位于最新助手消息内）；
    // ②深层推理态文本「在之前的思考中自我修正」（含"思考中"，无稳定类，须靠文本匹配）。故保留 loading/thinking/generating/spinner 兜底类名
    // 与中文思考中/生成中、英文 Thinking/Generating 文本匹配（详见 _dsLatestReply 文本兜底）。
    generatingSel: '[class*="site_logo_loading"], [class*="loading"], [class*="thinking"], [class*="generating"], [class*="spinner"]'
  };
  var DS_CHANNEL = 'cx-deepseek-vision';

  // ---- 跨页通道：优先 GM 存储中继（跨源可用），回退同源 BroadcastChannel ----
  // BroadcastChannel 同源隔离：课程页(chaoxing.com)与 DeepSeek 页(chat.deepseek.com)不同源，状态广播永远到不了，
  // 导致课程页 DS_STATUS 恒为未连接（症状："DeepSeek 已链接但页面没显示"）。改用脚本级 GM 存储——
  // 按脚本而非按源共享，GM_addValueChangeListener 的 remote=true 即来自其他标签页的变更，实现跨源跨标签页通信。
  // 若运行环境未授权 GM_*（@grant none），自动回退到 BroadcastChannel（仅同源可用）。
  var _GM = (typeof GM_setValue === 'function' && typeof GM_addValueChangeListener === 'function')
    ? { set: GM_setValue, on: GM_addValueChangeListener } : null;
  var DS_BRIDGE_KEY = 'cx_ds_bridge_v1';   // 心跳/状态(ds-state/ds-ping/ds-answer)：小值常驻，决定 DS_STATUS.connected
  var DS_ASK_KEY = 'cx_ds_ask_v1';          // v4.19.28：答题请求(含截图 base64)独立键，避免大值挤掉心跳键导致误断连/超时
  var _myTabId = 't' + Math.random().toString(36).slice(2);
  var _chanListeners = [];
  // 【架构·顶层帧编排】跨页通道(BroadcastChannel + GM 监听)只承载面板状态/应答端联动，只应在「顶层帧」(面板挂载处)
  // 或 DeepSeek 站点本身初始化一次。旧实现在每帧(顶+各 iframe)都 new BroadcastChannel + 注册 GM 监听 → 多帧页面
  // 开 N 个冗余通道/监听器，是每帧无谓开销的一部分。此处置 _dsNeedChannel 门控，非顶层且非 DS 站点的 iframe 不建通道。
  var _dsIsTop = (typeof window !== 'undefined') && (window.self === window.top);
  var _dsNeedChannel = _dsIsTop || (typeof detectSite === 'function' && detectSite() === 'deepseek');
  var _bc = (_dsNeedChannel && typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel(DS_CHANNEL) : null;
  // 修复·iframe 内视觉作答（v4.19.1 回归）：学习通作业题在多层 iframe（doHomeWorkNew 等），答题引擎跑在子帧。
  // 顶层帧编排把通道收敛到顶层后，子帧收不到 ds-state/ds-answer → dsAvailable() 恒 false → 每题立即
  // 「应答端不可用」严格失败、截图从未发出（实测：检测修复后 5 题全红、DS 页「最近请求=无」）。
  // 修复①：子帧首次真正需要 DS 时按需注册 GM 值变更监听（懒注册：无题帧零开销，保持顶层帧编排收益）。
  var _dsLazyChannel = false;
  var _dsChannelEnsureAt = 0;
  function _dsEnsureChannel() {
    if (_dsNeedChannel || _dsLazyChannel || !_GM) return _dsChannelEnsureAt;
    _dsLazyChannel = true; _dsChannelEnsureAt = Date.now();
    bestEffort(function () {
      _dsGmListenerId = _GM.on(DS_BRIDGE_KEY, function (name, oldV, newV, remote) {
        if (!remote || !newV) return;   // v4.19.6：空值（_dsClearBridge 释放）跳过解析
        bestEffort(function () { _emitChannel(JSON.parse(newV)); }, 'ds.onChannel.gm.lazy');
      });
      // 修复·子帧 DS_STATUS（v4.19.3 实测：5 黑灯+无请求+门控宽限）：角色锁让子帧跳过 course-side 初始化
      // （_dsInitCourseSide 被 _dsNeedChannel 门控），收到 ds-state 也无人更新 DS_STATUS → dsAvailable() 恒 false。
      // 补最小 ds-state 处理器：DS 页首个心跳（≤5s）到达后 connected=true，门控放行、视觉作答启动。
      // GM 存储通道按脚本共享、与窗口隔离无关——子帧经此通道收发与顶层等价。
      _onChannel(function (m) {
        if (m && m.type === 'ds-state') {
          DS_STATUS.connected = true;
          if (m.loggedIn != null) DS_STATUS.loggedIn = m.loggedIn;
          DS_STATUS.ts = m.ts || Date.now();
          if (m.loop) DS_STATUS.loop = m.loop;   // v4.19.37：应答端循环快照随心跳落课程页
        }
      });
    }, 'ds.init.gm.lazy');
    return _dsChannelEnsureAt;
  }
  // 幂等性修复(审查 S-2/G-1)：GM 值变更监听器 id（供 quizVisionDeepSeekStop 卸载时 remove，杜绝脚本热禁用/手动
  // uninstall 后监听残留——GM 监听是脚本级、跨标签页长驻的，注册时不保存 id 则永远无法移除）。
  var _dsGmListenerId = null;
  var _dsGmAskListenerId = null;   // v4.19.28：答题请求键(cx_ds_ask_v1)监听，供卸载时移除
  // v4.19.9 需求·应答端面板信号灯镜像：DeepSeek 页监听课程页经 GM 存储广播的灯快照（跨标签页/跨域），
  // 写入 quizLightsRemote 并触发 'quiz:lights' —— 面板做题区/诊断显示课程页答题进度（红绿黄黑灯）。
  var _dsLightsGmListenerId = null;
  function _dsInstallLightsMirror() {
    if (_dsLightsGmListenerId != null || typeof GM_addValueChangeListener !== 'function') return;
    bestEffort(function () {
      _dsLightsGmListenerId = GM_addValueChangeListener('cx_quiz_lights_v1', function (name, oldV, newV, remote) {
        if (!remote || !newV) return;
        bestEffort(function () {
          var d = JSON.parse(newV);
          if (d && Array.isArray(d.lights) && window.__CX_FORCE_PLAY) {
            window.__CX_FORCE_PLAY.quizLightsRemote = d.lights;
            // v4.19.46：镜像时间戳（课程页写入时间）——应答端诊断/面板可显示「镜像 Xs前」，
            // 一眼分辨灯是当前状态还是陈旧残留（课程页出清/关闭后 GM 键残留旧灯）。
            window.__CX_FORCE_PLAY.quizLightsRemoteTs = d.ts || 0;
            if (typeof EventBus !== 'undefined' && EventBus.emit) EventBus.emit('quiz:lights');
          }
        }, 'ds.lightsMirror.parse');
      });
    }, 'ds.init.lights');
  }
  function _postChannel(msg) {
    msg = msg || {}; msg._from = _myTabId; msg._ts = Date.now();
    // v4.19.28：ds-ask(含大图 base64)走独立 GM 键，心跳/回包仍走 DS_BRIDGE_KEY——大值写入不再挤掉 ds-state 心跳，
    // 避免课程页 _dsCourseTimer 误判断开（原 4.19.27 纯文本方案的根因：单键承载多 MB 截图→心跳/回传被挤掉→60s 超时）。
    var _key = (msg.type === 'ds-ask') ? DS_ASK_KEY : DS_BRIDGE_KEY;
    _dsLoopWrite(msg.type);   // v4.19.37：GM 键写入统计（数据循环流量可见）
    bestEffort(function () { if (_GM) { _GM.set(_key, JSON.stringify(msg)); return; } }, 'ds.postChannel.gm');
    bestEffort(function () { if (_bc) _bc.postMessage(msg); }, 'ds.postChannel.bc');
  }
  function _onChannel(cb) { if (cb) _chanListeners.push(cb); }
  function _offChannel(cb) { var i = _chanListeners.indexOf(cb); if (i >= 0) _chanListeners.splice(i, 1); }
  // 跨上下文消息类型白名单（P2 加固：入站消息须声明已知 type，否则丢弃，避免同源任意页/GM 存储变更伪造消息驱动应答端行为）
  var DS_MSG_TYPES = { 'ds-state': 1, 'ds-ping': 1, 'ds-ask': 1, 'ds-answer': 1 };
  function _emitChannel(m) {
    // 幂等性修复(审查 S-1)：卸载后（cleanupListeners 已 delete 命名空间）不再派发通道消息——
    // 否则残留的 GM 监听仍会驱动 responder 作答/徽标重建，与「uninstall 回到注入前状态」契约相悖。
    if (!(window && window.__CX_FORCE_PLAY)) return;
    if (!m || m._from === _myTabId) return;
    // 校验消息形状：仅接受已知 type；拒绝伪造/异常消息（同源范围仍受限，此为纵深防御，与既有静默 return 风格一致）
    if (typeof m.type !== 'string' || !DS_MSG_TYPES[m.type]) return;
    for (var i = 0; i < _chanListeners.length; i++) { bestEffort(function (cb) { cb(m); }.bind(null, _chanListeners[i]), 'ds.emitChannel'); }
  }
  // v4.19.28：题目截图 base64 现走独立 GM 键 cx_ds_ask_v1；DS 页消费(粘贴/作答)后仅清空该键释放大字符串，
  // 心跳键(cx_ds_bridge_v1)保持不动，避免误清心跳导致课程页误断连。
  function _dsClearBridge() { bestEffort(function () { if (_GM) _GM.set(DS_ASK_KEY, ''); }, 'ds.clearBridge'); }
  if (_GM && _dsNeedChannel) {
    bestEffort(function () {
      // 幂等性修复(审查 G-1)：保存监听器 id，quizVisionDeepSeekStop 时 GM_removeValueChangeListener 移除，
      // 避免脚本热禁用/手动 uninstall 后 GM 监听跨标签页长驻（卸载契约还原清单 ⑫ 的配套）。
      _dsGmListenerId = _GM.on(DS_BRIDGE_KEY, function (name, oldV, newV, remote) {
        if (!remote || !newV) return;   // v4.19.6：_dsClearBridge 写 '' 释放大字符串 → 空值跳过解析，杜绝 JSON.parse('') 噪音
        bestEffort(function () { _emitChannel(JSON.parse(newV)); }, 'ds.onChannel.gm');
      });
      // v4.19.28：答题请求键(cx_ds_ask_v1，含大图 base64)独立监听——与心跳键分离，大值写入不再挤掉 ds-state 心跳。
      _dsGmAskListenerId = _GM.on(DS_ASK_KEY, function (name, oldV, newV, remote) {
        if (!remote || !newV) return;
        bestEffort(function () { _emitChannel(JSON.parse(newV)); }, 'ds.onChannel.gm.ask');
      });
    }, 'ds.init.gm');
  }
  if (_bc) { _bc.onmessage = function (e) { bestEffort(function () { _emitChannel(e.data); }, 'ds.onChannel.bc'); }; }

  // 跨页共享状态：课程页据此判断后端可用性并渲染徽标
  var DS_STATUS = { connected: false, loggedIn: null, ts: 0 };
  // v4.19.37 数据循环遥测：课程页侧（asksSent/answersGot/retries/roundTripMs）与应答端侧
  // （received/sent/watchdog/dedupe/qdrop）共用同一对象（按角色各写各的字段）。
  // 应答端侧快照随 ds-state 心跳广播回课程页（DS_STATUS.loop），实现「发题→应答端收→回包→课程页收」
  // 闭环在任意一侧诊断都可见——数据循环断在哪一环（发/收/回/心跳）一眼定位。
  var _dsLoop = {
    asksSent: 0, answersGot: 0, retries: 0, roundTrips: 0, roundTripMs: 0,  // 课程页侧
    received: 0, sent: 0, watchdog: 0, dedupe: 0, qdrop: 0,                 // 应答端侧
    lastAskAt: 0, lastAnswerAt: 0, lastErr: '',                              // 两侧共用
    writes: {}, lastWriteAt: {}                                              // GM 键写入统计（数据循环流量）
  };
  function _dsLoopWrite(type) {
    _dsLoop.writes[type] = (_dsLoop.writes[type] || 0) + 1;
    _dsLoop.lastWriteAt[type] = Date.now();
  }
  // 跨标签定时器句柄：卸载时需 clearInterval 避免泄漏（审查 §2.1）
  var _dsCourseTimer = null;
  var _dsBroadcastTimer = null;
  // 审查 S1 修复：responder 侧轮询/重试定时器统一经 TimerRegistry 登记(owner 'deepseek')，
  // 使 quizVisionDeepSeekStop() 的 clearAll('deepseek') 能真正取消在途轮询，避免卸载后裸 setTimeout 残留运行至多 ~90s。
  // TimerRegistry 不可用时回退原生 setTimeout（沙箱未初始化等极端场景），不阻断应答链路。
  function _dsRegTimer(fn, ms) {
    if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry && typeof window.__CX_FORCE_PLAY.TimerRegistry.setTimeout === 'function') {
      return window.__CX_FORCE_PLAY.TimerRegistry.setTimeout(fn, ms, 'deepseek');
    }
    return setTimeout(fn, ms);
  }

  // 审查#B：发送前末条回复文本快照，用于「流式复用同一消息节点（length 不增）」的兜底判定
  var _dsLastReplyBefore = '';
  var _dsStreamStable = '';   // v4.19.20：流式终态稳定性记忆——同一文本连续两轮 poll 一致才视为终态
