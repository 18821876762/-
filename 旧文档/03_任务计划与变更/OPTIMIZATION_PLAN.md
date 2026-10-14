# 网课强制续播 · 优化方案（2026-08-12）

> 范围：`ecosystem/src/chaoxing-force-play/*`、`ecosystem/build-force-play.ps1`、`ecosystem/_sim/*`、`perception/*`
> 目标：在「已修复 2026-08-11 审查项」基础上，给出**剩余 + 新增**的高价值优化清单。
> 交付：分析报告 + 可执行优先级清单（未直接改代码，待确认后落地）。

> **状态更新（2026-08-12 本会话后）**：下方 §1–§4 的多项已在**本会话实际完成**，并经全量构建（`node --check` / `_sim 47/47` / `eslint` / 契约 / 元数据 全 PASS）+ Python 单测（12 tests OK）验证无回归。交叉对照如下：
> - ✅ **P2-9（§2.5 save_cookies domain）** = 本会话 H5：`session.py` 已从 `s.cookies` 取真实 `domain/path` 落盘（`PY_OK` + `TestSaveCookies` 守护）。
> - ✅ **P0-12（§6 Python 单测）** = 本会话 H6：新增 `TestSaveCookies`（12 tests OK，含 domain 回归）。
> - ✅ **P2-10（§4.5 注释清理）** = 本会话 H3：代码 `[历史]` 前缀全仓 0 命中 + 术语归一（`主脚本→核心脚本`，历史归档按不篡改原则保留）。
> - ✅ **P1-7（§4.3 bundle lint）** = 本会话 H8：`build-force-play.ps1` 已对**构建后 bundle** 跑 ESLint + 强制单配置。
> - ✅ **P1-2（§4.2 选择器 DRY 中央化）** = 本会话 H1：`sites/quiz-selectors.js` 四站工厂 + `popup-quiz.js POPUP_BASE` 已落地。
> - ⚠️ **P1-6（§4.4 超大函数拆分）**：前提已失效——`quiet-popups.js` 现仅 42 行（非报告所称 ~207 行）；`buildPanelHTML` 拆分会破坏 `divcheck.js`/`hiercheck.js` 源码级 div 配平校验，故**不推进**（详见 `docs/DEFERRED_TASKS.md`）。
> - 仍待实施：P0-1 / P1-3 / P1-4 / P2-5 / P1-11 / P1-13 / P2-8。其中 **P0-1（真实站点选择器校准）= 延后项 H7**，阻塞于真实 DOM dump；**§4.3 的 esbuild/rollup 选型 = 延后项 P4**；二者均记入 `docs/DEFERRED_TASKS.md`。

---

## 0. 已落地（回顾，避免重复投入）

第二批已修复并 PASS 测试，本次不再列入：

| 项 | 修复内容 |
|---|---|
| §4.1 | 新建 `foundation/storage/keys.js`，28 个 `cx_*` 键名中央常量，替换 15 文件 |
| §1.1 | `zhihuishu-exam.js` 可观测降级：DS 未连/非答题页时 `EventBus` 发诊断，FAB 显示原因 |
| §3.1 | `_quizFingerprint` 用 `__cxFp/__cxFpVer` 缓存 + 内联 `_doneInTick` 消除二次遍历 |
| §1.3 | `_pqStormGate`：10s 关 >8 弹窗 → 风暴断路器，暂停 30s |
| §1.2 | 双数据源开关归一（统一引用 `CX_KEYS.QUIZ_AUTO_SUBMIT`） |
| §5.1 | `bridge.py` 加 `--auth-token`/Bearer 鉴权 + 非 localhost 警告 |
| §1.4 | `api_client` 429 处理经 `Retry-After` + `@with_retry` 退避，已覆盖 |

**现状结论**：运行时性能、可观测性、安全基线已较好；剩余风险集中在**选择器真机校准**、**选择器/逻辑 DRY 收口**、**超大函数拆分**、**构建/测试效率**四处。

---

## 1. 答题引擎 / 识别准确率（最高价值）

### P0-1 真实站点选择器校准（全仓最大盲区）
- **位置**：`sites/*.js` 的 `questionSels/stemSels/optionSels/submitSels`、`quiz.js:20-23`、`popup-quiz.js` 的 `dialogSels`、`zhihuishu-exam.js` 选项容器。
- **问题**：全部为 best-effort 并集（如 `[class*=title]`、`[class*="quiz-item"]`），真机命中率**完全未被自动化验证**（审查 §6 盲区①）。记忆反复标注"检测到 0 题需发真实 HTML 校准"。
- **方案**：
  1. 新增 `_sim` 真机 HTML fixture 框架：从真实站点 dump 的 DOM（脱敏）建 `fixtures/` 样本，在 jsdom 中验证选择器命中题数；
  2. 每个站点维护一份 `selector-wins.md` 记录"已校验选择器 + 样本来源版本"，CI 跑 `sim-quiz-selectors.js` 比对期望命中；
  3. 灰度策略：模糊选择器仅作兜底，精确属性选择器（`.topic-item` 等）优先，限定到已知容器子树（呼应 §3.2）。
- **收益**：把"能不能识别题目"从不可测变为可回归，直接提升答题正确率与用户信任。

### P1-2 完成选择器 DRY 中央化（§4.2 残留）
- **现状**：已新建 `sites/quiz-selectors.js`（manifest 第 34 行），但 `quiz.js`/`zhihuishu-exam.js`/`popup-quiz.js` 仍各自维护并集，逻辑高度雷同。
- **方案**：以 `quiz-selectors.js` 为单一事实源，导出 `defaultSelectors`；各站点用 `Object.assign({}, DEFAULT, siteOverride)` 合并覆盖。删除三处重复定义。
- **收益**：选择器改动只改一处，避免漂移；配合 P0-1 校准更易维护。

### P1-3 DeepSeek 应答端真机契约校准
- **位置**：`engine/vision-deepseek-web.js`、`engine/quiz-vision.js`。
- **问题**：DOM 驱动（输入框/发送/回复/生成中）与 `QUIZ_VISION_ENDPOINT` 契约均"待真实站点校准"。
- **方案**：加 `ds-ask` 链路端到端重试/退避（已有 `sim-ds-ask-retry` 范本，确认已接 `vision-deepseek-web`）；补充"生成中"超时熔断 + 失败回随机兜底（对齐 `quiz.js` 的 `_quizAIPending` 超时逻辑）。

---

## 2. 运行时性能（在 §3.1 之上再榨取）

### P1-4 答题扫描从"全量轮询"改为"MO 增量 diff"
- **位置**：`quiz.js` 的 `quizTick` + `quizObserve`。
- **现状**：§3.1 已缓存指纹版本，但每轮仍 `querySelectorAll` 走全部 10+ 选择器并集，再逐题读 `textContent` 比对。题目多（N=200）时每 2s 仍有可感知开销。
- **方案**：`quizObserve` 的 MutationObserver 缓存"上一轮题目节点列表"，仅在节点**增删**时重算新增节点指纹；`quizTick` 复用该增量集合，跳过稳定题。节点用 `WeakMap` 记忆指纹，文本未变不重算。
- **收益**：静态大题量页 CPU 进一步下降，主循环轮询对答题几乎零成本。

### P2-5 宽泛选择器收敛（§3.2 残留）
- **位置**：`quiz.js:20-23`、各 `dialogSels`。
- **方案**：`[class*=title]` 模糊匹配会误命中无关节点（仅放大计数噪声但增扫描量）。改为精确 `stem/title` 类名优先，模糊项限定到 `题目容器 > [class*=title]` 子树。

---

## 3. 代码架构与质量

### P1-6 超大单函数拆分（§4.4）
- **位置**：`plugins/addons/quiet-popups.js` 的 `setup`（~207 行）、`presentation/panel-template.js` 的 `buildPanelHTML`（大段 HTML 拼接）。
- **方案**：`setup` 拆为 `探测 → 绑定 → 调度` 三段；`buildPanelHTML` 按区块（视频控制/工具库/系统区/DS 控制台）拆小函数。
- **收益**：可单测、可复用；降低回归风险。

### P1-7 半段 IIFE 架构的单文件可测化（§4.3）
- **位置**：`takeover/bootstrap/core.js` 仅 24 行，IIFE 由构建闭合。
- **方案**（二选一）：
  - 轻量：CI 中对**构建后 bundle** 跑 ESLint + 语法门禁（当前 7 道门禁已含 eslint，确认 parserOptions 兼容即可）；
  - 彻底：迁移到 esbuild/rollup 保留模块边界 + tree-shaking（注意字符串契约 `__cxRegisterAddon`/`window.__CX_FORCE_PLAY.*` 须 preserve，构建脚本已注明不摇树）。
- **收益**：细粒度单元回归成为可能，调试栈函数归属清晰。

### P2-8 ensurePanel 守卫回归（§2.4）
- **位置**：`presentation/panel-core.js` `ensurePanel` 的 5 处 null 守卫。
- **方案**：补一条 `_sim` 用例，DS 控制台（缺 `#__cxPanelClose` 等）下 `ensurePanel` 不抛错；并断言守卫使用的 `CONFIG` 字段名确为 `RESUME_AFTER_MIN`（非 `AUTO_STOP_MIN`），防止守卫替换不匹配。

### P2-9 Python `save_cookies` 补全 domain（§2.5）
- **位置**：`perception/cx_crawler/session.py`。
- **方案**：新 cookie 以 `"domain": ""` 追加，部分 requests 版本忽略 → 补全 domain 或写入对应域名。

### P2-10 注释清理（§4.5）
- 对"已撤销/已完成修复"的注释加 `[历史]` 前缀或清理，避免误导后续维护。

---

## 4. 构建与测试效率（本地开发体验）

### P1-11 构建门禁并行化 + 开发快模式
- **位置**：`build-force-play.ps1` 第 196–366 行，7 道门禁**串行**，且每轮对 447KB bundle 跑整包 ESLint。
- **方案**：
  1. 无依赖的门禁（node --check / eslint / contract / metadata / contract-semantics）并行 `Start-Job` 执行，汇总失败；
  2. 新增 `-Fast` 开发开关：跳过整包 ESLint 与 `_sim` 全量，仅跑 `node --check` + 契约元数据（秒级本地反馈）；CI 仍跑全量。
- **收益**：本地改一处源码的"改→验"循环从秒级降到亚秒级。

### P0-12 Python 端补充单测（§6 盲区②）
- **位置**：`perception/cx_crawler/*`（登录/重试/限流/上传）。
- **方案**：用 `pytest` + `requests-mock` 覆盖 `api_client` 429 退避、`bridge.py` token 鉴权、`session.save_cookies` domain 补全。
- **收益**：当前仅 `py_compile`，逻辑错误无法自动发现。

### P1-13 真机选择器回归纳入 CI（呼应 P0-1）
- 把 `_sim/sim-quiz-selectors.js` + `fixtures/` 样本设为 CI 必跑项，阻断"选择器漂移导致真机失效"。

---

## 5. 优先级总览（建议执行顺序）

| 优先级 | 编号 | 项 | 方向 | 量级 |
|---|---|---|---|---|
| **P0** | 1 | 真实站点选择器校准 + fixture 框架 | 答题引擎 | 中 |
| **P0** | 12 | Python 单测 | 测试 | 中 |
| **P1** | 2 | 选择器 DRY 中央化收口 | 架构 | 小 |
| **P1** | 3 | DS 应答端真机契约 + 重试熔断 | 答题引擎 | 小 |
| **P1** | 4 | 答题扫描 MO 增量 diff | 性能 | 中 |
| **P1** | 6 | 超大单函数拆分 | 架构 | 小 |
| **P1** | 7 | 单文件可测化（bundle lint / 迁移打包器） | 架构 | 中 |
| **P1** | 11 | 构建门禁并行 + 开发快模式 | 构建 | 小 |
| **P1** | 13 | 真机选择器回归入 CI | 测试 | 小 |
| **P2** | 5 | 宽泛选择器收敛 | 性能 | 小 |
| **P2** | 8 | ensurePanel 守卫回归用例 | 架构 | 小 |
| **P2** | 9 | save_cookies domain 补全 | Python | 小 |
| **P2** | 10 | 注释清理 | 维护 | 小 |

**建议第一步**：先落地 **P0-1（选择器校准）** 与 **P0-12（Python 单测）**——二者是当前"正确性/正确性保障"的最大缺口，且彼此独立，可并行启动。

---

## 6. 待您确认

- 是否按上述 P0 启动实施（需要真实站点 HTML 样本 dump 才能校准选择器）；
- 构建方向选「bundle lint 轻量方案」还是「迁移 esbuild/rollup 打包器」（后者改动大但长期收益高）；
- 是否需要我直接动手落地其中某几项（选「直接改造」模式）。

> **本会话已直接落地**：P2-9 / P0-12 / P2-10 / P1-7 / P1-2 五项已按"直接改造"模式完成并验证（见顶部状态更新）。剩余待确认收敛为两点：① P0-1 需真实 DOM dump（=H7）；② esbuild/rollup 选型（=P4）。二者均记入 `docs/DEFERRED_TASKS.md`，等待您的材料或决策。
