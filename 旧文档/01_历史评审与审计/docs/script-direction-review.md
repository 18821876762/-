# 脚本方向审查（2026-08-08）

针对 `chaoxing-force-play` 整体架构方向的审视（非逐行 bug，而是"在朝正确的方向走吗"）。
结论：**主干方向正确、成熟**；以下列出已验证正确的方向点 + 仍需校准/可改进项。

---

## 一、已验证正确的方向点

### 1. 站点隔离分层（site-router.js）
- `detectSite()` 集中路由，正则带域名边界（renwei 已修 L3 误匹配），未知/未配置域回退 `chaoxing` 基线。
- `SITES` 映射各站点私有全局（attachmentsKey/ananasKey）/任务容器选择器；`currentSiteCfg()` 按 detectSite 实时分发。
- 方向正确：平台改版只改 `SITES` 一处，无散落硬编码。

### 2. 续播主线与站点专属逻辑解耦（main-loop.js）
- 通用续播（`dom.js` 的 `scanVideos` + 原型 pause 中性化）对所有站点兜底；
- 主循环 `_loopTick` 仅按 `detectSite()` 分发「弹窗随机作答 / 真答题」（站点函数内部还有二层守卫）。
- 方向正确：续播与答题互不影响，新增平台只需加分支 + 填 `SITES`。

### 3. DeepSeek 应答端解耦为跨源 Channel 中继（vision-deepseek-web.js）
- 课程页 `quizAskDeepSeek` 发 `ds-ask` → DeepSeek 页 `_dsRespond` 作答 → 回 `ds-answer`；
- 中继优先 `GM.set`（跨源可用），回退 `BroadcastChannel`（同源）；
- 课程页与 DS 页分别由 `location.host` 判断装 `_dsInitCourseSide` / `_dsInitResponder`，互不干扰；
- 应答端独立于续播主循环，开关闸门(`DS_RESPONDER_ENABLED===false`) + 登录态硬闸门(`_dsIsLoggedIn`) 双锁。
- 方向正确：应答端是"无头后端"，不污染课程页续播逻辑。

### 4. DeepSeek 空选择器已做安全降级（dom.js 评审#6）
- `deepseek` 站点 `taskContainerSel:''` 时，`_containerSel` 降级只用 `SELECTORS.VIDEO_BOX`，
  避免拼出非法选择器 `#videoBox, ` 导致每轮 `querySelectorAll` 报错（诊断#510：deepseek 页曾 510 次报错）。
- 方向正确：已预见跨源空跑副作用并修复。

### 5. 智慧树答题接口接线一致
- `main-loop.js` 调用的 `zhihuishuExamEnabled/Tick/AutoSubmitTick` 与 `zhihuishu-exam.js` 暴露的接口**同名**；
- FAB / 诊断 / 面板均通过同一接口名调用。方向正确：无断点。

### 6. 章节测验 active 锚定（auto-next.js）
- 视频播完时 `li.active` 恰是刚结束任务点，优先只点 active 之后的章节测验，避免同页多测验跳错章。
- 方向正确：贴合超星 DOM 现实结构。

---

## 二、仍需校准项（方向正确，但选择器待真实站点校准）

> 这些是"best-effort 待校准"，不是方向错误。代码已留 TODO/回退。

| 项 | 现状 | 校准方式 |
|---|---|---|
| DeepSeek 运行时选择器 | `DEEPSEEK` 配置已固化 best-effort 回退（input/send/msgList/reply/generating/fileInput 均非 TODO），但依赖模拟 DOM | 在 `chat.deepseek.com` 登录态用 DevTools 复核一次，覆盖 `window.__CX_FORCE_PLAY.DEEPSEEK` |
| 多平台 taskContainerSel | icourse163/xuetangx/icve/renwei/unipus/ucampus/ilabx 的容器选择器均为 best-effort | 各平台真实页实测 |
| 智慧树 attachmentsKey/ananasKey | 置空 → 定向续播自动回退全量（合理降级） | 若智慧树有白名单全局再补 |
| `_dsIsLoggedIn` 启发式 | 基于 textarea/account 菜单存在性 | 真实页校准登录态判定 |

---

## 三、可改进的方向项（可选，非必须）

### A. DeepSeek 站点主循环续播 tick 短路（轻微优化）
当前 `_loopTick` 对 `deepseek` 站点仍跑 `scanVideos/autoStopTick/resumeTick/applyUserRateAll/neutralizeGlobalPause`（已安全降级为空跑）。
建议：在 `_loopTick` 顶部对 `detectSite()==='deepseek'` 仅跑 DS 应答端相关（或干脆 `return`），省去无谓轮询。
风险：低，但需确认 DS 页不需要任何续播状态遥测。列为可选项，未擅自改动以免引入回归。

### B. `_dsRespond` 消息计数对"流式复用节点"的边界
`_dsCountMessages` 用 `nodes.length` 比对 `countBefore`；若 DeepSeek 把新回复**流式追加到同一消息节点**（length 不增），
会误判"无新回复"。当前模拟 DOM 用独立 `role=listitem` 节点不受影响。
建议：增加"末条回复文本是否变化"的兜底判定（弱模式）。列为已知限制，非阻塞。

### C. 跨源中继的单点故障
课程页 `quizAskDeepSeek` 依赖 DeepSeek 页开着且已登录。若 DS 页关/未登录 → 60s 超时 reject → 课程页随机兜底。
方向正确（有兜底），但可考虑：超时后短期重试一次后再随机，降低单题因 DS 页暂离而错答的概率。可选。

---

## 四、总体结论

脚本**方向正确、分层合理、站点隔离到位、应答端解耦干净**。无架构性偏差，无断点接线。
剩余工作均为「best-effort 选择器在真实站点校准」（已在各文件标 TODO/回退），以及 3 个可选优化（A/B/C）。
建议优先级：**先做二（真实站点校准，决定作答能否真正命中）> A（轻量优化）> B/C（边界增强）**。
