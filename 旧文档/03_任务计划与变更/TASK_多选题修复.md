# 任务文档：多选题在文本/题库/AI 路径只点 1 项的缺陷修复

- **状态**：✅ 已完成并验证
- **日期**：2026-08-16
- **涉及模块**：`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js`
- **回归测试**：`ecosystem/_sim/sim-quiz-choice-types.js`
- **构建产物**：`ecosystem/chaoxing-force-play.user.js`（已重建）

---

## 1. 问题来源

代码评审发现（与实测一致，但按真实代码校正后执行）：

- `_quizResolveAnswer`（`quiz.js:347`）用 `parseInt(b, 10)` 把题库答案塌缩成**单值**；加权融合 `mergeAnswers` 本身只返回单一 `index`。
- 应用主循环（`quiz.js:572` 附近）只调用 `_quizClick(opts, idxObj.idx)`，**全程未调用 `_quizIsMulti`**。
- 视觉路径已能解析 `"AB"`（经 `_quizAnswerToIdxs`，返回 `{idxs, multi}`），但文本/题库/AI 路径从未接入。

**后果**：多选题（超星 `qtype=1` / `role=checkbox`）在随机、题库、AI 路径下只会选中 1 项，答案残缺，且用户无感知。

---

## 2. 根因（真实代码校正）

评审里几处假设与实际签名不符，已校正：

| 评审假设 | 真实情况 |
|----------|----------|
| `_quizAnswerToIdxs` 返回数组 | 实际返回对象 `{ idxs, multi }`（与视觉路径 `quiz.js:473` 用法一致） |
| 缺陷只在 `quiz.js:571-592` 的 auto 分支 | 实际 AI 超时兜底、无答案源兜底、低置信 review 兜底三处均为单选项点击 |
| `core.js` 有语法错误 | 误报（`core.js` 仅打开共享 IIFE，闭合 `})();` 由构建脚本在拼接末尾追加） |

---

## 3. 改动清单

### 3.1 `_quizResolveAnswer` 多选识别（`quiz.js:351`）

开头计算多选标志并透传：
```js
var multi = _quizIsMulti(options);   // 多选题：答案可能为多个下标（题库可存字母串"AB"/数组）
```

题库路径（bank/ai）增加多选分支：题库答案为字母串 `"AB"/"A,B"` 或下标数组时，经 `_quizAnswerToIdxs` 解析为多个下标，直接返回 `{ idxs:[...], confidence:1.0, source:'bank' }`；单值/单选项路径完全不变。

### 3.2 应用主循环归一化点选（`quiz.js:572` 起）

先计算待点选下标集合 `clickIdxs`（多选 = 全部正确下标、单选 = 单个），再做置信度分级决策；多选时 `clickIdxs.forEach` 全选点击，不再只点 1 项：
```js
var clickIdxs = [];
if (idxObj) {
  if (idxObj.idxs && idxObj.idxs.length) {
    idxObj.idxs.forEach(function (i) { if (typeof i === 'number' && i >= 0 && i < opts.length) clickIdxs.push(i); });
  } else if (idxObj.idx != null) {
    if (typeof idxObj.idx === 'number' && idxObj.idx >= 0 && idxObj.idx < opts.length) clickIdxs.push(idxObj.idx);
  }
}
// ...置信度分级决策...
clickIdxs.forEach(function (i) { _quizClick(opts, i); });
```

### 3.3 随机兜底多选感知

新增辅助函数 `_quizRandomPick(opts, multi)`（`quiz.js:423`）：多选题返回 2 个互异随机下标（模拟"多选"语义），单选题返回 1 个。应用于三处兜底：
- AI 超时兜底（`quiz.js:624` 附近）
- 无答案源兜底（`quiz.js:668` 附近）
- 低置信 review 兜底（主循环内）

---

## 4. 验证结果

- `node --check ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js` → ✅ 通过
- Lint → ✅ 0 错误
- 重建产物 → ✅ 全部 BUILD GATE 通过（含 `_sim PASSED`）
- `sim-quiz-choice-types.js` 新增 2 个用例：
  - 用例 6：多选·题库路径（题库存 `"AB"`）→ 点 0/1 不点 2 ✅
  - 用例 7：单选·题库路径（题库存 `1`）→ 仅点 1（回归）✅
- **完整 sim 套件：56/56 全 PASS**（choice-types 共 17 条断言全绿）

---

## 5. 改动前提与边界

- 修复前提是答案源能提供多选答案（字母串/数组）。若题库只存了单一下标，仍只点一项——这是**数据限制**，非代码缺陷；视觉路径（DeepSeek 回传 `"AB"`）本就全选，不受影响。

---

## 6. 未处理项（评审其余建议，按需跟进）

| 优先级 | 问题 | 位置 |
|--------|------|------|
| 🟡 中 | 部分定时器绕过 `TimerRegistry` 清理（裸 `setTimeout`） | `vision-deepseek-web.js:296/298/565/591` |
| 🟡 低 | 死代码 `_quizCountAnswered` | `quiz.js:515` |
| 🟡 低 | `quiz.js:559-568` 缩进错位（逻辑正确，仅视觉误导） | `quiz.js` |
| ⚠️ 核查 | 弹窗/面板 `innerHTML` 拼接是否全部 `escapeHTML` | `zhihuishu-fab.js`、`panel.js`、`commands.js` |
| 🟢 风格 | `var`/`const`/`let` 混用 | 零散 |
