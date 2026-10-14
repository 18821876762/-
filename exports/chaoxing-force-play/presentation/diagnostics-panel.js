// @provides: copyDiagnostics
// @requires: CONFIG, CX_KEYS, DEBUG, EventBus, FLAGS, _cxAllFrames, _cxPanel, bestEffort, cxState, detectSite, foregroundVideo, safeGet, shortSrc
// @source-group: presentation/diagnostics.js
// @continuation-of: presentation/diagnostics.js
// Panel, video, and toast diagnostics plus clipboard helpers.
    L.push('');
    L.push('■ [12] 面板与配置');
    // 工具库项（插件）注册清单：列出已接入的工具库项及其开关态，便于确认是否漏装/误关
    if (typeof _cxAddons !== 'undefined' && _cxAddons) {
      var _adIds = Object.keys(_cxAddons);
      if (_adIds.length) {
        var _adTxt = _adIds.map(function (id) {
          var _a = _cxAddons[id];
          var _on = (_a && _a.type === 'toggle') ? ((_a.get && _a.get()) ? '开' : '关') : (_a ? _a.type : '?');
          return id + '(' + _on + ')';
        }).join(', ');
        L.push('工具库项(' + _adIds.length + '): ' + _adTxt);
      } else {
        L.push('工具库项: 无（未接入任何工具库项）');
      }
    }
    // 面板与场景状态
    L.push('面板: ' + (_cxPanel ? (_cxPanel.style.display !== 'none' ? '可见' : '隐藏') : '未创建') + ' · 站点=' + (typeof detectSite === 'function' ? detectSite() : '?'));
    // 脚本弹窗（静默）状态：关闭后一切提示仅进洞察页，不再悬浮
    L.push('脚本弹窗: ' + ((typeof isQuietPopups === 'function' && isQuietPopups()) ? '已关闭(仅洞察页)' : '开启(悬浮提示)'));
    // 看播统计本地汇总（只读估算，不含平台上报）
    if (typeof _watchStats !== 'undefined' && _watchStats) {
      var _wm = 0, _wk = Object.keys(_watchStats);
      for (var _wi = 0; _wi < _wk.length; _wi++) { _wm += (_watchStats[_wk[_wi]].ms || 0); }
      L.push('看播统计: 累计 ' + (_wm / 60000).toFixed(1) + ' 分钟 · 课程源 ' + _wk.length + ' 个');
    }
    // 接管/隔离盘点（诊断#九）：原型中性化 / 跨 iframe 接管 / mediaSession 是否到位，定位"明明该续播却不动"
    L.push('接管: iframe文档=' + (typeof _playWatchDocs !== 'undefined' && _playWatchDocs ? _playWatchDocs.length : 0) +
      ' · 原型pause中性化=' + (_cxAuditProtoPause() ? '是' : '否') +
      ' · 原型rate中性化=' + (_cxAuditProtoRate() ? '是' : '否') +
      ' · mediaSession=' + (_cxAuditMediaSession() ? '已接管' : '否'));
    // 自动暂停/恢复运行时状态（诊断#十）：阈值与"接近阈值/待恢复"计数，便于核对自动暂停是否按预期生效
    var _pendingResume = 0, _nearAutoStop = 0;
    for (var _ji = 0; _ji < vs.length; _ji++) {
      bestEffort(function () {
        var _jv = vs[_ji];
        if (cxState(_jv).resumeAt && Date.now() < cxState(_jv).resumeAt) _pendingResume++;
        if (CONFIG.AUTO_STOP_MIN > 0 && (cxState(_jv).watchMs || 0) >= CONFIG.AUTO_STOP_MIN * 60000 * 0.8) _nearAutoStop++;
      }, 'diag.pendingResume');
    }
    L.push('自动暂停: 阈值=' + CONFIG.AUTO_STOP_MIN + 'min · 接近阈值=' + _nearAutoStop + ' · 自动恢复: 间隔=' + CONFIG.RESUME_AFTER_MIN + 'min · 待恢复=' + _pendingResume);
    // 智慧树作业/考试助手状态（题目区且已启用时）
    if (typeof window.__CX_FORCE_PLAY !== 'undefined' && typeof window.__CX_FORCE_PLAY.zhihuishuExamEnabled === 'function' && window.__CX_FORCE_PLAY.zhihuishuExamEnabled() && typeof window.__CX_FORCE_PLAY.zhihuishuExamState === 'function') {
      var _zs = window.__CX_FORCE_PLAY.zhihuishuExamState() || {};
      L.push('智慧树作业/考试: DeepSeek=' + (_zs.ds ? '已连' : '未连') + ' · 作答=' + (_zs.answering ? '进行中' : '未启') + ' · 自动交卷=' + (_zs.asub || '关') + ' · 可交卷=' + (_zs.confirmReady ? '是(待确认)' : '否'));
    }
    L.push('CONFIG: AUTO_STOP_MIN=' + CONFIG.AUTO_STOP_MIN + ' RESUME_AFTER_MIN=' + CONFIG.RESUME_AFTER_MIN + ' RESCAN_INTERVAL=' + CONFIG.RESCAN_INTERVAL + ' END_RELEASE_SEC=' + CONFIG.END_RELEASE_SEC + ' LOOP_PLAY=' + CONFIG.LOOP_PLAY + ' SINGLE_VIDEO=' + CONFIG.SINGLE_VIDEO + (CONFIG.SINGLE_VIDEO_COURSES && CONFIG.SINGLE_VIDEO_COURSES.length ? ' SINGLE_COURSES=' + CONFIG.SINGLE_VIDEO_COURSES.join(',') : '') + ' SINGLE_ACTIVE=' + (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.singleVideoActive ? window.__CX_FORCE_PLAY.singleVideoActive() : CONFIG.SINGLE_VIDEO) + ' NINJA=' + CONFIG.NINJA_MODE + ' PAUSE_HOTKEY=' + CONFIG.PAUSE_HOTKEY + ' DEBUG=' + DEBUG + ' INTRUSION_MODE=' + CONFIG.INTRUSION_MODE + ' POLITE_MODE=' + CONFIG.POLITE_MODE);
    // v4.19.49 答题/视觉配置补全：旧 CONFIG 行只有视频系配置，「作答了为何没提交 / bank 为何不命中 / 截图为何不发」
    // 的第一排查项（自动提交/题库规模/CDN 隐私授权/视觉超时）散落或缺失，统一收口在此一行。
    bestEffort(function () {
      var _ls = function (k) { return safeGet(function () { return localStorage.getItem(k); }, null); };
      var _autoSubmit = _ls(CX_KEYS.QUIZ_AUTO_SUBMIT) !== '0';                       // 默认自动提交
      var _autoStart = _ls(CX_KEYS.QUIZ_AUTO_START) !== '0';                         // 默认自动启动
      var _offline = _ls(CX_KEYS.QUIZ_OFFLINE) !== '0';                              // 默认仅离线（不外发）
      var _src = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_ANSWER_SOURCE) || 'random';
      var _vis = !!(typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_ENABLED);
      var _ocr = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_OCR) || 'endpoint';
      var _visTo = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_TIMEOUT) || 60000;
      var _cdn = !!(typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_PRIVACY_OK);
      var _ep = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_AI_ENDPOINT) ? '已配置' : '未配置';
      // v4.19.49：超时按「实际生效口径」显示——deepseek-web 模式恒 90s（面板 60s 配置被忽略，见 quiz.js _visTo），
      // 旧显示直接暴露 CONFIG 值 60s，与实际 90s 预算不符，误导「修复未生效」判断。
      var _visEff = (_ocr === 'deepseek-web') ? 90000 : _visTo;
      L.push('QUIZ配置: 自动启动=' + (_autoStart ? '开' : '关') + ' · 自动提交=' + (_autoSubmit ? '开' : '关(作答后挂起待确认)') + ' · 仅离线=' + (_offline ? '是(不外发)' : '否') +
        ' · 答案源=' + _src + ' · 视觉识别=' + (_vis ? ('开(OCR=' + _ocr + ' · 超时=' + Math.round(_visEff / 1000) + 's' + (_ocr === 'deepseek-web' && _visTo !== 90000 ? '[deepseek-web 固定90s]' : '') + ')') : '关') +
        ' · CDN授权=' + (_cdn ? '已授权' : '未授权(不发截图/不加载CDN)') + ' · AI端点=' + _ep);
      // 填空自动作答状态：默认关，命中题库/AI 才回填且不自动提交（与「自动提交」默认开相反，属高风险动作）
      var _fill = (_ls(CX_KEYS.QUIZ_FILL_ENABLED) === '1');
      L.push('填空自动作答: ' + (_fill ? '开(仅题库/AI命中·不自动提交)' : '关(填空题留待人工)'));
      // 题库规模：内存 quizBank（跨帧取最大）+ 落盘 cx_quiz_bank——bank 源命中与否的直接判据
      var _mem = 0, _frB = _cxAllFrames();
      for (var _bi2 = 0; _bi2 < _frB.length; _bi2++) {
        try {
          var _bk = _frB[_bi2].__CX_FORCE_PLAY && _frB[_bi2].__CX_FORCE_PLAY.quizBank;
          if (_bk) { var _n2 = Object.keys(_bk).length; if (_n2 > _mem) _mem = _n2; }
        } catch (e) {}
      }
      var _disk = safeGet(function () {
        var _raw = localStorage.getItem(CX_KEYS.QUIZ_BANK);
        return _raw ? Object.keys(JSON.parse(_raw)).length : 0;
      }, 0);
      L.push('题库: 内存=' + _mem + '条 · 落盘=' + _disk + '条' + (_src === 'bank' && !_mem && !_disk ? '（源=bank 但题库为空 → 恒回退随机）' : ''));
    }, 'diag.quizCfg');

    var fg = foregroundVideo();
    L.push('前台(可见·面积最大): ' + (fg ? ('#' + (vs.indexOf(fg) + 1)) : '无(无可见视频→本帧不强制续播)'));
    L.push('');
    L.push(_sec(13, '视频列表(' + vs.length + ')'));
    for (var i = 0; i < vs.length; i++) {
      bestEffort(function () {
        var v = vs[i];
        var st = v.ended ? 'ended' : (v.paused ? 'paused' : 'playing');
        L.push('#' + (i + 1) + (v === fg ? '★前台' : '') + ' ' + st +
          ' rate=' + v.playbackRate + ' loop=' + v.loop +
          ' ForcePaused=' + !!v[FLAGS.forcePaused] + ' UserPaused=' + !!v[FLAGS.userPaused] +
          ' Released=' + !!cxState(v).released + ' EndedLock=' + !!v[FLAGS.endedLock] +
          ' 原生pause=' + !!v[FLAGS.np] + ' nearEnd=' + nearEnd(v) + ' keep=' + !!cxState(v).userKeep +
          ' 进度=' + fmtTime(v.currentTime) + (isFinite(v.duration) && v.duration > 0 ? '/' + fmtTime(v.duration) : '') +
          ' 漂移恢复=' + (v.__cxDriftAt ? (Math.round((Date.now() - v.__cxDriftAt) / 1000) + 's前') : '无') +
          ' 已看=' + ((cxState(v).watchMs || 0) / 60000).toFixed(1) + 'min' +
          ' isRebuildFinished=' + isRebuildFinished(v) +
          ' src=' + shortSrc(v));
      }, 'diag.perVideo');
    }
    L.push('');
    L.push('■ [14] 功能自检');
    // 联动功能自检矩阵：将所有 partial(部分) 与 fail(失败) 项汇总进诊断信息，
    // 使"实时诊断"与"功能完整性矩阵"合并呈现——只看实时状态会漏掉功能缺口（报告矩阵里标 partial/fail 的项）。
    bestEffort(function () {
      var st = buildFeatureSelfTest();
      if (st && st.rows && st.rows.length) {
        var watch = [];
        for (var _wi = 0; _wi < st.rows.length; _wi++) {
          var _w = st.rows[_wi];
          if (_w.status === 'partial' || _w.status === 'fail') watch.push(_w);
        }
        if (watch.length) {
          L.push('自检待关注(' + watch.length + '项·部分/失败): ' + watch.map(function (w) {
            return '[' + w.status + '] ' + w.group + '·' + w.name + (w.detail ? ' · ' + w.detail : '');
          }).join(' | '));
        } else {
          L.push('自检待关注: 无（所有功能均已实现/不适用）');
        }
      }
    }, 'diag.selfTestJoin');
    L.push('');
    L.push('■ [15] 提示流（最近10条）');
    // 跨帧聚合各帧提示史（答题 toast 常发自子帧）：数据源为 panel-toast-feed 的结构化环形缓冲
    // toastFeedRecent（独立于面板 DOM 与 flush 生命周期），按 ts 取最新、同秒同文去重后输出。
    bestEffort(function () {
      var _lv = { error: '错误', warn: '警告', success: '成功', info: '提示' };
      var _all = [];
      var _fr = _cxAllFrames();
      for (var _fi = 0; _fi < _fr.length; _fi++) {
        (function (w) {
          var rec = safeGet(function () {
            return (w.__CX_FORCE_PLAY && typeof w.__CX_FORCE_PLAY.toastFeedRecent === 'function') ? w.__CX_FORCE_PLAY.toastFeedRecent(10) : null;
          }, null);
          if (rec && rec.length) {
            for (var k = 0; k < rec.length; k++) {
              if (rec[k] && rec[k].m != null) _all.push({ m: String(rec[k].m), l: rec[k].l || 'info', ts: rec[k].ts || 0, f: (w === window ? '本帧' : '子帧') });
            }
          }
        })(_fr[_fi]);
      }
      if (!_all.length) {
        // v4.19.50 跨页回读：各帧内存 log 为空时，回读 localStorage 持久化历史（cx_toast_feed_v1，由任意页写入）——
        // 补「课程页新会话/未答题帧而应答端已有历史」的同步缺口，提示流跨页必定可见。仅在内存全空时兜底。
        bestEffort(function () {
          try {
            var _pfRaw = localStorage.getItem('cx_toast_feed_v1');
            if (_pfRaw) {
              var _pfArr = JSON.parse(_pfRaw);
              if (Array.isArray(_pfArr)) {
                for (var _pi = 0; _pi < _pfArr.length; _pi++) {
                  if (_pfArr[_pi] && _pfArr[_pi].m != null) _all.push({ m: String(_pfArr[_pi].m), l: _pfArr[_pi].l || 'info', ts: _pfArr[_pi].ts || 0, f: '持久化' });
                }
              }
            }
          } catch (e) {}
        }, 'diag.toastFeedPersist');
      }
      if (!_all.length) {
        // v4.19.50 调试：仍空 → 输出各帧提示流链路状态（订阅/日志/持久化），定位「订阅丢失 vs 确实无记录 vs 持久化异常」
        L.push('  （暂无提示记录）· 链路: ' + _fr.map(function (w) {
          var _d = null;
          try { _d = (w.__CX_FORCE_PLAY && typeof w.__CX_FORCE_PLAY._toastFeedDebug === 'function') ? w.__CX_FORCE_PLAY._toastFeedDebug() : null; } catch (e) {}
          return _d ? ('帧(订=' + (_d.subscribed ? 'on' : 'OFF') + ' 日志=' + _d.logLen + ' 持久=' + _d.persist + ')') : ((w === window) ? '帧(无探针·本帧)' : '帧(无探针)');
        }).join(' '));
        return;
      }
      _all.sort(function (a, b) { return b.ts - a.ts; });   // 最新在前
      var _seen = {}, _n = 0;
      for (var i2 = 0; i2 < _all.length && _n < 10; i2++) {
        var it = _all[i2];
        var key = Math.floor(it.ts / 1000) + '|' + it.m;   // 同秒同文视为同一条（多帧副本偶发重放）
        if (_seen[key]) continue;
        _seen[key] = 1; _n++;
        var d = new Date(it.ts);
        var hh = ('0' + d.getHours()).slice(-2), mm = ('0' + d.getMinutes()).slice(-2), ss = ('0' + d.getSeconds()).slice(-2);
        L.push('  [' + hh + ':' + mm + ':' + ss + '][' + (_lv[it.l] || '提示') + ']' + (it.f === '子帧' ? '[子帧]' : '') + ' ' + it.m);
      }
    }, 'diag.toastFeed');
    return L.join('\n');
  }
  function copyDiagnostics() {
    var txt;
    bestEffort(function () { txt = buildDiagnostics(); }, 'diag.build');   // buildDiagnostics 访问 allVideos/_cxAuditProtoPause 等无 typeof 守卫，抛错时降级为错误文本，避免"复制无响应"
    if (txt === undefined) txt = '诊断生成失败：build 过程抛出异常（详见控制台 telemetry 日志）';
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { EventBus.emit('ui:toast', '已复制诊断信息'); }, function () { fallbackCopy(txt); });
      } else fallbackCopy(txt);
    } catch (e) { fallbackCopy(txt); }
  }
  function fallbackCopy(txt) {                     // 非安全上下文/剪贴板 API 不可用时的降级
    try {
      var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.style.left = '-9999px';
      if (document.body) { document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
      EventBus.emit('ui:toast', '已复制诊断信息');
    } catch (e2) { EventBus.emit('ui:toast', '复制失败，请手动复制'); }
  }

