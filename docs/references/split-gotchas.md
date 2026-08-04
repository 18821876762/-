# 拆分机械约束 · 详细参考

> 本文件承接 `docs/ARCHITECTURE_GOVERNANCE.md` §4 的具体细节。核心规约只保留结论，详细反例/正例与校验清单见此处。

## 1. 为什么 `return` 后不能单独成行

用脚本切片把大文件拆成小文件时，若把函数的 `return` 提成了独立行，JS 的 **ASI（自动分号插入）** 会在 `return` 后自动补一个分号，使函数**立刻返回 `undefined`**，后面整段字符串拼接受成死代码。

本仓库真实事故：拆分 `panel.js` 时 `buildPanelHTML()` 的 `return` 被提成独立行，
导致 `el.innerHTML = buildPanelHTML(...)` 被写成字符串 `"undefined"`——按 `p` 打开面板只显示"未定义"。

### 反例（❌ 返回 undefined）

```js
function buildPanelHTML(_inFrame) {
  return
    '<div ...>' + ...
}
```

### 正例（✅ 返回完整 HTML 字符串）

用 `return (` 包裹，换行安全：

```js
function buildPanelHTML(_inFrame) {
  return (
    '<div ...>' + ...
  );
}
```

## 2. 切片后的硬性校验清单

任何"只移动、不改逻辑"的拆分，完成后必须逐条确认：

1. **零容忍 `return` 单独成行**：
   ```bash
   grep -rn '^\s*return\s*$' src/   # 结果必须为空
   ```
2. **重建产物**：`powershell -File ecosystem/build-force-play.ps1`。
3. **结构校验**（无 node 环境时）：产物须以 `// ==UserScript==` 开头、`})();` 结尾、大括号配平。
4. **关键函数不变**：拆分出的函数定义次数、调用次数与原文件一致（可用 grep 计数核对）。
5. **行数红线**：`powershell -File ecosystem/check-module-size.ps1` 通过。

## 3. 通用切片注意事项

- 同 IIFE 内函数提升，抽成顶层函数后调用点自动可用，行为与原内联代码一致；但 `return` 后换行、模板字符串未闭合等语法边界必须保留。
- 切片脚本若含中文注释，注意 PowerShell 编码：中文注释可能破坏字符串界定符，建议脚本注释与字符串全程 ASCII。
- 抽取视图层（HTML 模板字符串）时，模板内的插值变量（`STYLES.T.*` 等）仍在原作用域，无需改动。
