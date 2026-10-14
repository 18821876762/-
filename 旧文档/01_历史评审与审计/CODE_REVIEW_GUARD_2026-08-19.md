# 代码审查报告 · 新增模块（guard.js / quiz-selectors.js / keys.js）

- 日期：2026-08-19
- 范围：git 暂存区三个新增源码模块
  - `takeover/foundation/error-guard/guard.js`（分层错误卫士）
  - `sites/quiz-selectors.js`（quiz 选择器工厂）
  - `takeover/foundation/storage/keys.js`（localStorage 键名中央来源）
- 方法：逐文件精读 + 跨文件依赖核验（manifest 顺序、消费者、键名一致性、契约 `@requires/@provides`）

---

## 一、`guard.js`（分层错误卫士）

### 🔴 已修复 · Bug 1：`Guard` 永不暴露到外部表面（确定性 bug）
原代码：
```js
var Guard = { safeGet: getGet, bestEffort: bestEffort, safeDOM: safeDOM };
try { if (window.__CX_FORCE_PLAY && window.__CX_FORCE_PLAY.toolkit) window.__CX_FORCE_PLAY.toolkit.Guard = Guard; } catch (_) {}
```
- `guard.js` 在 `build-manifest.txt` 排 **第 1 位**；`toolkit` 对象在 `utils.js`（第 9 位，约 249 行）才创建。
- 因此执行到第 42 行时 `window.__CX_FORCE_PLAY.toolkit` 尚不存在 → 条件恒 `false` → 赋值被跳过。
- grep 确认：**全仓无任何消费者**引用 `toolkit.Guard`/`.Guard`（仅 guard.js 自身 + `dom.js` 中 `'ov.nearEnd.guard'` 字符串误命中）。当前属"设计意图失效、外部 addon 拿不到"，尚未造成线上故障，但必须修。
- 修复：挂顶层命名空间（不依赖 toolkit 创建时机），toolkit 已存在则同步一份：
```js
try {
  window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {};
  window.__CX_FORCE_PLAY.Guard = Guard;
  if (window.__CX_FORCE_PLAY.toolkit) window.__CX_FORCE_PLAY.toolkit.Guard = Guard;
} catch (_) {}
```

### 🟡 已修复 · 潜在 2：`bestEffort` 对 `swallow` 缺失无防护
原代码：
```js
function bestEffort(fn, tag) {
  try { fn(); } catch (e) { swallow(e, tag || 'guard.be'); }
}
```
- 仅 `fn()` 在 `try` 内；若 `swallow` 因契约断裂缺失，`swallow(...)` 抛 `ReferenceError` 发生在 `try` 之外 → `bestEffort` 自身抛错，违背"不中断主流程"初衷。
- 运行时当前安全：`swallow` 是 `utils.js:25` 的函数声明、同 IIFE 内提升，且 `bestEffort` 仅在事件/轮询运行时被调用。
- 修复（防御性收敛）：
```js
function bestEffort(fn, tag) {
  try { fn(); } catch (e) { if (typeof swallow === 'function') swallow(e, tag || 'guard.be'); }
}
```

### 🟢 未改 · 设计脆弱性 3：`safeGet` 只兜底 `undefined` 不兜底 `null`
```js
try { var v = fn(); return v !== undefined ? v : fallback; }
```
若 `fn()` 返回 `null` 则放行 `null`。当前调用方（如 `panel-controls.js` 的 `v !== '0'`、`popupBlock` 的 `v === '1'`）靠后续比较"碰巧"正确，语义脆弱。建议 `return v != null ? v : fallback;` 或文档注明只区分 `undefined`。**未改**（非本次请求范围，且与 `safeDOM` 已用 `v != null` 不一致，宜统一后处理）。

### 说明：关于 `@requires: swallow` 的构建顺序
`guard.js` 在 `utils.js` 之前，但 `swallow` 是函数声明、在拼接后的单 IIFE 内被提升，**运行时无问题**。仅需注意：`verify_cross_module.js` 若按"声明顺序"严格校验 `@requires` 必须先于 `@provides`，可能误报——属契约校验口径问题，非运行时 bug。

---

## 二、`quiz-selectors.js`（quiz 选择器工厂）

### 🟡 未改 · 潜在 1：`thirdQuestionSel` 缺省无防护
```js
function createQuizSelectors(thirdQuestionSel) {
  return { questionSels: ['.question-item', '.quiz-item', thirdQuestionSel, '[class*="question"]', '[class*="quiz"]'], ... };
}
```
当前 4 个调用方（renwei/unipus/ucampus/ilabx）均传合法串（如 `renwei.js:6` 传 `'.exam-item'`），现不出错。若未来某调用方漏传（`undefined`/`''`），`querySelectorAll(undefined)` 抛 `TypeError`，被外层 `safeGet` 兜住但**静默导致整题检测返回 0**。建议：
```js
var extra = thirdQuestionSel ? [thirdQuestionSel] : [];
return { questionSels: ['.question-item', '.quiz-item'].concat(extra, ['[class*="question"]', '[class*="quiz"]']), ... };
```

### 🟡 未改 · 潜在 2：通配选择器 `[class*="..."]` 过度匹配（真实站点主要风险）
```js
questionSels: [..., '[class*="question"]', '[class*="quiz"]'],
optionSels: ['.option-item', '.q-option', 'li[class*="option"]', '[class*="choice"]'],
```
通配 `[class*="quiz"]` / `[class*="choice"]` 极易同时命中题块容器与选项元素，造成选项重复计数——即此前超星校准修掉的 `OPTION_COUNT=8`（应为 4）那类 bug（`memory ID 14974749`）。选择器与注释均标 TODO、待真实站点校准。建议校准前收窄或排除嵌套，并在 `_sim` 加"选项数=可见 li 数"断言防回归。**未改**（需真实站点校准，非纯逻辑修复）。

### 说明
返回对象每次调用新建、字面量重复——非 bug，仅轻微内存开销，可忽略。

---

## 三、`keys.js`（localStorage 键名中央来源）

整体评价：集中化方向正确。`CX_KEYS` 被 `zhihuishu-fab`/`panel-controls`/`storage`/`toast`/`panel.js` 等广泛引用（grep 85+ 处），"中央唯一来源"目标确实落地。

### 🟢 未改 · 命名风格不一致（未来漂移隐患）
```js
QUIZ_AUTO_SUBMIT:    'cx_quiz_autosubmit',     // 与同文件 cx_quiz_auto_start 等下划线风格不一致
ZH_EXAM_AUTO_SUBMIT: 'cx_zh_exam_autosubmit',
```
当前非 bug：源码/测试全部使用 `cx_quiz_autosubmit` 字面量（如 `quiz.js:424`、`sim-quiz.js:117`），读写匹配。但风格不统一增加日后手改拼错风险。建议统一为 `cx_quiz_auto_submit`/`cx_zh_exam_auto_submit`（需同步改 85+ 处消费者）。**未改**（波及面广，需单独一轮）。

### 🟢 未改 · 语义混淆：`KVS_DB`/`FP_NS` 混入键名对象
```js
KVS_DB: 'cx_kvs',   // 注释自承：不是 localStorage 键
FP_NS:  'cx_fp_'    // 注释自承：是前缀，不是键
```
二者显式标注"非键/前缀"，却置于 `CX_KEYS`（"全局 localStorage 键名常量"）。若将来遍历 `CX_KEYS` 枚举键，会误把 `cx_kvs`/前缀 `cx_fp_` 当键。建议拆到独立 `CX_NS` 常量。**未改**（设计清理，非功能性）。

### ✅ 顺序处理正确（对比 guard.js）
```js
try { window.__CX_FORCE_PLAY = window.__CX_FORCE_PLAY || {}; window.__CX_FORCE_PLAY.KEYS = CX_KEYS; } catch (e) {}
```
挂 `window.__CX_FORCE_PLAY.KEYS`（顶层命名空间，不依赖 `toolkit`），即使 `guard.js` 之后才执行也安全——反衬出 `guard.js:42` 原用 `.toolkit` 是错误的。

---

## 优先级汇总

| 严重度 | 文件 | 问题 | 状态 |
|---|---|---|---|
| 🔴 确定 bug | `guard.js` | `Guard` 因 `toolkit` 未创建而永不暴露 | ✅ 已修复 |
| 🟡 潜在 | `guard.js` | `bestEffort` 对 `swallow` 缺失无兜底 | ✅ 已修复 |
| 🟢 设计 | `guard.js` | `safeGet` 只兜底 `undefined` 不兜底 `null` | 待定 |
| 🟡 潜在 | `quiz-selectors.js` | `thirdQuestionSel` 缺省产生非法选择器、静默失效 | 待定 |
| 🟡 潜在 | `quiz-selectors.js` | 通配 `[class*="quiz"]`/`[class*="choice"]` 未校准易重复计数 | 待定（需真实站点校准） |
| 🟢 风格 | `keys.js` | 键名 `autosubmit` 缺下划线，与同文件不一致 | 待定（波及 85+ 处） |
| 🟢 设计 | `keys.js` | 非键 `KVS_DB`/`FP_NS` 混入键名对象 | 待定 |

---

## 验证（已修复项）

- 构建门禁 `build-force-play.ps1` **EXIT=0**（node --check / 契约 / 元数据 / 跨模块 / SELFTEST / _sim）
- `run-sim.js` 全量 **EXIT=0**
- `tests/pure.test.js` **52/52**
- lint 零错误
- 产物已同步至 `chaoxing-force-play-latest.user.js`
