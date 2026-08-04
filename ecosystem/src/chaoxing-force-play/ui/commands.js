  // ===== DOMAIN: ui/commands (command palette) =====
  // ===== MODULE: 命令面板 =====
  // 域：UI/面板模块 —— 命令面板。
  // 在控制面板内提供「/命令」输入：输入 / 唤起下拉、↑↓ 选择、Tab 补全、Enter 执行、Esc 关闭下拉。
  // 命令可带参数（如 /rate 2 /autostop 5）；无参数命令鼠标点击即执行，有参数命令点击后填入待补全。
  // registerCommand 同时暴露到 window.__cxRegisterCommand，供副脚本/其它脚本扩展命令。
  var _cxCommands = [];                 // [{name, desc, args, exec}]
  var _cxCmdFilter = [];                // 当前过滤后的命令（用于 ↑↓ 高亮）
  var _cxCmdHi = -1;                    // 高亮索引（过滤列表内）
  // —— 命令收藏夹：星标系统，持久化到 localStorage ——
  var _cxFavorites = [];                // 收藏的命令名数组
  try { _cxFavorites = JSON.parse(localStorage.getItem('cx_cmd_fav') || '[]'); } catch (e) { _cxFavorites = []; }
  function _cxFavSave() { try { localStorage.setItem('cx_cmd_fav', JSON.stringify(_cxFavorites)); } catch (e) { swallow(e); } }
  function _cxFavToggle(name) {
    var idx = _cxFavorites.indexOf(name);
    if (idx >= 0) { _cxFavorites.splice(idx, 1); Store.emit('ui:toast', '已取消收藏 /' + name); }
    else { _cxFavorites.push(name); Store.emit('ui:toast', '已收藏 /' + name); }
    _cxFavSave();
    _cxCmdUpdate();  // 刷新下拉
  }
  function registerCommand(name, desc, hasArgs, exec) {   // name 不含斜杠；exec(rawInput, argStr)
    name = ('' + (name || '')).replace(/^\//, '').trim().toLowerCase();
    if (!name) return;
    for (var i = 0; i < _cxCommands.length; i++) { if (_cxCommands[i].name === name) { _cxCommands[i].desc = desc; _cxCommands[i].args = !!hasArgs; _cxCommands[i].exec = exec; return; } }
    _cxCommands.push({ name: name, desc: desc || '', args: !!hasArgs, exec: exec });
  }
  function executeRawCmd(raw) {         // 解析并执任何输入（含参数），下拉关闭与否都执行——修复「参数命令下拉关闭后 Enter 不执行」
    raw = ('' + (raw || '')).trim();
    if (!raw) { Store.emit('ui:toast', '请输入命令，如 /pause（输入 / 查看全部）'); return false; }
    var sp = raw.indexOf(' ');
    var head = (sp < 0 ? raw : raw.slice(0, sp)).replace(/^\//, '').toLowerCase();
    var arg = (sp < 0 ? '' : raw.slice(sp + 1)).trim();
    if (!head) { Store.emit('ui:toast', '请输入命令名称，如 /pause'); return false; }
    for (var i = 0; i < _cxCommands.length; i++) {
      if (_cxCommands[i].name === head) {
        try { _cxCommands[i].exec(raw, arg); } catch (e) { swallow(e); Store.emit('ui:toast', '命令执行出错: ' + head, 'error'); }
        return true;
      }
    }
    Store.emit('ui:toast', '未知命令: /' + head + '（输入 / 查看全部）', 'warn');
    return false;
  }
  function _videoByArg(arg) {           // 参数为空→前台/当前视频；数字→该序号视频
    if (!arg) { var v = currentVideo(); if (!v) { Store.emit('ui:toast', '未找到当前视频，无法执行'); return undefined; } return v; }
    var n = parseInt(arg, 10); if (isNaN(n)) { Store.emit('ui:toast', '参数需为数字序号，如 /pause 2'); return undefined; }
    var vs = allVideos(); var v = vs[n - 1];
    if (!v) { Store.emit('ui:toast', '无第 ' + n + ' 个视频（共 ' + vs.length + ' 个）'); return undefined; }
    return v;
  }
  function initBuiltinCommands() {      // 注册内置命令（幂等）
    if (_cxCommands.length) return;     // 已注册则跳过，避免重复
    registerCommand('pause', '暂停视频（可带序号，如 /pause 2）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userPause(v); Store.emit('panel:refresh'); Store.emit('ui:toast', '已暂停视频', 'success');
    });
    registerCommand('resume', '恢复续播（可带序号）', true, function (raw, arg) {
      var v = _videoByArg(arg); if (!v) return; userResume(v); Store.emit('panel:refresh'); Store.emit('ui:toast', '已恢复续播', 'success');
    });
    registerCommand('loop', '循环播放 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); CONFIG.LOOP_PLAY = on; clampCfg(); applyLoopAll(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '循环播放 ' + (on ? '开' : '关'));
    });
    registerCommand('rate', '设置播放速率，如 /rate 1.5', true, function (raw, arg) {
      var r = parseFloat(arg); if (isNaN(r)) { Store.emit('ui:toast', '用法: /rate 0.5~2'); return; } CONFIG.USER_RATE = r; clampCfg(); applyUserRateAll(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '播放速率 ' + CONFIG.USER_RATE + 'x');
    });
    registerCommand('autostop', '自动停止计时(分钟)，如 /autostop 30', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { Store.emit('ui:toast', '用法: /autostop 0~120'); return; } CONFIG.AUTO_STOP_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '自动停止 ' + CONFIG.AUTO_STOP_MIN + ' 分钟');
    });
    registerCommand('autoresume', '暂停后自动恢复(分钟)，如 /autoresume 10', true, function (raw, arg) {
      var m = parseFloat(arg); if (isNaN(m)) { Store.emit('ui:toast', '用法: /autoresume 0~60'); return; } CONFIG.RESUME_AFTER_MIN = m; clampCfg(); savePanelCfg(); syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '自动恢复 ' + CONFIG.RESUME_AFTER_MIN + ' 分钟');
    });
    registerCommand('debug', '调试日志 on/off', true, function (raw, arg) {
      var on = !(arg && (arg.toLowerCase() === 'off' || arg === '0')); DEBUG = on; savePanelCfg(); Store.emit('ui:toast', '调试日志 ' + (on ? '开' : '关'));
    });
    registerCommand('copy', '复制诊断信息', false, function () { copyDiagnostics(); });
    registerCommand('refresh', '立即重扫视频与状态', false, function () { try { Store.emit('cmd:scan'); } catch (e) { swallow(e); } Store.emit('panel:refresh'); Store.emit('ui:toast', '已重扫'); });
    registerCommand('rescan', '重启轮询(ms)，如 /rescan 1000', true, function (raw, arg) {
      var ms = parseInt(arg, 10); if (isNaN(ms)) { Store.emit('ui:toast', '用法: /rescan 500~5000'); return; } CONFIG.RESCAN_INTERVAL = ms; clampCfg(); savePanelCfg();
      try { if (_loopTimer) clearInterval(_loopTimer); } catch (e) { swallow(e); }
      try { _loopTimer = setInterval(_loopTick, CONFIG.RESCAN_INTERVAL); } catch (e) { swallow(e); }
      syncPanelInputs(); Store.emit('panel:refresh'); Store.emit('ui:toast', '轮询 ' + CONFIG.RESCAN_INTERVAL + 'ms');
    });
    registerCommand('help', '显示命令帮助', false, function () {
      var names = _cxCommands.map(function (c) { return '/' + c.name + (c.args ? ' …' : ''); }).join('  ');
      Store.emit('ui:toast', '命令: ' + names);
      _cxCmdShowAll && _cxCmdShowAll();
    });
    registerCommand('close', '关闭面板', false, function () { hidePanel(); });
    registerCommand('hide', '关闭面板', false, function () { hidePanel(); });
    // —— 视频快捷操作 ——
    registerCommand('only', '仅播此轨：暂停其他视频，只留前台播放', false, function () {
      try { var fg = foregroundVideo(); if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var vs = allVideos(); for (var i = 0; i < vs.length; i++) { if (vs[i] !== fg && !vs[i].__cxUserPaused) userPause(vs[i]); }
        Store.emit('ui:toast', '已仅播前台视频'); Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    registerCommand('resumeall', '全部续播：恢复所有被暂停的视频', false, function () {
      try { var vs = allVideos(); for (var i = 0; i < vs.length; i++) { if (vs[i].__cxUserPaused) userResume(vs[i]); }
        Store.emit('ui:toast', '已全部续播'); Store.emit('panel:refresh');
      } catch (e) { swallow(e); }
    });
    registerCommand('mute', '前台视频静音 on/off（默认切换）', true, function (raw, arg) {
      try { var fg = foregroundVideo(); if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var on = arg ? !/^off$/i.test(arg.trim()) : !fg.muted; fg.muted = !!on;
        Store.emit('ui:toast', '前台视频已' + (fg.muted ? '静音' : '取消静音'));
      } catch (e) { swallow(e); }
    });
    registerCommand('seek', '前台视频跳转到指定秒数', true, function (raw, arg) {
      try { var fg = foregroundVideo(); if (!fg) { Store.emit('ui:toast', '未找到前台视频'); return; }
        var s = parseFloat(arg); if (isNaN(s)) { Store.emit('ui:toast', '用法: /seek 120'); return; }
        try { fg.currentTime = s; } catch (e2) { swallow(e2); }
        Store.emit('ui:toast', '已跳到 ' + Math.round(s) + ' 秒');
      } catch (e) { swallow(e); }
    });
    // —— 面板 / 模式控制 ——
    registerCommand('ninja', '切换 n 模式（可加 on/off）', true, function (raw, arg) {
      try { if (arg) { var on = !/^off$/i.test(arg.trim()); if (!!CONFIG.NINJA_MODE === on) { Store.emit('ui:toast', 'n 模式已是 ' + (on ? 'on' : 'off')); return; } }
        toggleNinjaMode(); Store.emit('ui:toast', 'n 模式已' + (CONFIG.NINJA_MODE ? '关' : '开'));
      } catch (e) { swallow(e); }
    });
    registerCommand('single', '单视频模式 on/off（只控制前台视频）', true, function (raw, arg) {
      try { var on = arg ? !/^off$/i.test(arg.trim()) : !CONFIG.SINGLE_VIDEO; CONFIG.SINGLE_VIDEO = !!on;
        savePanelCfg(); syncPanelInputs(); Store.emit('ui:toast', '单视频模式 ' + (CONFIG.SINGLE_VIDEO ? '开' : '关'));
      } catch (e) { swallow(e); }
    });
    registerCommand('width', '设置面板宽度(px, 288-760)', true, function (raw, arg) {
      try { var w = parseInt(arg, 10); if (isNaN(w)) { Store.emit('ui:toast', '用法: /width 520'); return; }
        CONFIG.PANEL_W = w; clampCfg(); savePanelCfg();
        if (_cxPanel) _cxPanel.style.setProperty('--cx-panel-w', CONFIG.PANEL_W + 'px');
        syncPanelInputs(); Store.emit('ui:toast', '面板宽度 → ' + CONFIG.PANEL_W + 'px');
      } catch (e) { swallow(e); }
    });
    registerCommand('tab', '切换标签页: control|automation|insight|system', true, function (raw, arg) {
      try { var m = { control: 'control', automation: 'automation', insight: 'insight', system: 'system', 控制: 'control', 自动: 'automation', 洞察: 'insight', 系统: 'system' };
        var name = m[(arg || '').trim().toLowerCase()]; if (!name) { Store.emit('ui:toast', '用法: /tab system'); return; }
        Store.emit('ui:switchTab', name); Store.emit('ui:toast', '已切到「' + name + '」');
      } catch (e) { swallow(e); }
    });
  }
  // —— 下拉渲染与交互（依赖面板内 #__cxCmd / #__cxCmdList，缺失时安全降级）——
  function _cxCmdRender(list, hi, showFav) {
    var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList'); if (!box) return;
    _cxCmdFilter = list; _cxCmdHi = hi;
    if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    var html = '';
    if (showFav && _cxFavorites.length) {
      html += '<div style="padding:2px 8px;font-size:9px;color:' + STYLES.T.warning + ';border-bottom:1px solid ' + STYLES.T.border + ';">★ 收藏命令</div>';
    }
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var isFav = _cxFavorites.indexOf(c.name) >= 0;
      html += '<div data-ci="' + i + '" style="display:flex;align-items:center;padding:5px 8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
        (i === hi ? 'background:' + STYLES.T.primary + ';color:#fff;' : 'color:' + STYLES.T.text + ';') + '"' +
        ' title="' + escapeHTML(c.desc || ('/' + c.name)) + '">' +
        '<span data-fav="' + escapeHTML(c.name) + '" title="' + (isFav ? '取消收藏' : '收藏命令') + '" style="cursor:pointer;color:' + (isFav ? STYLES.T.warning : STYLES.T.idle) + ';margin-right:6px;font-size:13px;flex:0 0 auto;">' + (isFav ? '★' : '☆') + '</span>' +
        '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">' +
          '<b>/' + escapeHTML(c.name) + '</b>' + (c.args ? ' …' : '') +
          (c.desc ? ' <span style="color:' + (i === hi ? STYLES.T.onPrimary2 : STYLES.T.text2b) + ';">— ' + escapeHTML(c.desc) + '</span>' : '') +
        '</span>' +
        '</div>';
    }
    box.innerHTML = html; box.style.display = 'block';
  }
  function _cxCmdUpdate() {
    var inp = _cxPanel && _cxPanel.querySelector('#__cxCmd'); if (!inp) return;
    var q = ('' + (inp.value || '')).trim().toLowerCase();
    if (!q) {
      // 输入为空时，收藏命令优先显示在最前
      var all = _cxCommands.slice();
      var favs = [], rest = [];
      for (var i = 0; i < all.length; i++) {
        if (_cxFavorites.indexOf(all[i].name) >= 0) favs.push(all[i]);
        else rest.push(all[i]);
      }
      _cxCmdRender(favs.concat(rest), -1, true);  // showFav=true：渲染星标图标
      return;
    }
    var head = q.replace(/^\//, '');
    var list = [];
    // 收藏匹配项优先
    for (var i2 = 0; i2 < _cxCommands.length; i2++) { if (_cxCommands[i2].name.indexOf(head) === 0 && _cxFavorites.indexOf(_cxCommands[i2].name) >= 0) list.push(_cxCommands[i2]); }
    for (var i3 = 0; i3 < _cxCommands.length; i3++) { if (_cxCommands[i3].name.indexOf(head) === 0 && _cxFavorites.indexOf(_cxCommands[i3].name) < 0) list.push(_cxCommands[i3]); }
    if (!list.length) { for (var j = 0; j < _cxCommands.length; j++) { if (_cxCommands[j].name.indexOf(head) >= 0) list.push(_cxCommands[j]); } }
    _cxCmdRender(list, list.length ? 0 : -1, false);
  }
  function _cxCmdShowAll() { var inp = _cxPanel && _cxPanel.querySelector('#__cxCmd'); if (inp) inp.focus(); _cxCmdUpdate(); }
  function _cxCmdOnInput() { _cxCmdUpdate(); }
  function _cxCmdOnKey(e) {
    var inp = e.target; if (!inp) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (_cxCmdFilter.length) { _cxCmdHi = (_cxCmdHi + 1) % _cxCmdFilter.length; _cxCmdRender(_cxCmdFilter, _cxCmdHi); } return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (_cxCmdFilter.length) { _cxCmdHi = (_cxCmdHi - 1 + _cxCmdFilter.length) % _cxCmdFilter.length; _cxCmdRender(_cxCmdFilter, _cxCmdHi); } return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      var pick = (_cxCmdHi >= 0 && _cxCmdFilter[_cxCmdHi]) ? _cxCmdFilter[_cxCmdHi] : (_cxCmdFilter[0] || null);
      if (pick) { inp.value = '/' + pick.name + ' '; _cxCmdHi = -1; _cxCmdRender(_cxCmdFilter, -1); try { inp.focus(); var L = inp.value.length; inp.setSelectionRange(L, L); } catch (ee) { swallow(ee); } }
      return;
    }
    if (e.key === 'Enter') {
      // 若有高亮项且下拉中与输入一致则取之；否则直接按原始输入解析执行（覆盖「参数命令下拉关闭不执行」bug）
      e.preventDefault();
      if (_cxCmdHi >= 0 && _cxCmdFilter[_cxCmdHi] && (('/' + _cxCmdFilter[_cxCmdHi].name) === ('' + inp.value).trim())) {
        inp.value = '/' + _cxCmdFilter[_cxCmdHi].name + ' ';
      }
      var raw = inp.value;
      executeRawCmd(raw);
      hideCmdList(); inp.value = '';
      return;
    }
    if (e.key === 'Escape') {
      var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList');
      if (box && box.style.display !== 'none') { e.preventDefault(); e.stopPropagation(); hideCmdList(); }
      return;
    }
  }
  function hideCmdList() { var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList'); if (box) { box.style.display = 'none'; box.innerHTML = ''; } _cxCmdFilter = []; _cxCmdHi = -1; }
  function _cxCmdOnBlur() { hideCmdList(); }
  // _cxCommands 已在本 MODULE 顶部初始化完毕，此处调用 initBuiltinCommands 注册内置命令（执行顺序正确，不会被 var 初始化覆盖）
  try { initBuiltinCommands(); } catch (e) { swallow(e); }
