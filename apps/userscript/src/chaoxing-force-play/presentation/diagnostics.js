// @provides: _cxAllFrames
// @requires: BRIDGE, CONFIG, CONST, CoreState, DEBUG, ENDED_SRCS, SCRIPT_VERSION, TARGET, _loopTicks, _loopTimer, _targetMissStreak, allVideos, bestEffort, detectSite
// @source-group: presentation/diagnostics.js
  // ===== DOMAIN: presentation/diagnostics (diagnostics + blackbox) =====
  // 跨同源 iframe 收集所有窗口（含顶层壳页与 doHomeWorkNew 等嵌套答题 iframe）：每帧有独立脚本副本，
  // quizStats/quizAIProblems/错误缓冲只写在各自 window.__CX_FORCE_PLAY 上，诊断在顶层壳页需聚合才能看到。
  function _cxAllFrames() {
    var _out = [];
    bestEffort(function () {
      var _top = (window.top && window.top !== window) ? window.top : window;
      function _walk(win) {
        if (!win) return;
        _out.push(win);
        var _fs = (typeof win.frames !== 'undefined') ? win.frames : [];
        for (var _i = 0; _i < _fs.length; _i++) { try { _walk(_fs[_i]); } catch (e) {} }  // 跨源帧访问抛错→跳过
      }
      _walk(_top);
    }, 'diag.frames');
    return _out;
  }
  function buildDiagnostics() {                    // 一键反馈：汇总共全部状态/开关/标志为文本
    var L = [];
    // v4.19.48：站点身份 + 分区相关性标注——让不同页面(学习通/DeepSeek等)粘贴的诊断一眼可区分重点
    var _site = (typeof detectSite === 'function') ? detectSite() : '?';
    var _host = (typeof window !== 'undefined' && window.location) ? window.location.host : '?';
    var _siteLabel = ({
      chaoxing: '学习通（chaoxing）· 网课核心主页',
      deepseek: 'DeepSeek 应答端控制台',
      zhihuishu: '智慧树（知到）',
      icourse163: '中国大学 MOOC',
      xuetangx: '学堂在线',
      icve: '智慧职教',
      renwei: '人卫慕课',
      unipus: 'Unipus 外语慕课',
      ucampus: 'U校园',
      ilabx: '实验空间',
      edu: '高校 edu.cn（兜底）'
    })[_site] || (_site || '未知');
    var _role = (_site === 'deepseek')
      ? '应答端控制台 · 广播 DS 登录态 / 承接题目作答'
      : '网课核心主页 · 负责视频续播与答题';
    var _relMap = {
      deepseek: { '2': '本页无视频', '5': '本页核心', '6': '本页无关', '8': '本页无关', '9': '本页核心', '13': '本页无视频' },
      chaoxing: { '5': '跨页参考' },
      zhihuishu: { '5': '跨页参考' }
    };
    var _rel = _relMap[_site] || {};
    function _sec(n, name) {
      var t = _rel[String(n)];
      return '■ [' + n + '] ' + name + (t ? '（' + t + '）' : '');
    }
    L.push('=== 网课强制续播 诊断信息 ===');
    // ===== 诊断报告结构重排（v4.19.48）：分区「节」结构 + 标题块，便于复制与技术支持快速定位 =====
    L.push('网课强制续播 · 运行诊断报告');
    L.push('══════════════════════════════════════════════');
    L.push('站点     : ' + _siteLabel);
    L.push('角色     : ' + _role);
    L.push('本机地址 : ' + _host);
    L.push('采集帧   : ' + _site + ' / ' + (window === window.top ? '顶层窗口' : 'iframe嵌套'));
    L.push('生成时间 : ' + new Date().toLocaleString() + ' (本地)');
    L.push('版本     : ' + SCRIPT_VERSION);
    var _runtime = CoreState.getSnapshot();
    L.push('运行状态 : ' + _runtime.state + ' · 原因=' + _runtime.reason + ' · 代次=' + _runtime.epoch);
    L.push('══════════════════════════════════════════════');
    L.push('');
    L.push('■ [1] 系统环境');
    L.push('  运行环境   : ' + (typeof GM_info !== 'undefined' && GM_info.scriptHandler ? GM_info.scriptHandler : 'n/a') +
      ' · GM存储=' + (typeof GM_setValue === 'function' ? '已授权' : '未授权'));
    L.push('  页面状态   : 可见性=' + (typeof document !== 'undefined' ? document.visibilityState : '?') +
      ' · 窗口=' + (window === window.top ? '顶层' : 'iframe嵌套') +
      ' · 同源帧=' + _cxAllFrames().length +   // 跨帧聚合（信号灯/错误/AI明细/遥测）的来源帧数：子帧丢失（跨域/未注入）时可据此察觉聚合缺源
      ' · ready=' + (typeof document !== 'undefined' ? document.readyState : '?') +
      ' · 持久化键=' + (_cxAuditLsKeys ? _cxAuditLsKeys().length : '?'));
    // v4.19.50 顶层注入状态：子帧自起主循环/DS 通道在顶层缺失时可一锤定音——若「顶层脚本=未注入」，
    // 说明顶层壳页脚本未运行（页面结构/时序问题），子帧按 v4.19.18 盲区设计自起主循环，但跨页通道/跨帧聚合缺顶层源。
    L.push('  顶层状态   : ' + (function () {
      try {
        if (window.self === window.top) return '本帧即顶层';
        if (!window.top) return '顶层不可达';
        var _tw = window.top;
        // v4.19.50 追加顶层 URL：分辨「about:blank/blob(结构性不匹配 @match)」vs「chaoxing URL 却未注入(注入侧问题/@all-frames)」
        var _tu = '?';
        if (typeof _tw.location !== 'undefined' && _tw.location.href) { try { _tu = String(_tw.location.href).slice(0, 120); } catch (e) { _tu = '[读取受限]'; } }
        return '顶层脚本=' + ((_tw.__CX_FORCE_PLAY && typeof _tw.__CX_FORCE_PLAY.version === 'string') ? ('已注入 v' + _tw.__CX_FORCE_PLAY.version) : '未注入(壳页无脚本)') + ' · 同源=' + (function () { try { void _tw.__CX_FORCE_PLAY; return '可达'; } catch (e) { return '跨域不可达'; } })() + ' · 顶层URL=' + _tu;
      } catch (e) { return '顶层跨域不可达'; }
    })());
    L.push('  平台/浏览器 : ' + (typeof navigator !== 'undefined' && navigator.userAgent ? String(navigator.userAgent).slice(0, 160) : 'n/a'));
    var vs = allVideos();
    // v4.19.38：moQueue 是瞬态队列（捕获后 16ms/200ms 内排空接管），采样恒 0 属正常；
    // v4.19.40：以「批次」为 MO 活跃主指标——静态渲染的视频不触发 MO（MO 只捕获新增节点），
    // 入队恒 0 属正常（视频由主循环 scanVideos 接管）；批次持续增长才是 MO 在工作的直接证据。
    L.push('');
    L.push(_sec(2, '续播与视频'));
    L.push('视频总数: ' + vs.length + ' · MO队列: ' + _moQueue.length +
      ' (批次' + _moBatches + (_moLastBatchAt ? (' · 最近' + Math.round((Date.now() - _moLastBatchAt) / 1000) + 's前') : ' · 尚无回调') + ' · 入队' + _moPushes + '/排空' + _moFlushes + ') · ENDED_SRCS: ' + Object.keys(ENDED_SRCS).length);
    // 错误累计/最近(3)：聚合本帧 + 所有同源 iframe 的错误缓冲（答题引擎在 iframe 内的 strictFail 也计入顶层诊断）
    var _rec = [];
    bestEffort(function () {
      var _fr = _cxAllFrames(), _agg = 0;
      for (var _fi = 0; _fi < _fr.length; _fi++) {
        try {
          var _fp = _fr[_fi].__CX_FORCE_PLAY;
          if (!_fp) continue;
          if (typeof _fp.errorCount === 'function') _agg += _fp.errorCount();
          if (typeof _fp.recentErrors === 'function') {
            var _rr = _fp.recentErrors(3);
            if (_rr && _rr.length) for (var _rj = 0; _rj < _rr.length; _rj++) _rec.push(_rr[_rj]);
          }
        } catch (e) {}
      }
      L.push('');
      L.push('■ [3] 错误堆栈');
      L.push('错误累计: ' + _agg + ' · 最近(3): ' + (_rec.length ? _rec.map(function (r) {
        var _t = r.tag || '?'; var _m = ('' + (r.msg || '')).replace(/\s+/g, ' ').slice(0, 48);
        return _t + (_m ? ':' + _m : '');
      }).join(' | ') : '无'));
    }, 'diag.errAgg');
    // 去重按时间取最新 3 条（供 DEBUG 段复用 _rec，保持变量名一致）
    _rec.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    if (_rec.length > 3) _rec = _rec.slice(0, 3);
    // 评审#1：DEBUG 下暴露最近被吞错误的 msg+stack（来自 swallow 写入的 _errBuf 遥测），便于根因诊断
    if (DEBUG && _rec.length) {
      for (var _ri = 0; _ri < _rec.length; _ri++) {
        var _r = _rec[_ri];
        var _line = '  ↳[' + _r.tag + '] ' + (_r.msg || '?');
        if (_r.stack) {
          var _st = String(_r.stack).split('\n');
          if (_st.length > 1) _line += '\n    ' + _st.slice(1, 4).join('\n    ');   // 跳过首行(与 msg 重复)，仅显示调用栈
        }
        L.push(_line);
      }
    }
    var m = (typeof performance !== 'undefined' && performance.memory) ? performance.memory : null;
    L.push('');
    L.push('■ [4] 运行资源');
    L.push('heap: ' + (m ? (m.usedJSHeapSize / 1048576).toFixed(1) + 'MB / ' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + 'MB' : 'n/a'));
    L.push('桥: ' + (BRIDGE && BRIDGE.base ? ('已连 ' + BRIDGE.base) : '离线') + ' · skipResume=' + !!(BRIDGE && BRIDGE.skipResume) + ' · 章清单=' + !!(BRIDGE && BRIDGE.chapter) + ' · 桥版本=' + (BRIDGE && BRIDGE.version ? BRIDGE.version : '?'));
    L.push('定向: enabled=' + (TARGET && TARGET.enabled) + ' matchedAny=' + (TARGET && TARGET.matchedAny) + ' 0命中连击=' + _targetMissStreak + '/' + CONST.TARGET_FALLBACK_ROUNDS);
    L.push('');
    L.push(_sec(5, 'DeepSeek 应答端'));
    // DeepSeek 应答端（视觉后端）状态——分"课程页(靠跨页广播)"与"应答端(同页DOM探测)"两场景，直接点出跨域不可达根因
    var _f = window.__CX_FORCE_PLAY;
    if (_f && _f.DS_STATUS) {
      var _ds = _f.DS_STATUS;
      // _site 已在本函数开头（站点身份区）声明并赋值，此处直接复用，不再重复声明（no-redeclare）
      if (_site === 'deepseek') {
        // 应答端自身：直接用本页 DOM 探测登录态，不走跨页通道
        var _li = (typeof _f._dsIsLoggedIn === 'function') ? _f._dsIsLoggedIn() : undefined;
        var _liTxt = _li === true ? '已登录' : (_li === false ? '未登录' : '未知(登录态未识别)');
        L.push('DeepSeek[应答端]: 本页探测=' + _liTxt + ' · 广播周期=5s');
      } else {
        // 课程页：依赖跨页 BroadcastChannel（同源隔离→跨域永远收不到）
        var _got = !!_ds.ts;
        var _dsLogin = _ds.loggedIn === true ? '已登录' : (_ds.loggedIn === false ? '未登录' : '未知');
        L.push('DeepSeek[课程页]: 收到跨页广播=' + _got + (_got ? (' connected=' + _ds.connected + ' loggedIn=' + _dsLogin) : ' → 同源BroadcastChannel跨域不可达，课程页收不到DeepSeek已登录'));
      }
      var _dsAvailTxt;
      if (_site === 'deepseek') {
        // 应答端本页：dsAvailable() 永远 false（本页只广播不接收自身通道），应显示本页登录就绪态而非误导的 dsAvailable
        var _li2 = (typeof _f._dsIsLoggedIn === 'function') ? _f._dsIsLoggedIn() : undefined;
        _dsAvailTxt = '本页就绪=' + (_li2 === true ? '是(已登录可作应答端)' : (_li2 === false ? '否(未登录)' : '未知(登录态未识别)'));
      } else {
        _dsAvailTxt = 'dsAvailable=' + (typeof _f.dsAvailable === 'function' ? _f.dsAvailable() : 'n/a');
      }
      L.push('  应答端开关=' + (_f.DS_RESPONDER_ENABLED === false ? '关' : '开') + ' · ' + _dsAvailTxt + ' · 本机host=' + ((typeof location !== 'undefined' && location.host) || '?'));
      L.push('  最近请求=' + (_f.DS_LAST_ASK ? (Math.round((Date.now() - _f.DS_LAST_ASK) / 1000) + 's前') : '无') + (_f.DS_LAST_ANSWER ? (' · ' + _f.DS_LAST_ANSWER) : ''));
    }
    L.push('');
    L.push(_sec(6, '答题·AI作答明细'));
    // 严格 AI 作答状态（诊断联动#十一）：把「AI 不可用→停下报错(不随机)」汇总进诊断，避免仅弹 toast 而在诊断里看不到根因。
    // 关键：本段跨同源 iframe 聚合——答题引擎常跑在 doHomeWorkNew 嵌套 iframe 内，其 quizStats/quizAIProblems 写在
    // 该 iframe 的 window.__CX_FORCE_PLAY 上，顶层壳页直接读读不到；必须遍历所有帧才能显示「AI 作答」段与每题报错原因。
    var _qAgg = { strict: false, scanned: 0, answered: 0, probs: {} };
    bestEffort(function () {
      var _fr = _cxAllFrames();
      for (var _fi = 0; _fi < _fr.length; _fi++) {
        try {
          var _fp = _fr[_fi].__CX_FORCE_PLAY;
          if (!_fp) continue;
          if (_fp.quizStats) {
            if (_fp.quizStats.strictMode) _qAgg.strict = true;
            _qAgg.scanned += (_fp.quizStats.scanned || 0);
            _qAgg.answered += (_fp.quizStats.answered || 0);
          }
          if (_fp.quizAIProblems) {
            var _ks = Object.keys(_fp.quizAIProblems);
            for (var _ki = 0; _ki < _ks.length; _ki++) _qAgg.probs[_ks[_ki]] = _fp.quizAIProblems[_ks[_ki]];
          }
        } catch (e) {}
      }
    }, 'diag.quizAgg');
    var _pk = Object.keys(_qAgg.probs);
    if (_qAgg.strict || _pk.length || _qAgg.scanned) {
      L.push('AI 作答: strictMode=' + (_qAgg.strict ? '开(禁止随机)' : '关') +
        ' · 扫描=' + _qAgg.scanned + ' · 已答=' + _qAgg.answered +
        ' · 停下报错=' + _pk.length + ' 题');
      for (var _pi = 0; _pi < _pk.length; _pi++) {
        var _p = _qAgg.probs[_pk[_pi]];
        L.push('  ⛔ [' + (new Date(_p.ts).toLocaleTimeString()) + '] ' + (_p.msg || '未知原因'));
      }
    }
    // v4.19.14：逐题 AI 作答诊断明细——直接暴露每道题「题型/选项数/混淆字体解码状态/DeepSeek 回传内容/解析原因分类/结果」，
    // 用来定位“多题变红”的根因：是「解析失败(no-letter/letter-out-of-range)」还是「连接问题(error/empty-recover)」。
    // 跨同源 iframe 聚合；同 fp 多帧只取其一（子帧灯已合并）。失败类(result=fail/error/random)排前、ok 排后。
    bestEffort(function () {
      var _diag = {}, _fr3 = _cxAllFrames();
      for (var _di = 0; _di < _fr3.length; _di++) {
        try {
          var _dw = _fr3[_di].__CX_FORCE_PLAY;
          if (_dw && _dw.quizAiDiag) {
            var _entries = _dw.quizAiDiag;
            for (var _dk in _entries) {
              if (!Object.prototype.hasOwnProperty.call(_entries, _dk)) continue;
              _diag[_dk] = _entries[_dk];   // 同 fp 多帧取其一
            }
          }
        } catch (e) {}
      }
      var _dks = Object.keys(_diag);
      if (_dks.length) {
        var _ord = { fail: 0, error: 1, random: 2, ok: 3 };
        _dks.sort(function (a, b) {
          var _ra = _ord[((_diag[a].last && _diag[a].last.result) || 'ok')]; if (_ra == null) _ra = 9;
          var _rb = _ord[((_diag[b].last && _diag[b].last.result) || 'ok')]; if (_rb == null) _rb = 9;
          return _ra - _rb;
        });
        L.push('AI 作答诊断明细(' + _dks.length + '题, fail/error/random 在前):');
        for (var _dj = 0; _dj < _dks.length; _dj++) {
          var _e = _diag[_dks[_dj]], _l = _e.last || {};
          var _seq = _e.seq ? ('第' + _e.seq + '题') : ('fp=' + String(_e.fp).slice(0, 8));
          var _shot = (_l.imgSkipped === true) ? ' · 截图=跳过(仅文本)' : (_l.imgSkipped === false ? ' · 截图=已发' : '');
          var _dec = (_l.decodeOk ? ('解码成功(' + (_l.decodeLen || 0) + '字)') : (_l.decodeOk === false ? '解码失败(仅截图盲答)' : '解码状态未知')) + _shot;
          var _ans = (_l.answer != null) ? ('answer=' + String(_l.answer).slice(0, 40)) : 'answer=null';
          var _txt = (_l.text != null) ? (' · DeepSeek回复=' + _l.text.slice(0, 130)) : '';
          var _marker = (_l.result === 'ok' ? '[OK]' : (_l.result === 'fail' ? '[FAIL]' : (_l.result === 'random' ? '[RAND]' : '[ERR]')));
          L.push('  ' + _marker + ' [' + _seq + '] ' + (_e.qtype || '?') + '·选项' + (_e.optCount || 0) +
            ' · ' + _dec +
            ' · ' + _ans + (_l.parseReason ? (' · 解析=' + _l.parseReason) : '') +
            ' · 结果=' + (_l.result || '?') + (_l.err ? (' (' + _l.err.slice(0, 130) + ')') : '') + _txt);
          if (_e.history && _e.history.length) {
            for (var _dh = 0; _dh < _e.history.length; _dh++) {
              var _h = _e.history[_dh];
              L.push('      ↳ 前次: 解析=' + (_h.parseReason || '-') + ' · 结果=' + (_h.result || '-') + (_h.answer != null ? (' · answer=' + String(_h.answer).slice(0, 30)) : '') + (_h.err ? (' · ' + String(_h.err).slice(0, 90)) : ''));
            }
          }
        }
      }
    }, 'diag.quizAiDiag');
    L.push('');
    if (_site === 'deepseek') {
      // v4.19.49：应答端页不运行主循环（restartLoopTimer 已跳过），不再空转 2s tick / 后台节流 ×4 抖动
      L.push('■ [7] 主循环与续播（本页无关）· 应答端页不运行主循环（响应由 ds-ask 事件驱动）');
    } else {
      L.push('■ [7] 主循环与续播');
      // 主循环健康（诊断#七）：确认续播调度仍在跑，避免"看起来没接管"却不知循环已停
      L.push('主循环: ' + (_loopTimer ? '运行中' : '已停') + ' · 已运行轮次=' + (_loopTicks || 0) + ' · 周期=' + CONFIG.RESCAN_INTERVAL + 'ms' + (_loopLastTick ? (' · 上次tick=' + Math.round((Date.now() - _loopLastTick) / 1000) + 's前') : ' · 上次tick=未运行'));
    }
