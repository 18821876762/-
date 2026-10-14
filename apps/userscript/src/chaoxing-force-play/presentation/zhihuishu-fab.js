// @requires: CX_KEYS, EventBus, bestEffort, cxIcon, detectSite, dsAvailable, safeGet
  // ===== DOMAIN: presentation/zhihuishu-fab (Zhihuishu 专属 FAB，场景自适应) =====
  // ===== MODULE: 智慧树右下角微型标志 + 浮层（视频页 / 题目页 两套不同面板） =====
  // 域：UI 模块 —— 智慧树(知到)专属，与超星学习通分区面板刻意区分。
  // 【场景自适应】用户要求题目区与视频区控制面板「不一样」，且不是 deepseek 默认题目区：
  //   - 视频页（非 dohomework 类 URL）：显示「强制续播」面板（续播开关 + 本次弹窗作答数）。
  //   - 题目页（dohomework/webExamList/stuExamWeb 等作业·考试页）：显示「作业/考试助手」面板
  //     （自动作答开关 / 自动交卷开关 / DeepSeek 连接状态 / 作答进度 / 确认交卷按钮），两者互斥、不混用。
  //   题目区面板由 sites/zhihuishu-exam.js 的状态机驱动；未连入 DeepSeek 时开关灰禁用、不执行任何操作。
  var _zhsFab = null;
  var _zhsFabAnswered = 0;            // 视频页：累计本次会话自动作答弹窗数
  var _zhsFabEnabled = true;          // 视频页：续播总开关镜像
  var _zhsMode = null;                // 'video' | 'exam' | null（当前浮层形态）
  var _zhsDiagReason = null;          // §1.1 可观测化：zhExam:diag 最新拦停原因（如 'ds-unavailable'），null=正常

  var ZHS_FAB_SVG =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">' +
      '<path d="M12 21c0-5 0-8 0-8" stroke="#10B981" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M12 13c-4 0-6-3-6-6 3 0 6 1 6 4 0-4 3-6 6-5 0 4-2 7-6 7z" fill="#10B981" opacity="0.9"/>' +
      '<circle cx="12" cy="4.5" r="1.6" fill="#3B82F6"/>' +
    '</svg>';

  // 题目页判定：与 biz/zhihuishu-exam.js 中 _isExamPage 保持一致(P0-2 修复——原 FAB 正则无负向环视，会误匹配
  // example/homeworking 等任意含子串的 URL)。统一为带 (^|/) 锚点 + (?![a-z0-9]) 负向环视的版本，杜绝 FAB 误弹「作业/考试助手」。
  function _zhsIsExamPage() {
    return safeGet(function () { return /(^|\/)(dohomework|webExamList|stuExamWeb|doExam|examList|onlineExam|exam|homework|doHomeWork)(?![a-z0-9])/i.test((window.location && window.location.href) || ''); }, false);
  }
  // DeepSeek 连接状态
  function _zhsDsOk() {
    return safeGet(function () { if (typeof dsAvailable === 'function') return !!dsAvailable(); return false; }, false);
  }

  function _zhsFabStyle() {
    return '.cx-zhs-fab{' +
      'position:fixed;right:14px;bottom:14px;z-index:2147483646;width:38px;height:38px;border-radius:12px;' +
      'display:flex;align-items:center;justify-content:center;cursor:pointer;' +
      'background:rgba(255,255,255,.92);border:1px solid #E5E7EB;' +
      'box-shadow:0 6px 18px rgba(16,185,129,.28),0 2px 6px rgba(0,0,0,.08);' +
      '-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);' +
      'transition:transform .18s ease,box-shadow .18s ease;user-select:none;' +
    '}' +
    '.cx-zhs-fab:hover{transform:translateY(-2px) scale(1.06);box-shadow:0 10px 24px rgba(16,185,129,.4),0 2px 8px rgba(0,0,0,.1);}' +
    '.cx-zhs-fab .cx-zhs-dot{position:absolute;top:-2px;right:-2px;width:10px;height:10px;border-radius:50%;' +
      'background:#10B981;border:2px solid #fff;box-shadow:0 0 0 2px rgba(16,185,129,.2);animation:cx-zhs-pulse 2.4s infinite ease-out;}' +
    '@keyframes cx-zhs-pulse{0%{transform:scale(.7);opacity:.6;}100%{transform:scale(1.8);opacity:0;}}' +
    '.cx-zhs-pop{position:fixed;right:14px;bottom:60px;z-index:2147483646;width:264px;box-sizing:border-box;' +
      'background:#F9FAFB;color:#1F2937;font:12px/1.5 sans-serif;border:1px solid #E5E7EB;border-radius:12px;' +
      'box-shadow:0 12px 32px rgba(0,0,0,.14),0 2px 8px rgba(0,0,0,.06);padding:12px;' +
      'display:none;}' +
    '.cx-zhs-pop.cx-show{display:block;}' +
    '.cx-zhs-pop h4{margin:0 0 8px;font-size:13px;color:#10B981;display:flex;align-items:center;gap:6px;}' +
    '.cx-zhs-pop .cx-row{display:flex;justify-content:space-between;align-items:center;margin:6px 0;}' +
    '.cx-zhs-pop .cx-val{color:#1F2937;font-weight:600;}' +
    '.cx-zhs-pop button{width:100%;margin-top:8px;padding:7px;border:0;border-radius:6px;cursor:pointer;' +
      'background:#10B981;color:#fff;font-size:12px;}' +
    '.cx-zhs-pop button.cx-off{background:#EF4444;}' +
    // 题目区专属样式
    '.cx-zhs-pop .cx-chk{display:flex;align-items:center;gap:6px;margin:7px 0;cursor:pointer;font-size:12px;}' +
    '.cx-zhs-pop .cx-chk input{margin:0;}' +
    '.cx-zhs-pop .cx-chk.cx-disabled{opacity:.45;cursor:not-allowed;}' +
    '.cx-zhs-pop .cx-prog{margin:7px 0;padding:7px;background:#F3F4F6;border-radius:6px;font-size:11px;color:#374151;}' +
    '.cx-zhs-pop #__cxZheConfirm{background:#EF4444;margin-top:4px;}' +
    '.cx-zhs-pop #__cxZheConfirm:disabled{background:#9CA3AF;cursor:not-allowed;}' +
    // ===== 区块化 IA：头部场景徽标 + 收起 + 分区 + 统一开关 =====
    '.cx-zhs-head{display:flex;align-items:center;justify-content:space-between;margin:-12px -12px 10px;padding:10px 12px;border-bottom:1px solid #E5E7EB;}' +
    '.cx-zhs-badge{display:inline-flex;align-items:center;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;color:#fff;}' +
    '.cx-badge-video{background:#10B981;}' +
    '.cx-badge-exam{background:#3B82F6;}' +
    '.cx-zhs-close{border:0;background:transparent;color:#9CA3AF;font-size:18px;line-height:1;cursor:pointer;padding:0 2px;}' +
    '.cx-zhs-close:hover{color:#374151;}' +
    '.cx-zhs-body{padding:0;}' +
    '.cx-zhs-sec{margin:0 0 10px;}' +
    '.cx-zhs-sec:last-child{margin-bottom:0;}' +
    '.cx-zhs-sec-title{font-size:11px;font-weight:600;color:#9CA3AF;margin:0 0 6px;letter-spacing:.02em;}' +
    '.cx-zhs-actions button{margin-top:0;}' +
    '.cx-zhs-hint{font-size:11px;color:#9CA3AF;line-height:1.4;}' +
    '.cx-switch-row{display:flex;align-items:center;justify-content:space-between;margin:7px 0;gap:8px;}' +
    '.cx-switch{position:relative;width:38px;height:22px;border-radius:999px;border:0;background:#D1D5DB;cursor:pointer;padding:0;transition:background .18s;flex:0 0 auto;}' +
    '.cx-switch.on{background:#10B981;}' +
    '.cx-switch .cx-knob{position:absolute;left:2px;top:50%;width:18px;height:18px;margin-top:-9px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:transform .18s;}' +
    '.cx-switch.on .cx-knob{transform:translateX(16px);}'+
    // 答题进度条 + 信号灯（与视频 Hero 进度条同源视觉语言）
    '.cx-zhe-status-row{display:flex;align-items:center;gap:7px;margin:8px 0 6px;}'+
    '.cx-zhe-led{width:9px;height:9px;border-radius:50%;flex-shrink:0;background:#9CA3AF;box-shadow:none;transition:background-color .3s,box-shadow .3s;}'+
    '.cx-zhe-led.running{background:#10B981;box-shadow:0 0 8px #10B981;animation:cx-led-pulse 1.4s ease-in-out infinite;}'+
    '.cx-zhe-led.warn{background:#F59E0B;box-shadow:0 0 8px #F59E0B;}'+
    '.cx-zhe-led.done{background:#3B82F6;box-shadow:0 0 8px #3B82F6;}'+
    '.cx-zhe-led.paused{background:#F59E0B;box-shadow:0 0 8px #F59E0B;}'+
    '.cx-zhe-led.error{background:#EF4444;box-shadow:0 0 8px #EF4444;}'+
    '.cx-zhe-status-text{font-size:12px;color:#374151;flex:1;}'+
    '.cx-zhe-prog-bar-track{height:6px;background:#E5E7EB;border-radius:999px;overflow:hidden;}'+
    '.cx-zhe-prog-bar{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#3B82F6,#10B981);transition:width .35s ease;}'+
    '.cx-zhe-prog-foot{display:flex;justify-content:space-between;font-size:11px;color:#9CA3AF;margin-top:5px;}'+
    '.cx-zhe-pct{font-weight:600;color:#374151;}';
  }

  // 头部：场景徽标 + 收起按钮（两套模式共用，凸显"视频/题目不一样"）
  function _zhsHead(label, badgeClass) {
    return '<div class="cx-zhs-head">' +
      '<span class="cx-zhs-badge ' + (badgeClass || '') + '">' + label + '</span>' +
      '<button type="button" class="cx-zhs-close" id="__cxZhsClose" aria-label="收起">' + cxIcon('close', 18) + '</button>' +
    '</div>';
  }
  // 题目区面板 HTML（区块化 IA：状态 / 控制 / 动作）
  function _zhsExamPopHTML() {
    return _zhsHead('题目作答', 'cx-badge-exam') +
      '<div class="cx-zhs-body">' +
        '<section class="cx-zhs-sec">' +
          '<div class="cx-zhs-sec-title">状态</div>' +
          '<div class="cx-row" id="__cxZheDsRow"><span>DeepSeek</span><span class="cx-val" id="__cxZheDs">未连接</span></div>' +
          '<div class="cx-zhe-status-row">' +
            '<span id="__cxZheStateLed" class="cx-zhe-led idle" title="作答状态"></span>' +
            '<span id="__cxZheStatus" class="cx-zhe-status-text">就绪</span>' +
          '</div>' +
          '<div class="cx-zhe-prog-bar-track"><div id="__cxZheBar" class="cx-zhe-prog-bar"></div></div>' +
          '<div class="cx-zhe-prog-foot"><span id="__cxZheNum">已作答 0 / 总数 0</span><span id="__cxZhePct" class="cx-zhe-pct">0%</span></div>' +
          '<div class="cx-prog" id="__cxZheProg" style="margin-top:8px;">作答:关 · 自动交卷:OFF</div>' +
        '</section>' +
        '<section class="cx-zhs-sec">' +
          '<div class="cx-zhs-sec-title">控制</div>' +
          '<label class="cx-chk" id="__cxZheAnsWrap"><input type="checkbox" id="__cxZheAns"> 自动作答（需连 DeepSeek）</label>' +
          '<label class="cx-chk" id="__cxZheSubWrap"><input type="checkbox" id="__cxZheSub"> 自动交卷（答完所有页+确认）</label>' +
        '</section>' +
        '<section class="cx-zhs-sec cx-zhs-actions">' +
          '<button id="__cxZheConfirm" disabled>确认交卷</button>' +
        '</section>' +
      '</div>';
  }
  // 视频页面板 HTML（续播；区块化 IA + 统一开关样式）
  function _zhsVideoPopHTML() {
    return _zhsHead('视频续播', 'cx-badge-video') +
      '<div class="cx-zhs-body">' +
        '<section class="cx-zhs-sec">' +
          '<div class="cx-zhs-sec-title">状态</div>' +
          '<div class="cx-row"><span>强制续播</span><span class="cx-val" id="__cxZhsPlay">开</span></div>' +
          '<div class="cx-row"><span>本次自动作答</span><span class="cx-val" id="__cxZhsAns">0</span></div>' +
        '</section>' +
        '<section class="cx-zhs-sec">' +
          '<div class="cx-zhs-sec-title">控制</div>' +
          '<div class="cx-switch-row"><span>强制续播</span>' +
            '<button type="button" id="__cxZhsToggle" class="cx-switch' + (_zhsFabEnabled ? ' on' : '') + '" role="switch" aria-checked="' + (_zhsFabEnabled ? 'true' : 'false') + '"><span class="cx-knob"></span></button>' +
          '</div>' +
        '</section>' +
        '<section class="cx-zhs-sec cx-zhs-actions">' +
          '<div class="cx-zhs-hint">随堂弹窗自动消干扰 · 视频自动续播</div>' +
        '</section>' +
      '</div>';
  }

  // 根据题目区状态，刷新面板内动态字段
  function _zhsRefreshExam() {
    var pop = document.getElementById('__cxZhsPop');
    if (!pop) return;
    var ds = document.getElementById('__cxZheDs');
    if (ds) {
      var ok = _zhsDsOk();
      ds.textContent = ok ? '已连接' : '未连接(操作禁用)';
      ds.style.color = ok ? '#10B981' : '#EF4444';
      // §1.1 可观测化：当有拦停诊断时，额外显示原因
      if (!ok && _zhsDiagReason) {
        var reasonMap = { 'ds-unavailable': '等待 DeepSeek 登录', 'not-exam-page': '非答题页', 'no-ds-no-exam': 'DS 未连 + 非答题页', 'tick-ds-unavailable': '作答暂停·DS 未连' };
        ds.textContent += ' [' + (reasonMap[_zhsDiagReason] || _zhsDiagReason) + ']';
      }
    }
    var st = (typeof window.__CX_FORCE_PLAY !== 'undefined' && typeof window.__CX_FORCE_PLAY.zhihuishuExamState === 'function') ? window.__CX_FORCE_PLAY.zhihuishuExamState() : null;
    var prog = document.getElementById('__cxZheProg');
    if (prog) {
      if (!st) prog.textContent = '状态获取失败';
      else {
        var a = st.answering ? '进行中' : '关';
        var subMap = { 'OFF': '关', 'ANSWERING': '作答并翻页中', 'READY': '所有页已答完·待确认', 'DONE': '已交卷' };
        prog.textContent = '作答:' + a + ' · 自动交卷:' + (subMap[st.asub] || st.asub) + (st.lastPage ? ' · 末页' : ' · 非末页');
      }
    }
    // 进度条 + 信号灯（题目总数/已完成 + 状态灯）
    var _bar = document.getElementById('__cxZheBar'),
        _num = document.getElementById('__cxZheNum'),
        _pctEl = document.getElementById('__cxZhePct'),
        _led = document.getElementById('__cxZheStateLed'),
        _stTxt = document.getElementById('__cxZheStatus');
    if (_bar) {
      var _total = (st && st.progress && typeof st.progress.total === 'number') ? st.progress.total : 0;
      var _ans = (st && st.progress && typeof st.progress.answered === 'number') ? st.progress.answered : 0;
      var _p = _total > 0 ? Math.min(100, Math.round(_ans / _total * 100)) : 0;
      _bar.style.width = _p + '%';
      if (_num) _num.textContent = '已作答 ' + _ans + ' / 总数 ' + _total;
      if (_pctEl) _pctEl.textContent = _p + '%';
    }
    if (_led && _stTxt) {
      var _cls = 'idle', _t = '就绪';
      if (st) {
        if (st.asub === 'DONE') { _cls = 'done'; _t = '已交卷'; }
        else if (st.asub === 'READY') { _cls = 'done'; _t = '所有页已答完·待确认交卷'; }
        else if (st.answering) { _cls = 'running'; _t = '作答进行中…'; }
        else if (st.asub === 'ANSWERING') { _cls = 'warn'; _t = '作答中·翻页'; }
        else if (!st.ds) { _cls = 'paused'; _t = '等待 DeepSeek 连接'; }
        else { _cls = 'idle'; _t = '自动作答未开启'; }
      }
      _led.className = 'cx-zhe-led ' + _cls;
      _stTxt.textContent = _t;
    }
    var cf = document.getElementById('__cxZheConfirm');
    if (cf && st) cf.disabled = !st.confirmReady;
    // 同步开关勾选态（用户手点后即时反映）
    var ans = document.getElementById('__cxZheAns'); if (ans) ans.checked = safeGet(function () { return localStorage.getItem(CX_KEYS.ZH_EXAM_ON); }, null) === '1';
    var sub = document.getElementById('__cxZheSub'); if (sub) sub.checked = safeGet(function () { return localStorage.getItem(CX_KEYS.ZH_EXAM_AUTO_SUBMIT); }, null) === '1';
    // DeepSeek 未连：灰禁开关
    var wrapA = document.getElementById('__cxZheAnsWrap'); if (wrapA) wrapA.className = 'cx-chk' + (_zhsDsOk() ? '' : ' cx-disabled');
    var wrapS = document.getElementById('__cxZheSubWrap'); if (wrapS) wrapS.className = 'cx-chk' + (_zhsDsOk() ? '' : ' cx-disabled');
    // Rec: 自动作答关闭时隐藏 DeepSeek 连接状态提示行（联动关闭）
    var _ansOn = safeGet(function () { return localStorage.getItem(CX_KEYS.ZH_EXAM_ON); }, null) === '1';
    var _dsRow = document.getElementById('__cxZheDsRow');
    if (_dsRow) _dsRow.style.display = _ansOn ? '' : 'none';
  }

  function _zhsRefreshVideo() {
    var ans = document.getElementById('__cxZhsAns');
    if (ans) ans.textContent = _zhsFabAnswered;
    var pl = document.getElementById('__cxZhsPlay');
    if (pl) pl.textContent = _zhsFabEnabled ? '开' : '关';
    // 统一开关（按钮）反映开/关态
    var tg = document.getElementById('__cxZhsToggle');
    if (tg) { tg.className = 'cx-switch' + (_zhsFabEnabled ? ' on' : ''); bestEffort(function () { tg.setAttribute('aria-checked', _zhsFabEnabled ? 'true' : 'false'); }, 'zhs.aria'); }
  }

  function _zhsRefreshFab() {
    if (!_zhsFab) return;
    bestEffort(function () { if (_zhsMode === 'exam') _zhsRefreshExam(); else _zhsRefreshVideo(); }, 'zhs.refreshFab');
  }

  // 【清理·重复代码】原 _zhsMaybeSwitchMode 与 _zhsEnsureFab 各写了一份完全相同的弹窗事件绑定
  //   （#__cxZheAns / #__cxZheSub / #__cxZheConfirm / #__cxZhsToggle），改动时极易只改一处。
  //   此处收敛为单一绑定函数；同时对 querySelector 结果加 null 守卫（模板变更时不再抛 TypeError 中断整段初始化）。
  function _zhsBindPop(pop, mode) {
    if (!pop) return;
    var q = function (sel) { return safeGet(function () { return pop.querySelector(sel); }, null); };
    // 收起按钮（两套模式共用）：点击关闭弹层
    var closeBtn = q('#__cxZhsClose');
    if (closeBtn) closeBtn.addEventListener('click', function () { bestEffort(function () { pop.classList.remove('cx-show'); }, 'zhs.close'); });
    if (mode === 'exam') {
      var ans = q('#__cxZheAns');
      if (ans) ans.addEventListener('change', function (e) {
        bestEffort(function () { localStorage.setItem(CX_KEYS.ZH_EXAM_ON, e.target.checked ? '1' : '0'); if (window.__cxRegisterAddon) window.__cxRegisterAddon(); }, 'zhs.bind.ansLs');
        bestEffort(function () { _zhsRefreshExam(); }, 'zhs.bind.ansRefresh');
      });
      var sub = q('#__cxZheSub');
      if (sub) sub.addEventListener('change', function (e) {
        bestEffort(function () { localStorage.setItem(CX_KEYS.ZH_EXAM_AUTO_SUBMIT, e.target.checked ? '1' : '0'); }, 'zhs.bind.subLs');
      });
      var cfm = q('#__cxZheConfirm');
      if (cfm) cfm.addEventListener('click', function () {
        bestEffort(function () { if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.zhihuishuExamSubmitNow === 'function') window.__CX_FORCE_PLAY.zhihuishuExamSubmitNow(); }, 'zhs.bind.confirm');
      });
    } else {
      var tg = q('#__cxZhsToggle');
      if (tg) tg.addEventListener('click', function () {
        bestEffort(function () {
          _zhsFabEnabled = !_zhsFabEnabled;
          bestEffort(function () {
            if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.CONFIG) {
              window.__CX_FORCE_PLAY.CONFIG.INTRUSION_MODE = _zhsFabEnabled ? 'auto' : 'gentle';
              if (typeof window.__CX_FORCE_PLAY.reconcileIntrusionMode === 'function') window.__CX_FORCE_PLAY.reconcileIntrusionMode();
            }
          }, 'zhs.bind.reconcile');
          _zhsRefreshVideo();
        }, 'zhs.bind.toggle');
      });
    }
  }

  // 按场景切换浮层形态（互斥：题目页 OR 视频页）
  function _zhsMaybeSwitchMode() {
    if (!_zhsFab) return;
    var exam = _zhsIsExamPage();
    var mode = exam ? 'exam' : 'video';
    if (mode === _zhsMode) { _zhsRefreshFab(); return; }
    _zhsMode = mode;
    var pop = document.getElementById('__cxZhsPop');
    if (!pop) return;
    pop.innerHTML = (mode === 'exam') ? _zhsExamPopHTML() : _zhsVideoPopHTML();
    _zhsBindPop(pop, mode);
    _zhsRefreshFab();
  }

  function _zhsEnsureFab() {
    if (detectSite() !== 'zhihuishu') return;
    if (_zhsFab) { _zhsMaybeSwitchMode(); return; }
    bestEffort(function () {
      var pd = document;
      if (!pd.getElementById('__cxZhsStyle')) {
        var st = pd.createElement('style'); st.id = '__cxZhsStyle'; st.textContent = _zhsFabStyle();
        (pd.head || pd.documentElement || pd).appendChild(st);
      }
      var fab = pd.createElement('div');
      fab.className = 'cx-zhs-fab'; fab.id = '__cxZhsFab'; fab.title = '智慧树助手';
      fab.innerHTML = ZHS_FAB_SVG + '<span class="cx-zhs-dot"></span>';
      pd.body.appendChild(fab);

      var pop = pd.createElement('div');
      pop.className = 'cx-zhs-pop'; pop.id = '__cxZhsPop';
      pop.innerHTML = _zhsIsExamPage() ? _zhsExamPopHTML() : _zhsVideoPopHTML();
      pd.body.appendChild(pop);

      fab.addEventListener('click', function () {
        bestEffort(function () { pop.classList.toggle('cx-show'); _zhsRefreshFab(); }, 'zhs.fab.click');
      });
      _zhsFab = fab;
      _zhsMode = _zhsIsExamPage() ? 'exam' : 'video';
      _zhsBindPop(pop, _zhsMode);
    }, 'zhs.ensureFab');
  }

  // 主循环每轮调用：确保图标存在，累加视频页弹窗作答数，并刷新当前面板
  function zhihuishuFabTick(handledCount) {
    if (detectSite() !== 'zhihuishu') return;
    bestEffort(function () { _zhsEnsureFab(); }, 'zhs.tick.ensure');
    if (handledCount > 0) _zhsFabAnswered += handledCount;
    bestEffort(function () { _zhsRefreshFab(); }, 'zhs.tick.refresh');
  }

  // 暴露给主循环与回归测试
  bestEffort(function () {
    if (typeof window !== 'undefined') {
      window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
      window.__CX_FORCE_PLAY.zhihuishuFabTick = zhihuishuFabTick;
    }
  }, 'zhs.export');

  // §1.1 可观测化：监听 zhExam 拦停诊断事件，刷新面板状态
  // ⚠️ 必须用 onEv（事件通道 __ev:），绝不能 on（状态键通道）——emit 走事件通道，用 on 会永不触发（其他审查已指出）
  bestEffort(function () {
    if (typeof EventBus !== 'undefined' && EventBus.onEv) {
      EventBus.onEv('zhExam:diag', function (d) {
        _zhsDiagReason = (d && d.reason) ? d.reason : null;
        bestEffort(function () { _zhsRefreshExam(); }, 'zhs.diag.refresh');
      });
    }
  }, 'zhs.diag.listen');
