// ===== MODULE: 答案决策融合 + 置信度（取自 code review：多源求解 → 加权融合 → 分级）=====
// 纯函数模块：不依赖 DOM/网络，可直接单测。
// 每个答案来源产出 { idx, score?, source }，经加权融合得到 { index, confidence, sources }；
// confidence ∈ [0,1] 用于分级：
//   ≥0.9  直接提交（auto）
//   0.6~0.9 提示待确认（confirm，面板展示 + 用户可取消）
//   <0.6  标记人工复核（review，不盲选 / 走随机兜底）
//
// 来源权重（反映"我们对这一来源的信任度"）：本地题库最可信，远端 AI/DeepSeek 次之，
// OCR 再次，随机兜底最低。多来源命中同一选项时加权累加，分歧时按加权占比推导置信度。
var QUIZ_SRC_WEIGHT = { bank: 1.0, deepseek: 0.9, ai: 0.7, ocr: 0.5, random: 0.3 };

/**
 * 融合多来源答案。
 * @param {Array<{idx:number, score?:number, source:string}>} answers
 * @returns {{index:number, confidence:number, sources:string[]}|null}
 */
function mergeAnswers(answers) {
  if (!answers || !answers.length) return null;
  var agg = {};
  var srcSeen = {};
  for (var i = 0; i < answers.length; i++) {
    var a = answers[i];
    if (!a || a.idx == null) continue;
    var idx = Number(a.idx);
    if (isNaN(idx)) continue;
    var w = (QUIZ_SRC_WEIGHT[a.source] != null) ? QUIZ_SRC_WEIGHT[a.source] : 0.6;
    // a.score 是来源自身对其选择的可信度（0~1）；缺省则回落到来源权重
    var s = (typeof a.score === 'number' && a.score >= 0 && a.score <= 1) ? a.score : w;
    agg[idx] = (agg[idx] || 0) + s * w;
    if (a.source) srcSeen[a.source] = true;
  }
  var keys = Object.keys(agg);
  if (!keys.length) return null;
  var best = keys[0], bestV = agg[keys[0]];
  for (var k = 1; k < keys.length; k++) { if (agg[keys[k]] > bestV) { bestV = agg[keys[k]]; best = keys[k]; } }
  var total = 0;
  for (var m = 0; m < keys.length; m++) total += agg[keys[m]];
  var confidence;
  if (keys.length === 1) {
    // 单来源：置信度 = 该来源权重（体现"我们对这一来源的信任度"，而非恒为 1.0）
    var onlySrc = Object.keys(srcSeen)[0];
    confidence = (QUIZ_SRC_WEIGHT[onlySrc] != null) ? QUIZ_SRC_WEIGHT[onlySrc] : 0.6;
  } else {
    // 多来源：最优选项占加权总票的比例（一致→趋近 1，分歧→下降）
    confidence = total > 0 ? bestV / total : 0;
  }
  return { index: Number(best), confidence: confidence, sources: Object.keys(srcSeen) };
}

/**
 * 置信度分级。
 * @param {number} confidence
 * @param {number} [autoTh=0.9]
 * @param {number} [confirmTh=0.6]
 * @returns {'auto'|'confirm'|'review'}
 */
function decisionFor(confidence, autoTh, confirmTh) {
  autoTh = (typeof autoTh === 'number') ? autoTh : 0.9;
  confirmTh = (typeof confirmTh === 'number') ? confirmTh : 0.6;
  if (typeof confidence !== 'number' || isNaN(confidence)) return 'review';
  if (confidence >= autoTh) return 'auto';
  if (confidence >= confirmTh) return 'confirm';
  return 'review';
}

try {
  if (typeof window !== 'undefined' && window.__CX_FORCE_PLAY) {
    window.__CX_FORCE_PLAY.quizMerge = {
      mergeAnswers: mergeAnswers,
      decisionFor: decisionFor,
      QUIZ_SRC_WEIGHT: QUIZ_SRC_WEIGHT
    };
  }
} catch (e) {}
