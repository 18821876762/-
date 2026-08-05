# 代码注释历史 · 迁出叙事类注释

> 本文件属 🟢 历史文档。代码内只保留 **"为什么"（约束/坑位/防回归不变量）** 注释；带版本号的**功能叙事**与**历史组织结构叙述**已迁出此处，避免时效坏账。
> 版本演进完整细节见 `CHANGELOG.md`（逐版评级 + 对应评审）。
> 注释规范红线见 `ARCHITECTURE_GOVERNANCE.md` §8。

---

## 一、从代码迁出的版本徽标（含义索引）

代码原注释里的 `vX.Y 功能名` 仅作功能溯源，具体改动细节查 `CHANGELOG.md` 对应版本行：

| 原代码注释 | 功能 | CHANGELOG 锚点 |
|---|---|---|
| `命令面板（原 v4.7）` | `/` 唤起命令下拉、↑↓/Tab/Enter/Esc、参数解析 | `force-play v4.7`（命令面板） |
| `运维仪表盘（原 v4.8）` | 实时 CPU/内存/网速监控小面板 | `force-play v4.8`（运维仪表盘） |
| `命令收藏夹（原 v4.8）` | 星标系统，持久化到 localStorage | `force-play v4.8`（星标收藏） |
| `副脚本注册中心（原 v4.0 主脚本架构）` | 主/副脚本架构，`__cxAddonQueue`/`__cxRegisterAddon` | `force-play v4.0` |
| `面板设置持久化（原 v4.1）` | 刷新后保持 AUTO_STOP_MIN/RESUME_AFTER_MIN/RESCAN_INTERVAL/END_RELEASE_SEC/DEBUG | `force-play v4.1` |
| `近尾 ended 监听（原 v4.7.replay）` | `nearEndEndedGuard` 只装一次 | `force-play v4.7.replay` |
| `主控面板命名（原 v4.0/v4.4 主从式）` | 顶部导航 + 分区块、`switchTab` 持久化 | `force-play v4.0 / v4.4` |

---

## 二、从代码迁出的历史组织结构叙述

以下叙述解释"代码为何是现在的结构"，已无时效价值，留存备查：

- **`utils.js` 原注**：`原先与配置同处 module-01-config，现独立为工具层` —— 工具层早已稳定独立，组织沿革无需留在代码。
- **`positionPanel` 空壳**：副面板（progress-panel）自 `v3.2` 起内嵌主控面板，不再有独立浮动窗需避让；空壳保留仅因 `showPanel/ensurePanel` 调用契约，无版本含义。
- **`panel-core.js` 位置策略（原 v4.9 修订）**：禁用拖拽、面板恒居 CSS 右上角安全位。旧版拖拽会把"Ninja 窄态 40px 坐标"套到"退出后 460px 宽态面板"上，导致 `left` 不变、右侧大半被屏幕右缘裁掉。
- **`config.js` 面板宽度（原注）**：宽度走 CSS 变量 `--cx-panel-w`（默认 380px）单一事实源；旧版固定 288px 与 Ninja 展开宽度恰好相等，退出 n 模式后用户仍见窄面板，误以为"没退出 n 模式"。
- **`meta.js @description` 演进**：描述串含 `v3.9 健壮性`/`v3.10 健壮性`/`v3.15 抗伪暂停/MSE 断流` 等历史特性标记，属元数据叙事，已由 `CHANGELOG.md` 完整覆盖；描述末尾已补 `v4.x 面板化`/`v4.9 位置策略` 摘要。
- **本地 Node 运行位置（工具链沿革）**：本机 `PATH`/WSL/`install_binary` 均取不到 Node，但工作区自带 `node_home/node-v20.19.0-win-x64/node.exe`（不在 PATH）。任何本地验证（构建、`node --check`、`tools/check-build-size.js`、`tests/pure.test.js`、`_sim/*.js`——后者需 `jsdom`，工作区可用）都必须显式用完整路径调用：
  `c:/Users/24033_1dhcyji/CodeBuddy/20260723173246/node_home/node-v20.19.0-win-x64/node.exe <脚本>`。
  此事实因 AI 曾误判"本机无 node"而记录，避免后续再次漏用。CI（GitHub Actions）环境自带 Node，走 `ci.yml` 即可。

---

## 三、保留在代码中的 why 类约束（切勿删除）

以下注释对抗回归至关重要，**保留在代码原位**，此处仅作索引：

| 位置 | 约束 | 违反后果 |
|---|---|---|
| `bootstrap/main-loop.js` | `F-B4`：每轮 `scanVideos` 重新 neutralize 原型 pause（防 use strict 下描述符被平台还原绕过） | 改为"仅首装幂等"→ 还原缺陷，暂停锁失效 |
| `ui/panel-core.js` | `修复 #16`：body 未就绪时 deferred 构建，避免面板游离 DOM 外不可见 | 提前构建 → 面板赋值但不可见 |
| `bootstrap/core.js` | `审查#5`：幂等守卫防重复注入产生双倍定时器/监听器 | 重复注入 → 双 setInterval/监听器叠加 |
| `dom/dom.js` | `吸收评审#2/#D`：优先 `defineProperty` 在实例建 own 属性遮蔽 pause（自有/继承皆可遮蔽） | 仅覆盖原型 → webpack 私有函数直调 pause 绕过 |
| `dom/dom.js` | `F-B1`：曾被释放的视频重新归属任务点 → 重新接管；撤销全量阶段已施加接管 → 交还平台 | 广告/插播被永久强制续播 |
| `biz/targeting.js` | `修复复审`：定向 0 命中不在本轮回退，连续 N 轮稳定 0 命中才判失效回退全量 | 章节间隙/视频延迟渲染瞬时空窗误强播广告 |
