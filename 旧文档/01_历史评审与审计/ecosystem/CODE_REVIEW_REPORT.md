# 全面静态与动态审查报告 — chaoxing-force-play v4.19.47

> 审查日期：2026-08-23
> 审查对象：`ecosystem/src/chaoxing-force-play/`（59 个源文件，单文件零运行时依赖用户脚本）
> 审查方式：自动化门禁套件（构建脚本全量门禁）+ 专项静态扫描 + 人工深度逐文件/逐函数复核
> 环境说明：本机 `npm` 与 `child_process` 派生子进程时 `node`/`powershell` 被 PATH 错误解析到损坏的 `.7z` 路径，
> 故构建与门禁均改用**绝对 node/powershell 路径**直跑，绕开坏 PATH。所有门禁最终均成功执行。

---

## 0. 审查范围与代码规模指标

| 指标 | 数值 |
|------|------|
| 源文件数 | 59（takeover 25 / sites 13 / plugins 8 / presentation 13） |
| 总行数 (LOC) | 13,115 |
| 函数数 | 554 |
| 最大文件 | `takeover/engine/quiz.js`（1689 LOC / 66 fn） |
| 次大文件 | `vision-deepseek-web.js`（949）、`diagnostics.js`（768）、`dom.js`（643）、`panel-core.js`（596） |
| 构建产物体积 | 域分组：takeover 475KB / presentation 317KB / plugins 65KB / sites 61KB |
| 运行时依赖 | **0**（单文件用户脚本） |
| 开发依赖 | esbuild ^0.25.0、eslint ^8.57.0、jsdom ^29.1.1（仅构建/测试期） |

---

## 1. 语法检查（Syntax）

- **方法**：单进程 `vm.Script` 编译校验全部 59 个源文件（规避重复派生 node 的 ENOENT 环境坑）。
- **结果**：58/59 通过。唯一“报错”的 `takeover/bootstrap/core.js` 是构建脚本在拼接产物末尾统一补 `})();` 故意不闭合的 IIFE 包裹片段（文件头注释已声明），**非缺陷**。
- **门禁复核**：完整构建门禁的 `node --check <产物>` → **PASSED**。
- **结论**：**0 真实语法错误**。

## 2. 代码规范 / Lint（ESLint 8.57）

- **配置**：`eslint:recommended` + 错误级 `no-undef`/`no-dupe-keys`/`no-dupe-args`/`no-irregular-whitespace` + 警告级 `no-redeclare`/`no-cond-assign`/`no-constant-condition`。
- **整包 ESLint（针对构建产物 `chaoxing-force-play.user.js`）→ PASSED**：0 error / 0 warning。
- **含义**：无未定义变量引用、无重复对象键、无重复函数参数、无不规则空白字符；无重复声明、无危险的条件赋值/常量条件。

## 3. 类型检查（Type Checking）

- 纯 JavaScript 用户脚本，无 TypeScript，无适用类型检查器。
- 跨模块契约/运行时接口由 `verify_contract_semantics.js` 以**变异自检**（注入变异断言规则是否仍能捕获）保证非空转 → **PASSED + SELFTEST PASSED**。

## 4. 安全漏洞扫描（Security）

- **工具**：`scripts/check-security.js`（EXIT=0）+ 人工逐条复核。
- **结果明细**：
  - `eval` / `new Function`：**0 处**。
  - `document.write`：1 处（`presentation/panel-controls.js:329`），内容为 `escapeHTML(text)` 转义后写入，**安全**。
  - `innerHTML` 赋值：38 处。全部动态数据均经 `escapeHTML()` 转义或来自 `cxIcon()`/`STYLES.*` 常量（如 `dashboard.js`、`panel-ds-console.js`、`panel.js`、`registry.js`、`commands.js`、`zhihuishu-fab.js`），**无 XSS 注入点**。
  - `outerHTML` / `insertAdjacentHTML`：**0 处**。`setAttribute` 脚本/src 注入：**0 处**。
  - `postMessage`：接收端均校验 `event.origin` / `event.source` / `type`（人工复核）。1 处 `quiz.js:578` 手动提交命令用通配 `targetOrigin='*'`，接收端已双重校验，**可利用性低**（建议收窄，见 §11）。
  - `GM_setValue/GM_getValue` 敏感键明文写入：**0 处**；`localStorage` 密码类：**0 处**。
  - 明文 `http` 接口：仅 `127.0.0.1:<port>` 本地桥（`bridge.js:35/41/81/90`、`auto-next.js:151`），用户脚本↔本地爬虫的本地通信，**无凭证泄漏**，响应经结构+同域校验。
  - 明文密钥/口令字面量：**0 处**。
- **结论**：**无高危/中危可利用漏洞**；1 处中危建议（§11 MED-1）。

## 5. 性能分析（Performance）

- **方法**：人工静态审查热路径 + 代码规模指标。
- **中危**：
  - `quiz.js:257` `_quizAiDiag` 逐题 AI 诊断对象无计数上限（仅整体 evict），超长会话/长题库单调增长；且 `diagnostics.js` 跨帧遍历它。建议加 `QUIZ_AI_DIAG_CAP` 淘汰（仿 `_quizPruneHandled`）。
  - `quiz.js:1228` 每 tick 全文档 `querySelectorAll(questionSels)`；已有 2s 无题节流+指纹缓存削减重算，但遍历本身未缓存。
  - `quiz.js:735` MutationObserver 防抖 `setTimeout` 未登记 `TimerRegistry`（有 `disconnect` 兜底，卸载竞态下可能残留一次）。
- **低危**：跨帧灯快照 `_quizRemoteState` 无显式 CAP；`TimerRegistry` 未就绪时的回退裸 `setTimeout`。
- **未发现**：<1s 热路径轮询、未防抖的大范围 MutationObserver、逐 video 重复 `addEventListener`（依赖同函数引用去重）。

## 6. 依赖审计（Dependency Audit）

- **运行时依赖**：0 → 供应链运行时风险 = 0。
- **开发依赖**：esbuild/eslint/jsdom 均为成熟稳定库，仅构建/测试期使用，**不进入产物**。
- `npm audit` 在本环境无法运行（`npm` 脚本壳 PATH 损坏），但 devDeps 仅构建/测试期、不进发布产物，实质性风险极低。

## 7. 单元测试 / 集成测试 / 覆盖率（Testing）

- **单元测试**（`tests/`）：
  - `tests/pure.test.js` → **52 断言全部 PASS**（escapeHTML / fmtTime / signatureOf / shortSrc / urlParam / collectAttachmentIds / clampCfg）。
  - `tests/quiz-merge.test.js` → **25 passed, 0 failed**（mergeAnswers / decisionFor 阈值决策）。
- **集成仿真**（`_sim/`，`scripts/run-sim.js`）：75 个用例，jsdom 子集 **72/72 passed, 0 failed, 3 skipped**（3 个 Playwright 真机浏览器仿真本地无浏览器跳过）。
  - 覆盖重点：quiz 灯色/答案解析/缓存驱逐/选择器守卫/严格模式/已提交守卫/增量/手动/vision/popup、popup 屏蔽、uninstall 实例隔离、sandbox 泄漏、secret 解码、submit 锁、vision 隐私、targeting、面板归属、ninja、polite、zhihuishu/fab/exam 等。
- **覆盖率分析**：`run-sim.js --coverage` 已尝试，但本环境未产出覆盖率产物（sim 以打包产物方式加载，脱离 `node:test` 插桩范围；Playwright 子集本地跳过）。项目未配置覆盖率门禁。**覆盖率百分比在本环境不可用**，集成测试 72 用例全过为可用动态证据。

## 8. 逻辑漏洞（深度人工审查，逐文件/逐函数）

- **确证 1 处（HIGH）**：`quiz.js:91` 红灯未让位于紫（宽限）——DS 通道建立 10s 宽限内，曾失败题显示红而非紫，与 `:87-88` 注释明示的 v4.19.35 修复意图矛盾。最小修复：红灯条件加 `&& !_inGrace`（与行 92 对齐）。
- **其余审计标记经逐行复核均为误报/设计关注点（非确证 bug）**：
  - playback `NATIVE_PAUSE` 优先于 `INTRUSION_MODE`（缺 `POLITE_MODE` 反向开关，设计取舍）；
  - UI 仪表盘「插播题锁定」渲染（显示态与 `__cxAN_hold` 完全同步，无反向 bug）；
  - addons 跨帧 guard（`postMessage` 单点 + `verify_cross_module` 门禁已锁，无重复订阅）；
  - `quiz.js:1389` 视觉占坑（因 `_quizSyncLights` 黄态优先于绿态，正确显示黄，非闪绿）；
  - quiet-popups 计数（`quiet-popups.js` 无 count/dismiss 逻辑，前提不成立）；
  - bridge 端口（默认 7531 可配+`BRIDGE_PROBE_PORTS` 探测，非硬编码）；
  - lifecycle 卸载还原（十二项清单 + 复用 restorePrototype 同源 + 幂等，稳健）。

## 9. 代码风格 / 命名 / 重复 / 死代码

- **重复扫描**（`check-dup.js`，EXIT=0）：1 处跨文件重复骨架 `window.__cxAddonQueue` 注册（auto-next / video-ended-notify / zhihuishu-auto-next，3 文件共享），属预期插件骨架，**低危**。
- **人工**：`quiz.js` 6 个近同构 `_quizPrune*` 可抽 `pruneMap`；localStorage 读取模板复制 5 次；`commands.js:24/29` 裸字符串 `'cx_cmd_recent'` 未进 `CX_KEYS`（建议加 `CMD_RECENT` 常量）。
- **命名**：全局 snake_case 一致（私有前缀 `_`）；`utils.js:48` `videoState` 用 camelCase 的小不一致；foundation 层整体 camelCase（层内统一、跨层不一致，可接受）。
- **风格**：`targeting.js`/`quiz-merge.js`/`url.js` 用 `const/let`（ES6）与全库主流 `var` 混用，无害。
- **死代码**：人工核验所有报告符号（buildPanelHTML、各 `cxIcon`、`safeGet` 等）均被调用，无死函数/未使用导出；自动化扫描因规模仅部分覆盖，但无确证死代码。
- **可维护性（低危）**：超长函数 `diagnostics.js` `buildDiagnostics`(~552 行)、`quiz.js` `quizTick`(~340 行)、`_quizVisionAnswer`(~165 行)；`_quizSyncLights` 7 态 `else if` 链圈复杂度偏高（建议拆子函数）。

---

## 10. 综合指标汇总

| 维度 | 结果 |
|------|------|
| 语法检查 | 0 错误（59 文件，1 为构建包裹片段） |
| ESLint | 0 error / 0 warning |
| 契约校验（verify_contracts/doc/semantics） | PASS（含语义变异自检 PASS） |
| 元数据校验（verify_metadata） | PASS（含自检 PASS） |
| 跨模块契约（verify_cross_module） | PASS（含自检 PASS） |
| 构建门禁 `_sim` 集成仿真 | 72/72 过，3 跳过 |
| 单元测试 | 77 断言全部 PASS |
| 安全扫描（check-security） | 0 可利用漏洞，1 中危建议 |
| 重复扫描（check-dup） | 1 低危骨架重复 |
| 运行时依赖 | 0（供应链运行时风险=0） |
| 测试覆盖率 | 本环境不可用（sim 脱离插桩范围，无覆盖率门禁） |

**构建门禁总结果：`BUILD_EXIT=0`（node --check / eslint / 契约 / 元数据 / 跨模块 / _sim 全部 PASSED）。**

---

## 11. 问题清单（按严重度，全部来自本报告核实）

### 必须修（逻辑正确性）
- **[HIGH] `quiz.js:91`** 红灯未让位于紫（宽限窗口）。修复：`if (_quizAIFailed[fp] && Date.now() < _quizAIFailed[fp] && !_quizHandled[fp] && !_inGrace) st = 'fail';`

### 建议修（安全 / 性能 / 质量）
- **[MED-1] `quiz.js:578`** 手动提交 `postMessage(..., '*')` 通配目标源 → 收窄为 `window.top.origin`（接收端已双重校验，可利用性低）。
- **[MED-2] `bridge.js:38-39`** `localStorage.cx_bridge_base` 可被同源页面改写重定向 fetch → 仅允许 `http(s)://127.0.0.1`。
- **[MED-3] `quiz.js:257`** `_quizAiDiag` 无上限 → 加 CAP 淘汰。
- **[MED-4] `quiz.js:1228`** 每 tick 全文档 `querySelectorAll` → 缓存结果。
- **[MED-5] `quiz.js:735`** MO 防抖 `setTimeout` 未登记 `TimerRegistry` → 登记。
- **[LOW-1] `quiz.js`** 6 个近同构 `_quizPrune*` → 抽 `pruneMap(map, cap, ttl)`。
- **[LOW-2] `commands.js`** 裸 `'cx_cmd_recent'` → 加 `CX_KEYS.CMD_RECENT` 常量。
- **[LOW-3] `storage.js`/`utils.js`** localStorage 读取模板复制 5 次 → 抽工具函数。

### 设计关注点（需真页验证，非确证 bug，来自前期逻辑审计）
- 作业页 `silentDismiss` 计数语义、popup 多次 dismiss 仍计弹窗、记忆命中残留、爬虫配置耦合等约 18 项 —— 均属「需真实页面验证的设计关注点」，非已确认缺陷。

---

## 12. 结论

工程质量**高**：完整自动化门禁套件（语法 / ESLint / 契约 / 元数据 / 跨模块 / 集成仿真）全绿，零运行时依赖，安全基线强（`escapeHTML` / `bestEffort` / 消息白名单 / 幂等守卫 / 十二项卸载还原 / `TimerRegistry` 集中定时器治理），测试覆盖核心逻辑（单元 77 断言 + 集成 72 用例）。

**唯一确证缺陷**为 `quiz.js:91` 逻辑 bug（红灯未让位于宽限紫）；另有 5 项中危（安全 2 + 性能 3）与 3 项低危（重复/常量/模板）可渐进改进。**整体可维护性与正确性达到发布级**，无阻断性运行时错误或安全漏洞。

> 注：本环境 `npm` 脚本壳 PATH 损坏导致 `npm run *` 系列命令不可用；所有门禁均通过绝对 node/powershell 路径直跑复现，结果有效。

---

## 13. 已应用修复（2026-08-23）

重跑门禁：`BUILD_EXIT=0`（node --check / eslint / 契约 / 元数据 / 跨模块 / `_sim` 全部 PASSED）；单元测试 77 断言全过。**无回归**。

| # | 文件:行 | 严重度 | 修复内容 |
|---|---------|--------|----------|
| 1 | `quiz.js:91` | HIGH | 红灯条件加 `&& !_inGrace`，宽限窗口内让位于紫（对齐行 92 的 v4.19.35 意图） |
| 2 | `quiz.js:578` | MED | 手动提交 `postMessage` 目标源 `'*'` → `w.origin`，收窄发送面（接收端仍双重校验 origin/source） |
| 3 | `bridge.js:38-39` | MED | `localStorage.cx_bridge_base` 仅信任 `127.0.0.1/localhost`，防止同源页面改写后把桥请求重定向到外部主机 |
| 4 | `quiz.js` `_quizRecordDiag` | MED | 逐题 AI 诊断明细加计数上限淘汰（`QUIZ_AI_DIAG_CAP` 默认 200），防止超长会话/长题库下无界增长 |
| 5 | `quiz.js:735` + `:769` | MED | MutationObserver 防抖 `setTimeout` 登记 `TimerRegistry`(owner `'quiz'`)，卸载按注册表清理，消除极端竞态残留 |

**刻意未应用（含理由）**：

- **§11 MED-4（每 tick `querySelectorAll` 缓存）**：架构刻意每 tick 全量 `_pqQueryAll` 以保证不漏题（见 `quiz.js:34` 注释「检测仍由每 tick 全量 `_pqQueryAll` 负责（不丢题）」），仅缓存逐题 `textContent` 读取成本。跨 tick 缓存结果在 DOM 增量更新时存在漏题风险，故不缓存；性能已由「无题稳态 5s 节流 + 指纹缓存削减重算」缓解。

**未在本次范围（LOW 重构项，§11 LOW-1/2/3）**：

- 抽 `pruneMap(map,cap,ttl)` 合并 6 个近同构 `_quizPrune*`；
- `commands.js` 裸 `'cx_cmd_recent'` → 加 `CX_KEYS.CMD_RECENT` 常量；
- `storage.js`/`utils.js` localStorage 读取模板抽工具函数。

上述三项为重构类改动，存在回归风险，建议单独评审后渐进实施，不在本轮缺陷修复内。
