// @requires: CONFIG, CX_KEYS, DEBUG, EventBus, FLAGS, _cxPanel, allVideos, applyUserRateAll, bestEffort, copyDiagnostics, currentVideo, foregroundVideo, hidePanel, safeGet, savePanelCfg, swallow, toggleNinjaMode, topHref, urlParam, userPause, userResume
// @source-group: presentation/commands.js
  // ===== DOMAIN: presentation/commands (command palette) =====
  // ===== MODULE: 命令面板 =====
  // 域：presentation/面板模块 —— 命令面板。
  // 在控制面板内提供「/命令」输入：输入 / 唤起下拉、↑↓ 选择、Tab 补全、Enter 执行、Esc 关闭下拉。
  // 命令可带参数（如 /rate 2 /autostop 5）；无参数命令鼠标点击即执行，有参数命令点击后填入待补全。
  // registerCommand 同时暴露到 window.__cxRegisterCommand，供工具库项/其它脚本扩展命令。
  var _cxCommands = [];                 // [{name, desc, args, exec, group}]
  var _cxCmdFilter = [];                // 当前过滤后的命令（用于 ↑↓ 高亮）
  var _cxCmdHi = -1;                    // 高亮索引（过滤列表内）
  // —— 命令收藏夹：星标系统，持久化到 localStorage ——
  var _cxFavorites = [];                // 收藏的命令名数组
  _cxFavorites = safeGet(function () { return JSON.parse(localStorage.getItem(CX_KEYS.CMD_FAV) || '[]'); }, []);
  function _cxFavSave() { bestEffort(function () { localStorage.setItem(CX_KEYS.CMD_FAV, JSON.stringify(_cxFavorites)); }, 'cmd.favSave'); }
  function _cxFavToggle(name) {
    var idx = _cxFavorites.indexOf(name);
    if (idx >= 0) { _cxFavorites.splice(idx, 1); EventBus.emit('ui:toast', '已取消收藏 /' + name); }
    else { _cxFavorites.push(name); EventBus.emit('ui:toast', '已收藏 /' + name); }
    _cxFavSave();
    _cxCmdUpdate();  // 刷新下拉
  }
  // —— 最近使用：成功执行的命令名（最多 8 条），用于下拉排序加权 ——
  var _cxRecent = [];
  _cxRecent = safeGet(function () { return JSON.parse(localStorage.getItem('cx_cmd_recent') || '[]'); }, []);
  function _cxRecentPush(name) {
    name = '' + (name || ''); if (!name) return;
    var ri = _cxRecent.indexOf(name); if (ri >= 0) _cxRecent.splice(ri, 1);
    _cxRecent.unshift(name); if (_cxRecent.length > 8) _cxRecent.length = 8;
    bestEffort(function () { localStorage.setItem('cx_cmd_recent', JSON.stringify(_cxRecent)); }, 'cmd.recentSave');
  }
  function registerCommand(name, desc, hasArgs, exec, group) {   // name 不含斜杠；group 为分组名（可选）
    name = ('' + (name || '')).replace(/^\//, '').trim().toLowerCase();
    if (!name) return;
    for (var i = 0; i < _cxCommands.length; i++) { if (_cxCommands[i].name === name) { _cxCommands[i].desc = desc; _cxCommands[i].args = !!hasArgs; _cxCommands[i].exec = exec; _cxCommands[i].group = group || ''; return; } }
    _cxCommands.push({ name: name, desc: desc || '', args: !!hasArgs, exec: exec, group: group || '' });
  }
  function executeRawCmd(raw) {         // 解析并执任何输入（含参数），下拉关闭与否都执行——修复「参数命令下拉关闭后 Enter 不执行」
    raw = ('' + (raw || '')).trim();
    if (!raw) { EventBus.emit('ui:toast', '请输入命令，如 /pause（输入 / 查看全部）'); return false; }
    var sp = raw.indexOf(' ');
    var head = (sp < 0 ? raw : raw.slice(0, sp)).replace(/^\//, '').toLowerCase();
    var arg = (sp < 0 ? '' : raw.slice(sp + 1)).trim();
    if (!head) { EventBus.emit('ui:toast', '请输入命令名称，如 /pause'); return false; }
    for (var i = 0; i < _cxCommands.length; i++) {
      if (_cxCommands[i].name === head) {
        try { _cxCommands[i].exec(raw, arg); } catch (e) { swallow(e); EventBus.emit('ui:toast', '命令执行出错: ' + head, 'error'); }
        _cxRecentPush(head);
        return true;
      }
    }
    EventBus.emit('ui:toast', '未知命令: /' + head + '（输入 / 查看全部）', 'warn');
    return false;
  }
  function _videoByArg(arg) {           // 参数为空→前台/当前视频；数字→该序号视频
    if (!arg) { var v = currentVideo(); if (!v) { EventBus.emit('ui:toast', '未找到当前视频，无法执行'); return undefined; } return v; }
    var n = parseInt(arg, 10); if (isNaN(n)) { EventBus.emit('ui:toast', '参数需为数字序号，如 /pause 2'); return undefined; }
    var vs = allVideos(); var v2 = vs[n - 1];
    if (!v2) { EventBus.emit('ui:toast', '无第 ' + n + ' 个视频（共 ' + vs.length + ' 个）'); return undefined; }
    return v2;
  }
  function initBuiltinCommands() {      // 注册内置命令（幂等）
    if (_cxCommands.length) return;     // 已注册则跳过，避免重复
    registerCommand('pause', '暂停视频（可带序号，如 /pause 2）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userPause(v); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '已暂停视频', 'success');
    });
    registerCommand('resume', '恢复续播（可带序号）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userResume(v); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '已恢复续播', 'success');
    });
    registerCommand('loop', '循环播放 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); CONFIG.LOOP_PLAY = on; clampCfg(); applyLoopAll(); syncPanelInputs(); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '循环播放 ' + (on ? '开' : '关'));
    });
    registerCommand('rate', '设置播放速率，如 /rate 1.5', true, function (raw, arg) {
      var r = parseFloat(arg); if (isNaN(r)) { EventBus.emit('ui:toast', '用法: /rate 0.5~2'); return; } CONFIG.USER_RATE = r; clampCfg(); applyUserRateAll(); syncPanelInputs(); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '播放速率 ' + CONFIG.USER_RATE + 'x');
    });
    registerCommand('autostop', '自动停止计时(分钟)，如 /autostop 30', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { EventBus.emit('ui:toast', '用法: /autostop 0~120'); return; } CONFIG.AUTO_STOP_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '自动停止 ' + CONFIG.AUTO_STOP_MIN + ' 分钟');
    });
    registerCommand('autoresume', '暂停后自动恢复(分钟)，如 /autoresume 10', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { EventBus.emit('ui:toast', '用法: /autoresume 0~60'); return; } CONFIG.RESUME_AFTER_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '自动恢复 ' + CONFIG.RESUME_AFTER_MIN + ' 分钟');
    });
    registerCommand('debug', '调试日志 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); DEBUG = on; savePanelCfg(); EventBus.emit('ui:toast', '调试日志 ' + (on ? '开' : '关'));
    });
    // 开发者模式：功能自检矩阵 + 调试日志开关（由 diagnostics.buildDevReport 提供联动盘点）
    registerCommand('dev', '开发者模式：dev 自检功能实现(联动诊断信息) / dev on|off 开关调试日志', true, function (raw, arg) {
      var a = ('' + (arg || '')).trim().toLowerCase();
      if (a === 'on') { DEBUG = true; savePanelCfg(); EventBus.emit('ui:toast', '开发者模式：开（已启用调试日志）', 'success'); return; }
      if (a === 'off') { DEBUG = false; savePanelCfg(); EventBus.emit('ui:toast', '开发者模式：关（已关闭调试日志）', 'info'); return; }
      bestEffort(function () {
        var _fp = window.__CX_FORCE_PLAY || {};
        if (typeof _fp.buildDevReport !== 'function') { EventBus.emit('ui:toast', '功能自检不可用', 'error'); return; }
        var rep = _fp.buildDevReport();
        var st = rep.selfTest, diag = rep.diagnostics || '';
        // 控制台：先自检矩阵(表格)，再附诊断信息(联动)
        try {
          if (st && st.rows) {
            var rows = st.rows.map(function (r) { return { 状态: r.status, 域: r.group, 功能: r.name, 说明: r.detail }; });
            console.log('%c[开发者模式] 功能自检矩阵（站点=' + (st.site || '?') + '）', 'font-weight:bold;color:#3fb950;');
            if (typeof console.table === 'function') console.table(rows); else console.log(rows);
          }
          console.log('%c[开发者模式] 诊断信息（与自检矩阵联动）', 'font-weight:bold;color:#58a6ff;');
          console.log(diag);
        } catch (e) {}
        EventBus.emit('ui:switchTab', 'insight'); showPanel(); EventBus.emit('panel:refresh');
        var s = (st && st.summary) || { ok: 0, partial: 0, na: 0, fail: 0 };
        EventBus.emit('ui:toast', '自检' + s.ok + '/部分' + s.partial + '/不适用' + s.na + '/失败' + s.fail + ' · 诊断已联动', s.fail ? 'error' : 'success');
        var txt = (typeof _fp.buildDevReportText === 'function') ? _fp.buildDevReportText() : diag;
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).catch(function () {}); } catch (e) {}
      }, 'cmd.dev');
    });
    registerCommand('copy', '复制诊断信息', false, function () { copyDiagnostics(); });
    registerCommand('refresh', '立即重扫视频与状态', false, function () { bestEffort(function () { EventBus.emit('cmd:scan'); }, 'cmd.scan'); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '已重扫'); });
    registerCommand('evict', '出清所有可治理本地数据(答题缓存/GM大值/统计)，下一节从零', false, function () {
      bestEffort(function () {
        var f = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.dataGovernance) || null;
        if (!f || typeof f.evictAll !== 'function') { EventBus.emit('ui:toast', '出清指令不可用'); return; }
        var n = f.evictAll('command');
        EventBus.emit('ui:toast', '已出清本地数据（' + n + ' 项）');
      }, 'cmd.evict');
    });
    registerCommand('evict-all', '同 /evict：出清所有非受保护本地数据', false, function () {
      bestEffort(function () {
        var f = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.dataGovernance) || null;
        if (!f || typeof f.evictAll !== 'function') { EventBus.emit('ui:toast', '出清指令不可用'); return; }
        var n = f.evictAll('command');
        EventBus.emit('ui:toast', '已出清本地数据（' + n + ' 项）');
      }, 'cmd.evictAll');
    });
    registerCommand('evict-session', '仅清答题态(缓存+GM答题大图)，保留统计/配置', false, function () {
      bestEffort(function () {
        var f = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.dataGovernance) || null;
        if (!f || typeof f.evict !== 'function') { EventBus.emit('ui:toast', '出清指令不可用'); return; }
        var n = f.evict(['session', 'relay'], 'command');
        EventBus.emit('ui:toast', '已出清答题态（' + n + ' 项）');
      }, 'cmd.evictSession');
    });
    registerCommand('audit', '刷新安全审计清单(洞察页)', false, function () { bestEffort(function () { EventBus.emit('ui:switchTab', 'insight'); showPanel(); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '已刷新侵入点清单'); }, 'cmd.audit'); });
    registerCommand('rescan', '重启轮询(ms)，如 /rescan 1000', true, function (raw, arg) {
      var ms = parseInt(arg, 10); if (isNaN(ms)) { EventBus.emit('ui:toast', '用法: /rescan 500~5000'); return; } CONFIG.RESCAN_INTERVAL = ms; clampCfg(); savePanelCfg();
      // P1：经 restartLoopTimer() 统一重启主循环定时器(已登记 TimerRegistry，先 clear 再 set)，消除裸 setInterval 双定时器泄漏
      bestEffort(function () { if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY.restartLoopTimer === 'function') window.__CX_FORCE_PLAY.restartLoopTimer(); }, 'cmd.rescan');
      syncPanelInputs(); EventBus.emit('panel:refresh'); EventBus.emit('ui:toast', '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms');
    });
    registerCommand('cleardata', '彻底清除脚本写入的 localStorage(cx_* 键)', false, function () {
      bestEffort(function () {
        var n = 0;
        for (var i = localStorage.length - 1; i >= 0; i--) {
          var k = localStorage.key(i);
          if (k && k.indexOf('cx_') === 0) { (function (key) { bestEffort(function () { localStorage.removeItem(key); n++; }, 'cmd.cleardata.rm'); })(k); }
        }
        EventBus.emit('ui:toast', '已清除 ' + n + ' 个 cx_* 键（刷新后配置/统计归零）', 'success');
      }, 'cmd.cleardata');
    });
    registerCommand('help', '显示命令帮助', false, function () {
      var names = _cxCommands.map(function (c) { return '/' + c.name + (c.args ? ' …' : ''); }).join('  ');
      EventBus.emit('ui:toast', '命令: ' + names);
      _cxCmdShowAll && _cxCmdShowAll();
    });
    registerCommand('close', '关闭面板', false, function () { hidePanel(); });
    registerCommand('hide', '关闭面板', false, function () { hidePanel(); });
    // —— 视频快捷操作 ——
    registerCommand('only', '仅播此轨：暂停其他视频，只留前台播放', false, function () {
      bestEffort(function () { var fg = foregroundVideo(); if (!fg) { EventBus.emit('ui:toast', '未找到前台视频'); return; }
        var vs = allVideos(); for (var i = 0; i < vs.length; i++) { if (vs[i] !== fg && !vs[i][FLAGS.userPaused]) userPause(vs[i]); }
        EventBus.emit('ui:toast', '已仅播前台视频'); EventBus.emit('panel:refresh');
      }, 'cmd.only');
    });
    registerCommand('resumeall', '全部续播：恢复所有被暂停的视频', false, function () {
      bestEffort(function () { var vs = allVideos(); for (var i = 0; i < vs.length; i++) { if (vs[i][FLAGS.userPaused]) userResume(vs[i]); }
        EventBus.emit('ui:toast', '已全部续播'); EventBus.emit('panel:refresh');
      }, 'cmd.resumeall');
    });
    registerCommand('mute', '前台视频静音 on/off（默认切换）', true, function (raw, arg) {
      bestEffort(function () { var fg = foregroundVideo(); if (!fg) { EventBus.emit('ui:toast', '未找到前台视频'); return; }
        var on = arg ? !/^off$/i.test(arg.trim()) : !fg.muted; fg.muted = !!on;
        EventBus.emit('ui:toast', '前台视频已' + (fg.muted ? '静音' : '取消静音'));
      }, 'cmd.mute');
    });
    registerCommand('seek', '前台视频跳转到指定秒数', true, function (raw, arg) {
      bestEffort(function () { var fg = foregroundVideo(); if (!fg) { EventBus.emit('ui:toast', '未找到前台视频'); return; }
        var s = parseFloat(arg); if (isNaN(s)) { EventBus.emit('ui:toast', '用法: /seek 120'); return; }
        bestEffort(function () { fg.currentTime = s; }, 'cmd.seek.currentTime');
        EventBus.emit('ui:toast', '已跳到 ' + Math.round(s) + ' 秒');
      }, 'cmd.seek');
    });
    // —— 面板 / 模式控制 ——
    registerCommand('ninja', '切换 n 模式（可加 on/off）', true, function (raw, arg) {
      bestEffort(function () { if (arg) { var on = !/^off$/i.test(arg.trim()); if (!!CONFIG.NINJA_MODE === on) { EventBus.emit('ui:toast', 'n 模式已是 ' + (on ? 'on' : 'off')); return; } }
        toggleNinjaMode(); EventBus.emit('ui:toast', 'n 模式已' + (CONFIG.NINJA_MODE ? '开' : '关'));
      }, 'cmd.ninja');
    });
    registerCommand('single', '单视频模式 on/off（只控制前台视频）', true, function (raw, arg) {
      bestEffort(function () { var on = arg ? !/^off$/i.test(arg.trim()) : !CONFIG.SINGLE_VIDEO; CONFIG.SINGLE_VIDEO = !!on;
        savePanelCfg(); syncPanelInputs(); EventBus.emit('ui:toast', '单视频模式 ' + (CONFIG.SINGLE_VIDEO ? '开' : '关'));
      }, 'cmd.single');
    });
    registerCommand('single-course', '本门课单视频 on/off（避免并发续播触发风控）', true, function (raw, arg) {
      bestEffort(function () {
        var ns = window.__CX_FORCE_PLAY;
        if (!ns || typeof ns.toggleCourseSingleVideo !== 'function') { EventBus.emit('ui:toast', '单视频课程名单不可用'); return; }
        var on = arg ? !/^off$/i.test(arg.trim()) : true;
        var cid = (typeof urlParam === 'function') ? urlParam(topHref(), ['courseId']) : '';
        if (!cid) { EventBus.emit('ui:toast', '当前非课程页，无法按课程设置'); return; }
        var cur = (CONFIG.SINGLE_VIDEO_COURSES || []).indexOf(cid) !== -1;
        if (on === cur) { EventBus.emit('ui:toast', '本门课单视频已为 ' + (on ? '开' : '关')); return; }
        ns.toggleCourseSingleVideo(cid);
        EventBus.emit('ui:toast', '本门课单视频 ' + (on ? '开' : '关'));
      }, 'cmd.singleCourse');
    });
    registerCommand('width', '设置面板宽度(px, 288-760)', true, function (raw, arg) {
      bestEffort(function () { var w = parseInt(arg, 10); if (isNaN(w)) { EventBus.emit('ui:toast', '用法: /width 520'); return; }
        CONFIG.PANEL_W = w; clampCfg(); savePanelCfg();
        if (_cxPanel) _cxPanel.style.setProperty('--cx-panel-w', CONFIG.PANEL_W + 'px');
        syncPanelInputs(); EventBus.emit('ui:toast', '面板宽度 → ' + CONFIG.PANEL_W + 'px');
      }, 'cmd.width');
    });
    registerCommand('tab', '切换标签页: control|automation|insight|system', true, function (raw, arg) {
      bestEffort(function () { var m = { control: 'control', automation: 'automation', insight: 'insight', system: 'system', 控制: 'control', 自动: 'automation', 洞察: 'insight', 系统: 'system' };
        var name = m[(arg || '').trim().toLowerCase()]; if (!name) { EventBus.emit('ui:toast', '用法: /tab system'); return; }
        EventBus.emit('ui:switchTab', name); EventBus.emit('ui:toast', '已切到「' + name + '」');
      }, 'cmd.tab');
    });
  }
  // 内置命令分组标注（命令面板按组渲染，降低长列表查找成本）
  (function () {
    var G = { pause:'播放控制', resume:'播放控制', loop:'播放控制', rate:'播放控制', only:'播放控制', resumeall:'播放控制', mute:'播放控制', seek:'播放控制', autostop:'播放控制', autoresume:'播放控制', ninja:'面板模式', single:'面板模式', width:'面板模式', tab:'面板模式', debug:'面板模式', close:'面板模式', hide:'面板模式', copy:'系统工具', refresh:'系统工具', audit:'系统工具', rescan:'系统工具', cleardata:'系统工具', evict:'系统工具', 'evict-all':'系统工具', 'evict-session':'系统工具', help:'系统工具', 'dev':'系统工具' };
    for (var i = 0; i < _cxCommands.length; i++) { var g = G[_cxCommands[i].name]; if (g) _cxCommands[i].group = g; }
  })();
