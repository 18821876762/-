# chaoxing-force-play 全面审查与优化报告（2026-08-27）

范围：58 源模块 + 构建链。方法：并行子代理(3)跨维度定位 + 主代理逐一核实源码 + 定向修复 + 构建门禁全量验证。

## 一、本次已落地修复（8 项，均经构建门禁 + _sim 全绿验证）

### 1. 功能/逻辑缺陷：面板宽度默认值不一致（真实 Bug）
- **文件**：`presentation/panel-template.js:334-335`
- **问题**：模板硬编码 `460`px，而 `CONFIG.PANEL_W` 默认 `340`px。首帧渲染时面板以 460px 出现，随后 `panel.js syncInputs` 才拉回 340px，产生一次可见的宽度跳变；滑块值与宽度标签初始态也不同步。
- **修复**：模板默认值改为绑定 `CONFIG.PANEL_W`（`typeof CONFIG` 守卫 + 兜底 340），并补 `CONFIG` 到 `@requires` 契约注解。

### 2. 可维护性：伪暂停阈值 `0.01` 魔法数字散落 6 处
- **文件**：`config.js`(×3) + `dom.js`(×3)
- **问题**：平台「伪暂停」判定 `playbackRate <= 0.01` 在多个模块散落硬编码，平台改判定口径时需多处同步改，易漏。
- **修复**：新增 `CONST.PSEUDO_PAUSE_RATE: 0.01` 单一事实源，全部 6 处改为引用。

### 3. 性能：`_ovDriftGuard` 每 tick 重复祖先遍历
- **文件**：`dom/dom.js`
- **问题**：漂移守卫每 tick 都调用 `videoIframeSrcsOf(v)` + `videoDriftStableKeys(v)`，两者都沿祖先链上溯；而 `key0`（video src）不变时这些稳定键理论上不变化，属重复遍历。
- **修复**：祖先派生键按「源变化」缓存于 `cxState(v).driftStableKeys`，仅当 `driftSrc !== key0`（换源）时重算。换源必然触发重算，iframe 归属仅在换课/换任务时变化且届时 src 必变，语义零回归。

### 4. 逻辑缺陷：`_srcMaxCount` 换源删除不递减 → 计数失真
- **文件**：`dom/dom.js`
- **问题**：换源时 `delete _srcMaxTime[旧key]` 但未递减 `_srcMaxCount`；该计数只增不减（对不存在键的计数），持续累积到 5000 阈值会**提前触发淘汰**，把本不该淘汰的进度键清掉。
- **修复**：换源删除前先 `hasOwnProperty` 判断再 `_srcMaxCount--`，计数与实际键数收敛一致。

### 5. 性能：`overrideVideo` 内 `videoBelongsToTask` 重复祖先遍历
- **文件**：`dom/dom.js`
- **问题**：同一视频同一 tick 内，`matchedAny` 登记与 `_ovSkipNonTask` 各算一次 `videoBelongsToTask`（完整祖先上溯）。仅在首次匹配前并发重复，但仍是冗余。
- **修复**：`overrideVideo` 顶部统一算一次 `_belongs`，复用传入 `_ovSkipNonTask(v, _belongs)`；定向关闭时恒 `true`，与旧语义完全一致。

### 6. 健壮性/资源泄漏：reverse-api 消息监听器匿名 + 通道未关闭
- **文件**：`reverse-api.js` + `lifecycle.js`
- **问题**：`window.addEventListener('message')` 匿名注册未登记 cleanup；`BroadcastChannel` 从不 `close()`。卸载后残留全局监听 + 未关闭通道（本项目的卸载清洁度是核心关注点）。
- **修复**：命名 handler `_reverseApiMsgHandler` + 模块级通道句柄 `_reverseApiBc` + 新增 `reverseApiStop()`（幂等，移除监听 + close 通道 + 复位标志），在 `lifecycle.js cleanupListeners` 登记调用。

### 7. 安全：reverse-api postMessage 跨站源未校验（纵深防御）
- **文件**：`reverse-api.js`
- **问题**：postMessage 入口虽有 auth token 第一道门，但未校验 `ev.origin`，token 泄露时任意跨站页面可调用。
- **修复**：新增 `_reverseApiOriginOk()`——放行同源、`origin=null`（非 Web 上下文，无法被跨站伪造）、file/扩展协议；拒绝跨站 Web 源。与 `server.js` 的 CORS `*` 通道不冲突（不同传输层）。

### 8. 安全：bridge.js `?cxbridge=` URL 参数未限制回环（SSRF 一致性）
- **文件**：`bridge.js` `resolveBridgeBase`
- **问题**：`localStorage` 路径已被收窄到回环（MED-2），但 `?cxbridge=` URL 参数路径却接受任意 `http(s)://` 主机——来源面不一致，注入该参数的页面 URL 可将桥请求重定向到外部主机（SSRF 探测）。
- **修复**：URL 参数路径与 localStorage 一致，仅信任回环地址（`127.0.0.1`/`localhost`/`[::1]`），保留 scheme/端口/纯主机形式兼容。桥本质是本地爬虫代理，回环限制无损功能。

## 二、审查中评估后「不改」的项（避免过度优化 / 无回归价值）
- **面板刷新链 / 拖拽捕获**：已在 v4.24 修复并有专项回归，当前无新问题。
- **各 addon/站点选择器**：best-effort 并集语义，校准依赖真实站点 DOM，非静态可改。
- **`_ovDriftGuard` 全量扫描**：已节流（2s tick / 5s seek 冷却 / markDomDirty 置脏），属设计内。
- **进度记录键上限 5000**：已有淘汰机制，配合修复后的计数收敛正常。

## 三、验证
- 构建门禁全绿：`node --check` / `eslint` / `contract verify` / `contract doc` / `contract semantics` / `metadata` / `cross-module contract` / 两套自检 / `_sim`（run-sim.js）全部 PASSED。
- 契约文档重生成：CONTRACT.md（206 个挂载符号，登记新符号 `reverseApiStop`）+ CROSS_MODULE_CONTRACT.md。
- 产物同步：`ecosystem/chaoxing-force-play.user.js` 与用户安装的 `chaoxing-force-play-latest.user.js` SHA256 一致（769988 字节），内含全部改动标记（PSEUDO_PAUSE_RATE / reverseApiStop / _reverseApiOriginOk / driftStableKeys / cxbridge 收窄）。
- 版本三处一致（4.19.48），由 metadata 门禁保证。

## 四、需用户侧动作
重装 `chaoxing-force-play-latest.user.js` 后验证：面板首帧宽度不再跳变；无回归的续播/答题行为。本批次为审查优化（非新功能），未 bump 版本号。
