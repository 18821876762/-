# 当前文档索引

核对日期：2026-10-14；用户脚本版本：4.20.3。现行资料共 31 份 Markdown。时效依据、验证范围和待核对项见 [文档现状](DOCUMENT_STATUS.md)。

## 阅读路线

| 目的 | 阅读顺序 |
|---|---|
| 安装和使用 | [项目说明](../README.md) → [使用说明](USAGE.md) → [安装产物](../dist/README.md) |
| 开发和维护 | [目录结构](PROJECT_STRUCTURE.md) → [贡献流程](../CONTRIBUTING.md) → [应用开发](../apps/userscript/README.md) |
| 阅读实现 | 本表“实现”类别 → [行为契约](CONTRACT.md)及 [跨模块契约](CROSS_MODULE_CONTRACT.md) |
| 查旧资料 | [首次归档](../旧文档/归档说明.md) → [补充归档](../旧文档/07_补充归档/2026-10-03/补充归档说明.md) |

## 现行文档清单

| 类别 | 文档 | 维护用途 |
|---|---|---|
| 入门 | [项目说明](../README.md) | 项目定位、开发与安装入口 |
| 入门 | [使用说明](USAGE.md) | 安装、开关、本地桥与排障 |
| 入门 | [安装产物](../dist/README.md) | personal、open、latest 三个产物 |
| 入门 | [感知层说明](../services/perception/README.md) | 感知脚本与 Python 服务职责 |
| 入门 | [Python 服务](../services/perception/cx_crawler/README.md) | 依赖、配置、采集与桥接口 |
| 开发 | [目录结构](PROJECT_STRUCTURE.md) | 应用、服务、工具、产物和备份归属 |
| 开发 | [贡献流程](../CONTRIBUTING.md) | 修改、验证、同步与文档维护 |
| 开发 | [用户脚本开发](../apps/userscript/README.md) | 构建器、依赖、测试与源码位置 |
| 开发 | [源码镜像](../exports/chaoxing-force-play/README.md) | 同步方式和镜像用途 |
| 开发 | [架构治理](ARCHITECTURE_GOVERNANCE.md) | 能力域、拆分规则和当前体积检查结果 |
| 开发 | [拆分约束](references/split-gotchas.md) | 语法边界、初始化顺序和验证方法 |
| 开发 | [页面校准](calibration-guide.md) | 页面采集、样本和选择器核对 |
| 开发 | [合成页面样本](../apps/userscript/tests/fixtures/README.md) | 离线夹具范围、脱敏与真实站点校准边界 |
| 实现 | [错误处理](error-handling-framework.md) | 容错原语、公开挂载和错误反馈 |
| 实现 | [答题链路](QUIZ_PIPELINE.md) | 当前调度、通道、提交态与数据治理 |
| 实现 | [核心状态机](CORE_STATE.md) | 运行许可、任务代次、取消与子系统协作 |
| 实现 | [内置插件](modules/decision.md) | 插件清单、站点边界及开关 |
| 实现 | [Reverse API](REVERSE_API.md) | 浏览器与 HTTP 接口、认证和参数 |
| 契约 | [行为契约](CONTRACT.md) | 人工不变量和自动生成挂载表 |
| 契约 | [跨模块契约](CROSS_MODULE_CONTRACT.md) | 自动生成依赖表，受门禁校验 |
| 契约 | [契约兼容入口](CONTRACTS.md) | 指向 CONTRACT.md 的旧链接兼容页 |
| 工具 | [诊断工具](../tools/diagnostics/README.md) | 只读诊断、浏览器探针与历史助手 |
| 工具 | [演示生成器](../tools/presentations/README.md) | 构建方式、输出路径及历史内容说明 |
| 管理 | [文档入口](README.md) | 按任务选择文档 |
| 管理 | [当前文档索引](DOC_INDEX.md) | 本表；现行文档登记入口 |
| 管理 | [文档现状](DOCUMENT_STATUS.md) | 数量、时效、证据和待核对项 |
| 管理 | [变更记录](CHANGELOG.md) | 历史日志兼容入口及当前整理记录 |
| 管理 | [使用约定](../NOTICE.md) | 项目既有用途与分发声明；配套 [LICENSE](../LICENSE) |
| 管理 | [安全与隐私](../SECURITY.md) | 凭据、课程数据、安全报告与本地快照边界 |
| 管理 | [第三方说明](../THIRD_PARTY_NOTICES.md) | 工具链、可选外部库和分发许可范围 |
| 管理 | [4.20.3 发布准备](releases/4.20.3.md) | 来源提交、产物摘要、当前验证和发布状态 |

## 历史资料与整理记录

[首次归档说明](../旧文档/归档说明.md)、[CSV](../旧文档/归档清单.csv)和 [JSON](../旧文档/归档清单.json)保留最初归档时的路径、时间和 SHA-256。原批次登记 158 个归档文件；其中可共享评审及归档容器已按账号安全要求脱敏，当前副本不能直接按原件哈希验收，见 [脱敏说明](../旧文档/脱敏说明.md)。原件仅保留在本地忽略的修正前快照。

[2026-10-03 补充归档](../旧文档/07_补充归档/2026-10-03/补充归档说明.md)包含 6 份历史评审、v3.33 脚本快照，以及治理和答题链路整理前稿件。共享副本的账号标识处理按脱敏记录阅读；不同批次的同名报告按其版本分别理解。

整理前文件见 [文档快照](../backups/docs/2026-10-03/文档整理前.zip)及 [原路径清单](../backups/docs/2026-10-03/整理前清单.json)，校验结果见 [文档验收记录](../backups/docs/2026-10-03/文档验收结果.json)。历史测试与完成状态按原日期理解。
