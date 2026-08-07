  // ===== DOMAIN: biz/quiz-vision (站点无关·抗题目文本混淆·图片化识别层) =====
  // ===== MODULE: 真答题「视觉识别」对抗层 —— 对抗平台对题干做的同形字/字体映射/Canvas 题目混淆 =====
  // 背景：rev2 的 quiz.js 依赖题干 textContent 做指纹去重与题库匹配。平台现已对题目文本做实时变换，
  //   复制粘贴出来的字与肉眼所见"每一个字都不一样"（同形字替换 / 字体映射变形 / 题目以图片或 Canvas 呈现），
  //   导致：① textContent 副本 ≠ 显示文本 → 题库(存真实文本)匹配失效；② 纯文本 AI 接口拿到的也是乱码。
  // 对策：把题目节点"截图"下来 → 还原肉眼所见文本 → 再走 bank/ai 答案源。两条识别后端：
  //   ① endpoint 模式：把截图 POST 到 CONFIG.QUIZ_VISION_ENDPOINT（多模态 AI），端点直接返回 {text, answer}；
  //   ② tesseract 模式：本地 Tesseract.js OCR 还原文本，再回 quiz.js 查本地题库（无需外部 AI，仅依赖 Tesseract CDN）。
  // 依赖(html2canvas / tesseract.js)按需懒加载（仅 QUIZ_VISION_ENABLED 且命中题目时才注入 CDN 脚本），核心零运行时依赖。
  // 注：popup-quiz(弹窗随机作答)不读题干，故不受混淆影响，本层仅服务于"真答题"引擎 quiz.js。
  var QUIZ_VISION = {
    html2canvasCdn: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    tesseractCdn: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
    _h2c: null, _ocr: null
  };

  // TEST SEAM：单测注入假的 recover（jsdom 无 Canvas/OCR 环境），生产恒为 null。
  var _quizRecoverOverride = null;

  // 懒加载外部脚本（仅启用视觉识别且命中题目时注入），返回对应全局对象 Promise。
  function _quizLoadScript(src) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof document === 'undefined' || !document.createElement) { reject(new Error('no document')); return; }
        // 已加载则直接取全局，避免重复注入
        if (/html2canvas/.test(src) && window.html2canvas) { resolve(window.html2canvas); return; }
        if (/tesseract/.test(src) && window.Tesseract) { resolve(window.Tesseract); return; }
        var s = document.createElement('script');
        s.src = src; s.async = true;
        s.onload = function () {
          try {
            if (/html2canvas/.test(src)) { QUIZ_VISION._h2c = window.html2canvas; resolve(window.html2canvas); }
            else { QUIZ_VISION._ocr = window.Tesseract; resolve(window.Tesseract); }
          } catch (e) { reject(e); }
        };
        s.onerror = function () { reject(new Error('load fail: ' + src)); };
        (document.head || document.documentElement || document).appendChild(s);
      } catch (e) { reject(e); }
    });
  }

  // 把题目节点渲染成 PNG dataURL（html2canvas 按可见字体渲染，连 Canvas 题目也能截取位图）
  function quizSnapshot(el) {
    return _quizLoadScript(QUIZ_VISION.html2canvasCdn).then(function (h2c) {
      return h2c(el, { backgroundColor: null, logging: false, useCORS: true, scale: 2 });
    }).then(function (canvas) {
      return canvas.toDataURL('image/png');
    });
  }

  // 本地 OCR 还原肉眼所见文本（tesseract 模式用；Tesseract 自带多语言包，默认 chi_sim）
  function quizOcr(dataUrl, lang) {
    return _quizLoadScript(QUIZ_VISION.tesseractCdn).then(function (Tesseract) {
      return Tesseract.recognize(dataUrl, lang || 'chi_sim', { logger: function () {} }).then(function (r) {
        return (r && r.data && r.data.text) ? r.data.text.trim() : '';
      });
    });
  }

  // 多模态 AI 端点：把截图 + 选项文本一起 POST，返回 {text, answer}（端点契约由用户配置，脚本不内置密钥）
  function quizVisionAsk(dataUrl, qEl) {
    var ep = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENDPOINT) || '';
    if (!ep) return Promise.reject(new Error('QUIZ_VISION_ENDPOINT 未配置'));
    var opts = [];
    try {
      if (qEl && qEl.querySelectorAll) {
        var ns = qEl.querySelectorAll('[class*="option"], li[class*="choice"], .option-item, .q-option');
        for (var i = 0; i < ns.length; i++) opts.push((ns[i].textContent || '').replace(/\s+/g, ' ').trim());
      }
    } catch (e) { swallow(e); }
    var payload = JSON.stringify({ image: dataUrl, options: opts });
    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', ep, true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            if (xhr.status === 200) { try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); } }
            else reject(new Error('vision endpoint ' + xhr.status));
          }
        };
        xhr.send(payload);
      } catch (e) { reject(e); }
    });
  }

  // 统一还原入口：截图 → (tesseract OCR 文本 | endpoint 答案)；返回 Promise<{text, answer}>。
  //   text：还原后的肉眼可见题干文本（用于回查本地题库）；answer：多模态端点直接给的答案索引（可选）。
  function quizRecover(qEl) {
    if (typeof _quizRecoverOverride === 'function') return _quizRecoverOverride(qEl);   // TEST SEAM
    return quizSnapshot(qEl).then(function (dataUrl) {
      var mode = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_OCR) || 'endpoint';
      if (mode === 'tesseract') {
        return quizOcr(dataUrl, (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_OCR_LANG) || 'chi_sim')
          .then(function (text) { return { text: text, answer: null }; });
      }
      if (mode === 'deepseek-web') {
        var _opts = [];
        try {
          if (qEl && qEl.querySelectorAll) {
            var _ns = qEl.querySelectorAll('[class*="option"], li[class*="choice"], .option-item, .q-option');
            for (var _k = 0; _k < _ns.length; _k++) _opts.push((_ns[_k].textContent || '').replace(/\s+/g, ' ').trim());
          }
        } catch (e) { swallow(e); }
        return quizAskDeepSeek(dataUrl, _opts);   // 交给 DeepSeek 网页版 responder 作答（同标签注入+轮询）
      }
      // endpoint 模式：把截图交给多模态 AI，由其读图作答（answer 直接可用，text 可选回填题库）
      return quizVisionAsk(dataUrl, qEl).then(function (res) { return res || { text: null, answer: null }; });
    });
  }

  try {
    window.__CX_FORCE_PLAY.quizRecover = quizRecover;
    window.__CX_FORCE_PLAY.quizSnapshot = quizSnapshot;
    window.__CX_FORCE_PLAY.setQuizRecoverOverride = function (fn) { _quizRecoverOverride = fn; };
  } catch (e) {}
