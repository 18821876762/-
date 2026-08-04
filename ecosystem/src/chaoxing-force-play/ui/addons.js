  // ===== DOMAIN: ui/addons (addon registry) =====
  // ===== MODULE: 副脚本注册中心 =====
  // 域：核心业务模块 —— 副脚本注册中心 + 主循环 _loopTick 调度。
  // —— 副脚本注册中心（主脚本架构）——
  // 本脚本为「主脚本」，其余用户脚本作为「副脚本」把自己的开关/按钮挂进本面板，用法（加载顺序无关）：
  //   (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
  //     id: '唯一id', type: 'toggle'|'button'|'subpanel', label: '显示名', note: '小字说明(可选)',
  //     get: function(){return bool},   // toggle 当前值
  //     set: function(v){},             // toggle 切换回调
  //     onClick: function(){}           // button 点击回调
  //     render: function(container){}   // 仅 subpanel 用：把内容渲染进主控面板内的可折叠副面板区块
  //   });
  //   if (window.__cxRegisterAddon) window.__cxRegisterAddon();   // 主脚本已就绪时立即渲染
  // 主脚本启动时与面板创建时都会排空队列，故副脚本先于主脚本加载也能注册成功。
  var _cxAddons = {};                    // id -> addon（去重）
  function renderAddons() {
    if (!_cxPanel) return;
    try {
      var box = _cxPanel.querySelector('#__cxAddons');
      var wrap = _cxPanel.querySelector('#__cxAddonsWrap');
      var subBox = _cxPanel.querySelector('#__cxSubPanels');
      var subWrap = _cxPanel.querySelector('#__cxSubPanelsWrap');
      if (box) box.innerHTML = '';
      if (subBox) subBox.innerHTML = '';
      var ids = Object.keys(_cxAddons);
      var hasToggle = false, hasSub = false;
      ids.forEach(function (id) {
        var a = _cxAddons[id];
        if (!a) return;
        // —— 副面板：在主控面板内嵌一块可折叠内容（由副脚本 render 填充），不再需要独立浮动窗 ——
        if (a.type === 'subpanel') {
          hasSub = true;
          if (!subBox) return;
          var block = document.createElement('div');
          block.style.cssText = STYLES.DIAG_BLOCK;
          var head = document.createElement('div');
          head.style.cssText = STYLES.DIAG_HEAD;
          var titleSpan = document.createElement('span');
          titleSpan.textContent = a.label || id;
          var caret = document.createElement('span');
          caret.textContent = '▾';   // 默认展开
          caret.style.cssText = STYLES.DIAG_CARET;
          head.appendChild(titleSpan);
          head.appendChild(caret);
          var bodyEl = document.createElement('div');
          bodyEl.style.cssText = STYLES.DIAG_BODY;
          head.addEventListener('click', function () {
            var open = bodyEl.style.display !== 'none';
            bodyEl.style.display = open ? 'none' : 'block';
            caret.textContent = open ? '▸' : '▾';
          });
          block.appendChild(head);
          block.appendChild(bodyEl);
          subBox.appendChild(block);
          try { a.render && a.render(bodyEl); } catch (e) { swallow(e); }
          return;
        }
        // —— 普通副脚本开关 / 按钮 ——
        hasToggle = true;
        if (!box) return;
        var row = document.createElement('div');
        row.style.cssText = STYLES.DIAG_ROW;
        if (a.type === 'button') {
          var b = document.createElement('button');
          b.textContent = a.label;
          b.style.cssText = STYLES.DIAG_BTN;
          b.addEventListener('click', function () { try { a.onClick && a.onClick(); } catch (e) { swallow(e); } });
          row.appendChild(b);
        } else {
          var lab = document.createElement('label');
          lab.style.cssText = STYLES.DIAG_LAB;
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.style.cssText = STYLES.DIAG_CB;
          try { cb.checked = !!(a.get && a.get()); } catch (e) { swallow(e); }
          cb.addEventListener('change', function () { try { a.set && a.set(cb.checked); } catch (e) { swallow(e); } });
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode(a.label));
          row.appendChild(lab);
        }
        if (a.note) {
          var nt = document.createElement('div');
          nt.style.cssText = STYLES.DIAG_NOTE;
          nt.textContent = a.note;
          row.appendChild(nt);
        }
        box.appendChild(row);
      });
      if (wrap) {   // 空态成文（设计 §6.3）：无副脚本时显示占位文案而非隐藏区块
        wrap.style.display = 'block';
        if (!hasToggle && box) box.innerHTML = '<div style="font-size:12px;color:' + STYLES.T.text3 + ';text-align:center;padding:8px 0;">暂无副脚本接入</div>';
      }
      if (subWrap) subWrap.style.display = hasSub ? 'block' : 'none';
    } catch (e) { swallow(e); }
  }
  function drainAddonQueue() {
    try {
      var q = window.__cxAddonQueue;
      if (q && q.length) {
        for (var i = 0; i < q.length; i++) {
          var a = q[i];
          if (a && a.id && !_cxAddons[a.id]) _cxAddons[a.id] = a;
        }
        q.length = 0;
      }
      renderAddons();
    } catch (e) { swallow(e); }
  }
  try { window.__cxRegisterAddon = drainAddonQueue; } catch (e) { swallow(e); }
  drainAddonQueue();   // 排空先于主脚本加载的副脚本注册（此时面板未建，仅入册，建面板时渲染）
  // 命令面板：暴露注册入口供副脚本扩展命令（initBuiltinCommands 在 MODULE 内、_cxCommands 初始化后调用，避免执行顺序问题）
  try { window.__cxRegisterCommand = registerCommand; } catch (e) { swallow(e); }
