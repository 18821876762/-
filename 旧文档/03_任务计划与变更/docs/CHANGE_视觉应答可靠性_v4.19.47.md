# 修改文档：视觉应答可靠性修复（v4.19.47）

> 模块：`chaoxing-force-play`（网课强制续播 用户脚本）
> 关联版本：`4.19.47`（源码当前版本；本轮严格审查补充的两处修复仍在 4.19.47 内，见 §5 后续注意事项）
> 修改日期：2026-08-27
> 相关人员：用户（需求提出 / 真机诊断复现「重复询问 + 答案不可靠」）/ AI 助手 CodeBuddy（严格逻辑审查 + 缺陷修复实现）

---

## 1. 修改概述

本次修改针对 **DeepSeek 网页版（deepseek-web）视觉作答**链路的两类可靠性问题：

1. **答案被「图片分析状态」误判为终态**：DeepSeek 在接收并分析题目截图期间，回复区会显示「正在分析图片 / 分析图片 / 分析中」等状态文本。旧逻辑未将其识别为「生成中」，导致 `_dsParseAnswer` 把该状态文本当作最终答案 → 错答 / 提前定答案。这是用户报告「大幅降低答案可靠性、重复询问」的直接根因。
2. **流式作答中间态被提前定答案（严格审查补充）**：v4.19.20 引入的「流式稳定性守卫」只覆盖 `≤countBefore` 分支，发题后常见的 `>countBefore` 分支直接返回末节点文本、无守卫，DS 流式作答的中间态（如先到 `A` 后到 `AB`）会被立即当成终态 → 错答（多选只点 A）。
3. **晚到答案仍被重发（严格审查补充）**：课程页 `_visClear` 仅 `delete` 定时器引用而不 `clearTimeout`，DS 在 90–180s 晚回传时，预算内后置的「二级余量定时器」照常触发，误删 `_quizHandled[fp]` 占坑 → 已作答的题被重新发起（重复询问）。

配套同步修正了回归测试 `sim-ds-stream.js` 的场景 3，使其与修正后的「两轮一致才终态」语义对齐。

修复后：视觉答案须连续两轮文本一致才定稿，图片分析等状态文本全程不终态；晚到答案被正确采纳且不再解锁重发。

---

## 2. 详细变更列表

### 2.1 `ecosystem/src/chaoxing-force-play/takeover/engine/vision-deepseek-web.js`

**函数：`_dsLatestReply(countBefore)`（轮询最新回复文本，约 597–642 行）**

| 项 | 内容 |
|---|---|
| 变更点 A（v4.19.47 根因修复） | 生成中判定正则新增图片分析态关键词：`正在分析图片｜分析图片｜分析中`。涉及 4 处：line 613（`≤countBefore` 分支预检）、line 617（同分支稳定前终态过滤）、line 629（`>countBefore` 分支预检）、line 634（同分支稳定前终态过滤）。 |
| 变更原因 A | DS 图片分析期间回复区渲染「正在分析图片」等状态文本；旧正则仅含「正在生成/思考中/生成中/Thinking/Generating…」，漏掉图片分析态 → 该文本被 `_dsParseAnswer` 当终态答案（无字母 → 解析失败 → 严格模式整题失败 / 非严格模式随机兜底），即用户所见「重复询问 + 答案不可靠」。 |
| 影响范围 A | deepseek-web 模式所有题目截图作答的回复轮询；纯文本模式与 endpoint 模式不经过此函数，不受影响。 |
| 变更点 B（本轮严格审查补充） | `>countBefore` 分支（原 line 625–634 直接 `return t \|\| ''`）改为与 `≤countBefore` 分支对齐的流式稳定性守卫：空 / 生成中 / 图片分析态 → 复位 `_dsStreamStable` 返回 `__GENERATING__`；非生成态须 `_dsStreamStable === t`（连续两轮一致）才返回 `t`，否则记录 `_dsStreamStable = t` 返回 `__GENERATING__`（现 625–640 行）。 |
| 变更原因 B | v4.19.20 的稳定性守卫仅覆盖「节点数未增（≤countBefore）」分支；发题后消息数 +1，`>countBefore` 分支无守卫，DS 流式作答中间态（先 `A` 后 `AB`、或图片分析态残余）会被立即当终态 → 多选只点 A 等错答。 |
| 影响范围 B | 同上；每题答案现需约 2 轮 poll（额外 ~1.6s 延迟，属预期代价，换来终态正确）。 |

**函数：`_dsParseAnswer`（解析答案，约 719–750 行）**
- 本次未改动；其健壮性（`toUpperCase` 输出、单字母边界、判断题兜底）已在前序版本验证，本次修复不依赖其改动。仅 `_dsLatestReply` 在调用前已确保传入的是稳定终态文本。

### 2.2 `ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js`

**函数：`_quizVisionAnswer` 内 `_visClear`（约 1069 行）**

| 项 | 内容 |
|---|---|
| 变更点 | `_visClear` 由 `if (_visTimer) { clearTimeout(_visTimer); _visTimer = null; } delete _quizVisTimers[fp];` 改为：在 `delete _quizVisTimers[fp]` 之前先 `try { clearTimeout(_quizVisTimers[fp]); } catch (e) {}`。 |
| 变更原因 | 课程页视觉作答超时（`_visTo`，deepseek-web 默认 90000ms）未回传时，会在 1199 行再置一个「二级余量定时器」（`_quizVisTimers[fp] = setTimeout(..., 90000)`），到期后删 `_quizHandled[fp]` 解锁重发。旧 `_visClear` 只对本地 `_visTimer` 做了 `clearTimeout`，对 `_quizVisTimers[fp]` 仅 `delete` 引用而不取消句柄 → 若 DS 在 90–180s 间**晚回传**（`_onSettle` 设计上仍采纳），`_visClear` 删除的是引用、定时器照常触发 → 误删 `_quizHandled[fp]` → 已作答的题被重新发起（重复询问）。 |
| 影响范围 | 仅 deepseek-web 模式（`_dsMode` 为 true）的「预算内未回传」路径；endpoint / 文本模式无二级余量定时器，不受影响。修复后晚到答案 settle 会正确取消二级定时器，不再误重发。 |

### 2.3 `ecosystem/_sim/sim-ds-stream.js`

**场景 3（约 73–86 行）「节点数正常增加（常规新节点）」**

| 项 | 内容 |
|---|---|
| 变更点 | 由单次 `ns._dsLatestReply(2)` 直接断言返回 `'答案：C'`，改为两次调用：首轮断言 `'__GENERATING__'`（进入稳定性等待），次轮（文本两轮一致）断言返回 `'答案：C'`。 |
| 变更原因 | 同步 2.1-B 的 `>countBefore` 分支稳定性守卫行为，使回归测试与实现语义一致（与场景 1 / 场景 4 的「两轮一致」断言对齐）。 |
| 影响范围 | 仅测试断言；无运行时影响。 |

---

## 3. 测试情况说明

### 3.1 构建门禁（全部通过）
通过 `powershell -ExecutionPolicy Bypass -File build-force-play.ps1` 执行，结果：

| 门禁 | 结果 |
|---|---|
| `node --check` 语法检查 | PASSED |
| `eslint` | PASSED |
| contract verify（契约校验） | PASSED |
| contract doc（契约文档） | PASSED |
| contract semantics（契约语义） | PASSED |
| metadata（元数据） | PASSED |
| cross-module contract（跨模块契约） | PASSED |
| contract semantics SELFTEST | PASSED |
| metadata SELFTEST | PASSED |
| cross-module contract SELFTEST | PASSED |
| `_sim`（仿真回归） | PASSED（via run-sim.js，72/72） |

产物：`ecosystem/chaoxing-force-play.user.js` 与 `chaoxing-force-play-latest.user.js` 同步重建。

### 3.2 仿真回归重点
- `sim-ds-stream.js`：4 场景全过（含修正后的场景 3 两轮一致语义）。
- 全量 `_sim`：72/72 PASS（无新增失败，无回归）。

### 3.3 验证约束
- 本次为逻辑层修复，AI 环境无浏览器，未做真机渲染验证；真页行为由用户侧重装脚本复测（见 §5）。
- 仿真测试在 jsdom 子集下运行，覆盖轮询/稳定性/解析纯逻辑，不覆盖真实 DeepSeek DOM 渲染时序。

---

## 4. 后续注意事项

1. **版本号建议提升**：本轮严格审查补充的两处修复（2.1-B 流式稳定性守卫、2.2 `_visClear` 定时器取消）目前仍落在 `4.19.47` 源码版本内（与 2.1-A「正在分析图片」根因修复同版本）。为便于独立追溯与回滚，建议将版本号提升至 **4.19.48**（三处一致：`takeover/meta.js` 行 7 `@version`、`presentation/panel.js` 行 9 `SCRIPT_VERSION`、`package.json` 行 3 `version`），并重新构建。

2. **低风险点（审查中确认，本次未改动，避免回归）**：
   - `_dsLatestReplyTextOnly(0)` 的 `0` 实参被函数忽略（函数无参），功能正确，属拷贝残留。
   - `_dsParseAnswer` 在 `_dsPollReply`（约 551 行）未包 `safeGet`；其为纯字符串处理不抛错，风险极低。
   - `_dsClickSend`（约 497–498 行）同时 `dispatchEvent(click)` + `sb.click()` 冗余；DeepSeek 空输入兜底保证不会双发。
   - 看门狗（90s）与 poll（deadline ≤58.5s）在 `QUIZ_VISION_TIMEOUT≈90s` 极窄边界可能双回同一 reqId；课程页按 `done` 去重、队列仅多一次无害入队。

3. **真机复测指引**：重装 `chaoxing-force-play-latest.user.js`，打开超星作业/考试页，观察 DS 控制台「最近请求 / 首错」与每题信号灯：
   - 同一题不再被「正在分析图片」误判终态；
   - DS 晚回传（>90s）的题不再被重发；
   - 视觉答案须两轮稳定才定稿，错答率下降。

4. **仍偶发 `vision-timeout` 的归因**：多为 DS 网页版 responder 注入时机 / 图片粘贴在真实页偶发慢，非本次逻辑问题；可贴诊断「最近请求=」与「首错=」复核。

5. **潜在误判边界（已知、未改）**：发题后极短窗口（消息数 +1 但助手节点尚未建立、末节点仍是用户提问）理论上会读到自身提问文本。但 `_dsPollReply` 首次 poll 在发后 ~2.4s，助手节点此时必已建立，实际不可达；若按 `rsel` 强制区分助手/用户节点，选择器失配时会反致永不收敛，故未改。

---

## 5. 涉及文件清单（变更汇总）

| 文件 | 性质 | 关键改动 |
|---|---|---|
| `ecosystem/src/chaoxing-force-play/takeover/engine/vision-deepseek-web.js` | 源码（核心） | `_dsLatestReply`：图片分析态纳入生成中判定（2.1-A）+ `>countBefore` 分支流式稳定性守卫（2.1-B） |
| `ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js` | 源码（核心） | `_visClear` 取消二级余量定时器句柄（2.2） |
| `ecosystem/_sim/sim-ds-stream.js` | 测试（回归） | 场景 3 改为两轮一致语义（2.3） |

> 文档同步：本文件与 `docs/CHANGELOG.md` 评级速览 `4.19.47` 条目互为补充（CHANGELOG 为摘要，本文为完整变更记录）。
