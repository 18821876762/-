// @requires: EventBus, bestEffort
// @source-group: presentation/panel-core.js
// @continuation-of: presentation/panel-core.js
// Ninja panel interactions inside ensurePanel.
    // Ninja 点击展开/收起：用 mouseup 而非 click——拖拽的 mousedown 调了 preventDefault，
    // 部分浏览器会吞掉后续 click，导致窄条点不开、永久卡死。mouseup 不受其影响，且 ninja-open
    // 为粘性展开态（不依赖 :hover），点开后保持，便于够到“退出 n 模式”复选框。
    var ninjaBar = el.querySelector('.cx-titlebar');
    if (ninjaBar) {
      ninjaBar.addEventListener('mouseup', function (e) {
        if (!el.classList.contains('ninja')) return;
        if (el.classList.contains('cx-dragging')) return;
        if (el._cxDragMoved) { el._cxDragMoved = false; return; }  // 拖拽结束后的误触，跳过
        if (e && e.button !== undefined && e.button !== 0) return;
        var _wasOpen = el.classList.contains('ninja-open');
        el.classList.toggle('ninja-open');
        setNinjaAria();
        if (!_wasOpen) { reclampSoon(); bestEffort(function () { EventBus.emit('panel:refresh'); }, 'panel.ninjaOpenRefresh'); }
      });
    }
    // Ninja 折叠态 FAB：拖拽移动 + 点击展开/收起 + 右键菜单 + 键盘可达。
    // 视频页卡顿 / 局部无法移动修复：
    //   ① 改用 Pointer Events + setPointerCapture —— 跨域视频 iframe 不再吞掉 move/up（旧 document mousemove 越过 iframe 即中断 → 卡死/无法移动/松手丢失）；
    //   ② 拖拽期只改 transform:translate3d（仅合成层，不触发重排/重绘），不再每帧写 left/top（旧实现强制同步布局 → 视频解码抢占主线程时严重掉帧）；
    //   ③ rAF 合并高频 pointermove，每帧最多提交一次 transform；松手才把位移并入 left/top 并持久化。
    var ninjaFab = el.querySelector('.cx-ninja-fab');
    if (ninjaFab) {
      var _nxDrag = { active: false, moved: false, onFab: false, killed: false, sx: 0, sy: 0, ox: 0, oy: 0, raf: 0, dx: 0, dy: 0 };
      var _nxApply = function () { _nxDrag.raf = 0; el.style.transform = 'translate3d(' + _nxDrag.dx + 'px,' + _nxDrag.dy + 'px,0)'; };
      var _nxSched = function () {
        if (typeof requestAnimationFrame === 'function') { if (!_nxDrag.raf) _nxDrag.raf = requestAnimationFrame(_nxApply); }
        else { _nxApply(); }
      };
      var _nxToggle = function () {
        var _wasOpen = el.classList.contains('ninja-open');
        el.classList.toggle('ninja-open'); setNinjaAria();
        if (!_wasOpen) { reclampSoon(); bestEffort(function () { EventBus.emit('panel:refresh'); }, 'panel.ninjaFabOpen'); }
      }
      // 「点击冻结」根因修复（用户复现：按钮/tab 点击全失效、按 P 正常、刷新才恢复）：
      // pointerdown 时 setPointerCapture + preventDefault，若 pointerup 丢失（指针拖出窗口/失焦/中断），
      // 捕获残留 → 后续所有 pointerdown 被重定向到 FAB 并 preventDefault → 全局 click 被吞；
      // 且 pointerup 若在 ninja class 移除后到达，旧实现提前 return 致 _nxEnd 永不执行 → 捕获永不释放 → 必须刷新。
      // 修复：pointercancel / lostpointercapture / pointerup 无条件清理 + 全局兜底 + 窗口失焦，五路保证捕获
      // 残留后「下一次点击」即解锁（本次点击让事件自然派发、落空，之后完全恢复）。
      var _nxFabInRect = function (x, y, tgt) {
        var r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
        // 无布局环境（jsdom 沙箱 rect 恒 0）回退 target 判断，保证 onFab/兜底在回归测试中行为一致
        return !!(tgt && (tgt === ninjaFab || (typeof ninjaFab.contains === 'function' && ninjaFab.contains(tgt))));
      };
      ninjaFab.addEventListener('pointerdown', function (e) {
        if (!el.classList.contains('ninja')) return;
        if (e.button !== 0) return;            // 仅左键 / 触摸主指针
        if (_nxDrag.killed) { _nxDrag.killed = false; _nxDrag.active = false; return; }   // 自愈后首击：不再捕获/吞事件，让事件自然派发
        if (_nxDrag.active) _nxEnd(null, e.pointerId);   // 幂等：上次拖拽未正常结束先释放，防状态叠加
        _nxDrag.active = true; _nxDrag.moved = false;
        _nxDrag.onFab = _nxFabInRect(e.clientX, e.clientY, e.target);
        _nxDrag.sx = e.clientX; _nxDrag.sy = e.clientY;
        var r = el.getBoundingClientRect(); _nxDrag.ox = r.left; _nxDrag.oy = r.top; _nxDrag.dx = 0; _nxDrag.dy = 0;
        e.preventDefault();                    // 防文本选择；同时阻断兼容 mouse 事件（展开改由 pointerup 处理）
        try { ninjaFab.setPointerCapture(e.pointerId); } catch (_e) {}
      });
      ninjaFab.addEventListener('pointermove', function (e) {
        if (!_nxDrag.active) return;
        var dx = e.clientX - _nxDrag.sx, dy = e.clientY - _nxDrag.sy;
        if (!_nxDrag.moved && Math.hypot(dx, dy) > 5) { _nxDrag.moved = true; el._cxDragMoved = true; el.classList.add('cx-dragging'); }
        if (_nxDrag.moved) { _nxDrag.dx = dx; _nxDrag.dy = dy; _nxSched(); }
      });
      var _nxEnd = function (e, _pid) {
        if (!_nxDrag.active) return;
        _nxDrag.active = false;
        var _rel = (e && e.pointerId != null) ? e.pointerId : _pid;
        try { if (_rel != null) ninjaFab.releasePointerCapture(_rel); } catch (_e) {}
        if (_nxDrag.raf) { cancelAnimationFrame(_nxDrag.raf); _nxDrag.raf = 0; }
        if (_nxDrag.moved) {
          var left = _nxDrag.ox + _nxDrag.dx, top = _nxDrag.oy + _nxDrag.dy;
          el.style.transform = '';
          el.style.left = left + 'px'; el.style.top = top + 'px';
          el.style.right = 'auto'; el.style.bottom = 'auto';
          bestEffort(function () { clampNinjaPos(); saveNinjaPos(); }, 'panel.fabDragEnd');
          el._cxDragMoved = false; el.classList.remove('cx-dragging');
        }
      }
      ninjaFab.addEventListener('pointerup', function (e) {
        var _wasActive = _nxDrag.active;
        var _wasMoved = _nxDrag.moved;
        var _onFab = _nxDrag.onFab;
        _nxEnd(e);                             // 无条件清理（即使 ninja class 已被移除），杜绝捕获残留
        if (!el.classList.contains('ninja')) return;
        if (_wasActive && !_wasMoved && _onFab) _nxToggle();   // 未拖动且真点在 FAB 上 = 点击 → 展开/收起
      });
      ninjaFab.addEventListener('pointercancel', function (e) { _nxEnd(e); });
      ninjaFab.addEventListener('lostpointercapture', function (e) { _nxEnd(e); });   // 捕获任意路径释放时兜底清理
      // 全局自愈（顶层文档 capture 阶段）：拖拽手势中本不应再出现 pointerdown——指针捕获会独占该指针，
      // 直到 pointerup 才释放。一旦 _nxDrag.active 仍为 true 时又收到 pointerdown，说明上一手势的 pointerup
      // 已丢失（拖出窗口/失焦/页面繁忙被中断），捕获残留导致后续点击被重定向到 FAB 并 preventDefault → 面板内点击全失效。
      // 此时无条件释放捕获+清状态（killed 阻断 FAB 再次 setPointerCapture 吞点击），本次点击落空、下一次点击即完全恢复——不再需要刷新。
      // 注意：绝不能用 _nxFabInRect 判断落点——捕获会使 e.target 恒为 FAB、clientX/Y 虽真实但旧实现依赖 target 判定，
      //       导致判定恒为真而永不释放，这正是「点击冻结无法自愈、只能刷新」的真正根因，故此处收到即释放、移除落点判断。
      bestEffort(function () {
        pd.addEventListener('pointerdown', function (e) {
          if (!_nxDrag.active) return;
          _nxDrag.killed = true;
          _nxEnd(null, e.pointerId);
        }, true);
      }, 'panel.ninjaDragHeal');
      // 文档级双保险（bubble 阶段，务必晚于 FAB 自身 pointerup，否则会抢先清空 active 使 toggle 的 _wasActive 误判）：
      // 极少数情况下 FAB 自身 pointerup 未触发（如元素被答题过程临时移除/重渲染、或平台弹窗抢占焦点），
      // 任何 pointerup/pointercancel 冒泡到文档时都尝试结束拖拽，避免捕获残留跨手势累积、彻底杜绝「答题后冻结」。
      bestEffort(function () {
        if (typeof pd.addEventListener === 'function') {
          pd.addEventListener('pointerup', function () { if (_nxDrag.active) _nxEnd(null); }, false);
          pd.addEventListener('pointercancel', function () { if (_nxDrag.active) _nxEnd(null); }, false);
        }
      }, 'panel.ninjaDragDocEnd');
      // 窗口失焦（alt-tab / 指针拖出窗口后松开）也结束拖拽，从源头减少捕获残留
      bestEffort(function () {
        if (typeof window.addEventListener === 'function') window.addEventListener('blur', function () { if (_nxDrag.active) _nxEnd(null); }, false);
      }, 'panel.ninjaBlur');
      ninjaFab.addEventListener('contextmenu', function (e) {
        if (!el.classList.contains('ninja')) return;
        e.preventDefault();
        showFabMenu(e.clientX, e.clientY);
      });
      // 键盘可达：Enter/Space 展开/收起，与非 n 模式面板 Tab 可达性一致（悬浮球可聚焦后回车即展开）。
      ninjaFab.addEventListener('keydown', function (e) {
        if (!el.classList.contains('ninja')) return;
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault(); _nxToggle();
        }
      });
    }
    bestEffort(function () {
      if (!_panelOutsideClickBound) { pd.addEventListener('mousedown', panelNinjaOutsideClick, true); _panelOutsideClickBound = true; }
    }, 'panel.ninjaMouseDown');
