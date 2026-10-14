// @requires: CONFIG, _quizVisionCheckContext, bestEffort
// @source-group: takeover/engine/quiz-vision.js
// 职责：文本恢复编排与公共入口挂载；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // 统一还原入口：截图 → (tesseract OCR 文本 | endpoint 答案 | deepseek-web 视觉作答)；返回 Promise<{text, answer}>。
  //   text：还原后的肉眼可见题干文本（用于回查本地题库）；answer：多模态端点直接给的答案索引（可选）。
  // 关键前提：超星题干/选项在 DOM 中是混淆替换后的假字（同形字/字体映射），textContent 与肉眼所见不一致；
  //   只有「渲染后的视觉」(截图) 才是真实题目。因此一律先截图，再交给 OCR/多模态视觉后端，绝不信任 DOM 文本。
  function quizRecover(qEl, context) {
    var requestContext = _quizVisionCreateContext(qEl, context), ownsContext = requestContext !== context;
    var recover = function () {
    _quizVisionCheckContext(requestContext);
    if (typeof _quizRecoverOverride === 'function') return _quizRecoverOverride(qEl, requestContext);   // TEST SEAM
    // 视觉提示词：明确要求读图作答、仅回字母；DOM 假字不可附。
    // v4.19.19 收紧：实测旧提示词约束过软，DeepSeek 仍会输出「解析/我认为/根据…」等前缀与解释文字，
    // 导致①回复变长拖慢网页版 responder（慢→易触 45s vision-timeout）、②解析在冗杂文本里取错字母。
    // 改为「硬格式约束」：整条回复只允许是要么一个字母、要么几个字母连写，禁止任何前缀/解释/标点；并给定显式格式示例。
    // v4.19.25 再收紧：实测 4.19.19 硬约束仍被无视（回复「我们根据已还原文本，这是一道单选题…」长篇分析无字母）
    // → 加入「程序逐字解析、非字母内容即判错」的后果式约束，并显式声明文本/截图可能不完整时的行为。
    var VISION_PROMPT = [
      '你是网课答题助手。请根据题目截图与已还原文本作答，题型可能是【单选】【多选】【判断】之一。',
      '',
      '作答步骤（内部推理，可展示）：',
      '1) 先判断题型（单选/多选/判断）；',
      '2) 逐项核对：把每个选项与题干逐字比对，特别注意限定词——「不/除了/错误的是/不属于/没有/以下哪项正确」等会反转对错方向，切勿漏看；',
      '3) 反思核对：在落答案前，回看题干与选项，确认没有把"正确"答成"错误"、没有多/漏选；',
      '4) 给出答案与确定性。',
      '答案必须能从题干与选项中推出；若信息确实不足，选最可能项并标注低置信，不要留空。',
      '',
      '输出规则（严格遵循）：',
      '· 单选题：一个大写字母，例如 A',
      '· 多选题：所有正确选项的字母连写、字母间不要空格，例如 ABD。注意：正确选项可能只有 1 个（此时只写 1 个字母），也可能 2~4 个，按实际选。',
      '· 判断题：输出题目里「正确/错误」选项对应的字母（通常是 A 或 B）。务必输出字母，不要输出「正确」「错误」等中文词。',
      '· 最后一行固定格式（程序据此解析）：答案：<字母>｜置信：高/中/低。例：答案：C｜置信：高',
      '',
      '已还原文本由程序从混淆字体还原，通常比截图里的字形更可靠；若已还原文本清晰、选项字母可读，优先信已还原文本。截图仅作辅助确认。',
      '',
      '示例（仅参考格式）：',
      '问：下列说法正确的是？选项 A…B…C…D…',
      '答：经核对 B 正确。答案：B｜置信：高',
      '问：下列不属于的有（多选）？选项 A…B…C…',
      '答：AC 不属于。答案：AC｜置信：高'
    ].join('\n');
    // 截图：成功→dataURL；失败（空白 / html2canvas 加载失败 / 视口外元素）→null，由下方按模式兜底。
    // v4.19.15 修复：deepseek-web 有「混淆字体解码文本」作强兜底，截图不可用时应答而非整题失败；
    // endpoint/tesseract 依赖截图，无图即失败（保持原语义）。
    var _snap;
    try { _snap = (typeof _quizSnapshotOverride === 'function') ? _quizSnapshotOverride(qEl) : quizSnapshot(qEl); }
    catch (e) { _snap = Promise.reject(e); }   // TEST SEAM：注入假截图/抛错
    return Promise.resolve(_snap).then(function (dataUrl) { return dataUrl; }, function () { return null; }).then(function (dataUrl) {
      _quizVisionCheckContext(requestContext);
      var mode = (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_VISION_OCR) || 'endpoint';
      if (mode === 'tesseract') {
        // 本地 OCR 还原真实文本 → 回查题库
        if (!dataUrl) return Promise.reject(new Error('题目截图疑似空白（tesseract 依赖截图，无文本兜底）'));
        return quizOcr(dataUrl, (typeof CONFIG !== 'undefined' && CONFIG.QUIZ_OCR_LANG) || 'chi_sim')
          .then(function (text) { return { text: text, answer: null }; });
      }
      if (mode === 'deepseek-web') {
        // DOM 文本为假，绝不读取；优先把截图发往 DeepSeek 视觉作答（应答端已支持粘贴图片）。
        // rev4 抗截图残缺：截图对透明色/text-shadow 混淆渲染为空（实测只剩 ABCD）→ 解码混淆字体
        // 得到真实题干+选项文本，随提示词发给 DS（截图仍附，双保险；解码失败回退纯截图）。
        // v4.19.14 诊断：把混淆字体解码是否成功/还原字数附进回包（decodeOk/decodeLen），供诊断页区分
        // 「解码失败→DS 只见截图盲答」与「解码成功→DS 见真实文本」。
        // v4.19.15：截图空白/不可用→仅发解码文本给 DS（text-only），显式说明截图缺失，避免把空白图发给 AI 造成错答。
        return _quizDecodeSecretText(qEl).then(function (realText) {
          _quizVisionCheckContext(requestContext);
          var prompt = VISION_PROMPT;
          var _decodeOk = !!(realText && realText.length > 4);
          // 截图是题目渲染后的真实视觉，是作答依据。v4.19.28：大图改经独立 GM 键 cx_ds_ask_v1 发送，
          // 不再与 ds-state 心跳键(cx_ds_bridge_v1)共享——大值写入不再挤掉心跳，避免 4.19.27 的 60s 超时全红，
          // 同时恢复把截图发给 DeepSeek（双保险：截图为主、解码文本为辅）。混淆字体下解码文本可能含假字，仅供参考、以截图为准。
          var _img = dataUrl || undefined;
          if (_decodeOk) prompt += '\n\n（以下为 AI 还原的真实题目文本，请以此为主要依据作答；若与截图不一致以文本为准）\n' + realText.slice(0, 800);
          if (_img) prompt += '\n\n（题目截图已随消息发送，请结合截图作答）';
          else prompt += '\n\n（本题无可用截图，仅以已还原文本作答）';
          return quizAskDeepSeek(_img, [], prompt, requestContext).then(function (r) {
            _quizVisionCheckContext(requestContext);
            if (r && typeof r === 'object') {
              r.decodeOk = _decodeOk; r.decodeLen = realText ? realText.length : 0; r.imgSkipped = !_img;
              // v4.19.32·把 DS 回复的确定性信号接回作答决策（解析器能算，但旧逻辑恒丢）。
              // 供 _onSettle 按 high/mid/low 分级落点（错答不再无条件直交）。
              var _rc = (typeof window !== 'undefined' && window.__CX_FORCE_PLAY && typeof window.__CX_FORCE_PLAY._dsReadConfidence === 'function')
                ? window.__CX_FORCE_PLAY._dsReadConfidence((r.text != null) ? r.text : '') : 'high';
              r.visionConf = _rc;
            }
            return r;
          });
        }, function () {
          _quizVisionCheckContext(requestContext);
          // 解码异常：仍发截图（真实视觉），无截图则整题失败
          if (!dataUrl) return Promise.reject(new Error('题目截图疑似空白且混淆字体解码失败（无可用作答依据）'));
          return quizAskDeepSeek(dataUrl, [], VISION_PROMPT + '\n\n（题目截图已随消息发送，请结合截图作答）', requestContext).then(function (r) { _quizVisionCheckContext(requestContext); if (r && typeof r === 'object') { r.decodeOk = false; r.decodeLen = 0; r.imgSkipped = false; } return r; });
        });
      }
      // endpoint 模式：把截图交给多模态 AI 读图作答（answer 直接可用，text 可选回填题库）
      if (!dataUrl) return Promise.reject(new Error('题目截图疑似空白（endpoint 依赖截图）'));
      return quizVisionAsk(dataUrl, VISION_PROMPT, requestContext).then(function (res) { return res || { text: null, answer: null }; });
    });
    };
    var pending; try { pending = recover(); } catch (error) { pending = Promise.reject(error); }
    return Promise.resolve(pending).then(function (result) { _quizVisionCheckContext(requestContext); return result; })
      .finally(function () { if (ownsContext) requestContext.finish(); });
  }

  bestEffort(function () {
    window.__CX_FORCE_PLAY.quizRecover = quizRecover;
    window.__CX_FORCE_PLAY.quizSnapshot = quizSnapshot;
    window.__CX_FORCE_PLAY._quizDecodeSecretText = _quizDecodeSecretText;   // 测试钩子（sim-secret-decode 回归）
    // v4.19.36 诊断：混淆字体解码缓存状态（字体族/字库字符数/缓存年龄）——判断题无图/解码失败排查用
    window.__CX_FORCE_PLAY._secretDecodeStats = function () {
      return Object.keys(_secretGlyphMaps).map(function (f) {
        return { family: f, chars: Object.keys(_secretGlyphMaps[f].map).length, ageMs: Date.now() - _secretGlyphMaps[f].ts };
      });
    };
    window.__CX_FORCE_PLAY._quizEnsureVisible = _quizEnsureVisible;   // 供 sim 回归：视口内化前置 resolve 不抛错
    window.__CX_FORCE_PLAY.setQuizRecoverOverride = function (fn) { _quizRecoverOverride = fn; };
    window.__CX_FORCE_PLAY.setQuizSnapshotOverride = function (fn) { _quizSnapshotOverride = fn; };   // TEST SEAM
  }, 'qv.export');
