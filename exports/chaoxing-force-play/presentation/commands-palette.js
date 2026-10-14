// @requires: STYLES, _cxPanel, bestEffort, cxIcon, escapeHTML
// @source-group: presentation/commands.js
// @continuation-of: presentation/commands.js
// Command palette rendering and input events.
  // —— 下拉渲染与交互（依赖面板内 #__cxCmd / #__cxCmdList，缺失时安全降级）——
  function _cxCmdRender(list, hi) {
    var box = _cxPanel && _cxPanel.querySelector('#__cxCmdList'); if (!box) return;
    _cxCmdFilter = list; _cxCmdHi = hi;
    if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
    // 按 group 分组（保持 list 全局顺序，仅在组内插入分组标题）
    var groups = {}, order = [];
    for (var i = 0; i < list.length; i++) {
      var g = list[i].group || '常规';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(i);   // 存全局索引
    }
    var html = '';
    for (var gi = 0; gi < order.length; gi++) {
      var gname = order[gi];
      html += '<div style="padding:2px 8px;font-size:9px;color:' + STYLES.T.text2b + ';border-bottom:1px solid ' + STYLES.T.border + ';margin-top:' + (gi ? '4px' : '0') + ';">' + escapeHTML(gname) + '</div>';
      var idxs = groups[gname];
      for (var k = 0; k < idxs.length; k++) {
        var ci = idxs[k], c = list[ci];
        var isFav = _cxFavorites.indexOf(c.name) >= 0;
        html += '<div data-ci="' + ci + '" style="display:flex;align-items:center;padding:5px 8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:auto;' +
          (ci === hi ? 'background:' + STYLES.T.primary + ';color:#fff;' : 'color:' + STYLES.T.text + ';') + '"' +
          ' title="' + escapeHTML(c.desc || ('/' + c.name)) + '">' +
          '<span data-fav="' + escapeHTML(c.name) + '" title="' + (isFav ? '取消收藏' : '收藏命令') + '" style="cursor:pointer;color:' + (isFav ? STYLES.T.warning : STYLES.T.idle) + ';margin-right:6px;font-size:13px;flex:0 0 auto;">' + (isFav ? cxIcon('star', 13) : cxIcon('starOutline', 13)) + '</span>' +
          '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;">' +
            '<b>/' + escapeHTML(c.name) + '</b>' + (c.args ? ' …' : '') +
            (c.desc ? ' <span style="color:' + (ci === hi ? STYLES.T.onPrimary2 : STYLES.T.text2b) + ';">— ' + escapeHTML(c.desc) + '</span>' : '') +
          '</span>' +
          '</div>';
      }
    }
    box.innerHTML = html; box.style.display = 'block';
  }
  // 模糊匹配评分：精确>前缀>子串>子序列；空查询返回 1（全部显示）
  function _cmdScore(name, q) {
    if (!q) return 1;
    var n = ('' + name).toLowerCase(), h = ('' + q).toLowerCase();
    if (n === h) return 5;
    if (n.indexOf(h) === 0) return 4;
    if (n.indexOf(h) >= 0) return 3;
    var i = 0, j = 0;
    while (i < n.length && j < h.length) { if (n[i] === h[j]) j++; i++; }
    if (j === h.length) return 2;
    return 0;
  }
  function _cxCmdUpdate() {
    var inp = _cxPanel && _cxPanel.querySelector('#__cxCmd'); if (!inp) return;
    var q = ('' + (inp.value || '')).trim().toLowerCase().replace(/^\//, '');
    // 评分 + 收藏/最近使用加权
    var scored = [];
    for (var i = 0; i < _cxCommands.length; i++) {
      var c = _cxCommands[i];
      var s = _cmdScore(c.name, q);
      if (s <= 0) continue;
      if (_cxFavorites.indexOf(c.name) >= 0) s += 1.0;                 // 收藏加权
      var ri = _cxRecent.indexOf(c.name);
      if (ri >= 0) s += 0.5 * (1 - ri / (_cxRecent.length + 1));        // 最近使用加权
      scored.push({ c: c, s: s });
    }
    scored.sort(function (a, b) { return b.s - a.s || (a.c.name < b.c.name ? -1 : 1); });
    var list = scored.map(function (o) { return o.c; });
    if (!q) {
      // 空输入：收藏优先，其次最近使用
      list.sort(function (a, b) {
        var fa = _cxFavorites.indexOf(a.name) >= 0, fb = _cxFavorites.indexOf(b.name) >= 0;
        if (fa !== fb) return fa ? -1 : 1;
        var ra = _cxRecent.indexOf(a.name), rb = _cxRecent.indexOf(b.name);
        if (ra >= 0 || rb >= 0) return (ra < 0 ? 1 : (rb < 0 ? -1 : ra - rb));
        return 0;
      });
    }
    _cxCmdRender(list, list.length ? 0 : -1);
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
      if (pick) { inp.value = '/' + pick.name + ' '; _cxCmdHi = -1; _cxCmdRender(_cxCmdFilter, -1); bestEffort(function () { inp.focus(); var L = inp.value.length; inp.setSelectionRange(L, L); }, 'cmd.tabFocus'); }
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
  // 全局兜底：在 document 上捕获 mousedown，点击命令栏(.cx-cmd-wrap)之外即收起下拉，
  // 防止下拉"悬停"盖住导航 tab（修复：点其他 tab 无反应）。
  // 注：命令下拉 inset top:100% 仅向下展开，header 关闭按钮在其上方永不可达，故下拉与关闭失效无关；
  // 完整面板冻结若含「关闭失效」，属站点侧透明层遮挡，由 panel.js 面板解冻自检(_cxPanelDefrostCheck)兜底恢复。
  // 点命令条目时 target 仍在 .cx-cmd-wrap 内 → 不收起，交由条目 mousedown 委托执行命令。
  var _cxCmdOutsideBound = false;
  function _cxBindCmdOutsideClose() {
    if (_cxCmdOutsideBound) return; _cxCmdOutsideBound = true;
    if (typeof document === 'undefined' || !document.addEventListener) return;
    bestEffort(function () {
      document.addEventListener('mousedown', function (e) {
        var t = e.target; if (!t || !t.closest) return;
        if (t.closest('.cx-cmd-wrap')) return;   // 命令栏/下拉内：保持展开
        hideCmdList();
      }, true);
    }, 'cmd.outsideClose');
  }
  _cxBindCmdOutsideClose();
  // _cxCommands 已在本 MODULE 顶部初始化完毕，此处调用 initBuiltinCommands 注册内置命令（执行顺序正确，不会被 var 初始化覆盖）
  // 开发者模式/自检：暴露内置命令清单（只读），供 diagnostics.buildFeatureSelfTest 探测
  bestEffort(function () {
    if (window.__CX_FORCE_PLAY) window.__CX_FORCE_PLAY.listCommands = function () {
      return _cxCommands.map(function (c) { return c.name; });
    };
  }, 'cmd.export.list');
  bestEffort(function () { initBuiltinCommands(); }, 'cmd.initBuiltin');
