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

  var ZHS_FAB_SVG =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;">' +
      '<path d="M12 21c0-5 0-8 0-8" stroke="#10B981" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M12 13c-4 0-6-3-6-6 3 0 6 1 6 4 0-4 3-6 6-5 0 4-2 7-6 7z" fill="#10B981" opacity="0.9"/>' +
      '<circle cx="12" cy="4.5" r="1.6" fill="#3B82F6"/>' +
    '</svg>';

  // 题目页判定
  function _zhsIsExamPage() {
    try { return /dohomework|webExamList|stuExamWeb|doExam|exam|homework|doHomeWork/i.test((window.location && window.location.href) || ''); }
    catch (e) { return false; }
  }
  // DeepSeek 连接状态
  function _zhsDsOk() {
    try { if (typeof dsAvailable === 'function') return !!dsAvailable(); } catch (e) {}
    return false;
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
    '.cx-zhs-pop{position:fixed;right:14px;bottom:60px;z-index:2147483646;width:248px;box-sizing:border-box;' +
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
    '.cx-zhs-pop #__cxZheConfirm:disabled{background:#9CA3AF;cursor:not-allowed;}';
  }

  // 题目区面板 HTML
  function _zhsExamPopHTML() {
    return '<h4>' + ZHS_FAB_SVG.replace('width="22" height="22"', 'width="16" height="16"') + '作业/考试助手</h4>' +
      '<div class="cx-row"><span>DeepSeek</span><span class="cx-val" id="__cxZheDs">未连接</span></div>' +
      '<label class="cx-chk" id="__cxZheAnsWrap"><input type="checkbox" id="__cxZheAns"> 自动作答（需连 DeepSeek）</label>' +
      '<label class="cx-chk" id="__cxZheSubWrap"><input type="checkbox" id="__cxZheSub"> 自动交卷（答完所有页+确认）</label>' +
      '<div class="cx-prog" id="__cxZheProg">作答:关 · 自动交卷:OFF</div>' +
      '<button id="__cxZheConfirm" disabled>确认交卷</button>';
  }
  // 视频页面板 HTML（续播）
  function _zhsVideoPopHTML() {
    return '<h4>' + ZHS_FAB_SVG.replace('width="22" height="22"', 'width="16" height="16"') + '智慧树助手</h4>' +
      '<div class="cx-row"><span>强制续播</span><span class="cx-val" id="__cxZhsPlay">开</span></div>' +
      '<div class="cx-row"><span>本次自动作答</span><span class="cx-val" id="__cxZhsAns">0</span></div>' +
      '<button id="__cxZhsToggle">关闭续播</button>';
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
    var cf = document.getElementById('__cxZheConfirm');
    if (cf && st) cf.disabled = !st.confirmReady;
    // 同步开关勾选态（用户手点后即时反映）
    var ans = document.getElementById('__cxZheAns'); if (ans) try { ans.checked = '1' === localStorage.getItem('cx_zh_exam_on'); } catch (e) {}
    var sub = document.getElementById('__cxZheSub'); if (sub) try { sub.checked = '1' === localStorage.getItem('cx_zh_exam_autosubmit'); } catch (e) {}
    // DeepSeek 未连：灰禁开关
    var wrapA = document.getElementById('__cxZheAnsWrap'); if (wrapA) wrapA.className = 'cx-chk' + (_zhsDsOk() ? '' : ' cx-disabled');
    var wrapS = document.getElementById('__cxZheSubWrap'); if (wrapS) wrapS.className = 'cx-chk' + (_zhsDsOk() ? '' : ' cx-disabled');
  }

  function _zhsRefreshVideo() {
    var ans = document.getElementById('__cxZhsAns');
    if (ans) ans.textContent = _zhsFabAnswered;
    var pl = document.getElementById('__cxZhsPlay');
    if (pl) pl.textContent = _zhsFabEnabled ? '开' : '关';
    var tg = document.getElementById('__cxZhsToggle');
    if (tg) { tg.textContent = _zhsFabEnabled ? '关闭续播' : '开启续播'; tg.className = _zhsFabEnabled ? '' : 'cx-off'; }
  }

  function _zhsRefreshFab() {
    if (!_zhsFab) return;
    try { if (_zhsMode === 'exam') _zhsRefreshExam(); else _zhsRefreshVideo(); } catch (e) { swallow(e); }
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
    if (mode === 'exam') {
      pop.innerHTML = _zhsExamPopHTML();
      pop.querySelector('#__cxZheAns').addEventListener('change', function (e) {
        try { localStorage.setItem('cx_zh_exam_on', e.target.checked ? '1' : '0'); if (window.__cxRegisterAddon) window.__cxRegisterAddon(); } catch (err) { swallow(err); }
      });
      pop.querySelector('#__cxZheSub').addEventListener('change', function (e) {
        try { localStorage.setItem('cx_zh_exam_autosubmit', e.target.checked ? '1' : '0'); } catch (err) { swallow(err); }
      });
      pop.querySelector('#__cxZheConfirm').addEventListener('click', function () {
        try { if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.zhihuishuExamSubmitNow === 'function') window.__CX_FORCE_PLAY.zhihuishuExamSubmitNow(); } catch (err) { swallow(err); }
      });
    } else {
      pop.innerHTML = _zhsVideoPopHTML();
      pop.querySelector('#__cxZhsToggle').addEventListener('click', function () {
        try {
          _zhsFabEnabled = !_zhsFabEnabled;
          try { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) {
            window.__CX_FORCE_PLAY.CONFIG.INTRUSION_MODE = _zhsFabEnabled ? 'auto' : 'gentle';
            if (typeof window.__CX_FORCE_PLAY.reconcileIntrusionMode === 'function') window.__CX_FORCE_PLAY.reconcileIntrusionMode();
          } } catch (e2) { swallow(e2); }
          _zhsRefreshVideo();
        } catch (e) { swallow(e); }
      });
    }
    _zhsRefreshFab();
  }

  function _zhsEnsureFab() {
    if (detectSite() !== 'zhihuishu') return;      // 隔离：非智慧树不渲染
    if (_zhsFab) { _zhsMaybeSwitchMode(); return; }
    try {
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
        try { pop.classList.toggle('cx-show'); _zhsRefreshFab(); } catch (e) { swallow(e); }
      });
      _zhsFab = fab;
      _zhsMode = _zhsIsExamPage() ? 'exam' : 'video';
      if (_zhsMode === 'exam') {
        pop.querySelector('#__cxZheAns').addEventListener('change', function (e) {
          try { localStorage.setItem('cx_zh_exam_on', e.target.checked ? '1' : '0'); if (window.__cxRegisterAddon) window.__cxRegisterAddon(); } catch (err) { swallow(err); }
        });
        pop.querySelector('#__cxZheSub').addEventListener('change', function (e) {
          try { localStorage.setItem('cx_zh_exam_autosubmit', e.target.checked ? '1' : '0'); } catch (err) { swallow(err); }
        });
        pop.querySelector('#__cxZheConfirm').addEventListener('click', function () {
          try { if (window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.zhihuishuExamSubmitNow === 'function') window.__CX_FORCE_PLAY.zhihuishuExamSubmitNow(); } catch (err) { swallow(err); }
        });
      } else {
        pop.querySelector('#__cxZhsToggle').addEventListener('click', function () {
          try {
            _zhsFabEnabled = !_zhsFabEnabled;
            try { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) {
              window.__CX_FORCE_PLAY.CONFIG.INTRUSION_MODE = _zhsFabEnabled ? 'auto' : 'gentle';
              if (typeof window.__CX_FORCE_PLAY.reconcileIntrusionMode === 'function') window.__CX_FORCE_PLAY.reconcileIntrusionMode();
            } } catch (e2) { swallow(e2); }
            _zhsRefreshVideo();
          } catch (e) { swallow(e); }
        });
      }
    } catch (e) { swallow(e); }
  }

  // 主循环每轮调用：确保图标存在，累加视频页弹窗作答数，并刷新当前面板
  function zhihuishuFabTick(handledCount) {
    if (detectSite() !== 'zhihuishu') return;
    try { _zhsEnsureFab(); } catch (e) { swallow(e); }
    if (handledCount > 0) _zhsFabAnswered += handledCount;
    try { _zhsRefreshFab(); } catch (e) { swallow(e); }
  }

  // 暴露给主循环与回归测试
  try { window.__CX_FORCE_PLAY.zhihuishuFabTick = zhihuishuFabTick; } catch (e) {}
