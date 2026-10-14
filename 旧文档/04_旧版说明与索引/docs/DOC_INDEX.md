# 文档总索引（DOC_INDEX）

> **用途**：本仓库全部规划/评审/规范类文档的统一导航与分类。配合 `docs/TASKS.md`（活跃任务）、`docs/DEFERRED_TASKS.md`（延后任务）、`docs/TASK_HISTORY.md`（已完成归档）使用。
>
> **分类口径**（7 类）：临时 · 历史 · 规则 · 核心 · 需求 · 任务(未完成) · 已完成。
> **维护规则**：
> 1. 新增文档先归入下表对应类别；长期文档放 `docs/`，散落根目录的评审稿应归并到 `docs/reviews/`。
> 2. ⚠ 标记 = 与其他文档内容重复/版本冗余，**不删除**（本仓禁用清理式删除），待人工合并后保留唯一权威版。
> 3. 临时文档统一放 `docs/_archive/`，结论落地后由作者归档或丢弃。

---

## 一、临时文档（docs/_archive/）
| 文件 | 说明 | 状态 |
|------|------|------|
| `docs/_archive/_sim_run.log` | 构建运行日志（过程产物，每次构建重写） | 可随时丢弃 |
| `docs/_archive/prototype.html` | 主控面板原型草稿 | 原型定型后可删 |
| `docs/_archive/element-dump-research.md` | DOM dump 调研草稿 | 结论吸收后归档 |

## 二、历史类文档（评审/审计报告）
> 评审驱动留痕。根目录与 `docs/reviews/` 存在同名/同内容冗余，建议合并为唯一权威版。

**根目录（建议归并到 `docs/reviews/`）**
| 文件 | 说明 | 重复/权威提示 |
|------|------|------|
| `CODE_REVIEW.md` | 代码评审主文档（当前状态汇总） | 权威主档 |
| `CODE_REVIEW_FULL.md` | 完整评审报告 | ⚠ ≈ `docs/reviews/code_review_full.md`（同名大小写，勿物理移动防覆盖） |
| `CODE_REVIEW_RESULT.md` | 评审结果 | — |
| `code-review-report.md` | 评审报告(kebab) | ⚠ ≈ `docs/reviews/code_review_report.md`（内容疑似重复） |
| `CODE_AUDIT.md` | 安全/代码审计主文档 | 权威主档 |
| `CODE_AUDIT_REPORT_2026-08-14.md` | 2026-08-14 审计报告 | 最新审计 |
| `CODE_REVIEW_2026-08-10.md` | 每日评审(08-10) | 历史留痕 |
| `CODE_REVIEW_2026-08-11.md` | 每日评审(08-11) | 历史留痕 |
| `CODE_REVIEW_2026-08-12.md` | 每日评审(08-12) | 历史留痕 |
| `CODE_REVIEW_2026-08-13.md` | 每日评审(08-13) | 历史留痕 |

**docs/**
| 文件 | 说明 |
|------|------|
| `code-review-2026-08-09.md` | 08-09 评审 |
| `CODE_REVIEW_DETAILED.md` | 详细评审 |
| `CODE_REVIEW_ALL_20260819.md` | 全量代码检查报告（2026-08-19：工具链全绿 + 模块大小门禁 9 文件超限 + 版本表漂移） |
| `CODE_REVIEW_RESULT_20260810.md` | 08-10 评审结果 |
| `code-annotation-history.md` | 代码批注历史 |
| `script-direction-review.md` | 脚本方向评审 |
| `code-review-contract-2026-08-09.md` | 评审契约(08-09) |
| `code-review-prompt.md` | 评审提示词 |

**docs/reviews/**
| 文件 | 说明 |
|------|------|
| `code_review_full.md` | 完整评审（⚠ 与根 `CODE_REVIEW_FULL.md` 同名） |
| `code_review_report_2026.md` | 年度评审报告 |
| `code_review_report.md` | 评审报告（⚠ 与根 `code-review-report.md` 疑似重复） |
| `force_play_review_333_new.md` | 强制续播评审(333) |
| `force_play_review.md` | 强制续播评审 |
| `workspace_code_review.md` | 工作区代码评审 |
| `security_review.md` | 安全审查（含 P1–P4 加固记录，最新权威） |
| `refactor-force-play-coupling-plan.md` | 重构耦合计划 |
| `remediation-plan.md` | 修复计划 |
| `review_validation_result.json` | 评审校验结果(数据) |

## 三、规则类文档（契约/规范/许可）
| 文件 | 说明 |
|------|------|
| `CONTRIBUTING.md` | 贡献规范 |
| `LICENSE` | 许可证 |
| `NOTICE.md` | 法律声明 |
| `docs/ARCHITECTURE_GOVERNANCE.md` | 架构治理规范 |
| `docs/CONTRACT.md` | 跨模块契约 |
| `docs/CONTRACTS.md` | 契约清单 |
| `docs/CROSS_MODULE_CONTRACT.md` | 跨模块契约(总) |
| `docs/error-handling-framework.md` | 错误处理框架 |
| `docs/references/split-gotchas.md` | 脚本拆分踩坑/规范 |

## 四、核心文档（架构/设计/使用）
| 文件 | 说明 |
|------|------|
| `README.md` | 仓库主说明（根） |
| `PERFORMANCE_ANALYSIS.md` | 性能分析（核心参考，含优化点 1–6 落地状态） |
| `docs/README.md` | 文档区索引（旧，本文件为其升级版） |
| `docs/ARCHITECTURE.md` | **系统架构图与设计文档（分层/模块/数据流权威）** |
| `docs/QUIZ_PIPELINE.md` | **自动答题链路权威细颗粒文档**（检测→信号灯→视觉→DS 通道→解码→解析→提交识别→出清治理；v4.19.x 修复矩阵 + 故障排查） |
| `docs/PROMPT_ACCURACY_RESEARCH.md` | 视觉答题提示词/置信分级准确率研究（v4.19.31/4.19.32 依据） |
| `docs/USAGE.md` | 使用说明 |
| `docs/design-gentle-polite-mode.md` | 温和礼貌模式设计 |
| `docs/design-multi-web-ai-responder.md` | 多网页 AI 应答端设计 |
| `docs/ui-design-main-panel.md` | 主控面板 UI 设计 |
| `docs/crawler-framework-architecture.md` | 采集框架架构 |
| `perception/README.md` | 感知/采集模块说明 |

## 五、需求类文档（计划/提案/需求）
| 文件 | 说明 |
|------|------|
| `OPTIMIZATION_PLAN.md` | 优化计划（P/H 任务编号源） |
| `REFACTOR_PLAN.md` | 重构计划 |
| `docs/CRAWLER_REQUIREMENTS.md` | 采集需求 |
| `docs/calibration-guide.md` | 选择器校准指南 |
| `docs/PERF_OPTIMIZATION_PROPOSAL.md` | 性能优化提案 |
| `docs/REFACTOR_CROSS_MODULE_DUP.md` | 跨模块重复重构 |
| `docs/STAGES.md` | 阶段计划 |
| `docs/remediation-plan.md` | 修复计划（见历史类，亦属需求） |
| `docs/decision/README.md` | 决策记录 |
| `docs/reviews/refactor-force-play-coupling-plan.md` | 强制续播耦合重构计划 |
| `perception/cx_crawler/*.md`（2） | 爬虫需求/实现说明 |

## 六、任务类文档（未完成）
| 文件 | 说明 |
|------|------|
| `docs/TASKS.md` | 活跃任务：P1-3、P1-13 待实施；H7/P2-5/P3/P4 阻塞·延后 |
| `docs/DEFERRED_TASKS.md` | 延后任务详因（H7、P3、P4） |

## 七、已完成文档
| 文件 | 说明 |
|------|------|
| `docs/TASK_HISTORY.md` | 已完成任务归档（TEST-1、TEST-2，含验证证据） |
| `docs/CHANGELOG.md` | 变更日志（已完成工作记录） |

---

## 优化分布建议（下一步，待确认再执行）
1. **合并历史冗余**：根 `CODE_REVIEW_FULL.md` 与 `docs/reviews/code_review_full.md`、`code-review-report.md` 与 `code_review_report.md` 择一为权威版（Windows 大小写不敏感，**勿用物理移动覆盖**，须人工比对后保留唯一）。
2. **根目录瘦身**：将根 10 个评审/审计稿迁至 `docs/reviews/`（避开同名项），根仅留 `README.md`/`LICENSE`/`NOTICE.md`/`CONTRIBUTING.md` 等门面文件。
3. **索引升级**：本文件取代 `docs/README.md` 作为文档唯一导航入口。
