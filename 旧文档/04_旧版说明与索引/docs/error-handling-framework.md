# 错误处理框架（指针）

> 本文为规则类占位升级版：错误处理**约定与实现位置**如下，不再为空占位。

现行错误处理不写在独立文件里，而是分散在「契约原语 + 守卫模块」中，统一规约见 [`CONTRACT.md`](CONTRACT.md) §7.2（错误卫士原语）：

- **`toolkit.d` / `swallow` / `safeCall` / `Guard`**：跨模块安全调用原语，由 `takeover/foundation/utils/utils.js` 暴露到 `window.__CX_FORCE_PLAY.toolkit`，各工具库项（addons）优先复用。
- **`takeover/foundation/error-guard/guard.js`**：基础错误守卫（构建清单 `foundation/error-guard/guard.js` 首位），提供 try/兜底封装。
- **错误落点**：近期错误统一进入面板的 `recentErrors` / `errorCount`（来自核心脚本的 `_errBuf`）；`toast(msg, level)` 的 `error` 级用于失败/异常反馈（见 `docs/ui-design-main-panel.md` §6.1 反馈分级矩阵）。

> 新增/改动错误处理逻辑时：必须走 `toolkit` 守卫，禁止裸 try/catch 重复实现；错误反馈须遵循 §6.1 分级（状态类变化不弹 toast，失败/异常才 error 级）。
