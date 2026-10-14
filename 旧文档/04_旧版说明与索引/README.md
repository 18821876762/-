# 网课强制续播（chaoxing-force-play）

> 浏览器用户脚本 + 本地感知层：强制续播 / 防暂停 / 自动答题 / 主控面板，配合 Python 爬虫提供权威章节清单。
> 站点识别支持超星学习通（含学银在线）、智慧树（含作业/考试答题页）、icourse163 / xuetangx / icve / renwei / unipus / ucampus / ilabx 等。

> ⚠️ **合规与风险声明（必读）**：本项目**仅用于技术学习与个人自动化研究**。使用本项目带来的任何学业、账号、数据或法律风险由使用者**自行承担**；作者**不鼓励、不支持**任何形式的学术不端或违反平台服务条款的行为。完整声明见 [`NOTICE.md`](NOTICE.md)。

---

## 它是什么

三层架构，各司其职：

| 层 | 目录 | 职责 |
|---|---|---|
| **生态层** | `ecosystem/` | 唯一交付物 `chaoxing-force-play.user.js`（单文件、零运行时依赖）。由 `src/chaoxing-force-play/` 按 **4 个能力域**（接管 `takeover` / 站点 `sites` / 插件 `plugins` / 呈现 `presentation`）**56 个源模块**（build-manifest 清单；含 `meta.js`/`core.js` 共 58 个 `.js`）构建拼接；含跨进程桥（127.0.0.1:7531）与 `postMessage` 协议。 |
| **感知层** | `perception/` | Python `cx_crawler` 爬虫：本地 HTTP 桥提供权威章节清单 / 媒体采集 / DeepSeek 应答端（自动答题 AI）。 |
| **文档层** | `docs/` | 🔴 **规则文档**（改码前必读，含架构红线 / 契约 / 选择器校准流程）与 🟢 **历史文档**（设计稿 / 评审快照 / 变更史）分离。 |

## 三句话上手

- **构建**：`cd ecosystem; powershell -ExecutionPolicy Bypass -File build-force-play.ps1` → 产出 `.user.js`；本地开发用 `-Fast` 跳过重门禁。
- **测试**：`ecosystem/_sim/` **56 个仿真回归**（`sim-*.js`；含 `verify_fixes.js` 为 57 个）+ `ecosystem/tests/pure.test.js` 纯函数单测 + 构建门禁（`node --check` / ESLint / 契约 / 元数据，全自动）。
- **发布**：CI 构建产物上传 GitHub Releases，Release note 注明对应 commit SHA。

## 开源同步副本（GitHub 源码）

仓库根 [`chaoxing-force-play/`](chaoxing-force-play/) 是 `ecosystem/src/chaoxing-force-play/` 的**实时同步镜像副本**，用于 GitHub 开源阅读（核心文件作用见其内 `README.md`）。原代码**不移动**；改动请改原处后运行同步：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1        # 一次性同步
powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1 -Watch # 实时监听（开发时保持运行）
```

## 文档导航

- [`docs/DOC_INDEX.md`](docs/DOC_INDEX.md) — 文档总索引（7 类分类，最新导航入口）
- [`docs/README.md`](docs/README.md) — 文档总览（旧版，仅规则 vs 历史两类分类）
- [`ecosystem/README.md`](ecosystem/README.md) — 完整构建 / 测试 / 静态分析 / 发布手册
- [`perception/cx_crawler/README.md`](perception/cx_crawler/README.md) — 爬虫子系统说明
- [`docs/TASKS.md`](docs/TASKS.md) — 任务区（当前活跃任务，完成后转历史）
- [`docs/TASK_HISTORY.md`](docs/TASK_HISTORY.md) — 任务历史归档

## 协作

- 贡献与踩坑指南见 [`CONTRIBUTING.md`](CONTRIBUTING.md)（含 Windows 构建已知坑）。

## 开源协议

[MIT](LICENSE)。合规与风险声明见 [`NOTICE.md`](NOTICE.md)。
