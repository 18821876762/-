// @requires: CONFIG, _dsLastReplyBefore, _dsParseAnswer, _dsRegTimer, bestEffort, safeGet
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：输入框注入、发送按钮与回复轮询；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 定位发送按钮：[RQ-09] 实测为 div.ds-button--iconLabelPrimary（新 UI 无 <button>/无文本/无 aria-label），
  // 同页多个候选（侧栏新建对话等）。[RQ-09 实测校准] 输入框祖先链全为匿名 div（class 全 hash，无 composer 语义类），
  // 故 closest('[class*="composer"]') 失配。
  // 改进（自动提交可靠性）：① 候选全集扩大到全文档常见可点击元素（含 aria/title 发送语义），避免精确 class 失配时
  //   退化到 parentElement 内找不到按钮；② 优先取「与输入框同 composer 容器(最近共同祖先)内」的候选；
  //   ③ 再用「输入框右下角邻近度」打分（发送钮通常位于 composer 右下，侧栏新建对话在上方/左侧被排除），
  //   ds-button--iconLabelPrimary 类命中强加分；④ 仍兜底取屏幕最靠下者。
  function _dsFindSendBtn(ta) {
    return safeGet(function () {
      var dsCfg = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var sendSel = (dsCfg && dsCfg.sendBtnSel && dsCfg.sendBtnSel !== 'TODO') ? dsCfg.sendBtnSel : 'div.ds-button--iconLabelPrimary';
      // 1) 精确 class 候选
      var all = Array.prototype.slice.call(document.querySelectorAll(sendSel));
      // 2) 候选不足则全文档扩大（含常见可点击 + 发送语义 aria/title），不再只限 parentElement
      if (all.length < 2) {
        var extra = Array.prototype.slice.call(document.querySelectorAll('button, div[role="button"], [class*="ds-button"], [aria-label*="发送"], [aria-label*="send"], [title*="发送"], [title*="send"]'));
        for (var k = 0; k < extra.length; k++) { if (all.indexOf(extra[k]) < 0) all.push(extra[k]); }
      }
      if (!all.length) return null;
      if (all.length === 1) return all[0];
      // 3) 最近共同祖先：从输入框向上，第一个同时包含某候选按钮的祖先即真实 composer 容器
      var cont = null, pp = (ta && ta.parentElement) || null;
      while (pp && !cont) {
        for (var c = 0; c < all.length; c++) { if (pp.contains(all[c])) { cont = pp; break; } }
        pp = pp.parentElement;
      }
      if (!cont) cont = (ta && ta.closest && ta.closest('[class*="composer"]')) || (ta && ta.parentElement) || null;
      var inBox = [];
      if (cont) { for (var i = 0; i < all.length; i++) { if (cont.contains(all[i])) inBox.push(all[i]); } }
      var pool = inBox.length ? inBox : all;
      // 4) 邻近度打分：取输入框右下角最近、且位于其下方/右侧的候选；上方候选(侧栏新建对话)排除
      var rect = (ta && ta.getBoundingClientRect) ? ta.getBoundingClientRect() : null;
      if (rect) {
        var best = null, bestScore = Infinity;
        for (var j = 0; j < pool.length; j++) {
          var r = pool[j].getBoundingClientRect();
          if (!r.width && !r.height) continue;
          if (r.top - rect.bottom < -rect.height) continue; // 明显在输入框上方→排除
          var dx = Math.max(0, r.left - rect.right), dy = Math.max(0, r.top - rect.bottom);
          var dist = Math.sqrt(dx * dx + dy * dy);
          try { if (pool[j].matches && pool[j].matches(sendSel)) dist -= 1000; } catch (e) {}
          if (dist < bestScore) { bestScore = dist; best = pool[j]; }
        }
        if (best) return best;
      }
      // 5) 兜底：屏幕最靠下者
      var bestB = null, bestBottom = -1;
      for (var m2 = 0; m2 < pool.length; m2++) {
        var rb = pool[m2].getBoundingClientRect();
        if (rb.bottom > bestBottom) { bestBottom = rb.bottom; bestB = pool[m2]; }
      }
      return bestB || pool[pool.length - 1];
    }, null);
  }

  // 向 DeepSeek 输入框注入内容并发送，轮询获取回复文本。
  // dataUrl 为题目截图(可选)，promptText 为提示词/选项文本。
  function _dsRespond(m, done) {
    bestEffort(function () {
      var promptText = (m && m.prompt) || (m && m.options && m.options.join('\n')) || '请根据题目作答';
      var dsCfg0 = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var inputSel = (dsCfg0 && dsCfg0.inputSel && dsCfg0.inputSel !== 'TODO') ? dsCfg0.inputSel : 'textarea[placeholder^="给 DeepSeek 发送消息"], textarea, [contenteditable="true"]';
      var ta = safeGet(function () { return document.querySelector(inputSel); }, null);
      if (!ta) { done({ type: 'ds-answer', reqId: m.reqId, error: 'no-input' }); return; }

      var _countBefore = _dsCountMessages();
      _dsLastReplyBefore = _dsLatestReplyTextOnly(0);

      // 1) 注入题目文本（React 受控输入框兼容：原生 setter + input/change 事件）
      var ok = _dsInjectText(ta, promptText);

      if (!ok) { done({ type: 'ds-answer', reqId: m.reqId, error: 'inject-failed' }); return; }

      // 2) 附题目截图（异步）；无论成否都要进入发送。
      //    守卫：startSend 幂等（防止图片回调与超时兜底重复触发），图片 8s 未完成也强制发送(纯文本)。
      var _started = false;
      var startSend = function () {
        if (_started) return; _started = true;
        if (_imgTimer) clearTimeout(_imgTimer);
        _dsAssertText(ta, promptText);   // 图片粘贴可能清空输入框，发送前回写提示词并同步 React 态
        // v4.19.20 审查修复：350ms 发送延迟经 _dsRegTimer 登记（owner 'deepseek'），卸载 clearAll 可取消
        _dsRegTimer(function () { _dsTrySend(ta, m, _countBefore, done); }, 350);
      };
      // v4.19.20 审查修复：8s 图片兜底定时器经 _dsRegTimer 登记——旧实现裸 setTimeout 逃逸 clearAll，
      // 卸载后仍触发 startSend 真实发消息（残留副作用链）
      var _imgTimer = _dsRegTimer(startSend, 8000);
      if (m && m.image) {
        bestEffort(function () { _dsPasteImage(ta, m.image, startSend); }, 'ds.respond.pasteImg');
      } else {
        startSend();
      }
    }, 'ds.respond');
  }

  // 向受控输入框写入文本（React 兼容：原生 setter + input/change 事件）
  function _dsInjectText(ta, text) {
    return safeGet(function () {
      if (!ta) return false;
      if (ta.tagName === 'TEXTAREA' || ta.tagName === 'INPUT') {
        var proto = Object.getPrototypeOf(ta);
        var desc = Object.getOwnPropertyDescriptor(proto, 'value');
        if (desc && desc.set) desc.set.call(ta, text); else ta.value = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        ta.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        ta.focus();
        ta.textContent = text;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    }, false);
  }
  // 发送前断言：若受控输入框已被清空（图片粘贴副作用），重新写入提示词；否则补发一次 input 事件确保 React 态同步
  function _dsAssertText(ta, text) {
    safeGet(function () {
      if (!ta) return;
      var cur = (ta.value != null ? ta.value : ta.textContent || '');
      if (!cur || !cur.trim()) { _dsInjectText(ta, text); }
      else if (ta.tagName === 'TEXTAREA' || ta.tagName === 'INPUT') {
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, undefined);
  }

  // 触发发送并校验生效：带重试的自动提交。
  // ① 找不到发送钮→间隔重试(最多 3 次)→仍无则报 no-send-btn；
  // ② 点击后用「输入框被清空 或 消息数增加」判定真正发出（不再仅靠消息数，规避真实 DOM .ds-message 失配导致的误判）；
  //    未生效则追加 Enter 键兜底（DeepSeek 支持 Enter 发送），仍无则重试点击(最多 3 次)→报 send-no-effect；
  // ③ 发送成功→轮询回复。
  function _dsClickSend(ta) {
    return safeGet(function () {
      var sb = _dsFindSendBtn(ta);
      if (!sb) return false;
      try { sb.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
      try { sb.click(); } catch (e) {}
      return true;
    }, false);
  }
  function _dsEnterSend(ta) {
    return safeGet(function () {
      if (!ta || !ta.focus) return false;
      ta.focus();
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        try { ta.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })); } catch (e) {}
      });
      return true;
    }, false);
  }
  function _dsTrySend(ta, m, countBefore, done) {
    var attempt = 0, MAXR = 3;
    var _verify = function (cb) {
      var cleared = safeGet(function () { return !((ta.value != null ? ta.value : ta.textContent || '').trim()); }, false);
      var cnt = _dsCountMessages();
      cb(cleared || cnt > countBefore);
    };
    var _pollNow = function () { _dsPollReply(m, countBefore, done); };
    var tryOnce = function () {
      _dsClickSend(ta);
      _dsRegTimer(function () {
        _verify(function (sent) {
          if (sent) { _pollNow(); return; }
          // 按钮点击未生效 → Enter 键兜底（DeepSeek 支持 Enter 发送）
          _dsEnterSend(ta);
          _dsRegTimer(function () {
            _verify(function (sent2) {
              if (sent2) { _pollNow(); return; }
              if (attempt < MAXR) { attempt++; tryOnce(); return; }
              done({ type: 'ds-answer', reqId: m.reqId, error: 'send-no-effect' }); return;
            });
          }, 1200);
        });
      }, 1200);
    };
    tryOnce();
  }
  // 轮询最新回复（独立于发送校验，便于复用）
  function _dsPollReply(m, countBefore, done) {
    var _pageTo = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_TIMEOUT) || 60000;
    var deadline = Date.now() + Math.min(90000, _pageTo - 1500);
    var poll = function () {
      var txt = safeGet(function () {
        if (Date.now() > deadline) return '__DEADLINE__';
        return _dsLatestReply(countBefore);
      }, '__GENERATING__');
      if (txt === '__DEADLINE__') { done({ type: 'ds-answer', reqId: m.reqId, error: 'timeout-wait-reply' }); return; }
      if (txt === '__GENERATING__') { _dsRegTimer(poll, 800); return; }
      if (txt) {
        var ans = _dsParseAnswer(txt);
        done({ type: 'ds-answer', reqId: m.reqId, text: txt, answer: ans });
        return;
      }
      _dsRegTimer(poll, 800);
    };
    _dsRegTimer(poll, 1200);
  }
