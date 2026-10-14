# 错误处理与反馈

> 核对基线：4.20.3；核对日期：2026-10-14。公开挂载点以[契约](CONTRACT.md)为准。

## 容错原语

实现位于 [guard.js](../apps/userscript/src/chaoxing-force-play/takeover/foundation/error-guard/guard.js) 与 [utils.js](../apps/userscript/src/chaoxing-force-play/takeover/foundation/utils/utils.js)。

| 需求 | 原语 | 异常后的行为 |
| --- | --- | --- |
| 取值并提供默认值 | `safeGet(fn, fallback)` | 返回 fallback；正常返回 undefined 也使用 fallback，null 保留 |
| 执行可失败的副作用 | `bestEffort(fn, tag)` | 不中断后续流程，异常经 `swallow` 记录 |
| 从可为空的 DOM 根节点取值 | `safeDOM(root, fn, fallback, tag)` | 根节点为空、结果为空或异常时返回 fallback；异常被记录 |
| 调用函数并保留返回值 | `safeCall(fn, tag)` | 正常返回函数结果；异常被记录并返回 undefined |
| 记录已捕获异常 | `swallow(error, tag)` | 增加计数、保存近期错误；DEBUG 开启时输出警告 |
| 调试日志 | `dbg(...args)` | 仅在调试态输出 |

IIFE 内部可直接使用相关函数。外部插件访问 `window.__CX_FORCE_PLAY.Guard` 中的 `safeGet`、`bestEffort`、`safeDOM`，或 `window.__CX_FORCE_PLAY.toolkit` 中的 `dbg`、`swallow`、`safeCall`。

`Guard` 是容错函数的薄包装。它先于 `utils.js` 创建工具库执行，而 `utils.js` 会重新赋值 toolkit 对象，因此外部调用者不能依赖 `toolkit.Guard` 存在。当前没有 `toolkit.d` 或 `Guard0` API。

## 错误记录与用户反馈

[metrics.js](../apps/userscript/src/chaoxing-force-play/takeover/foundation/state/metrics.js)保存错误计数与缓冲。通过 `toolkit.errorCount()`、`toolkit.recentErrors()` 读取；`swallow` 会保留最多 50 条近期错误，包含时间、来源标签、消息及可用的堆栈。关闭 DEBUG 不会停止这些记录。

用户提示走 `toolkit.toast(message, level)` 或内部 `EventBus.emit('ui:toast', message, level)`。工具库入口转发事件；面板提示流与浮层分别订阅相关反馈，渲染实现见 [toast.js](../apps/userscript/src/chaoxing-force-play/presentation/toast.js) 与 [panel-toast-feed.js](../apps/userscript/src/chaoxing-force-play/presentation/panel-toast-feed.js)。

当前仅 `error` / `critical` 级允许出现悬浮提示；`info` / `success` / `warn` 默认进入面板提示流。启用“关闭脚本弹窗”后悬浮提示关闭，面板提示流仍保留。错误计数本身不会自动触发浮层。

## 凭据与取消反馈

私有凭据模块捕获 GM 读写异常时只反馈会话有效期、授权或清理状态，不记录原始错误消息和 Key。保存失败仍可使用本次显式授权的会话凭据；清空失败须说明私有存储中仍可能有旧值，不能仅按内存清空宣称持久清理成功。

浏览器视觉 Key 请求用固定网络错误文本，避免服务端或异常对象反射 Key；成功回复中出现当前 Key 时遮盖。取消以 `AbortError` 传播，浏览器 Reverse API 转为 `ANSWER_FAILED` 和取消消息。调用方仍必须保留原任务上下文、清理 AbortSignal 监听与 reader，不能吞掉取消后继续发送、回填或提交。独立 HTTP 服务不自动使用这套浏览器反馈逻辑，按其实现单独判断。

配置导出及导入等待私有读取完成，再过滤凭据类字段、嵌套凭据和当前 Key 的字符串包含；凭据状态不确定时不应先把网页存储内容写入控制台或剪贴板。错误记录可能包含页面信息，分享前按 [安全与隐私](../SECURITY.md)使用合成或脱敏复现。

## 新增错误处理时

优先复用适合语义的容错原语，提供能定位来源的 tag。需要重试、资源释放、状态补偿或用户恢复操作的逻辑，应保留明确的 try/catch 与恢复分支，不能用吞错包装取代。没有异常风险的操作无需增加保护层。

跨域访问、DOM 缺失和可选能力应给出明确降级结果；关键失败应进入诊断或反馈。不要假设所有 try/catch 都已归并到 Guard，也不要把每次状态变化升级成错误提示。

修改公开能力及消费方时，检查[跨模块契约](CROSS_MODULE_CONTRACT.md)并在项目根运行 `scripts/test.ps1`。

核对当前修订的验证结果时使用 [4.20.3 发布记录](releases/4.20.3.md)，不将历史断言数量当作本轮已通过的证据。
