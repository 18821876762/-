// @requires: EventBus, _quizAIFailed, _quizAIPending, _quizAIProblems, _quizCanRun, _quizCancelForFp, _quizFillItems, _quizHandled, _quizInfoMissing, _quizLastAnswered, _quizLastHadQuestions, _quizLastQuestions, _quizLastScanned, _quizLightFp, _quizLights, _quizMOForced, _quizManualHold, _quizPendingSubmit, _quizQuestionSettled, _quizRefreshSettlementStats, _quizRetryTimer, _quizReviewItems, _quizSettled, _quizStrictAI, _quizSyncLights, _quizVisGen, _quizVisTimers, bestEffort, quizTick
// @source-group: takeover/engine/quiz.js
// @continuation-of: takeover/engine/quiz-tick.js
// 职责：同一 quizTick 闭包内的统计、清理与重扫（函数续片）；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
      // —— 运行/结束可观测 ——
      if (scanned === 0) {
        _quizDetectedNotified = false; _quizDoneNotified = false; _quizLastScanned = 0;  // 离开题目页→重置，再进会重报「启动」
        _quizRefreshSettlementStats();
      } else {
        _doneInTick = 0;
        for (var _dq = 0; _dq < _quizLastQuestions.length; _dq++) if (_quizQuestionSettled(_quizLastQuestions[_dq].fp)) _doneInTick++;
        var done = _doneInTick;
        var remaining = Math.max(0, scanned - done);
        // 完成度校验（需求：检测到 N 题应校验最大序号=N；全部答完应校验是否含 1~N）
        // 仅当「所有扫描题都能解析出序号」时做严格校验（含主观/填空无序号题则跳过，避免误报）
        var _validSeqs = _seqs.filter(function (s) { return s && s > 0; });
        var _maxSeq = _validSeqs.length ? Math.max.apply(null, _validSeqs) : 0;
        if (_validSeqs.length === scanned && scanned > 0 && _maxSeq !== scanned) {
          if (!_quizSeqWarnNotified) { _quizSeqWarnNotified = true; bestEffort(function () { EventBus.emit('ui:toast', '⚠ 检测到 ' + scanned + ' 题，但最大题号为 ' + _maxSeq + '（可能漏题或序号解析异常）'); }, 'quiz.seq.warn'); }
        } else if (remaining === 0 && _validSeqs.length === scanned && scanned > 0) {
          var _missing = [];
          for (var _s = 1; _s <= _maxSeq; _s++) if (_validSeqs.indexOf(_s) === -1) _missing.push(_s);
          if (_missing.length) {
            if (!_quizSeqWarnNotified) { _quizSeqWarnNotified = true; bestEffort(function () { EventBus.emit('ui:toast', '⚠ 全部作答完成，但缺少题号：' + _missing.join('、') + '（可能未作答或序号未识别）'); }, 'quiz.seq.warn'); }
          } else {
            _quizSeqWarnNotified = false;   // 恢复正常：下一轮若有异常可再报
          }
        }
        if (scanned > _quizLastScanned) _quizDoneNotified = false;   // 题量变多（翻页/动态加载）→ 重置完成信号
        _quizLastScanned = scanned; _quizLastAnswered = answered;    // v4.19.2：跨帧遥测（随信号灯广播上报顶层）
        bestEffort(function () {
          if (answered > 0) _quizLastActivityTs = Date.now();   // v4.19.29·出清系统：刷新答题活动时间戳（有作答题即视为活跃）
          window.__CX_FORCE_PLAY.quizStats = {
            scanned: scanned, answered: answered, done: done, remaining: remaining,
            maxSeq: _maxSeq,                                              // 已解析题号中的最大序号（完成度校验用）
            seqConsistent: _validSeqs.length === scanned && scanned > 0 ? (_maxSeq === scanned) : null,  // 序号与题数一致(null=含无序号题,不参与)
            doneAll: remaining === 0, source: src,
            answerSource: Object.keys(_srcMap).join('+') || 'random',   // 实际命中来源（融合后可见：bank/ai/random 等）
            confidence: _confN ? (_confAcc / _confN) : 0,                // 已作答项平均置信度（0~1）
            levels: Object.keys(_lvlMap).join('+') || 'auto',           // 本次分级分布（auto=直接提交/confirm=待确认/review=人工复核）
            pendingSubmit: Object.keys(_quizPendingSubmit).length,       // 已作答待二次确认提交数
            reviewCount: Object.keys(_quizReviewItems).length,
            fillCount: Object.keys(_quizFillItems).length,           // 识别为填空题待回填数（step2 自动回填消费；当前仅登记）           // 待人工复核题数（置信度<0.6 随机兜底，需用户确认/入题库）
            strictMode: _quizStrictAI(),                                 // 严格 AI 模式（强制用 AI，禁止随机兜底）
            aiProblems: _quizAIProblems ? Object.keys(_quizAIProblems).length : 0,  // 严格模式下停下报错题数
            offline: _quizOfflineOnly(),                                 // 是否仅离线作答（题目不外发）
            lastAnswerTs: _quizLastActivityTs,                            // v4.19.29·出清系统：最近作答活动时间戳
            ts: Date.now()
          };
          window.__CX_FORCE_PLAY.quizAIProblems = _quizAIProblems;       // 暴露失败题明细，供面板/诊断观测「已停下」
          _quizRefreshSettlementStats();
        }, 'quiz.stats');
        if (!_quizDetectedNotified) {
          // v4.19.50 唯一指纹计数（同完成提示）：避免 SPA 双份 DOM 使 scanned 虚高
          var _uniqS = 0; try { _uniqS = Object.keys(_quizLightFp).length; } catch (e) {}
          _quizDetectedNotified = true; bestEffort(function () { EventBus.emit('ui:toast', '自动答题已启动：检测到 ' + (_uniqS || scanned) + ' 道题（源=' + src + '）'); }, 'quiz.toast.start');
        }
        if (window.__CX_FORCE_PLAY.quizStats.doneAll && !_quizDoneNotified) {
          // v4.19.50：完成提示带「在途」反馈——占坑(handled)即算 done，视觉/ai 在途时旧文案误报「完成」，
          // 用户无法区分「真完成」vs「占坑等待回传」（实测提示流 20:36:28 报完成、20:36:39 还在帧扫5答0）。
          _quizDoneNotified = true;
          var _inflight = Object.keys(_quizVisTimers).length + (typeof _quizAIPending === 'object' ? Object.keys(_quizAIPending).length : 0);
          // v4.19.50 完成计数对齐唯一指纹：SPA 可能把同一题渲染成两份 DOM（qs 含两节点、scanned 放大），
          // 作答按 fp 去重只做一次，故文案用唯一指纹数（_quizLightFp 去重后=灯数），避免「共 N 题」虚高（实测 10 题 vs 灯 5）。
          var _uniqN = 0; try { _uniqN = Object.keys(_quizLightFp).length; } catch (e) {}
          bestEffort(function () { EventBus.emit('ui:toast', '答题完成：共 ' + (_uniqN || scanned) + ' 题已作答' + (_inflight ? ('（' + _inflight + ' 题视觉进行中，回传后落定）') : '')); }, 'quiz.toast.done');
        }
      }

      // v4.19.24 翻页清理：本帧扫到题，但部分灯对应题块已不在当前 DOM（作业翻页/切章）→ 移除旧灯与在途状态。
      // 用户实测：第一页 2 题 + 第二页 3 题 → 旧灯残留混显、灯表随翻页累积（面板卡顿需刷新）。
      {
        var _live = {};
        for (var _si2 = 0; _si2 < qs.length; _si2++) { var _fp2 = _quizFingerprint(qs[_si2], sels); if (_fp2) _live[_fp2] = 1; }
        for (var _lk = 0; _lk < _quizLights.length; _lk++) {
          var _ll = _quizLights[_lk];
          if (_ll.remote) continue;                 // 远程灯由来源帧广播管理，本帧不清理
          if (_live[_ll.fp]) continue;
          delete _quizLightFp[_ll.fp];
          _quizCancelForFp(_ll.fp);
          delete _quizSettled[_ll.fp]; delete _quizReviewItems[_ll.fp]; delete _quizFillItems[_ll.fp];
          delete _quizHandled[_ll.fp]; delete _quizAIFailed[_ll.fp]; delete _quizAIProblems[_ll.fp];
          delete _quizAIPending[_ll.fp]; delete _quizPendingSubmit[_ll.fp]; delete _quizInfoMissing[_ll.fp];
          if (_quizVisTimers[_ll.fp]) { try { clearTimeout(_quizVisTimers[_ll.fp]); } catch (e) {} delete _quizVisTimers[_ll.fp]; }
          delete _quizVisGen[_ll.fp];   // v4.19.49：翻页移除题块时连同代际删除
          _quizLights.splice(_lk, 1); _lk--;
        }
      }
    _quizRefreshSettlementStats();
    // 需求·信号灯：扫描后统一同步各题状态（红/绿/黄/黑）并通知面板渲染
    _quizSyncLights();
    // 状态机优化(卡顿排查·答题调度)：记录本轮扫描结果——无题时后续 tick 走节流降频、MO 走长防抖；
    // 有题时恢复每 tick 扫描 + MO 短防抖（题目出现/更新即时响应）。
    _quizLastHadQuestions = scanned > 0;
    // v4.19.5 修复·子帧待答重扫：子帧无主循环，一次性补扫后静态题页无 MO 事件 → 不再重扫——
    // DS 心跳/视觉链路就绪后题目永远停在门控宽限态（实测：帧DS=不可用 门控5 卡死黑灯）。
    // 有待答题时子帧起 2s 重扫（经 quizObserveDispatch 走站点路由；全部答完/离开题目页即停，零空闲开销）。
    var _pending = scanned - _doneInTick;
    if (typeof window !== 'undefined' && window !== window.top && scanned > 0 && _pending > 0 && !_quizManualHold && _quizCanRun()) {
      if (!_quizRetryTimer) {
        var _tr = (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry) ? window.__CX_FORCE_PLAY.TimerRegistry : null;
        if (_tr) {
          _quizRetryTimer = _tr.setInterval(function () {
            bestEffort(function () {
              if (!(window && window.__CX_FORCE_PLAY)) return;
              _quizMOForced = true;   // 强制扫描：不受无题节流影响
              var _rd = (typeof window.__CX_FORCE_PLAY.quizObserveDispatch === 'function') ? window.__CX_FORCE_PLAY.quizObserveDispatch : null;
              if (_rd) _rd(); else quizTick();
              _quizMOForced = false;
            }, 'quiz.retry');
          }, 2000, 'quiz-retry');
        }
      }
    } else if (_quizRetryTimer) {
      bestEffort(function () {
        if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.TimerRegistry) window.__CX_FORCE_PLAY.TimerRegistry.clearInterval(_quizRetryTimer);
        _quizRetryTimer = null;
      }, 'quiz.retry.stop');
    }
    return answered;
  }
