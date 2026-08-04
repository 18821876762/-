# 决策层 (Decision)

行为控制与动作决策。

- `chaoxing-auto-next.user.js` (v3.0 重写) — 播完自动进答题入口 / 跳下一未完成章节（Bridge优先+DOM兜底）；插播题遮罩自动暂停（MO+轮询双通道监控）。通过 `__cxAN_hold` 与主脚本通信；面板开关 `localStorage.cx_an_on` 持久化。

> 主控的播放/暂停/速率/循环等核心决策逻辑位于 `ecosystem/chaoxing-force-play.user.js`。
