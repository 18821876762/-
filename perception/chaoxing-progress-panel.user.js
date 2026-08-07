// ==UserScript==
// @name         学习通·进度只读面板（工具库）
// @namespace    http://cx.local/
// @version      3.6
// @author       anon
// @description  【工具库·接入主控面板】【只读】作为「副面板」内嵌进 chaoxing-force-play 主控面板（按 P 呼出 → 副面板区）：拉取你自己的课程列表/章节任务点完成状态，纯 GET 不提交、不伪造、不改任何平台数据。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

  (function () {
    'use strict';

    // —— 顶层窗口守卫 + realm 守卫（避免 Tampermonkey 在多个同源 iframe / 重复注入时注册多个副面板）——
    if (window.top !== window.self) return;
    if (window.__cxProgressPanelStarted) return;
    window.__cxProgressPanelStarted = true;

  var DEBUG = false;
  function dbg() {
    if (!DEBUG) return;
    try {
      var a = ['[CX-PANEL]'];
      for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
      console.log.apply(console, a);
    } catch (e) { swallow(e); }
  }
  // 审查 JS1-2：把空 catch 的静默吞掉改为 DEBUG 下告警；生产默认静默，不污染控制台
  var TK = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit) || {};
  var swallow = TK.swallow || function (e, tag) {
    if (!DEBUG) return;
    try { console.warn('[CX-PANEL] ' + (tag || 'swallowed') + ':', (e && e.message) ? e.message : e); } catch (_) {}
  };

  // —— 配置：只读端点（纯 GET，依赖浏览器已有登录态 cookie）。地址集中管理，便于版本间微调 ——
  var CONFIG = {
    API_COURSES: 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&rss=1',
    // 章节树 AJAX 接口（已验证可用；visitnodedetail 现返 HTML 空壳，故改走此接口）。
    // 需有效 chapterId 种子 + 正确 Referer 才返回完整树；seed 取 URL 中 chapterId，缺省 "0"。
    API_CHAPTERS: 'https://mooc1.chaoxing.com/mooc-ans/mycourse/studentstudycourselist?courseId={cid}&chapterId={seed}&clazzid={clid}&cpi={cpi}&mooc2=1&isMicroCourse=false',
    API_STUDYSTUDY: 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId={seed}&courseId={cid}&clazzid={clid}&mooc2=1&cpi={cpi}',
    REFRESH_INTERVAL: 30000 // 可选：未来用于自动刷新
  };

  // —— 通用 GET（同源，cookie 随请求自动带上；纯读取，绝不 POST）——
  function getJSON(url) {
    return new Promise(function (resolve, reject) {
      try {
        fetch(url, { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json, text/plain, */*' } })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
            return r.text();
          })
          .then(function (txt) {
            try { resolve({ ok: true, text: txt, data: JSON.parse(txt) }); }
            catch (e) { resolve({ ok: false, text: txt, data: null, error: 'JSON_PARSE_ERROR' }); }
          })
          .catch(function (err) { reject(err); });
      } catch (e) { reject(e); }
    });
  }

  // —— 通用 GET 文本（章节树接口返回 HTML 片段，非 JSON）——
  function getText(url, headers) {
    return new Promise(function (resolve, reject) {
      try {
        fetch(url, { method: 'GET', credentials: 'include', headers: headers || {} })
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
            return r.text();
          })
          .then(resolve)
          .catch(function (err) { reject(err); });
      } catch (e) { reject(e); }
    });
  }

  // 从当前 URL 提取 chapterId 作为章节树种子（播放页 URL 形如 ?chapterId=数字）
  // —— 把底层错误映射为面向用户的可读原因（网络异常 / 登录过期 / 权限不足 / 接口结构变化）——
  // getJSON/getText 在非 2xx 时 throw 'HTTP 401 ...'；网络层失败由 fetch 直接 reject（无响应）；
  // JSON 解析失败在 loadCourses 里以 resp.ok===false（error='JSON_PARSE_ERROR'）分支单独处理。
  function describeError(err) {
    var msg = (err && err.message) ? err.message : ('' + (err || ''));
    var name = (err && err.name) ? err.name : '';
    // 1) 网络层失败：同源场景下多为断网 / 被扩展或防火墙拦截（无 HTTP 响应）
    if (name === 'TypeError' || /Failed to fetch|NetworkError|Network request failed|aborted/i.test(msg)) {
      return { title: '网络异常', detail: '请求未能送达服务器，请检查网络是否被断开、扩展或防火墙拦截。', kind: 'net' };
    }
    // 2) 可识别的 HTTP 状态码
    var m = msg.match(/^HTTP\s+(\d{3})/i);
    if (m) {
      var code = parseInt(m[1], 10);
      if (code === 401) return { title: '登录过期', detail: 'HTTP 401：登录态可能已失效，请重新登录学习通后点「重试」。', kind: 'auth' };
      if (code === 403) return { title: '权限不足', detail: 'HTTP 403：当前账号无权访问该课程/章节，或登录过期，请重新登录后重试。', kind: 'auth' };
      if (code === 404) return { title: '接口地址失效', detail: 'HTTP 404：请求的章节接口不存在或已下线（部分课程需先进入其 studentstudy 播放页再点此按钮）。', kind: 'api' };
      if (code === 302 || code === 301) return { title: '登录过期', detail: 'HTTP ' + code + '：请求被重定向（常见于被跳转到登录页），请重新登录学习通。', kind: 'auth' };
      if (code >= 500) return { title: '服务器异常', detail: 'HTTP ' + code + '：学习通服务端错误，请稍后重试。', kind: 'api' };
      return { title: '请求被拒绝', detail: 'HTTP ' + code + '：' + escapeHTML(msg) + '，请重试或反馈给我分析。', kind: 'api' };
    }
    return { title: '加载失败', detail: escapeHTML(msg), kind: 'other' };
  }

  function getSeedFromUrl() {
    try {
      var m = location.search.match(/[?&]chapterId=(\d+)/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // —— 容错取值：依次尝试多个候选 key，返回第一个存在的 ——
  function pick(obj, keys) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (var i = 0; i < keys.length; i++) {
      if (obj[keys[i]] !== undefined && obj[keys[i]] !== null && obj[keys[i]] !== '') return obj[keys[i]];
    }
    return undefined;
  }

  // 从课程列表响应里尽量抽出课程数组（结构未知，做多路径兜底）
  // 超星 backclazzdata 真实结构：channelList[].course.data[]，课程字段(name/id/clazzId/cpi/progress)
  // 嵌套在深层；外层 channel 只有 id/name/state，无 cpi/clazzId（或仅有 cpi 而无 name）。原实现只取
  // channelList 顶层 → 取到缺字段的壳对象，显示「(无名课程)/cid=?/clazzid=?」。现改为递归下钻：
  // 以「含 clazzId，或含 cpi 且含 name 类字段」为课程指纹（排除无 name 的 cpi 壳），按 cpi（缺则 clazzId）
  // 去重并保留字段最多的对象（深层课程比外层 channel 字段更全），从而取到完整课程信息。
  function _isCourseObj(n) {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return false;
    if ('clazzId' in n || 'clazzid' in n || 'classId' in n) return true;
    if (('cpi' in n || 'CPI' in n) && ('name' in n || 'courseName' in n || 'title' in n)) return true;
    return false;
  }
  function _walkCourses(node, map) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) _walkCourses(node[i], map); return; }
    if (_isCourseObj(node)) {
      var key = ('cpi' in node) ? ('c:' + node.cpi)
              : ('CPI' in node) ? ('c:' + node.CPI)
              : ('clazzId' in node) ? ('z:' + node.clazzId)
              : ('clazzid' in node) ? ('z:' + node.clazzid)
              : ('classId' in node) ? ('z:' + node.classId)
              : ('z:' + (node.CPI != null ? node.CPI : 'unknown'));  // 兜底：classId 缺失时不落为 'z:undefined' 造成多课同键互覆盖（吸收评审 JS1-5）
      var r = 0; for (var k in node) if (node.hasOwnProperty(k)) r++;
      if (!map[key] || r > map[key].__r) { node.__r = r; map[key] = node; }
    }
    for (var k2 in node) { if (node.hasOwnProperty(k2)) { var v = node[k2]; if (v && typeof v === 'object') _walkCourses(v, map); } }
  }
  function extractCourses(resp) {
    var d = resp.data;
    if (!d) return [];
    var map = {};
    _walkCourses(d, map);
    var out = [];
    for (var key in map) if (map.hasOwnProperty(key)) out.push(map[key]);
    return out;
  }

  function courseName(c) {
    return pick(c, ['courseName', 'name', 'title', 'courseTitle', 'coursetitle', 'clazzName', 'kclazzName']) || '(无名课程)';
  }
  function courseId(c) {
    return pick(c, ['courseId', 'courseid', 'id', 'cId', 'kclazzId']);
  }
  function classId(c) {
    return pick(c, ['clazzId', 'clazzid', 'classId', 'classid', 'cid', 'cId']);
  }
  function courseProgress(c) {
    var p = pick(c, ['progress', 'rate', 'percent', 'completeRate', 'studyScore']);
    if (p === undefined) return '';
    return (typeof p === 'number') ? (p + '%') : ('' + p);
  }
  // 把进度文案转成 0~100 数值（供 CSS 进度条用），失败时返回 null
  function progressToNum(p) {
    if (p === undefined || p === null || p === '') return null;
    var s = ('' + p).replace(/[%\s]/g, '').trim();
    var n = parseFloat(s);
    return isNaN(n) ? null : Math.max(0, Math.min(100, n));
  }
  function courseCpi(c) {
    return pick(c, ['cpi', 'CPI', 'cPi']);
  }
  // 本地估算：汇总 force-play 写入 window.__cxWatchStats 的已看时长（按课程 courseId 关联，跨会话持久化）。
  // 仅用本地数据，不读取平台回看时长、不上报；force-play 未加载时返回 null（不展示）。属「进度同步·本地估算」。
  function courseWatchMin(cid) {
    try {
      var stats = (typeof window !== 'undefined' && window.__cxWatchStats && typeof window.__cxWatchStats === 'object') ? window.__cxWatchStats : null;
      if (!stats || !cid) return null;
      var cidS = '' + cid, total = 0;
      for (var k in stats) { if (!stats.hasOwnProperty(k)) continue; var e = stats[k]; if (e && ('' + e.courseId) === cidS) total += (e.ms || 0); }
      if (total <= 0) return null;
      return Math.round(total / 60000);
    } catch (e) { return null; }
  }

  // 解析章节树 HTML 片段（studentstudycourselist 返回），抽每章任务点状态。
  function parseChaptersHTML(html) {
    var doc;
    try { doc = new DOMParser().parseFromString(html || '', 'text/html'); }
    catch (e) { return []; }
    var all = doc.querySelectorAll('[id^="cur"]');
    var nodes = [];
    for (var k = 0; k < all.length; k++) {
      if (/^cur\d{6,}$/.test(all[k].id || '')) nodes.push(all[k]);
    }
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.querySelector('[id^="cur"]')) continue;   // 跳过容器节点，只保留叶子章节
      var kid = (n.id || '').replace(/^cur/, '');
      var sb = n.querySelector('.posCatalog_sbar');
      var index = sb ? sb.textContent.trim() : '';
      var nameEl = n.querySelector('.posCatalog_name') || n;
      var title = nameEl ? (nameEl.getAttribute('title') || nameEl.textContent || '').trim() : '';
      var unfInp = n.querySelector('.jobUnfinishCount');
      var unfinished = unfInp ? (parseInt(unfInp.value || unfInp.getAttribute('value') || '0', 10) || 0) : 0;
      var done = !!n.querySelector('.icon_Completed');
      out.push({ kid: kid, index: index, title: title, unfinished: unfinished, done: done });
    }
    return out;
  }

  // 渲染章节任务点列表（只读展示），顶部附加「已完成 X / 共 Y」CSS 汇总条
  function renderChapterList(list) {
    if (!list || !list.length) return '<i>未解析到章节任务点</i>';
    var doneCount = 0;
    for (var d = 0; d < list.length; d++) if (list[d].done) doneCount++;
    var pct = Math.round(doneCount / list.length * 100);
    var html = '<div class="cx-cbar" title="已完成 ' + doneCount + ' / 共 ' + list.length + ' 章">' +
      '<div class="cx-cbar-fill" style="width:' + pct + '%"></div>' +
      '<span class="cx-cbar-label">已完成 ' + doneCount + ' / ' + list.length + '（' + pct + '%）</span></div>';
    for (var i = 0; i < list.length; i++) {
      var t = list[i];
      var status = t.done ? '已完成'
        : (t.unfinished > 0 ? ('未完成 ' + t.unfinished) : '未知');
      var label = (t.index ? t.index + ' ' : '') + (t.title || '(未命名)');
      html += '<div class="cx-p-node">• ' + escapeHTML(label) + ' · ' + status + '</div>';
    }
    return html;
  }

  var escapeHTML = TK.escapeHTML || function (s) {
    return ('' + s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };

  // 拉取课程列表，渲染到 list 容器；rawBox 用于显示原始 JSON
  function loadCourses(list, rawBox) {
    list.innerHTML = '<i>加载中…</i>';
    getJSON(CONFIG.API_COURSES).then(function (resp) {
      if (rawBox) rawBox.textContent = resp.text;
      if (resp.ok === false) {
        // 2xx 却不是合法 JSON：最常见是登录过期被重定向到登录页（返回 HTML 登录框）。
        list.innerHTML = '<i style="color:#e57373">登录过期或接口结构变化：接口返回了非 JSON 内容（' + escapeHTML(resp.error || '') +
          '）。最常见原因是登录态失效、被重定向到登录页。请重新登录学习通后点「重试」。下方原始内容已填入，可勾选「显示原始JSON」确认。</i>' +
          '<br><button class="cx-retry-courses">重试</button>';
        list.querySelector('.cx-retry-courses').addEventListener('click', function () { loadCourses(list, rawBox); });
        return;
      }
      var courses = extractCourses(resp);
      if (!courses.length) {
        list.innerHTML = '<i>未解析到课程（接口字段可能与预期不同，已把原始JSON填入下方，可贴给我分析结构）</i>';
        return;
      }
      var html = '';
      for (var i = 0; i < courses.length; i++) {
        var c = courses[i];
        var cid = courseId(c), clid = classId(c), cpi = courseCpi(c);
        var prTxt = courseProgress(c) || '?';
        var prNum = progressToNum(courseProgress(c));
        var bar = (prNum === null) ? '' :
          '<div class="cx-pbar" title="完成度 ' + prNum + '%"><div class="cx-pbar-fill" style="width:' + prNum + '%"></div></div>';
        // 本地估算：已看时长 + 学习效率（进度%/已看分钟，越低时耗越高效率；纯本地，非平台同步）
        var wm = courseWatchMin(cid);
        var watchLine = (wm === null) ? '' :
          '<span style="color:#7db4f0">本机已看 ' + wm + 'min</span>' +
          ((prNum !== null && wm > 0) ? (' · 效率≈' + (prNum / wm).toFixed(1) + '%/min') : '');
        html += '<div class="cx-course">' +
          '<b>' + escapeHTML(courseName(c)) + '</b>' +
          '<div class="cx-pbar-row">进度 ' + escapeHTML(prTxt) + bar + '</div>' +
          '<span style="color:#888;font-size:11px">cid=' + escapeHTML(cid || '?') + ' / clazzid=' + escapeHTML(clid || '?') + ' / cpi=' + escapeHTML(cpi || '?') + '</span>' +
          (wm !== null ? '<br><span style="color:#888;font-size:11px">' + watchLine + '（本地估算）</span>' : '') +
          '<br><button data-cid="' + escapeHTML(cid || '') + '" data-clid="' + escapeHTML(clid || '') + '" data-cpi="' + escapeHTML(cpi || '') + '">查看章节任务点</button>' +
          '<div class="cx-chapters" style="margin-top:4px"></div></div>';
      }
      list.innerHTML = html;
      var btns = list.querySelectorAll('button[data-cid]');
      for (var j = 0; j < btns.length; j++) {
        btns[j].addEventListener('click', function () {
          var box = this.parentNode.querySelector('.cx-chapters');
          loadChapters(this.getAttribute('data-cid'), this.getAttribute('data-clid'), this.getAttribute('data-cpi'), box);
        });
      }
      dbg('课程数', courses.length);
    }).catch(function (err) {
      var info = describeError(err);
      list.innerHTML = '<i style="color:#e57373">' + escapeHTML(info.title) + '：' + info.detail + '</i>' +
        '<br><button class="cx-retry-courses">重试</button>';
      list.querySelector('.cx-retry-courses').addEventListener('click', function () { loadCourses(list, rawBox); });
    });
  }

  function loadChapters(cid, clid, cpi, box) {
    if (!cid || !clid || !cpi) { box.innerHTML = '<i style="color:#e57373">缺少 cid/clazzid/cpi</i>'; return; }
    box.innerHTML = '<i>加载章节…</i>';
    var seed = getSeedFromUrl() || '0';
    var url = CONFIG.API_CHAPTERS
      .replace('{cid}', encodeURIComponent(cid))
      .replace('{seed}', encodeURIComponent(seed))
      .replace('{clid}', encodeURIComponent(clid))
      .replace('{cpi}', encodeURIComponent(cpi));
    getText(url, {
      'Accept': 'text/html, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest'
    }).then(function (text) {
      var list = parseChaptersHTML(text);
      if (!list.length) {
        box.innerHTML = '<i>未解析到章节任务点（接口可能返回空壳；若返回空，请先进入该章节的 studentstudy 播放页再点此按钮——该接口依赖 Referer 校验）。原始HTML可在「显示原始JSON」中查看</i>';
        window.__cxLastChild = text;
        return;
      }
      box.innerHTML = renderChapterList(list);
      dbg('章节任务点节点数', list.length);
    }).catch(function (err) {
      var info = describeError(err);
      box.innerHTML = '<i style="color:#e57373">' + escapeHTML(info.title) + '：' + info.detail + '</i>' +
        '<br><button class="cx-retry-node">重试</button>';
      box.querySelector('.cx-retry-node').addEventListener('click', function () { loadChapters(cid, clid, cpi, box); });
    });
  }

  // —— 把进度面板内容渲染进主控面板的「副面板」容器（force-play 支持 subpanel 类型后内嵌，不再自建浮动窗）——
  function renderProgressContent(container) {
    container.innerHTML =
      '<div class="cxPContent">' +
      '  <div class="cxP-tools">' +
      '    <button class="cxP-refresh">刷新课程列表</button> ' +
      '    <label><input type="checkbox" class="cxP-raw"> 显示原始JSON</label>' +
      '  </div>' +
      '  <div style="font-size:11px;color:#6b7280;margin-bottom:6px;">「本机已看/效率」为本地估算（非平台同步，清缓存即丢失）</div>' +
      '  <div class="cxP-list"><i>点击「刷新课程列表」加载（纯读取，不改任何数据）</i></div>' +
      '  <div class="cxP-rawbox" style="display:none;white-space:pre-wrap;max-height:200px;overflow:auto;font-size:11px;border-top:1px solid #3a3f4b;margin-top:6px;padding-top:6px;"></div>' +
      '</div>';
    // 注入一次样式（限定 .cxPContent，避免污染主控面板其它部分）
    if (!document.getElementById('cxPContentStyle')) {
      try {
        var st = document.createElement('style');
        st.id = 'cxPContentStyle';
        st.textContent =
          '.cxPContent{color:#e8e8e8;font-size:12px;line-height:1.5;}' +
          '.cxPContent .cxP-tools{margin-bottom:8px;}' +
          '.cxPContent .cxP-refresh{background:#4a90d9;color:#fff;border:0;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px;}' +
          '.cxPContent .cx-course{border:1px solid #3a3f4b;border-radius:6px;padding:6px 8px;margin:6px 0;}' +
          '.cxPContent .cx-course b{color:#7db4f0;}' +
          '.cxPContent .cx-course button{margin-top:4px;font-size:12px;cursor:pointer;background:#3a3f4b;color:#e8e8e8;border:0;border-radius:4px;padding:3px 8px;}' +
          '.cxPContent .cx-p-node{font-size:12px;color:#c8ccd2;margin:2px 0;}' +
          '.cxPContent .cxP-rawbox{color:#9aa0a8;}' +
          // —— CSS 进度条（课程完成率）——
          '.cxPContent .cx-pbar-row{margin:3px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}' +
          '.cxPContent .cx-pbar{flex:1;min-width:80px;height:8px;background:#2a2e37;border-radius:5px;overflow:hidden;}' +
          '.cxPContent .cx-pbar-fill{height:100%;background:linear-gradient(90deg,#4a90d9,#5ec27a);}' +
          // —— CSS 进度条（章节完成汇总）——
          '.cxPContent .cx-cbar{position:relative;height:16px;background:#2a2e37;border-radius:5px;overflow:hidden;margin:4px 0 6px;}' +
          '.cxPContent .cx-cbar-fill{position:absolute;left:0;top:0;height:100%;background:linear-gradient(90deg,#4a90d9,#5ec27a);}' +
          '.cxPContent .cx-cbar-label{position:relative;z-index:1;display:block;text-align:center;font-size:11px;line-height:16px;color:#e8e8e8;}' +
          // —— 移动端适配：窄屏缩字号、放大点按区 ——
          '@media (max-width:480px){' +
            '.cxPContent{font-size:11px;}' +
            '.cxPContent .cxP-refresh,.cxPContent .cx-course button{padding:8px 12px;font-size:13px;}' +
            '.cxPContent .cx-pbar{min-width:60px;}' +
            '.cxPContent .cx-course{margin:8px 0;}' +
          '}';
        document.head.appendChild(st);
      } catch (e) { swallow(e); }
    }
    var list = container.querySelector('.cxP-list');
    var rawBox = container.querySelector('.cxP-rawbox');
    var rawChk = container.querySelector('.cxP-raw');
    rawChk.addEventListener('change', function () { rawBox.style.display = this.checked ? '' : 'none'; });
    container.querySelector('.cxP-refresh').addEventListener('click', function () { loadCourses(list, rawBox); });
  }

  // ===== 工具库项接入主控面板：作为「副面板」内嵌（force-play v4.x 支持 subpanel 类型）=====
  // 不再自建 #cxProgressPanel 浮动窗，而是把内容渲染进主控面板内的可折叠副面板区块（通过 a.render 回调）。
  try {
    (window.__cxAddonQueue = window.__cxAddonQueue || []).push({
      id: 'progress-panel', type: 'subpanel', label: '进度面板（只读）',
      note: '课程列表 / 章节任务点完成状态',
      render: function (container) { try { renderProgressContent(container); } catch (e) { dbg('render err', e); } }
    });
    // 自检：探测主脚本契约（force-play 暴露的 __cxRegisterAddon）。
    // 立即缺失可能是「工具库项先于主脚本执行」所致，故延迟 3s 复核，确实缺失再告警，避免误报。
    if (typeof window.__cxRegisterAddon === 'function') {
      window.__cxRegisterAddon();
    } else {
      setTimeout(function () {
        if (typeof window.__cxRegisterAddon !== 'function') {
          try { console.warn('[progress-panel] 未检测到 chaoxing-force-play 主脚本(__cxRegisterAddon 缺失)，本工具库项不会生效；请确认主脚本已安装且与本脚本在相同的 @match 下运行。'); } catch (e) { swallow(e); }
        }
      }, 3000);
    }
  } catch (e) { swallow(e); }
})();
