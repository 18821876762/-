# 网课强制续播（chaoxing-force-play）· 开源同步副本

> ⚠️ **本目录是同步镜像副本，请勿直接编辑。**
> 由 `scripts/sync-copy.ps1` 从 [`../ecosystem/src/chaoxing-force-play/`](../ecosystem/src/chaoxing-force-play) **实时同步**生成。
> 所有代码改动请改原处（`ecosystem/src/chaoxing-force-play/`），再运行同步脚本使本副本跟进：
>
> ```powershell
> # 一次性同步（提交前）
> powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1
> # 实时监听：开发时保持运行，源文件存盘即同步
> powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1 -Watch
> ```
>
> 原代码**不移动**，仍由 `ecosystem/build-force-play.ps1` 构建为单文件 `.user.js`。

---

## 它是什么

浏览器用户脚本 + 本地感知层：强制续播 / 防暂停 / 自动答题 / 主控面板，配合 Python 爬虫提供权威章节清单。
站点支持超星学习通（含学银在线）、智慧树（含作业/考试答题页）、icourse163 / xuetangx / icve / renwei / unipus / ucampus / ilabx 等。

合规与风险声明：本项目**仅用于技术学习与个人自动化研究**，使用风险由使用者自行承担；完整声明见仓库根 [`NOTICE.md`](../../NOTICE.md)。

## 代码结构（4 个能力域）

源码按 **接管 `takeover` / 站点 `sites` / 插件 `plugins` / 呈现 `presentation`** 四个能力域组织，由 `build-manifest.txt` 按依赖顺序拼接为单文件 IIFE（函数声明 hoist，拆分即等价）。

### ① takeover · 接管域（站点无关的核心引擎）

| 文件 | 作用 |
|---|---|
| `takeover/meta.js` | 全局入口/元信息：UserScript 元数据块、`@version`、站点注入引导；IIFE 起点 `(function () {` |
| `takeover/bootstrap/core.js` | 自启动引导 + IIFE 闭合 `})();` |
| `takeover/bootstrap/main-loop.js` | 主循环（~2000ms tick）：续播 / 答题 / 调度巡检心跳 |
| `takeover/foundation/error-guard/guard.js` | 全局错误守卫，保护主循环不被单点异常打断、采集错误堆栈 |
| `takeover/foundation/state/state.js` | 全局运行时状态容器 |
| `takeover/foundation/state/metrics.js` | 运行指标采集（tick / 批次 / 抖动），供诊断报告 |
| `takeover/foundation/storage/keys.js` | GM 存储键常量（持久化键命名，单一事实源） |
| `takeover/foundation/storage/storage.js` | Tampermonkey `GM_*` 存储读写封装 |
| `takeover/foundation/storage/data-governance.js` | 数据治理桶（relay-gm / stats-ls / config-ls / kvs-idb / fp-ls / quiz-cache）统一管理 |
| `takeover/foundation/meta-config/config.js` | 元配置（`CONFIG` 常量：AUTO_STOP_MIN / RESCAN_INTERVAL / LOOP_PLAY …），单一事实源 |
| `takeover/foundation/site/site-router.js` | 站点路由：按 URL 匹配平台并分发到对应 `sites` 模块 |
| `takeover/foundation/utils/url.js` | URL 解析 / 匹配工具 |
| `takeover/foundation/utils/utils.js` | 通用工具（防抖、DOM 辅助等） |
| `takeover/engine/policy.js` | 续播策略：何时强制续播 / 防暂停的门控 |
| `takeover/engine/bridge.js` | 跨进程通信桥（127.0.0.1:7531 + `postMessage` 协议） |
| `takeover/engine/targeting.js` | 前台视频定位（找面积最大可见视频） |
| `takeover/engine/dedup.js` | 去重（ENDED_SRCS / 已答去重） |
| `takeover/engine/playback.js` | 播放控制原语（play / pause 中性化接管） |
| `takeover/engine/stats.js` | 看播统计（累计时长 / 课程源） |
| `takeover/engine/foreground.js` | 前台（可见）判定与视频枚举 |
| `takeover/engine/quiz.js` | 答题引擎主流程（题目识别 → 作答调度） |
| `takeover/engine/quiz-merge.js` | 多源答题结果合并 / 去重 |
| `takeover/engine/quiz-vision.js` | 视觉识别答题（截图 + OCR / DS 视觉，`QUIZ_VISION_ENABLED` 开关） |
| `takeover/engine/vision-deepseek-web.js` | DeepSeek Web 视觉应答端对接 |
| `takeover/dom/dom.js` | DOM 接管：原生 media 元素 / prototype `pause`·`rate` 中性化、`mediaSession` 接管 |
| `takeover/dom/lifecycle.js` | 页面生命周期（加载 / 可见性 / 卸载钩子） |
| `takeover/dom/session.js` | 会话（iframe 文档接管数统计等） |

### ② sites · 站点域（各平台专属逻辑）

| 文件 | 作用 |
|---|---|
| `sites/zhihuishu.js` | 智慧树课程页专属逻辑 |
| `sites/zhihuishu-exam.js` | 智慧树作业 / 考试答题页专属逻辑 |
| `sites/icourse163.js` | 中国大学 MOOC 专属逻辑 |
| `sites/xuetangx.js` | 学堂在线专属逻辑 |
| `sites/icve.js` | 职教云 / icve 专属逻辑 |
| `sites/renwei.js` | 人卫专属逻辑 |
| `sites/unipus.js` | 随行课堂 / unipus 专属逻辑 |
| `sites/ucampus.js` | u 校园专属逻辑 |
| `sites/ilabx.js` | 实验空间 / ilabx 专属逻辑 |
| `sites/popup-quiz.js` | 共享弹窗答题骨架（被各站点弹窗复用） |
| `sites/quiz-selectors.js` | 答题选择器（题目 / 选项 DOM 选择器校准，供各站点复用） |

### ③ plugins · 插件域（工具库项）

| 文件 | 作用 |
|---|---|
| `plugins/registry.js` | 插件注册中心（工具库项注册 / 启用清单） |
| `plugins/addons/auto-next.js` | 自动下一题 / 下一节 |
| `plugins/addons/zhihuishu-auto-next.js` | 智慧树自动下一节 |
| `plugins/addons/keyboard-shortcuts.js` | 键盘快捷键 |
| `plugins/addons/tamper-guard.js` | 防篡改守卫（阻止平台脚本卸载本脚本 / 保护关键节点） |
| `plugins/addons/quiet-popups.js` | 静音 / 抑制平台弹窗 |
| `plugins/addons/video-ended-notify.js` | 视频播放结束通知 |

### ④ presentation · 呈现域（面板 / 诊断 / 洞察）

| 文件 | 作用 |
|---|---|
| `presentation/styles.js` | 面板 / 弹窗样式注入 |
| `presentation/toast.js` | Toast 轻提示 |
| `presentation/panel.js` | 主控面板外壳（可见性 / 站点 / 弹窗状态） |
| `presentation/panel-template.js` | 面板 HTML 模板 |
| `presentation/panel-toast-feed.js` | 面板内 Toast 流 |
| `presentation/panel-core.js` | 面板核心状态 / 数据绑定 |
| `presentation/panel-ds-console.js` | DeepSeek 应答端控制台面板（chat.deepseek.com） |
| `presentation/panel-controls.js` | 面板控制项 |
| `presentation/panel-drag.js` | 面板拖拽 |
| `presentation/diagnostics.js` | 运行诊断报告（`buildDiagnostics()`：分区化诊断，跨页类型区分） |
| `presentation/dashboard.js` | 洞察 / 数据看板 |
| `presentation/commands.js` | 命令 / 快捷键命令表 |
| `presentation/zhihuishu-fab.js` | 智慧树悬浮按钮（FAB） |

---

## 如何构建（在原处进行）

构建依赖都在 `ecosystem/`（`build-force-play.ps1` / `build-manifest.txt` / `scripts/` / `node_modules` / `package.json`），
本副本仅用于阅读源码结构，不自带构建链：

```powershell
cd ecosystem
powershell -ExecutionPolicy Bypass -File build-force-play.ps1        # 产出 chaoxing-force-play.user.js
powershell -ExecutionPolicy Bypass -File build-force-play.ps1 -Fast  # 本地开发快模式（跳过重门禁）
```

## 文档导航

- 仓库根 [`README.md`](../../README.md) — 三层架构与三句话上手
- [`../ecosystem/README.md`](../ecosystem/README.md) — 完整构建 / 测试 / 发布手册
- 规则文档（改码前必读）：`docs/`（`DOC_INDEX.md` / 架构红线 / 契约 / 选择器校准流程）
