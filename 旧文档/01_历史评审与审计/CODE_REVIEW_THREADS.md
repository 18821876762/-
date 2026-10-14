# 线程/调度单元全面审计报告 · 网课强制续播（chaoxing-force-play）

- 审计日期：2026-08-18
- 审计口径：JS 单线程下的全部「调度/异步执行单元」——定时器、requestAnimationFrame、MutationObserver、事件监听器、Promise 链、跨上下文通道（GM 存储/BroadcastChannel/postMessage）、iframe 副本。逐单元核对：创建点 / 周期 / 防重复守卫 / 清理点 / 卸载覆盖 / 泄漏风险。
- 方法：全量源码扫描（309 处调度相关代码）+ 逐类核对 + 实证探针（注入→运行→卸载→零残留断言）。

---

## 一、总览

| 类别 | 数量 | 周期类 | 一次性 | 守卫 | 卸载清理 | 结论 |
|---|---|---|---|---|---|---|
| setInterval | 6 | 5（均经 TimerRegistry）+ 1 自终结 | — | ✅ 全部 | ✅ 全覆盖 | 无泄漏 |
| setTimeout | ~30 | 0 | ~30 | ✅ 全部带 done/句柄/替换 | ✅ 关键路径全覆盖 | 本轮补 2 处句柄 |
| requestAnimationFrame | 3 | 0 | 3 | ✅ 1 处 cancel 配对 | ✅ 一次性自终 | 无泄漏 |
| MutationObserver | 2 | 整页/题目 | — | ✅ 先 disconnect 再重建 | ✅ 双 disconnect | 无泄漏 |
| 事件监听器 | ~15 文档级 + 9/视频 | — | — | ✅ 具名/登记 | ✅ cleanup 清单 12 项 | 无泄漏 |
| 跨上下文通道 | 3 | GM 5s / BC / postMessage | — | ✅ 门控+白名单 | ✅ 本轮补 BC close | 无泄漏 |
| Promise 异步链 | ~8 | — | — | ✅ done/超时/卸载守卫 | ✅ S-1 修复 + 本轮补 | 无泄漏 |
| iframe 副本 | 每同源帧 1 份 | 轻量初始化 | — | ✅ 顶层帧编排 | ✅ 每帧独立清理 | 设计内 |

**核心结论：全部调度单元均有创建守卫 + 卸载清理路径；实证「注入→运行→卸载」后活跃定时器 3→0 零残留。本轮补修 3 处句柄/资源管理缺口（均非泄漏级，属收尾一致性）。**

---

## 二、周期调度（setInterval）—— 5 个长生命周期 + 1 个自终结

| # | 创建点 | 周期 | 守卫（防重复） | 清理 | 备注 |
|---|---|---|---|---|---|
| 1 | `main-loop.js:126` 主循环 | 2s（后台×4 封顶 30s） | `restartLoopTimer` clear-then-set + TimerRegistry | `lifecycle.js:67` clearAll | 唯一重启入口，面板改间隔也经此 |
| 2 | `vision-deepseek-web.js:178` DS 课程心跳 | 4s | `_dsNeedChannel` 门控 + 跨帧锁（S-2） | `quizVisionDeepSeekStop` clearAll('deepseek') | 仅顶层/DS 帧 |
| 3 | `vision-deepseek-web.js:190` DS 广播 | 5s | 同 2 | 同 2 | 仅 DS 页 |
| 4 | `tamper-guard.js:124` 篡改检测 | 2s | `_tgTimer` clear-then-set + `__cxTgStarted` | TimerRegistry('tamper-guard') + addon cleanup | 每帧一份（设计内） |
| 5 | `panel-ds-console.js:39` DS 控制台 ticker | 2s | `_dsTickerId` 单例 | TimerRegistry('ds-console') + pagehide | 重建时现查节点（G3 已修） |
| 6 | `keyboard-shortcuts.js:94` 引导轮询 | 800ms | 命中即 clearInterval + **15s 兜底** | 自终结 | 一次性引导 |

## 三、一次性调度（setTimeout）—— ~30 个，全部自终结或带句柄

| 分组 | 位置 | 用途 | 句柄/守卫 | 清理 |
|---|---|---|---|---|
| bootstrap 延迟 | auto-next:451 / zh-autonext:58 / zh-exam:442 | 300ms 启动 | `__cxXxxStarted` 守卫内 | 守卫即清理 |
| fetch 超时 | auto-next:112/122/339、bridge:84/183/260、utils:125 | 5-15s abort/timeout | `done` 标志 + clearTimeout | 成功路径清除 |
| 交互延迟调度 | main-loop:69/106（扫描队尾化）、panel:112（defrost）、panel-core:195（菜单） | setTimeout(0) | 一次性/待办去重 | 自终 |
| UI 临时 | toast:44/48、tamper-guard:61、keyboard:82、panel-core:64 | 显示/隐藏 | clearTimeout 替换/自删 | 自终 |
| 答题调度 | quiz:353（MO 防抖）、zh-exam:294（sync 节流） | 0.8-5s | 单槽句柄 | `quizDisconnect`/`_syncTimer` 清 |
| **视觉超时（本轮补）** | quiz.js:571 | 45s race 超时 | **本轮：`_quizVisTimers` 登记 + settle 清除** | **本轮：`quizDisconnect` 统一清** |
| **Ninja 重算（本轮补）** | panel-core:153 reclampSoon | 320ms | **本轮：`_reclampTimer` clear-then-set** | 自终 |
| DS 发送 | vision-deepseek:320/322 | 350ms/8s | done/clearTimeout | `_emitChannel` 卸载守卫 |
| 加载超时 | quiz-vision:85/163/169 | 1.5-15s | done + clearTimeout | 自终 |
| MO flush 兜底 | dom:545/547 | 16-200ms | `_moScheduled` 去重 | 自终 |

## 四、requestAnimationFrame —— 3 处，无泄漏

| 位置 | 用途 | 管理 |
|---|---|---|
| panel-core:371/414 | Ninja 拖拽帧合并 | **cancelAnimationFrame 配对**（`_nxDrag.raf`） |
| dom:546 | MO flush 帧合并 | 一次性自终（后台 rAF 停摆由 setTimeout 兜底） |
| panel-core:63 | 面板构建兜底 | 一次性自终 |

## 五、MutationObserver —— 2 实例，均幂等

| 实例 | 挂载 | 回调 | 清理 |
|---|---|---|---|
| dom.js:525 `_mo` | 整页 childList+subtree（每帧） | 置脏 + video 入队（rAF/setTimeout 排空，队列上限 1024） | `lifecycle` ① disconnect |
| quiz.js:361 `_quizObserver` | 题目页 body | 动态防抖（有题 0.8s/无关 5s）→ quizTick | `quizDisconnect` disconnect + 防抖/视觉超时句柄全清 |

## 六、事件监听器 —— 文档级 ~15 个 + 每视频 9 个

- 文档级全部具名或登记：keydownHandler / visibilityHandler×2 / playWatchHandler / globalErrorHandler / syncNinjaGlyph / panelNinjaOutsideClick / _topFeedMessageHandler / visThrottleHandler / pagehide×2 / beforeunload / cleanup 自摘除；
- 视频级：`cxState(v).init` 单次挂载守卫 + `__cxPlayingArmed` 单例 + `nearEndEndedGuard`/`__seekArmed` 布尔守卫；
- cleanup 清单 12 项覆盖全部（lifecycle.js 还原清单 ①~⑫）。

## 七、跨上下文通道 —— 3 类

| 通道 | 创建 | 安全 | 卸载 |
|---|---|---|---|
| GM 存储桥（`GM_setValue`/`GM_addValueChangeListener`） | 仅顶层/DS 帧（`_dsNeedChannel` 门控） | `remote` 过滤 + type 白名单 + `_from` 忽略 + 卸载守卫 | `GM_removeValueChangeListener`（G-1 已修） |
| BroadcastChannel | 同门控 | 同源隔离 + onmessage 白名单 | **本轮补：`_bc.close()`** |
| postMessage（toast 透传） | 仅顶层帧 | `e.origin === location.origin` 严格校验 | 具名 + cleanup（G-4 已修） |

## 八、Promise 异步链 —— 8 条，全部收口

- 视觉 race（quiz:571）——**本轮**：超时定时器句柄登记 + settle 清除 + quizDisconnect 统一清 + 卸载守卫（S-1）；
- DS 问答（`_dsAskOnce`/retry）——经 `_dsRegTimer`（TimerRegistry 'deepseek'）可取消 + 卸载守卫（S-1）；
- 桥 fetch（bridge/auto-next/utils）——AbortController + done 守卫；
- 截图/OCR 加载（quiz-vision）——done + 超时 + 清理节点。

## 九、iframe 副本 —— 设计内

每同源 iframe 一份 bundle：MO×2 + tamper-guard 2s + playWatch + 初扫 + quizObserve（延迟 1.2s 挂载）；**主循环/DS 角色仅顶层**（顶层帧编排 + 跨帧锁）；每帧独立命名空间、独立清理。作业页（4 层帧链）的每帧 quiz MO 已按「变更性质动态防抖」控制频率（线程审计关联项）。

---

## 十、本轮修复（3 处，收尾一致性，均非泄漏级）

1. **quiz 视觉超时定时器句柄化**（quiz.js）：45s race 超时原为裸 setTimeout（卸载后仍触发，虽被 S-1 守卫拦截无副作用）——现登记 `_quizVisTimers`（fp→句柄），settle 即清，`quizDisconnect` 统一 clearTimeout；
2. **BroadcastChannel close**（vision-deepseek-web.js）：`quizVisionDeepSeekStop` 补 `_bc.close()`（原只清定时器/GM 监听，通道资源不释放）；
3. **reclampSoon 句柄管理**（panel-core.js）：连续展开不再堆积 320ms 定时器（clear-then-set）。

## 十一、验证证据（全部实测）

| # | 验证项 | 结果 |
|---|---|---|
| 1 | 线程审计回归（新增 `_sim/sim-thread-audit.js`）：注入→运行→卸载 | **4/4 PASS**；活跃定时器 3→**0 零残留**；卸载无错误；二次卸载幂等 |
| 2 | 全量 `_sim` 回归 | **57/57 passed**（含新增 sim-thread-audit） |
| 3 | 构建门禁（node --check / contract×5 / metadata / cross-module + selftest） | 全绿 |
| 4 | 全量扫描核对（309 处调度相关代码逐类核对） | 无遗漏泄漏源 |
