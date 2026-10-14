# 文档总览 · 规则文档 vs 历史文档

> ⚠️ **本文为旧索引（仅规则 / 历史两类）**：最新统一导航与 7 类分类见 [`docs/DOC_INDEX.md`](DOC_INDEX.md)。

本目录文档只分两类，便于快速定位：

- **🔴 规则文档（Rules）**：必须守的规约，改码前必读，保持精炼。
- **🟢 历史文档（History）**：设计稿、架构说明、使用手册、变更史、评审快照等累积资料，按需查阅、非必读。

> 涉及两套子系统，勿混：
> - **force-play 用户脚本**（`ecosystem/src/chaoxing-force-play/`）—— 规则文档治理的对象；构建产物为仓库根的 `ecosystem/chaoxing-force-play.user.js`。
> - **cx_crawler 爬虫**（`perception/cx_crawler/`，Python）—— 独立的感知子系统。

---

## 🔴 规则文档（Rules）

| 文档 | 子系统 | 内容 | 何时读 |
|---|---|---|---|
| `ARCHITECTURE_GOVERNANCE.md` | force-play | 分类管理红线：分层、单文件行数上限、新功能归域流程、拆分约束 | **每次改码前** |
| `references/split-gotchas.md` | force-play | §4 拆分机械约束的细节：ASI 反例/正例、切片后校验清单（规则补充） | 拆分大文件时 |
| `CONTRACT.md` | force-play | **唯一契约文档**（原 `CONTRACTS.md` 已并入）：§1–6 行为不变量（面板 owner 单一事实源、控件判空、列表索引、卸载还原清单、状态对偶还原、站点隔离/真值判断）、§7–9 命名空间与 `toolkit` 契约/预留扩展点/历史缺陷、§11 自动生成的挂载点总表 | 改跨文件共享状态 / 加接管点 / 加卸载还原 / 加命名空间成员时 |
| `calibration-guide.md` | force-play | 真实站点选择器校准流程（各平台选择器均为 best-effort，需按此流程取证再改） | 适配新站点 / 面板报「检测到 0 题」时 |
| `code-review-prompt.md` | force-play | 代码评审方法论：必须 grep/实跑复核、禁止泛读印象结论 | 发起或执行代码评审前 |
| `TASKS.md` | force-play | 任务区：当前活跃任务（待实施 / 阻塞·延后）；任务完成后删除该条目并转 `TASK_HISTORY.md` | 领取 / 派发任务前 |

> 规则文档只写"必须守的规则"，不堆细节；具体反例/正例/校验清单见 `references/split-gotchas.md`。
>
> 契约文档配套的三道自动门禁（构建时执行）：④ 挂载↔读点一致 `verify_contracts.js`、⑤ 挂载总表不漂移
> `verify_contract_doc.js`、⑥ 条款语义静态校验 `verify_contract_semantics.js`（附变异自检
> `selftest_contract_semantics.js`，防规则空转）。

---

## 🟢 历史文档（History）

| 文档 / 目录 | 子系统 | 内容 | 说明 |
|---|---|---|---|
| `CHANGELOG.md` | force-play | 全量变更史（408 行） | 查某次改动细节时翻，不必通读 |
| `code-annotation-history.md` | force-play | 从代码迁出的版本徽标/历史叙述索引 + 保留的 why 约束清单 | 注释时效治理后的叙事收编处 |
| `USAGE.md` | force-play | 使用说明 | 上手用，非规约 |
| `ui-design-main-panel.md` | force-play | 主控面板 UI 设计说明（P0–P5 令牌化计划） | 设计参考，引用已废弃文件处已更正为域文件 |
| `docs/_archive/prototype.html` | force-play | 面板原型（可浏览器打开，**已归档**至 `_archive/`） | 设计可视化 |
| `design-gentle-polite-mode.md` | force-play | 温和模式设计稿（含本地题库符号迁移记录） | 设计参考 |
| `code-review-2026-08-09.md` | force-play | 2026-08-09 全量代码评审快照 | 历史评审结论 |
| `code-review-contract-2026-08-09.md` | force-play | 同日契约专项评审（D1–D4/D12 的取证过程） | 契约缺陷溯源 |
| `script-direction-review.md` | force-play | 脚本方向性复盘（做什么/不做什么） | 需求取舍时参考 |
| `docs/_archive/element-dump-research.md` | force-play | 页面元素 dump 取证方法调研（**已归档**至 `_archive/`） | 配合 `calibration-guide.md` 取真实 DOM |
| `error-handling-framework.md` | force-play | 错误处理框架指针（实现位置见 `CONTRACT.md` §7.2 错误卫士原语 / `guard.js` / `toolkit` 守卫） | 改错误处理逻辑时读 |
| `CONTRACTS.md` | force-play | **已废弃的重定向占位**，内容并入 `CONTRACT.md` §7–§9 | 仅防历史链接失效 |
| `STAGES.md` | cx_crawler | 爬虫分阶段设计（长文档，按章节跳读） | 感知子系统设计 |
| `crawler-framework-architecture.md` | cx_crawler | 爬虫框架整体架构 | 感知子系统架构 |
| `reviews/` | force-play | 10 份代码/安全评审快照 | 见 `reviews/README.md` 归类（当前有效方案 vs 历史归档） |
| `TASK_HISTORY.md` | force-play | 任务历史归档：已完成任务按时间倒序记录（含改动文件与实跑验证证据），配套 `TASKS.md` | 查某任务何时完成、怎么做的 |

---

### 阅读路径
1. 第一次接手 / 要加新功能 → 读 🔴 `ARCHITECTURE_GOVERNANCE.md` → 细节查 🔴 `references/split-gotchas.md`。
2. 排查某次历史改动或看设计 → 翻 🟢 对应文件。
