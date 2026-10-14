// @requires: CONFIG, EventBus, FLAGS, allVideos, applyUserRateAll, bestEffort, currentVideo, foregroundVideo, hidePanel, savePanelCfg, singleVideoActive, toggleNinjaMode, userPause, userResume
// @source-group: presentation/panel-core.js
// @continuation-of: presentation/panel-core.js
// Command and playback controls inside ensurePanel.

    var closeBtn = el.querySelector('#__cxPanelClose'); if (closeBtn) closeBtn.addEventListener('click', hidePanel);   // DS 控制台无此按钮，需 null 守卫
    // —— 命令面板：输入 / 唤起命令下拉，↑↓/Tab/Enter/Esc ——
    var cmdInp = el.querySelector('#__cxCmd');
    if (cmdInp) {
      cmdInp.addEventListener('input', _cxCmdOnInput);
      cmdInp.addEventListener('keydown', _cxCmdOnKey);
      cmdInp.addEventListener('blur', _cxCmdOnBlur);
      cmdInp.addEventListener('focus', _cxCmdUpdate);
      // 鼠标点击命令项：用 mousedown + preventDefault 抢在 input blur 之前执行，避免点击被吞（修复点击无效）
      var cmdListEl = el.querySelector('#__cxCmdList');
      if (cmdListEl) {
        cmdListEl.addEventListener('mousedown', function (ev) {
          ev.preventDefault();   // 阻止 input 失焦，保证点击生效
          // 星标按钮：收藏/取消收藏
          var favBtn = ev.target && ev.target.closest ? ev.target.closest('[data-fav]') : null;
          if (favBtn) {
            bestEffort(function () { _cxFavToggle(favBtn.getAttribute('data-fav')); }, 'panel.favToggle');
            return;
          }
          var item = ev.target && ev.target.closest ? ev.target.closest('[data-ci]') : null;
          if (!item) return;
          var idx = +item.getAttribute('data-ci');
          var c = _cxCmdFilter[idx];
          if (!c) return;
          if (c.args) { cmdInp.value = '/' + c.name + ' '; bestEffort(function () { cmdInp.focus(); var L = cmdInp.value.length; cmdInp.setSelectionRange(L, L); }, 'panel.cmdFocus'); _cxCmdRender(_cxCmdFilter, idx); }
          else { cmdInp.value = '/' + c.name; executeRawCmd('/' + c.name); hideCmdList(); cmdInp.value = ''; }
        });
      }
    }
    var btnPauseEl = el.querySelector('#__cxBtnPause'); if (btnPauseEl) btnPauseEl.addEventListener('click', function () {
      var v = currentVideo(); if (!v) { EventBus.emit('ui:toast', '无目标视频'); return; }
      if (v[FLAGS.userPaused]) userResume(v); else userPause(v);
      EventBus.emit('panel:refresh');
    });
    // 视频列表：事件委托，逐个暂停/恢复（修复"多视频下只能控制单个视频"）
    var vlist = el.querySelector('#__cxVideoList');
    if (vlist) vlist.addEventListener('click', function (ev) {
      bestEffort(function () {
        var btn = ev.target && ev.target.closest ? ev.target.closest('[data-vi]') : null;
        if (!btn) return;
        if (btn.getAttribute('data-dis')) return;          // 已结束 或 单视频模式：开关禁用
        if (singleVideoActive()) return;                   // 双保险：单视频模式（全局或本门课）下不响应点击
        var idx = +btn.getAttribute('data-vi');
        var vv = (_lastVideoList && _lastVideoList[idx]) || allVideos()[idx];
        if (!vv) return;
        if (vv[FLAGS.userPaused]) userResume(vv); else userPause(vv);
        EventBus.emit('panel:refresh');
      }, 'panel.videoListClick');
    });
    // 快切按钮：仅播此轨（暂停所有其他视频，只保留前台）
    var btnOnlyFg = el.querySelector('#__cxBtnOnlyFg');
    if (btnOnlyFg) btnOnlyFg.addEventListener('click', function () {
      bestEffort(function () {
        var fg = _lockFg || foregroundVideo();
        if (!fg) { EventBus.emit('ui:toast', '未找到前台视频'); return; }
        var vs = allVideos();
        for (var i = 0; i < vs.length; i++) {
          if (vs[i] !== fg) bestEffort(function (v) { userPause(v); }.bind(null, vs[i]), 'panel.onlyFgPause');
          else bestEffort(function (v) { if (v[FLAGS.userPaused]) userResume(v); }.bind(null, vs[i]), 'panel.onlyFgResume');
        }
        EventBus.emit('ui:toast', '仅播此轨：已暂停其他 ' + (vs.length - 1) + ' 个视频', 'success');
        EventBus.emit('panel:refresh');
      }, 'panel.onlyFg');
    });
    // 快切按钮：全部续播（恢复所有视频）
    var btnResumeAll = el.querySelector('#__cxBtnResumeAll');
    if (btnResumeAll) btnResumeAll.addEventListener('click', function () {
      bestEffort(function () {
        var vs = allVideos();
        for (var i = 0; i < vs.length; i++) { bestEffort(function (v) { if (v[FLAGS.userPaused]) userResume(v); }.bind(null, vs[i]), 'panel.resumeAll'); }
        EventBus.emit('ui:toast', '全部续播：已恢复 ' + vs.length + ' 个视频', 'success');
        EventBus.emit('panel:refresh');
      }, 'panel.resumeAll');
    });
    // 锁定前台开关
    var lockFg = el.querySelector('#__cxLockFg');
    if (lockFg) lockFg.addEventListener('change', function () {
      bestEffort(function () {
        if (lockFg.checked) {
          _lockFg = foregroundVideo();
          EventBus.emit('ui:toast', '已锁定前台：滚动不会丢失前台资格');
        } else {
          _lockFg = null;
          EventBus.emit('ui:toast', '已解锁前台：恢复自动前台检测');
        }
        EventBus.emit('panel:refresh');
      }, 'panel.lockFg');
    });
    var auto = el.querySelector('#__cxAuto');
    if (auto) auto.addEventListener('input', function () { CONFIG.AUTO_STOP_MIN = +auto.value; savePanelCfg(); EventBus.emit('panel:refresh'); });
    var res = el.querySelector('#__cxResume');
    if (res) res.addEventListener('input', function () { CONFIG.RESUME_AFTER_MIN = +res.value; savePanelCfg(); EventBus.emit('panel:refresh'); });
    var resc = el.querySelector('#__cxRescan');
    if (resc) resc.addEventListener('input', function () {
      var _ri = +resc.value; if (!_ri || _ri < 500) _ri = 500; if (_ri > 5000) _ri = 5000;  // P1-5：下限守卫，避免 setInterval(_,0) 忙循环
      CONFIG.RESCAN_INTERVAL = _ri;
      // P1：经 restartLoopTimer() 统一重启主循环定时器(已登记 TimerRegistry，先 clear 再 set)，消除裸 setInterval 双定时器泄漏
      bestEffort(function () { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.restartLoopTimer === 'function') window.__CX_FORCE_PLAY.restartLoopTimer(); }, 'panel.restartTimer');
      savePanelCfg(); EventBus.emit('panel:refresh');
    });
    var endrel = el.querySelector('#__cxEndRel');
    if (endrel) endrel.addEventListener('input', function () { CONFIG.END_RELEASE_SEC = +endrel.value; savePanelCfg(); EventBus.emit('panel:refresh'); });
    // 面板宽度：实时改 CSS 变量（正常态与 Ninja 展开态同步生效），并持久化
    var pw = el.querySelector('#__cxPanelW');
    if (pw) {
      pw.addEventListener('input', function () {
        CONFIG.PANEL_W = +pw.value;
        clampCfg();
        bestEffort(function () { el.style.setProperty('--cx-panel-w', CONFIG.PANEL_W + 'px'); }, 'panel.setPW');
        var pwv = el.querySelector('#__cxPanelWVal'); if (pwv) pwv.textContent = CONFIG.PANEL_W;
        savePanelCfg();
      });
    }
    var rateSel = el.querySelector('#__cxRate');
    if (rateSel) {
      rateSel.value = ('' + (CONFIG.USER_RATE || 1));
      rateSel.addEventListener('change', function () {
        var r = parseFloat(this.value);
        CONFIG.USER_RATE = (isNaN(r) ? 1 : r);
        clampCfg(); CONFIG.USER_RATE = (CONFIG.USER_RATE || 1);
        var tr = el.querySelector('#__cxTopRate'); if (tr) tr.textContent = CONFIG.USER_RATE + 'x';   // 同步状态条速率
        savePanelCfg(); applyUserRateAll();
        EventBus.emit('panel:refresh');
      });
    }
    // Ninja 模式开关
    var ninja = el.querySelector('#__cxNinja');
    if (ninja) {
      ninja.addEventListener('change', function () {
        CONFIG.NINJA_MODE = !!ninja.checked;
        if (CONFIG.NINJA_MODE) {
          el.classList.add('ninja');
          el.classList.remove('ninja-open');
          restoreNinjaPos(); clampNinjaPos();
          EventBus.emit('ui:toast', 'Ninja 模式已开：面板缩成圆形，点击圆点展开');
        } else {
          el.classList.remove('ninja', 'ninja-open');
          EventBus.emit('ui:toast', 'Ninja 模式已关');
        }
        setNinjaAria();
        savePanelCfg();
      });
    }
    // 退出 n 模式按钮（仅 Ninja 展开态显示）：一键恢复常驻宽面板，给卡在窄条的用户逃生通道
    var exitNinjaBtn = el.querySelector('#__cxExitNinja');
    if (exitNinjaBtn) exitNinjaBtn.addEventListener('click', function (e) { bestEffort(function () { e.stopPropagation(); toggleNinjaMode(); }, 'panel.exitNinja'); });
