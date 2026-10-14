// @requires: CONFIG
// @source-group: takeover/engine/quiz-vision.js
// 职责：串行视口截图、空白校验与 OCR；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // —— 截图前置：视口内化（修复「总在最后一道题掉链子」的核心） ——
  // html2canvas 官方已知限制：只渲染「视口内」内容，视口外的元素截出来是透明/空白。
  // 超星/智慧树等考试页是单页多题长页面（chaoxing-exam 题块 div.TiMu 平铺、无分页器），末题常位于页面底部
  // 视口外 → 直接截图得到空白 → DeepSeek/端点收到空白图无从作答 → 严格 AI 模式「停下不点选」
  // （_quizStrictFail + 30s 冷却重试，重试仍空白）=「前几题勾了、最后一道题没勾、每次都在末题掉链子」。
  // 对策：① 截图前把题目滚动到视口中央并等待布局/题内图片稳定（滚动触发图片懒加载，等图完成才截得全）；
  //       ② 截图后空白检测兜底拒绝，绝不把空白图发往 AI 造成错答。
  // 串行队列：多题并发截图时，若各自滚动视口会互相污染（A 题截图途中视口被 B 题滚走 → 错位/空白），
  // 因此每道题「滚动+截图」串行执行——同一时刻只有一道题占据视口，末题不再被前题抢走。
  var _quizSnapshotTail = Promise.resolve();
  // 把题目节点滚动到视口中央，等待滚动稳定 + 题内图片加载完成（滚动常触发图片懒加载，未等即截可能截到占位图）。
  function _quizEnsureVisible(el) {
    return new Promise(function (resolve) {
      try {
        if (el && typeof el.scrollIntoView === 'function') {
          try { el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' }); }
          catch (e) { try { el.scrollIntoView(); } catch (e2) {} }
        }
      } catch (e) {}
      var imgs = [];
      try { if (el && el.querySelectorAll) imgs = el.querySelectorAll('img'); } catch (e) {}
      var _settled = false;
      var _settle = function () { if (_settled) return; _settled = true; resolve(); };
      // 双条件才 resolve：① 最少等 120ms（滚动同步生效后首帧布局稳定）；② 题内图片全部加载完成（单图 1500ms 超时兜底）。
      // 注意：不能只等 120ms 就放行——滚动触发图片懒加载后，图片未加载完就截图会截到占位图/空白。
      var _imgsReady = false, _minElapsed = false;
      var _finish = function () { if (_imgsReady && _minElapsed) _settle(); };
      setTimeout(function () { _minElapsed = true; _finish(); }, 120);
      if (imgs.length) {
        var _pending = imgs.length;
        var _imgDone = function () { _pending--; if (_pending <= 0) { _imgsReady = true; _finish(); } };
        for (var i = 0; i < imgs.length; i++) {
          (function (img) {
            var _to = setTimeout(_imgDone, 1500);   // 单图兜底超时，防坏链/幽灵图卡死整题
            if (!img || img.complete) { _imgDone(); return; }
            var _on = function () { clearTimeout(_to); _imgDone(); };
            img.addEventListener('load', _on, { once: true });
            img.addEventListener('error', _on, { once: true });
          })(imgs[i]);
        }
      } else {
        _imgsReady = true;
        _finish();
      }
    });
  }
  // 空白检测：html2canvas 对视口外元素渲染透明像素/黑块。均匀采样 25 点，全部透明或纯白 → 判为空白截图，
  // 拒绝提交给 AI（宁可停下重试/随机兜底，绝不拿空白图让 AI 错答）。jsdom/无 Canvas 环境自动跳过（不拦截）。
  function _quizCanvasBlank(canvas) {
    try {
      if (!canvas || typeof canvas.width !== 'number' || typeof canvas.height !== 'number') return false;
      if (canvas.width < 4 || canvas.height < 4) return true;   // 尺寸异常（典型截空产物）
      var ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx || typeof ctx.getImageData !== 'function') return false;
      var W = canvas.width, H = canvas.height;
      // v4.19.35：全画布步进采样（步长 8）替代 25 点——判断题等小题块暗像素稀疏（仅 2 个选项字母），
      // 25 点可能全落在空白 → 误判「截图空白」→ 仅文本发送（用户实测判断题无图输入）。
      // 判空标准：暗像素占比 < 0.05%（真空白画布 ≈0；小题块至少含字母 ≈0.5%+）。
      var d = ctx.getImageData(0, 0, W, H).data;
      var dark = 0, n = 0;
      for (var y = 0; y < H; y += 8) {
        for (var x = 0; x < W; x += 8) {
          var i = (y * W + x) * 4;
          var a = d[i + 3];
          if (a > 16 && !(d[i] > 248 && d[i + 1] > 248 && d[i + 2] > 248)) dark++;
          n++;
        }
      }
      return n > 0 && (dark / n) < 0.0005;
    } catch (e) { return false; }   // 跨域污染等 getImageData 受限 → 不拦截
  }

  // 把题目节点渲染成 PNG dataURL（html2canvas 按可见字体渲染，连 Canvas 题目也能截取位图）。
  // 多镜像顺序回退：浏览器常按域名拦截某 CDN（如拦 jsdelivr 放行 unpkg）→ 换源即绕过。
  // CONFIG.QUIZ_VISION_H2C_URL（自建/本地可访问）优先，用于所有公共 CDN 均被拦截的极端环境。
  // 修复点：截图前先 _quizEnsureVisible 滚动到视口内并等图片加载（html2canvas 视口外截空白 → 末题掉链子）；
  // 全部截图经 _quizSnapshotTail 串行执行，避免多题并发抢视口互相污染。
  function quizSnapshot(el) {
    var run = function () {
      // 像素质上限：避免大题块在 scale:2 下生成数 MB 的 base64（内存 + GM 持久化桥接双杀）。
      // 默认最长边 ≤1600px；可用 CONFIG.QUIZ_VISION_SCALE / QUIZ_VISION_MAX_DIM 或
      // localStorage(cx_quiz_vision_scale / cx_quiz_vision_maxdim) 调优：scale 调小更省内存，调大更利于 OCR。
      // 性能修复(卡顿排查·真实考试页长任务)：html2canvas 是同步主线程渲染，截图耗时与画布面积成正比——
      // 真实超星作业页（506 节点题块）在 scale 2 下每张截图阻塞主线程 1~3s（PerformanceObserver 实测长任务
      // 971/983/1877/3457ms），两道题就卡到面板无响应。默认 scale 降为 1.5、MAX_DIM 降为 1280（面积约 -60%，
      // 截图耗时同比例下降）；并按题块尺寸自适应：小图（长边 ≤500px）保持 2 倍清晰度（小字识别优先），
      // 大图限 1.5 倍。仍可用 cx_quiz_vision_scale 手动覆盖（如 1 最快 / 2 最清晰）。
      var _lsNum = function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : parseFloat(v); } catch (e) { return d; } };
      var MAX_DIM = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_MAX_DIM) || _lsNum('cx_quiz_vision_maxdim', 1280) || 1280;
      var userScale = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_SCALE) || _lsNum('cx_quiz_vision_scale', 1.5) || 1.5;
      var rect = el.getBoundingClientRect();
      var natW = Math.max(1, Math.round(rect.width || el.offsetWidth || el.clientWidth || 1));
      var natH = Math.max(1, Math.round(rect.height || el.offsetHeight || el.clientHeight || 1));
      var longer = Math.max(natW, natH);
      var capScale = (longer <= 500) ? Math.min(userScale, 2) : Math.min(userScale, 1.5);   // 小图保清晰，大图限耗
      var scale = Math.min(capScale, MAX_DIM / longer);   // 先按 MAX_DIM 收口，渲染阶段也不爆内存
      if (!(scale > 0) || !isFinite(scale)) scale = 1;
      return _quizEnsureVisible(el).then(function () {
        var urls = QUIZ_VISION.html2canvasCdns.slice();
        var ov = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_H2C_URL);
        if (ov) urls = [ov].concat(urls);
        return _quizLoadByMirror(urls, 'html2canvas').then(function (h2c) {
          return h2c(el, { backgroundColor: null, logging: false, useCORS: true, scale: scale });
        });
      }).then(function (canvas) {
        if (_quizCanvasBlank(canvas)) {
          throw new Error('题目截图疑似空白（html2canvas 对视口外元素渲染空白；滚动前置+图片等待后仍失败，已拒绝以避免把空白图发给 AI 造成错答）');
        }
        // 二次兜底：被 CSS 放大的题块渲染后仍超上限时，用临时画布下采样，避免输出数 MB base64
        var _c = canvas;
        if (Math.max(_c.width, _c.height) > MAX_DIM) {
          var r = MAX_DIM / Math.max(_c.width, _c.height);
          var tmp = document.createElement('canvas');
          tmp.width = Math.max(1, Math.round(_c.width * r));
          tmp.height = Math.max(1, Math.round(_c.height * r));
          tmp.getContext('2d').drawImage(_c, 0, 0, tmp.width, tmp.height);
          _c = tmp;
        }
        return _c.toDataURL('image/png');
      });
    };
    var p = _quizSnapshotTail.then(run, run);
    _quizSnapshotTail = p.then(function () {}, function () {});   // 队列吞错，前题失败不阻塞后续题
    return p;
  }

  // 本地 OCR 还原肉眼所见文本（tesseract 模式用；Tesseract 自带多语言包，默认 chi_sim）
  function quizOcr(dataUrl, lang) {
    return _quizLoadByMirror(QUIZ_VISION.tesseractCdns, 'Tesseract').then(function (Tesseract) {
      return Tesseract.recognize(dataUrl, lang || 'chi_sim', { logger: function () {} }).then(function (r) {
        return (r && r.data && r.data.text) ? r.data.text.trim() : '';
      });
    });
  }
