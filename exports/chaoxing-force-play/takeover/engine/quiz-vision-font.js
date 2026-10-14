// @requires: safeGet
// @source-group: takeover/engine/quiz-vision.js
// 职责：混淆字体字形解码；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // —— 混淆字体解码（rev4·抗截图残缺）：超星 font-cxsecret 用「自定义字体 + 透明色/text-shadow」混淆——
  //   DOM 文本是乱码假字，肉眼可见的真实文本由字体字形映射渲染；html2canvas 不渲染 text-shadow/透明色
  //   文本 → 截图只剩选项字母 ABCD（用户实测），DeepSeek 看不到题目内容、只能盲答。
  //   解码原理：canvas fillText 用文档字体渲染字形（与浏览器显示一致）——对常用汉字集逐字渲染取像素
  //   哈希建字形库，再把题块每个字符按字形哈希反查真实字符。混淆映射「假码位→真实字形」且真实码位
  //   指向同一字形，故假字自动还原；未覆盖字符保持原样（ASCII 直接透传）。字形库按字体族缓存 10 分钟。
  var _secretGlyphMaps = {};   // family → { map: {hash: char}, ts }
  var _secretCanvasEl = null;
  function _secretCtx() {
    if (_secretCanvasEl) return _secretCanvasEl.getContext('2d');
    var c = document.createElement('canvas');
    c.width = 20; c.height = 20;
    _secretCanvasEl = c;
    return c.getContext('2d');
  }
  function _secretFamilyOf(el) {
    return safeGet(function () {
      var cs = (typeof getComputedStyle === 'function') ? getComputedStyle(el) : null;
      if (!cs) return null;
      var f = String(cs.fontFamily || '');
      var m = f.match(/([A-Za-z_][A-Za-z0-9_-]*)/);
      return m ? m[1] : null;
    }, null);
  }
  function _glyphHash(ch, family) {
    var ctx = _secretCtx();
    if (!ctx || typeof ctx.getImageData !== 'function') return null;
    ctx.clearRect(0, 0, 20, 20);
    ctx.fillStyle = '#000';
    ctx.font = '14px ' + family;
    ctx.textBaseline = 'top';
    ctx.fillText(ch, 2, 2);
    var d = ctx.getImageData(0, 0, 20, 20).data;
    // 64 位 FNV-1a 风格指纹：对全部暗像素（字形点）的位置序列做雪崩混合——20k 字库规模下碰撞率可忽略
    // （旧 base-31 多项式 + 32 位溢出只保留末段信息，仿真实测 256 样本 21 撞 → 系统性错解）。
    var h1 = 0x811c9dc5, h2 = 0x9e3779b9, n = 0;
    for (var i = 0; i < d.length; i += 4) {
      if (d[i] < 128) {
        var p = i >> 2;
        h1 = ((h1 ^ (p + 1)) * 16777619) | 0;
        h2 = ((h2 ^ ((p << 8) | (d[i + 1] & 0xf0))) * 2246822519) | 0;
        n++;
      }
    }
    if (!n) return null;   // 空字形（字体未加载/透明）→ 无指纹
    return (h1 >>> 0).toString(36) + ':' + (h2 >>> 0).toString(36);
  }
  function _buildSecretMap(family) {
    var map = {}, CH = [];
    for (var cp = 0x4e00; cp <= 0x9fa5; cp++) CH.push(String.fromCharCode(cp));   // 常用汉字区
    CH.push('，。、；：？！（）《》【】“”‘’·—…、');
    var fontOK = (typeof document !== 'undefined' && document.fonts && typeof document.fonts.check === 'function');
    var readyP = (document && document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return readyP.then(function () {
      return new Promise(function (resolve) {
        var i = 0;
        (function step() {
          var t0 = Date.now();
          while (i < CH.length && Date.now() - t0 < 40) {   // 每片 ≤40ms 分片，避免长任务卡主线程
            var ch = CH[i++];
            if (fontOK && !document.fonts.check('14px ' + family, ch)) continue;   // 字体未覆盖 → 跳过
            var h = _glyphHash(ch, family);
            if (h && !map[h]) map[h] = ch;
          }
          if (i < CH.length) { setTimeout(step, 0); } else { resolve(map); }
        })();
      });
    });
  }
  // 解码题块文本：返回 Promise<string>（还原后的真实题干+选项文本；字体不可用/失败时回退原 textContent）
  function _quizDecodeSecretText(el) {
    return new Promise(function (resolve) {
      if (!el || !el.textContent) { resolve(''); return; }
      var family = _secretFamilyOf(el);
      if (!family) { resolve(el.textContent); return; }
      var use = function (map) {
        var raw = el.textContent.replace(/\s+/g, ' ');
        var out = '';
        for (var i = 0; i < raw.length; i++) {
          var c = raw[i];
          if (c > '\u2e80') {   // CJK/全角区才查字形表（ASCII/数字/字母直接透传）
            var h = _glyphHash(c, family);
            var real = (h && map[h]) || null;
            out += real || c;
          } else { out += c; }
        }
        resolve(out);
      };
      var cache = _secretGlyphMaps[family];
      if (cache && Date.now() - cache.ts < 10 * 60 * 1000) { use(cache.map); return; }
      _buildSecretMap(family).then(function (map) {
        _secretGlyphMaps[family] = { map: map, ts: Date.now() };
        use(map);
      }, function () { resolve(el.textContent); });
    });
  }
