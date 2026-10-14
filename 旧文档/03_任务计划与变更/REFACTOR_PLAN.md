# 重构方案：网课强制续播（chaoxing-force-play）

## 0. 现状与硬约束

- **单文件产物**：`ecosystem/chaoxing-force-play.user.js` 由 `build-force-play.ps1` 把 `src/chaoxing-force-play/**` 按顺序拼接进**一个共享 IIFE 闭包**（函数声明 hoist，顺序仅影响极少顶层语句）。这是 Tampermonkey 运行时的硬约束——浏览器里只能是一个 `.user.js`，**无法引入运行时模块系统**。
- **四个能力域**：`takeover`（foundation/engine/dom/bootstrap）、`sites`、`plugins`、`presentation`，共约 55 个 JS 文件。
- **已有的好基础**（保留，不推翻）：
  - 构建有显式顺序 + 孤儿文件反向校验（任何新文件不登记就直接抛错，`build-force-play.ps1` 120–133 行）。
  - 模块头统一 `// ===== MODULE: ... =====` 标注。
  - 站点隔离走 `SITES`/`detectSite()` 地图（`takeover/foundation/site/site-router.js`）。
  - 工具库项注册契约 `__cxRegisterAddon/__cxRegisterCommand`。

## 1. 实证出来的可维护性问题

| # | 问题 | 代码证据 |
|---|------|----------|
| 1 | **跨模块耦合风格混乱**：核心循环同时用「裸函数名」和「命名空间调用」两种风格，依赖关系不可见、易漏改 | `main-loop.js` 77–104 行：裸调 `icourse163TickQuestions()`、`chaoxingTickQuiz()`，却又 `window.__CX_FORCE_PLAY.zhihuishuExamTick()` |
| 2 | **站点调度 if/else 长链**：每加一个平台就要改核心文件，且易漏掉某一分支 | `main-loop.js` 77–104 行 9 个 `else if (_site === ...)` |
| 3 | **注释编号体系有效但碎片化**：`审查#5 / JS-幂等 / F-B4 / M1 / H3 / P5c / 诊断#七` 等编号其实**有**追踪系统（`docs/code-annotation-history.md` 映射表、`docs/ARCHITECTURE_GOVERNANCE.md` §8「必须保留」清单、`CODE_AUDIT.md`/`CODE_REVIEW.md` 的 `[H1]~[M3]`、`docs/CHANGELOG.md` 的 `F-B1/F-B4`）。问题是**散落多份文档、无单一术语表**，且代码标签与文档条目未双向链接，新人难查。⚠️**不能删标签**（删则丢防回归不变量，GOVERNANCE 已明令必须保留） | `state.js` 1–9 行、`quiz.js` 59 行（M1）、`core.js` 5 行（审查#5） |
| 4 | **27 版变更塞进一行**：`@description` 单行长 2KB，可读性差 | `meta.js` 第 6 行 |
| 5 | **无模块依赖声明**：构建顺序靠人工维护的 `$domainRel` 全量清单（57–111 行），新文件必须手动登记 | `build-force-play.ps1` |
| 6 | **名不副实**：`Store` 实为事件总线（`state.js` 1–9 行自承「名实校准」）；addon 幂等全局散落 `window.__cxAutoNextStarted` 等 | `auto-next.js` 18–23 行 |
| 7 | **命名不统一**：`FLAGS / CONST / CONFIG / __cx* / _quizX / TARGET` 混用，常量散落多域 | 全局 |
| 8 | **无构建门禁**：测试在 `_sim` 独立目录，构建脚本不跑测试，合并即可能回归 | `build-force-play.ps1` |

## 2. 重构方案（分阶段，均向后兼容、可逐步合并）

### Phase 0 — 基线防护（低风险，先落地）
- 引入 `.eslintrc`（基于 `eslint:recommended` + 针对本项目的规则）与 2-space 格式化配置，让风格可机检、可自动修复。
- 把 `meta.js` 第 6 行 27 版变更迁移到新建 `CHANGELOG.md`，`@description` 仅留一句话。
- **保留**所有注释标签（实证：它们已被 `docs/code-annotation-history.md` / `docs/ARCHITECTURE_GOVERNANCE.md` §8 追踪，删则丢防回归不变量）；Phase 0 只做**合并术语表**——把 `CODE_AUDIT.md`/`CODE_REVIEW.md`/`code-annotation-history.md`/`ARCHITECTURE_GOVERNANCE.md` 中重复的编号定义收敛到**单一** `docs/CODE_REVIEW.md` 的「术语/编号表」，并让代码标签改为指向文档（如 `// 见 CODE_REVIEW.md H3`）。不删标签、不改行为。

### Phase 1 — 显式模块契约（收益最大，中低风险）
- 确立 **`window.__CX_FORCE_PLAY` 为唯一模块注册表**。每个模块末尾统一暴露公共 API（仿 `Store` 的 `window.Store = Store` 写法）：
  ```js
  window.__CX_FORCE_PLAY.sites = window.__CX_FORCE_PLAY.sites || {};
  window.__CX_FORCE_PLAY.sites.icourse163 = { tick: icourse163TickQuestions };
  ```
- 把裸跨文件调用（`icourse163TickQuestions()` 等）收敛为 `__CX_FORCE_PLAY.sites.icourse163.tick()`，依赖关系变得可追溯。
- **站点调度改注册表驱动**：各站点模块加载时 `registerSiteTick(site, fn)`，核心循环只调用 `getSiteTick(detectSite())?.()`，**消除 `main-loop.js` 77–104 的 if/else 长链**，新增平台不再改核心文件。

### Phase 2 — 构建现代化（中风险）
- 用「**每域按目录自动发现 + 域内 `ORDER` 文件/标记排序**」替代手写 `$domainRel` 全量清单；保留孤儿校验但改为「发现未登记模块时给出友好提示 + 要求显式置顶」，降低新增文件成本。
- 构建后自动跑 `node --check` 全量语法校验（已有 `node_home/node-v20.19.0`）；加 CI/pre-commit 门禁跑 `_sim` 测试。
- 同步更新 `check-module-size.ps1` 的 `$deprecated` 列表（与构建脚本保持一致，已在注释里点明）。

### Phase 3 — 命名与结构收敛（低风险）
- `Store` 改名 `EventBus`（或保留名但补文档讲清它是总线）；addon 幂等全局（`__cxAutoNextStarted` 等）收敛进各自模块对象。
- 常量集中：`CONST / CONFIG / FLAGS` 收口到 `takeover/foundation/meta-config`；站点 selectors 补齐进 `SITES`（已完成大半）。
- 抽取 quiz 纯函数（如 `quiz-merge.js` 已标注「纯函数可单测」）补单测，提升覆盖率。

### Phase 4 — 可选：真·模块构建（高风险，需评估）
- 引入 **esbuild / rollup** 把 `src` 当 ESM 源，构建时打包成单 IIFE（保留单文件安装体验），从而获得真正的 `import/export`、tree-shaking、JSDoc/TS 类型检查。
- 代价：改动构建链；需验证 Tampermonkey 注入、`@grant GM_*` 与跨 frame 行为不受影响。
- 建议：仅在 Phase 1–3 完成、接口稳定后再评估，不作为首步。

## 3. 建议落地顺序

**Phase 0 + Phase 1 优先**——契约化是后续一切的基础，且向后兼容、风险低、不改动单 IIFE 产物形态。Phase 2/3 在其上渐进推进。Phase 4 视需要再定。

> 关键原则：**不破坏"单 IIFE 产物"这一硬约束**，所有重构都在拼接构建框架内做结构治理，确保 `chaoxing-force-play.user.js` 仍是可直接安装的单文件、行为零回归。
