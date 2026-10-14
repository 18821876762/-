


// @source-group: takeover/engine/quiz.js
// 职责：答案归一化与选项范围校验；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。
  // 把 DeepSeek/端点回传的答案令牌解析为要点击的选项下标数组。
  // 支持三类：① 字母(单选 A / 多选 AB) → 按位置映射(A=0,B=1,...)；
  //   ② 判断/是非题语义词(正确/对/是/真 vs 错误/错/否/假) → 按选项标签内容匹配(不假设 A=是/B=否)；
  //   ③ multi 标志透传(多选且多字母时强制多选点击)。
  // v4.19.14：答案解析「带失败原因分类」版本——供诊断页区分三类根因：
  //   'letter-ok'          字母命中且落在选项范围内（单选/单个字母）
  //   'letter-multi-ok'    多个字母均命中（多选）
  //   'letter-out-of-range' DeepSeek 回了字母但全部超出选项数（如回 "E" 但仅 4 项）
  //   'semantic-ok'        判断/是非题按语义词匹配到选项
  //   'no-letter-or-semantic' 回的是选项内容(如"翻阅资料选择")或无关文本 → 取不到字母/语义
  function _quizAnswerParse(token, opts, multi) {
    if (!token) return null;
    token = String(token).trim();
    // 1) 字母（可多个：多选 "AB"/"A、B"）。v4.19.14 修正：
    //   - 放宽到 A–H（覆盖 5~8 选项题；旧版只 A–D 会把"回 E"误判为无字母→随机兜底，是真实正确性 bug）。
    //   - 散文保护：回复含 3+ 连写英文字母的单词(如 "The correct answer is B" 的 answer/correct)→ 视为散文，
    //     不抓其中字母（否则旧版会从 "answer" 误抓 'a' 当成选项 A）。仅当回复是纯字母序列时才按字母解析。
    //   - 记录越界：有字母但全部超出选项数 → reason='letter-out-of-range'（诊断关键：区分"回的是字母但错"）。
    // v4.19.16 修复：散文保护本意是避开 "answer"/"correct" 等英文单词里的字母（避免误抓 'a' 当选项 A），
    // 但多选答案 "ABCD"（连续 4+ 英文字母）会误命中 /[A-Za-z]{3,}/ → 被当散文丢弃 → 整题解析失败变红。
    // 修正：仅当文本含「选项范围外的字母(I–Z)」才视为散文（英文单词几乎都含 I–Z 字母）；
    // 纯选项字母串(ABCD/ABC…)整体落在 A–H → 不当散文，正常按字母解析。
    var _pureOpt = /^[A-Ha-h\s、，,与和及]*$/.test(token);
    var _prose = !_pureOpt && /[A-Za-z]{3,}/.test(token);
    var letters = _prose ? null : token.match(/[A-Ha-h]/g);
    if (letters && letters.length) {
      var idxs = [], seen = {}, _oor = false;
      for (var i = 0; i < letters.length; i++) {
        var idx = letters[i].toUpperCase().charCodeAt(0) - 65;
        if (idx >= 0 && idx < opts.length && !seen[idx]) { seen[idx] = 1; idxs.push(idx); }
        else if (idx >= opts.length) _oor = true;   // 字母超出选项数（如回 E 但仅 4 项）
      }
      if (idxs.length) return { idxs: idxs, multi: multi || idxs.length > 1, reason: (idxs.length > 1 ? 'letter-multi-ok' : 'letter-ok') };
      if (_oor) return { idxs: [], multi: multi, reason: 'letter-out-of-range' };  // 有字母但全部越界
      return { idxs: [], multi: multi, reason: 'letter-out-of-range' };
    }
    // 2) 语义词（判断/是非题）：按选项标签自身正负极性匹配，不绑定 A=是/B=否
    // v4.19.20 审查修复：否定词优先——「不正确/不成立/不对/不是」等含否定前缀的回复不得被
    // pos 正则（正确/是/成立 等子串）误判为正向（旧实现「不正确」命中 pos 的『正确』→ 点反）。
    var _negTok = /(不对|不是|并非|不正确|不成立|不选|错误|错|否|假|false|×|错的|否的)/i.test(token);
    var pos = !_negTok && /(正确|对|是|真|true|√|对的|是的|成立)/i.test(token);
    var neg = _negTok || /(错误|错|否|假|false|×|不对|不是|并非|错的|否的)/i.test(token);
    if (pos || neg) {
      var chosen = [];
      for (var j = 0; j < opts.length; j++) {
        var lab = (opts[j].textContent || '').replace(/\s+/g, '');
        var op = /(正确|对|是|真|√|对的|是的|成立)/.test(lab);
        var on = /(错误|错|否|假|×|不对|不是|并非|错的)/.test(lab);
        if (pos && op && !on) chosen.push(j);
        if (neg && on && !op) chosen.push(j);
      }
      if (chosen.length) return { idxs: chosen, multi: multi || chosen.length > 1, reason: 'semantic-ok' };
    }
    return { idxs: [], multi: multi, reason: 'no-letter-or-semantic' };
  }
  function _quizAnswerToIdxs(token, opts, multi) {
    var r = _quizAnswerParse(token, opts, multi);
    return r ? { idxs: r.idxs, multi: r.multi } : null;
  }

  // 视觉识别异步作答：截图还原后求答案并回填（quiz-vision.js 提供 quizRecover）。先由调用方占坑(_quizHandled)，此处只负责还原+回填。
