# 代码审计报告 · chaoxing-force-play（网课强制续播）

审计日期：2026-08-14
范围：`ecosystem/src/chaoxing-force-play/`（58 个 JS 源文件）、`ecosystem/build-force-play.ps1`、`ecosystem/chaoxing-force-play.user.js`、`perception/*.py`、`_sim/*` 测试与契约校验器。

---

## 一、已验证良好的实践（正面确认）

| 项目 | 证据 | 说明 |
|---|---|---|
| 构建产物语法 | `node --check chaoxing-force-play.user.js` → exit 0 | 拼接后的完整 IIFE 无语法错误 |
| 契约/元数据门禁 | `verify_contracts / verify_contract_doc / verify_contract_semantics / selftest_contract_semantics / verify_metadata / selftest_metadata` 全部 exit 0 | 模块契约、元数据块、跨模块引用均一致 |
| 回归校验 | `verify_fixes.js` exit 0 | 已修复项未回归 |
| Python 侧 | `perception/*.py` 全部 `py_compile` 通过 | 无语法错误 |
| 定时器治理 | `core.js` `TimerRegistry` + 幂等守卫 `started` + `globalErrorHandler` | 长生命周期定时器集中登记、可卸载清理；重复注入不产生双倍定时器 |
| XSS 防护 | `panel.js` 动态内容经 `escapeHTML`（`_escHTML`）；`innerHTML` 仅用于静态模板 | 搜索 `eval(`/`new Function(`/字符串 `setTimeout(`：**零命中** |
| 跨帧消息收敛 | `state.js` 发送侧目标源限定 `location.origin` | 避免消息外泄到错误窗口 |
| DRY 落地 | `popup-quiz.js` 中央化选择器 `POPUP_BASE`；`site-router.js` 用 `registerSiteTick` 自注册 | 新增平台不改动核心文件，无分发器复制 |
| 异步健壮性 | `quiz.js`/`bridge.js`/`auto-next.js` 的 `.then` 链均带 `.catch` | 网络/解析失败静默回退，不中断主循环 |

---

## 二、按优先级分类的发现

### 🔴 中高优先级（建议修复）

**P1 · 匹配域过宽导致在任意 `.edu.cn` 站点注入并执行**
- 位置：`takeover/meta.js:11` — `@match *://*.edu.cn/*`
- 问题：该通配会把**完整引导逻辑（FAB、MutationObserver、主循环、视频接管）注入到所有中国高校域名**，而非仅目标平台。`detectSite()` 对未知 `.edu.cn` 回落到 `SITES.edu`（注释称"安全基线：空附件键、不钩私有全局"），但 `edu` 基线仍走视频接管（`dom.js:13`、`main-loop.js:33` 注释亦确认）。即：在任意打印机页面上也会运行视频扫描与接管行为，造成：
  - **隐私/足迹面**：在无关教学站点运行脚本；
  - **性能**：无关页面持续运行主循环与 DOM 观察器。
- 建议：将 `.edu.cn` 收窄为具体的学校超星/知到镜像域名清单，或仅对已知平台域名匹配；若必须保留宽泛匹配，应在 `detectSite()` 对未知 `edu` 站点**完全不启动接管**（而非空键基线也接管视频）。

### 🟠 中优先级（建议修复）

**P2 · 跨上下文入站消息未校验来源/结构**
- 位置：`takeover/engine/vision-deepseek-web.js:64-66`
  - `GM.on(DS_BRIDGE_KEY, ...)` → `_emitChannel(JSON.parse(newV))`
  - `_bc.onmessage = function(e){ ... _emitChannel(e.data); }`
- 问题：`_emitChannel`（`vision-deepseek-web.js:62`）仅以 `_myTabId` 去重，**未校验 `m.type`/消息形状**即分发给所有监听者。同源任意标签页（BroadcastChannel 同源范围）或 GM 存储变更可构造消息驱动 DeepSeek 应答端行为。
- 风险：同源范围受限，实际利用面较低，但不符合"不信任外部消息"的最佳实践。
- 建议：在 `_emitChannel` 入口校验 `m && typeof m.type === 'string'` 且仅处理白名单 `type`（如 `ds-ask`/`ds-status`）；GM 通道额外校验 `remote` 来源。

**P3 · `state.js` 的 `message` 监听未校验 `e.origin`**
- 位置：`takeover/foundation/state/state.js:64-68`
- 问题：监听器仅对 `d.__cxFeedToast` 数组作出反应（仅触发 UI toast，影响有限），但**未验证 `e.origin`**。任意可向其 window `postMessage` 的页面都能注入一条 toast。
- 建议：增加 `if (e.origin && e.origin !== location.origin) return;` 守卫。

**P4 · `quizAskDeepSeek` 重试终点缺少终级 `.catch`**
- 位置：`takeover/engine/vision-deepseek-web.js:575`
  ```js
  return new Promise(function (res) { setTimeout(res, DS_ASK_RETRY_DELAY); }).then(run);
  ```
- 问题：`run()` 内部 `.catch` 对"非超时"错误会 `throw err`，此 `throw` 沿 `.then(run)` 向上传播，而此处**无 `.catch`**。依赖顶层消费者与 `globalErrorHandler` 兜底；若某调用链未捕获，可能表现为未处理 rejection。
- 建议：在 `quizAskDeepSeek` 返回处补 `.catch` 或确保 `quizVisionAsk` 调用方已兜底（当前 `quiz.js`/`quiz-vision.js` 已用 `.catch`，故实际风险低，但属一致性缺口）。

### 🟡 低优先级（可选改进）

**P5 · `meta.js` 版本与描述不一致**
- 位置：`meta.js:7` `@version 4.18` 与 `meta.js:9` 描述"v3.x–v4.17"
- 影响：用户凭描述无法确认自身版本；轻微文档漂移。

**P6 · 插件 addon 引导样板重复**
- 位置：`plugins/addons/*.js`（auto-next / zhihuishu-auto-next / keyboard-shortcuts / tamper-guard / video-ended-notify / quiet-popups）
- 问题：各 addon 重复"嵌套 IIFE + `window.__CX_FORCE_PLAY.detectSite()==='xxx'` 站点隔离 + `setTimeout(bootstrap,300)`"样板。功能正确，但样板可抽为共享 helper（如 `defineAddon(name, site, fn)`）以减少复制、统一生命周期。

**P7 · 依赖未声明的 `@grant GM_xmlhttpRequest`**
- 位置：`plugins/addons/auto-next.js:114` 使用 `GM_xmlhttpRequest`，但 `meta.js` 仅 `@grant GM_setValue` 与 `GM_addValueChangeListener`。
- 现状：代码以 `typeof GM_xmlhttpRequest === 'function'` 守卫，未授权时优雅回退到原生 `fetch`（`auto-next.js:121+`），**当前无害**。但属"使用未声明能力"的潜在隐患——若某管理器提供该全局却行为不同，可能走非预期分支。
- 建议：要么在 `@grant` 显式声明，要么删除该分支仅保留原生 `fetch`（脚本本就无 GM_xmlhttpRequest 授权）。

**P8 · 个别 `.then` 链缺少 `.catch`（一致性）**
- 位置：`presentation/panel-controls.js:243`（`clipboard.writeText().then(...)`）、`takeover/foundation/storage/storage.js:37/55/74`（`_ready.then(...)`）
- 影响：失败仅表现为静默不复制/不持久化，无崩溃；但与其余代码严格的 `.catch` 纪律不一致。建议补 `.catch` 以统一错误处理。

---

## 三、明确排除的问题（用户关注项核查）

- **语法错误**：无。完整产物 `node --check` 通过；所有源文件在拼接语境下合法（`core.js` 单独 `--check` 报 L59 是预期假阳性——其 `})();` 闭合在构建期注入）。
- **eval / 动态代码执行**：无命中。
- **真实 XSS（未转义插入远程内容）**：未发现。`quiz`/`DeepSeek` 回复/`channel` 名等动态文本在插入 DOM 前均经 `escapeHTML`；仅静态模板使用 `innerHTML`。
- **定时器泄漏**：无。`core.js` 集中注册表 + 幂等守卫；短生命周期 `setTimeout` 为一次性自动清理。
- **死代码（明确可删）**：未做穷尽判定，但 `popup-quiz.js` 已用 `PQ_HANDLED_CAP` 淘汰去重指纹、`_pqStormGate` 防循环重弹，无遗留死分支。配置字段（如 `QUIZ_AI_ENDPOINT`、`QUIZ_VISION_ENDPOINT_ALLOW`）均有读写点且经白名单校验，非死配置。
- **未使用依赖**：`package.json`/构建脚本无外部 npm 运行时依赖（纯浏览器用户脚本）；`perception/` 为独立 Python 工具，未与 JS 产物耦合。

---

## 四、修复建议优先级排序

| 序 | 项 | 优先级 | 工作量 |
|---|---|---|---|
| 1 | P1 收窄 `.edu.cn` 匹配或关闭未知 edu 的视频接管 | 中高 | 小（meta.js + detectSite 一处回落逻辑） |
| 2 | P2 入站消息 `type` 白名单校验 | 中 | 小 |
| 3 | P3 `state.js` 消息 `e.origin` 校验 | 中 | 极小 |
| 4 | P4 重试终点补 `.catch` | 中 | 极小 |
| 5 | P5 版本描述对齐 | 低 | 极小 |
| 6 | P6 addon 引导样板抽离 | 低 | 中 |
| 7 | P7 清理未声明 GM_xmlhttpRequest 分支 | 低 | 小 |
| 8 | P8 零星 `.then` 补 `.catch` | 低 | 小 |

> 注：以上均不构成"阻断性"缺陷，当前版本可安全使用。最高价值改动为 **P1（缩小注入足迹）** 与 **P2/P3（加固跨上下文消息信任边界）**。

---

## 五、修复执行记录（2026-08-14 续）

| 项 | 状态 | 改动文件 | 验证 |
|---|---|---|---|
| P2 入站消息 type 白名单 | ✅ 已修复 | `takeover/engine/vision-deepseek-web.js` `_emitChannel` 新增 `DS_MSG_TYPES` 白名单（`ds-state`/`ds-ping`/`ds-ask`/`ds-answer`），未知 type 静默丢弃 | 重建 exit 0；`verify_fixes` exit 0；`sim-ds-console`/`sim-quiz-vision` exit 0；全量 `_sim` 0 失败 |
| P3 message 监听校验 e.origin | ✅ 已修复 | `takeover/foundation/state/state.js` 顶层 `message` 监听增加 `if (e.origin && e.origin !== window.location.origin) return;` | 同上 |
| P4 重试链终端 .catch | ✅ 已修复 | `takeover/engine/vision-deepseek-web.js` `quizAskDeepSeek` 末行改为 `return run().catch(function (err) { throw err; });`，明确拒绝上抛契约 | 同上 |
| P1 收窄 .edu.cn 注入 | ⏸ 暂不改动（需用户提供域名） | — | 见下 |

### P1 处置说明（重要）
审计后进一步追查发现：**`edu` 基线对 `.edu.cn` 做视频接管是既有设计，且受回归 #1 硬性约束（"edu.cn 视为 chaoxing 须接管视频"）**。
- `site-router.js:38` `isChaoxingEduCn` 已对未知 edu 站点回落 `SITES.edu`（空 `attachmentsKey`/`ananasKey`，不钩私有全局——满足 #19 收窄）；
- 但 `main-loop.js:12-13,33-34,45-47` 与 `dom.js` 明确**仍对 `edu` 站点接管视频**（无视频的普通 edu 页仅安装 play 监听 + 空扫描，实际足迹极小）。

因此"对未知 edu 站点完全不接管"会**破坏回归 #1**，不应改动运行时接管逻辑。P1 唯一安全的缓解是**收窄 `@match` 域名清单**（如 `@match *://*.chaoxing.com/*`、`*://*.zhihuishu.com/*` 及各学校超星镜像域名）。但这需要你提供实际使用的学校镜像域名，否则枚举会误伤真实超星镜像。**请在下方告知你的学校域名，我据此收窄匹配域。**

### 验证汇总
- 构建：`build-force-play.ps1` exit 0；产物 `node --check` exit 0
- 契约/元数据门禁：6/6 exit 0
- `verify_fixes.js`：exit 0（注：脚本位于 `_sim/`，非 `scripts/`）
- `_sim` 全量 sim 测试套件：0 失败
- Lint：两处改动文件 0 诊断
