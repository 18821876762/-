// @requires: _dsLastReplyBefore, bestEffort, safeGet
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：消息收集、流式回复与图片上传；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 消息项集合（鲁棒容器解析）：[RQ-09] 真实页已确认 .ds-message 为单条消息块（LAST_MSG_EL 回复块位于其内）。
  // 但真实容器是否 .ds-virtual-list 尚缺实证——calibrate-dump 的容器选择器从未覆盖该名，实页回传的 MSG_LIST 是
  // div.ds-message(靠 [class*="message"] 兜底命中消息项本身)，即实页是否真有 .ds-virtual-list 容器未知。
  // 故做兜底：先按 msgListSel 取容器；若容器为空、或容器本身恰好就是一条消息项(被 [class*="message"] 等误命中)，
  // 则直接全文档收集 .ds-message。避免容器名失配导致 box 为 null、轮询永远拿不到回复(静默超时)。
  function _dsMessageItems() {
    return safeGet(function () {
      var dsCfg = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var itemSel = '.ds-message, [role="listitem"], [data-message-id], [class*="message-item"], [class*="chat-item"]';
      var csel = (dsCfg && dsCfg.msgListSel && dsCfg.msgListSel !== 'TODO') ? dsCfg.msgListSel : '.ds-virtual-list, [role="list"], .chat-messages, [class*="conversation"]';
      var box = document.querySelector(csel);
      if (box && !box.matches(itemSel)) {
        var inside = box.querySelectorAll(itemSel);
        if (inside.length) return inside;
      }
      return document.querySelectorAll(itemSel);
    }, []);
  }

  // 统计当前对话消息条数：直接基于 _dsMessageItems()（不再依赖容器名）。
  function _dsCountMessages() {
    return safeGet(function () { return _dsMessageItems().length; }, 0);
  }

  // 发送前快照：取最新一条 .ds-message 内的助手回复块(.ds-markdown.ds-assistant-message-main-content)文本
  function _dsLatestReplyTextOnly() {
    return safeGet(function () {
      var dsCfg = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var rsel = (dsCfg && dsCfg.lastReplySel && dsCfg.lastReplySel !== 'TODO') ? dsCfg.lastReplySel : '.ds-markdown.ds-assistant-message-main-content';
      var nodes = _dsMessageItems();
      if (!nodes.length) return '';
      var last = nodes[nodes.length - 1];
      var replyEl = last.querySelector(rsel) || last;
      return (replyEl.textContent || '').trim();
    }, '');
  }

  // 轮询最新回复：取最新 .ds-message（容器名失配时自动全文档兜底）；
  // 消息数未增→若文本有变化仍返回（流式复用同一节点）；否则取助手回复块文本。
  // 生成中判定：最新消息内含 site_logo_loading(实测初始)/loading/thinking 等类，或中文思考中/生成中 文本。
  // [RQ-09 实测校准] 深层推理态文本为「在之前的思考中自我修正」，含"思考中"——须纳入生成中信号，否则会误判终态拿半截推理文本。
  function _dsLatestReply(countBefore) {
    return safeGet(function () {
      var dsCfg = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
      var rsel = (dsCfg && dsCfg.lastReplySel && dsCfg.lastReplySel !== 'TODO') ? dsCfg.lastReplySel : '.ds-markdown.ds-assistant-message-main-content';
      var genSel = (dsCfg && dsCfg.generatingSel && dsCfg.generatingSel !== 'TODO') ? dsCfg.generatingSel : '[class*="site_logo_loading"], [class*="loading"], [class*="thinking"], [class*="generating"]';
      var nodes = _dsMessageItems();
      if (nodes.length <= countBefore) {
        // v4.19.20 审查修复：流式复用同一节点分支——补生成中判定 + 思考前缀剥离 + 稳定性条件
        // （旧实现直接把与上次不同的首段文本当终态：多选 'AB' 在 'A' 到达即被接受 → 只点 A 错答）
        var cur = nodes.length ? (nodes[nodes.length - 1].textContent || '').trim() : '';
        var lastNode = nodes.length ? nodes[nodes.length - 1] : null;
        if (lastNode && lastNode.querySelector(genSel)) return '__GENERATING__';
        if (/正在生成|正在思考|思考中|正在输入|DeepSeek 正在思考|生成中|正在分析图片|分析图片|分析中|Thinking|Generating|typing|Analyzing/i.test(cur)) return '__GENERATING__';
        cur = cur.replace(/^[（(]?\s*(?:已)?(?:深度)?思考[（(]?\s*用时[^）)]*[）)]\s*/i, '').trim();
        if (cur && cur !== _dsLastReplyBefore) {
          // 稳定性：同一文本连续两轮 poll 一致才视为终态；但「正在分析图片」等图片分析状态文本不应被当作终态答案
          if (/正在生成|正在思考|思考中|正在输入|DeepSeek 正在思考|生成中|正在分析图片|分析图片|分析中|Thinking|Generating|typing|Analyzing/i.test(cur)) { _dsStreamStable = ''; return '__GENERATING__'; }
          if (_dsStreamStable === cur) return cur;
          _dsStreamStable = cur;
          return '__GENERATING__';
        }
        _dsStreamStable = '';
        return '';
      }
      var last = nodes[nodes.length - 1];
      if (last.querySelector(genSel)) { _dsStreamStable = ''; return '__GENERATING__'; }
      var replyEl = last.querySelector(rsel) || last;
      var t = (replyEl.textContent || '').trim();
      if (/正在生成|正在思考|思考中|正在输入|DeepSeek 正在思考|生成中|正在分析图片|分析图片|分析中|Thinking|Generating|typing|Analyzing/i.test(t)) { _dsStreamStable = ''; return '__GENERATING__'; }
      // v4.19.16：剥离 DeepSeek 思考态前缀（「已思考（用时 3 秒）」/「已深度思考（用时 3 秒）」常出现在助手消息
      // 正文开头，会被误当作回复内容）——剥离后再判生成态/解析答案，避免污染诊断文本与误解析。
      t = t.replace(/^[（(]?\s*(?:已)?(?:深度)?思考[（(]?\s*用时[^）)]*[）)]\s*/i, '').trim();
      if (!t) { _dsStreamStable = ''; return ''; }
      if (/正在生成|正在思考|思考中|正在输入|DeepSeek 正在思考|生成中|正在分析图片|分析图片|分析中|Thinking|Generating|typing|Analyzing/i.test(t)) { _dsStreamStable = ''; return '__GENERATING__'; }
      // v4.19.48 修复：流式稳定性守卫原仅覆盖「≤countBefore」分支，漏掉发题后常见的「>countBefore」分支——DS 流式作答时
      // 中间态(如先到"A"后到"AB"、或"正在分析图片"残余)会被 _dsParseAnswer 立即当成终态→错答/提前定答案。
      // 此处与「≤countBefore」分支对齐：连续两轮文本一致才视为终态；状态文本漏判时也兜底不终态。
      if (_dsStreamStable === t) return t;
      _dsStreamStable = t;
      return '__GENERATING__';
    }, '');
  }

  // 把题目截图(URL)作为图片注入。优先走 file input 上传（DeepSeek 真实是附件/图片上传，
  // textarea 不吃 paste 图片）；fileInputSel 未校准时回退到 paste 事件（best-effort）。
  // cb：图片附完(成功/失败)回调，通知调用方进入发送步骤（无论成败都会调用，避免悬挂）。
  function _dsPasteImage(ta, dataUrl, cb) {
    var _fin = function () { if (typeof cb === 'function') { try { cb(); } catch (e) {} } };
    bestEffort(function () {
      var fetchImg = function (fetchCb) {
        bestEffort(function () {
          var img = new Image();
          img.onload = function () { bestEffort(function () { var c = document.createElement('canvas'); c.width = img.width; c.height = img.height; var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); c.toBlob(function (b) { fetchCb(b); }, 'image/png'); }, 'ds.pasteImg.canvas'); };
          img.onerror = function () { fetchCb(null); };
          img.src = dataUrl;
        }, 'ds.pasteImg.fetch');
      };
      fetchImg(function (blob) {
        if (!blob) { _fin(); return; }
        bestEffort(function () {
          var file = new File([blob], 'question.png', { type: 'image/png' });
          var fi = null;
          fi = safeGet(function () {
            var _dsCfg = window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.DEEPSEEK;
            if (_dsCfg && _dsCfg.fileInputSel && _dsCfg.fileInputSel !== 'TODO') return document.querySelector(_dsCfg.fileInputSel);
            return null;
          }, null);
          if (!fi) fi = safeGet(function () { return document.querySelector('input[type=file]'); }, null);
          if (fi) {
            bestEffort(function () {
              var dt = new DataTransfer();
              dt.items.add(file);
              bestEffort(function () { fi.files = dt.files; }, 'ds.pasteImg.fileAssign');
              fi.dispatchEvent(new Event('input', { bubbles: true }));
              fi.dispatchEvent(new Event('change', { bubbles: true }));
            }, 'ds.pasteImg.fileInput');
            _fin(); return;
          }
          // 回退：paste 事件
          var dt2 = new DataTransfer();
          dt2.items.add(file);
          var ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt2 });
          ta.dispatchEvent(ev);
          _fin();
        }, 'ds.pasteImg.blob');
      });
    }, 'ds.pasteImg');
  }
