// @requires: CONFIG, EventBus, bestEffort
// @source-group: takeover/engine/quiz-vision.js
// 职责：视觉配置与依赖脚本加载；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
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
    // html2canvas 多镜像容错。失败两大主因：① 浏览器(追踪防护/广告拦截)按域名拦截某 CDN；
    //   ② 区域网络(如国内访问海外 CDN 受限)整体不可达。故顺序尝试多个源，任一成功即用；
    //   另支持 CONFIG.QUIZ_VISION_H2C_URL 自定义单一地址(自建/本地可访问)优先。
    // 镜像顺序：fastly.jsdelivr(海外 CDN 的国内可达镜像) → 官方 jsdelivr → 国内 360(baomitu) →
    //   国内 BootCDN → unpkg/cdnjs(兜底)。chaoxing 等国内站点优先命中可达源，避免全部超时。
    html2canvasCdns: [
      'https://fastly.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
      'https://gcore.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
      'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
      'https://lib.baomitu.com/html2canvas/1.4.1/html2canvas.min.js',
      'https://cdn.bootcdn.net/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
      'https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
    ],
    // tesseract.js 同样多镜像容错(可选，纯本地 OCR 模式用)
    tesseractCdns: [
      'https://fastly.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
      'https://gcore.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
      'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
      'https://cdn.bootcdn.net/ajax/libs/tesseract.js/5.0.2/tesseract.min.js',
      'https://unpkg.com/tesseract.js@5/dist/tesseract.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.2/tesseract.min.js'
    ],
    OPTION_SELS: '[class*="option"], li[class*="choice"], .option-item, .q-option',
    STEM_SEL: 'div.Zy_TItle.clearfix > span.newZy_TItle, .question-title, [class*="title"], [class*="stem"], [class*="Topic"]',
    _h2c: null, _ocr: null
  };

  // TEST SEAM：单测注入假的 recover（jsdom 无 Canvas/OCR 环境），生产恒为 null。
  var _quizRecoverOverride = null;
  var _quizSnapshotOverride = null;   // TEST SEAM：注入假截图/抛错（验证空白截图兜底路径）

  // 解析「页面主世界」的真实 window。
  // 关键坑：Tampermonkey/Violentmonkey 在 @grant 模式下为脚本创建隔离沙箱，document.createElement('script')
  // 注入的外部脚本在【页面主世界】执行、把全局挂到真实 window（Tampermonkey 即 unsafeWindow）；
  // 而脚本自身作用域里的 window 是沙箱代理，读不到这些「后来才挂载」的全局 → 表现为"脚本加载完成但
  // window.html2canvas 未定义"。凡涉及外部脚本全局的读取，一律走本函数取真实 window，杜绝该假阴性。
  function _quizRealWindow() {
    try { if (typeof unsafeWindow !== 'undefined') return unsafeWindow; } catch (e) {}
    try { if (typeof window !== 'undefined' && window.wrappedJSObject) return window.wrappedJSObject; } catch (e) {}
    return (typeof window !== 'undefined') ? window : null;
  }

  // 懒加载外部脚本（仅启用视觉识别且命中题目时注入），返回对应全局对象 Promise。
  // 现代化改进（对比旧 onload/onerror 直插）：① 带超时防止 CDN 挂死导致 Promise 永不 settle；
  //   ② onload/onerror/timeout 后移除事件引用并删除 script 节点，避免内存泄漏与 DOM 残留；
  //   ③ 全局读取统一走 _quizRealWindow()，绕开 @grant 沙箱代理（见 _quizRealWindow 注释）。
  // expect: 显式指定期望的全局名（自定义地址不含 html2canvas/tesseract 关键字时必需）；否则按 URL 关键字自动识别。
  function _quizLoadScript(src, timeout, expect) {
    return new Promise(function (resolve, reject) {
      try {
        if (typeof document === 'undefined' || !document.createElement) { reject(new Error('no document')); return; }
        var _exp = expect || (/html2canvas/.test(src) ? 'html2canvas' : (/tesseract/.test(src) ? 'Tesseract' : null));
        var _rw = _quizRealWindow();
        // 已加载则直接取全局，避免重复注入（走真实 window，绕开沙箱代理）
        if (_exp && _rw && _rw[_exp]) {
          if (_exp !== 'html2canvas' || typeof _rw[_exp] === 'function') { resolve(_rw[_exp]); return; }
        }
        // 隐私优先：外部 CDN 脚本须显式授权（QUIZ_VISION_PRIVACY_OK），拒绝静默外连
        var _remote = /^https?:\/\//i.test(src);
        var _privacyOk = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_PRIVACY_OK);
        if (_remote && !_privacyOk) {
          bestEffort(function () { if (typeof EventBus !== 'undefined') EventBus.emit('ui:toast', '安全拦截：未授权加载外部脚本 ' + src + '（面板开启「允许加载外部视觉脚本」后可启用）'); }, 'qv.privacy');
          reject(new Error('隐私开关未开启：拒绝加载外部脚本 ' + src + '（请在面板开启「允许加载外部视觉脚本」）'));
          return;
        }
        var s = document.createElement('script');
        s.src = src; s.async = true;
        var _done = false;
        var _cleanup = function () {
          bestEffort(function () { s.onload = null; s.onerror = null; }, 'qv.cleanup.refs');
          if (s.parentNode) { bestEffort(function () { s.parentNode.removeChild(s); }, 'qv.cleanup.del'); }
        };
        var _to = setTimeout(function () {
          if (_done) return; _done = true; _cleanup();
          reject(new Error('load timeout: ' + src));
        }, timeout || 15000);
        s.onload = function () {
          if (_done) return; _done = true; clearTimeout(_to); _cleanup();
          try {
            // 全局优先从真实 window 读（@grant 沙箱代理读不到页面主世界挂载的全局）；
            // 再兜底试一次沙箱 window，兼容 @grant none / Violentmonkey 等把全局直接挂到脚本 window 的环境。
            var _g = (_rw && _rw[_exp]) || (typeof window !== 'undefined' ? window[_exp] : null);
            if (_exp === 'Tesseract') {
              if (typeof _g !== 'object' && typeof _g !== 'function') { reject(new Error('Tesseract 加载完成但未定义全局（CDN 被浏览器追踪防护/广告拦截/区域网络拦截，或脚本未执行；请在浏览器放行该 CDN 域名，或在 CONFIG.QUIZ_VISION_H2C_URL 填入可访问的本地/自建地址）')); return; }
              QUIZ_VISION._ocr = _g; resolve(_g);
            } else {
              // 默认/显式 html2canvas：CDN 被拦截时脚本可能"加载成功"但全局未定义 → 必须显式校验，
              // 否则下方 resolve(undefined) 会让 quizSnapshot 调 undefined(el) 抛 "h2c is not a function"。
              if (typeof _g !== 'function') { reject(new Error('html2canvas 加载完成但未定义全局（CDN 被浏览器追踪防护/广告拦截/区域网络拦截，或脚本未执行；请在浏览器放行该 CDN 域名，或在 CONFIG.QUIZ_VISION_H2C_URL 填入可访问的本地/自建地址）')); return; }
              QUIZ_VISION._h2c = _g; resolve(_g);
            }
          } catch (e) { reject(e); }
        };
        s.onerror = function () { if (_done) return; _done = true; clearTimeout(_to); _cleanup(); reject(new Error('load fail: ' + src)); };
        (document.head || document.documentElement || document).appendChild(s);
      } catch (e) { reject(e); }
    });
  }

  // 按镜像顺序尝试加载外部脚本，任一成功即返回；隐私拦截(所有源都因开关未开被拒)立即 reject，避免无谓重试。
  function _quizLoadByMirror(urls, expect, timeout) {
    var _rw = _quizRealWindow();
    if (_rw && _rw[expect]) {
      if (expect !== 'html2canvas' || typeof _rw[expect] === 'function') return Promise.resolve(_rw[expect]);
    }
    var _lastErr = null;
    var _try = function (i) {
      if (i >= urls.length) {
        // 走到这里说明隐私已授权(否则首个镜像即因"隐私开关未开启"立即 reject)，故不再提隐私；
        // 真正原因通常是：浏览器追踪防护/广告拦截按域名拦了所有 CDN、或离线、或自定义地址不可用。
        // 末因带出底层错误(如 jsdom 环境的 "load fail")，便于断言"已越过敏感闸门、真正尝试加载"。
        var _name = (expect === 'html2canvas') ? 'html2canvas' : 'Tesseract.js';
        return Promise.reject(new Error(_name + ' 全部 ' + urls.length + ' 个加载源均失败（末因：' + (_lastErr && _lastErr.message ? _lastErr.message : '未知') + '）。排查：① 浏览器追踪防护/广告拦截按域名拦截了所有公开 CDN；② 区域网络(如国内访问海外 CDN 受限)整体不可达或离线；③ 自定义/镜像地址不可用。可在 CONFIG.QUIZ_VISION_H2C_URL 填入可访问的本地/自建地址绕过'));
      }
      return _quizLoadScript(urls[i], timeout, expect).then(function (g) { return g; }).catch(function (e) {
        _lastErr = e;
        if (e && e.message && /隐私开关未开启/.test(e.message)) return Promise.reject(e);
        return _try(i + 1);
      });
    };
    return _try(0);
  }
