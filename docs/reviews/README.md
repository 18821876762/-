# 评审归档索引

本目录是 force-play / 工作区的**历史评审快照**，非规约、非必读。按"当前有效方案"与"历史归档"归类，避免无头绪翻阅 10 份重叠报告。

## 当前有效方案（优先看这两份）
| 文件 | 内容 | 状态 |
|---|---|---|
| `refactor-force-play-coupling-plan.md` | 解耦重构方案（将单体 `core-biz.js` 拆为域文件） | ✅ 已执行，对应 `ARCHITECTURE_GOVERNANCE.md` 的分层 |
| `remediation-plan.md` | 遗留代码修复方案 | ✅ 规划/执行中 |

## 历史评审快照（归档参考）
> 以下多为不同时间点的整库/专项审查，内容高度重叠，仅作演进记录。

| 文件 | 主题 |
|---|---|
| `force_play_review.md` | 超星强制播放脚本代码审查 |
| `force_play_review_333_new.md` | 强制播放脚本代码审查（333 版） |
| `code_review_full.md` | 超星强制播放脚本完整代码审查 |
| `code_review_report.md` | 工作区代码审查报告 |
| `code_review_report_2026.md` | 代码审查报告（2026） |
| `workspace_code_review.md` | 工作区代码审查报告 |
| `security_review.md` | 安全审查报告 |

## 机器产物
| 文件 | 内容 |
|---|---|
| `review_validation_result.json` | 评审验证结果（结构化数据，非人读） |

## 建议
- 想了解"为什么这么拆" → 读 `refactor-force-play-coupling-plan.md`，再看 🔴 `ARCHITECTURE_GOVERNANCE.md`。
- 历史评审细节 → 按需挑一份，不必全读。
