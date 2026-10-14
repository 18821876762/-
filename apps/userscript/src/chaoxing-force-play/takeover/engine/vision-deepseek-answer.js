// @provides: _dsParseAnswer
// @requires: safeGet
// @source-group: takeover/engine/vision-deepseek-web.js
// 职责：置信度与答案解析；按 build-manifest 顺序拼接，保留共享 IIFE 与原有初始化顺序。

  // v4.19.26 对齐颗粒度（用户确认=健壮+规格对齐）：4.19.25 提示词已声明「程序只读取大写英文字母、非字母即判错」的后果式硬约束。
  // 解析器保持「从冗杂散文捞字母」的健壮性（DS 偶发散文时不致整题失败、正确率不降），但输出规格严格对齐提示词：
  // ① 入参整体转大写 → 输出恒为大写 A–D 字母（不再漏掉小写 a-d）；② 单字母边界类覆盖引号/括号/反引号包裹（「A」/(A)/`A`）；
  // ③ 判断题仍「优先取字母(A/B)，仅当全文无任何字母时才回中文 正确/错误 作兜底」（与 _quizAnswerParse 的语义匹配分支一致）。
  // v4.19.32·置信度抽取：从 DS 回复文本推断确定性（不依赖模型是否遵守「｜置信：」格式，健壮性优先）。
  // 显式：高/中/低；隐式：犹豫词降级、自相矛盾降级；默认 high（保持旧行为，避免误降级导致全挂起）。
  function _dsReadConfidence(text) {
    return safeGet(function () {
      if (!text) return 'high';
      var t = String(text);
      var low = /置信[:：]\s*低/i.test(t);
      var mid = /置信[:：]\s*中/i.test(t);
      var high = /置信[:：]\s*高/i.test(t);
      if (low) return 'low';
      if (mid) return 'mid';
      if (high) return 'high';
      // 隐式犹豫：两种以上 → low；一种 → mid
      var _hes = (t.match(/(可能|大概|或许|也许|估计|不确定|不太确定|不太确定|没把握|猜|蒙|倾向|感觉|应该是)/g) || []).length;
      if (_hes >= 2) return 'low';
      if (_hes === 1) return 'mid';
      // 自相矛盾痕迹：结论后接否定/转折
      if (/(但|不过|然而|其实|实际上)[^。\n]{0,12}(不对|不是|错误|并非|不一定)/i.test(t)) return 'low';
      return 'high';
    }, 'high');
  }
  function _dsConfToNum(c) { return (c === 'low') ? 0.4 : (c === 'mid') ? 0.65 : 0.95; }

  function _dsParseAnswer(text) {
    return safeGet(function () {
      if (!text) return null;
      text = String(text).toUpperCase();   // v4.19.26：归一为大写，输出恒为大写字母，与提示词「大写英文字母」规格一致
      // 1) 多选：连续/经分隔符连接的多个字母（"AB"/"A、B"/"A和B"，需 ≥2 个不同字母）→ 返回多字母串
      var mm = text.match(/([A-D](?:[\s、，,与和及]*[A-D])+)/);
      if (mm) {
        // v4.19.7 否定守卫：字母簇后紧跟否定词（「选A，B不对」→ B 被否定，非多选）→ 不按多选处理，交由规则 2 取 A
        var _afterCluster = text.slice(mm.index + mm[0].length);
        if (!/(不对|不是|并非|不正确|错误)/i.test(_afterCluster)) {
          var seen = {}, out = '';
          var arr = mm[0].match(/[A-D]/g);
          for (var i = 0; i < arr.length; i++) { var L = arr[i].toUpperCase(); if (!seen[L]) { seen[L] = 1; out += L; } }
          if (out.length >= 2) return out;
        }
      }
      // 2) 单选：带「答案/正确选项/应选/选择/选/应为/是/为」等前缀的字母（含否定校验，避免「选A，B不对」误判）
      // v4.19.7：字符类补「是/为」——实测回复「答案是D」旧规则不匹配（「是」不在 [：:\s为] 内）→ 解析失败全题红灯
      var m3 = text.match(/(?:答案|正确选项|应选|选择|选|应为|应该是|是|为)[：:\s为是]*([A-D])/i);
      if (m3) {
        // 否定判定：① 字母后紧跟否定词（「选A不对」→ 否定 A）；② 匹配前缀之前含「不/非」（「答案不是A」→ 否定 A）。
        // 「选A，B不对」：_rest='，B不对' 锚定否定不命中（标点阻断）、前缀前无「不」→ 正确返回 A（B 才是被否定的）。
        var _rest = text.slice(m3.index + m3[0].length);
        var _before = text.slice(0, m3.index);
        var _neg = /^(?:[^，。、\n]{0,6}?)(不对|不是|并非|非|错误|不正确|不对的是)/i.test(_rest) || /(不|并非|非)/i.test(_before);
        if (!_neg) return m3[1];
      }
      // v4.19.49：置信结构优先——「B｜置信：高」「答案：B（置信 高）」是提示词强制要求输出的显式答案标注，
      // 即使上下文是长思维链（实测「B｜置信：高在《西游记》中…」）也稳定可取；且不受全文否定词（并非/不是）干扰，
      // 旧实现里此类文本被单字母边界（B 后全角｜不在边界集）与全文否定守卫双重拦截 → 整题解析失败红灯。
      var mConf = text.match(/([A-D])\s*[｜|:：]?\s*置信/i) || text.match(/置信[：:｜]*\s*([A-D])/i);
      if (mConf) return mConf[1].toUpperCase();
      // v4.19.26：单字母边界类覆盖引号/括号/反引号包裹（「A」/(A)/`A`）→ 直接取该字母
      var m1 = text.match(/(?:^|[\s，。、()（）「」“”‘’'"'`【\]])([A-D])(?:[\s，。、()（）「」“”‘’'"'`【\]]|$)/);
      if (m1) {
        var listed = (text.match(/[A-D][)．.、]|\b[A-D]\s*[A-D]\b/g) || []).length;
        if (listed <= 1) return m1[1];
      }
      // v4.19.7 兜底：全文仅一个 A-D 字母（如「D」「答案是D」「我认为选D」等自由句式）→ 直接取该字母；
      // 选项枚举式文本（A…B…C…D…）含多字母 → 不满足单字母条件，不会误取；含否定词时跳过（「选A不对」→ 不作答）。
      var _fall = text.match(/[A-D]/g);
      if (_fall && _fall.length === 1 && !/(不对|不是|并非|不正确)/i.test(text)) return _fall[0];
      var m2 = text.match(/(\d)[)．.]/);
      if (m2) return m2[1];
      // 3) 判断/是非题：仅在全文无 A-D 字母时，按语义词判定（正确/对/是/真 vs 错误/错/否/假）。
      //    前置「无字母」守卫，避免「选A，因为B不对」等含字母文本误触发语义分支。此为提示词「A/B」规格的兜底（DS 未给字母时）。
      //    v4.19.49 重写：旧实现 `/(正确|对|是|真)/` 对任意文本扫「是」字——纯思维链长文（无字母含大量「是」）
      //    被误判为「正确」，且「选A是不对的」会先匹配「是」抢先返回错误答案。现改为：去标点后 ≤12 字符才判语义，
      //    且优先精确匹配判断词族（正确/对/错误/不对…），其余一概视为「未给出明确判断」→ null 交上层兜底。
      if (!/[A-D]/.test(text)) {
        var _p = String(text).replace(/[\s。！？!?，,、~～：:]/g, '');
        if (_p.length <= 12) {
          // 否定判断词全文优先（「不正确/不对/不是/并非/错误/错的/假的」→ 错误）——「不正确」含「正确」子串、
          // 「说法不正确」不以否定字开头，若正向先行必被「正确」抢先误中（实测 got=正确）。
          if (/(不正确|不对|不是|并非|错误|错的|假的)/.test(_p)) return '错误';
          if (/^(正确|对|是的|成立|真|√)$/.test(_p)) return '正确';
          if (/^(错误|错|不对|不是|并非|否|假|×)$/.test(_p)) return '错误';
          if (/(正确|对(?!不起|不对)|成立)/.test(_p)) return '正确';
          if (/(不对|不是|并非|不正确|假的|错的)/.test(_p)) return '错误';
        }
      }
      return null;
    }, null);
  }
