# 文档总览 · 规则文档 vs 历史文档

本目录文档只分两类，便于快速定位：

- **🔴 规则文档（Rules）**：必须守的规约，改码前必读，保持精炼。
- **🟢 历史文档（History）**：设计稿、架构说明、使用手册、变更史、评审快照等累积资料，按需查阅、非必读。

> 涉及两套子系统，勿混：
> - **force-play 用户脚本**（`ecosystem/chaoxing-force-play/`）—— 规则文档治理的对象。
> - **cx_crawler 爬虫**（`perception/cx_crawler/`，Python）—— 独立的感知子系统。

---

## 🔴 规则文档（Rules）

| 文档 | 子系统 | 内容 | 何时读 |
|---|---|---|---|
| `ARCHITECTURE_GOVERNANCE.md` | force-play | 分类管理红线：分层、单文件行数上限、新功能归域流程、拆分约束 | **每次改码前** |
| `references/split-gotchas.md` | force-play | §4 拆分机械约束的细节：ASI 反例/正例、切片后校验清单（规则补充） | 拆分大文件时 |

> 规则文档只写"必须守的规则"，不堆细节；具体反例/正例/校验清单见上表第二份。

---

## 🟢 历史文档（History）

| 文档 / 目录 | 子系统 | 内容 | 说明 |
|---|---|---|---|
| `CHANGELOG.md` | force-play | 全量变更史（408 行） | 查某次改动细节时翻，不必通读 |
| `code-annotation-history.md` | force-play | 从代码迁出的版本徽标/历史叙述索引 + 保留的 why 约束清单 | 注释时效治理后的叙事收编处 |
| `USAGE.md` | force-play | 使用说明 | 上手用，非规约 |
| `ui-design-main-panel.md` | force-play | 主控面板 UI 设计说明（P0–P5 令牌化计划） | 设计参考，引用已废弃文件处已更正为域文件 |
| `ui-design/prototype.html` | force-play | 面板原型（可浏览器打开） | 设计可视化 |
| `STAGES.md` | cx_crawler | 爬虫分阶段设计（长文档，按章节跳读） | 感知子系统设计 |
| `crawler-framework-architecture.md` | cx_crawler | 爬虫框架整体架构 | 感知子系统架构 |
| `reviews/` | force-play | 10 份代码/安全评审快照 | 见 `reviews/README.md` 归类（当前有效方案 vs 历史归档） |

---

### 阅读路径
1. 第一次接手 / 要加新功能 → 读 🔴 `ARCHITECTURE_GOVERNANCE.md` → 细节查 🔴 `references/split-gotchas.md`。
2. 排查某次历史改动或看设计 → 翻 🟢 对应文件。
