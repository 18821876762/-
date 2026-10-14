# 任务区（当前活跃任务）

> **用途**：存放当前迭代待推进 / 延后的任务。与之配套的历史归档见 `docs/TASK_HISTORY.md`（已完成任务迁移至此）。
>
> **管理规则（务必遵守）**：
> 1. 新任务直接追加到本文件对应分组（待实施 / 阻塞·延后）。
> 2. 任务**完成后**：从本文件删除该任务条目，并将其「完成记录」追加到 `docs/TASK_HISTORY.md`（含验证证据）。
> 3. 本文件**始终保持为「下次任务」的容器**——即使临时清空，也只清空已完成的，不删除本规则说明，便于下一轮任务续接。
> 4. 阻塞 / 延后项同时维护在 `docs/DEFERRED_TASKS.md`（更完整的阻塞原因与恢复条件），二者交叉引用即可，详情不重复。
> 5. 任务 ID 沿用 `OPTIMIZATION_PLAN.md` 的 P/H 编号，避免跨文档漂移。

---

## 一、待实施（可开工）

### P1-3 · DeepSeek 应答端真机契约校准
- **入口**：`src/chaoxing-force-play/takeover/engine/vision-deepseek-web.js`、`engine/quiz-vision.js`
- **内容**：输入框/发送/回复/生成中 DOM 驱动 + `QUIZ_VISION_ENDPOINT` 契约待真实站点校准；补 `ds-ask` 端到端重试退避 + 生成中超时熔断 + 失败回随机兜底（对齐 `quiz.js` 的 `_quizAIPending`）。
- **阻塞**：需真实站点 DOM dump（同 H7；v4.19.49 起应答端页诊断 [15] 提示流 + [9] 数据循环已可定位 responder 驱动卡点，恢复条件见 H7 降级说明）。
- **状态**：pending

### P1-13 · 真机选择器回归纳入 CI
- **入口**：`_sim/sim-quiz-selectors.js` + `fixtures/` 样本；CI 配置 `.github/workflows/ci.yml`
- **内容**：把真机 HTML fixture 选择器命中率设为 CI 必跑项，阻断选择器漂移致真机失效。
- **阻塞**：依赖 **H7** 的 `fixtures/` 框架与样本（无 dump 则无 fixture）。
- **状态**：pending

---

## 二、阻塞 · 延后（详见 `docs/DEFERRED_TASKS.md`）

### H7 / P0-1 · 真实站点选择器校准 + fixture 框架
- **内容**：各平台 best-effort 选择器真机命中率校准；新增 `_sim` fixture 框架 + 各站 `selector-wins.md`。
- **阻塞原因**：必须依赖用户提供的真实 DOM dump，无法伪造。
- **恢复条件（v4.19.50 起已降级）**：用户只需在**题目停留在页面上**时复制一次诊断即可开工——v4.19.49 新增的 [8]「各帧答题」行可直接区分「扫 0/答 0=选择器未命中（H7 域）」vs「扫 N/答 M·重扫中=状态机/DS 挂起」，据此决定先校准选择器还是先修状态机；若能再附 `_pqQueryAll` 兜底 dump（任意调试工具导出题目容器 HTML）则直接校准。
- **级联阻塞**：P1-13 依赖本项。
- **状态**：⏸ 延后（pending，等「题目停留时」的诊断/dump）

### P2-5 · 宽泛选择器收敛（守护已加，收窄待 H7）
- **入口**：`quiz.js:20-26` 的 `QUIZ` 选择器并集，重点在 **document-wide 的 `questionSels` 宽属性选择器** `li[class*="question"]` / `[class*="quiz-item"]` 命中宿主容器。
- **已做（2026-08-14）**：补运行时守护 `_sim/sim-quiz-selectors-guard.js`，锁定当前各模式（含宽属性选择器）仍能「定位题块 + 作答 + 点提交」，后续收窄若误删模式会立刻报红。
- **待做**：实际收窄依赖真实站点 DOM（**H7** 根阻塞）。注：任务原写「`[class*=title]`」实为 stemSels，而 stemSels 在 `quizTick` 内已按「题块容器 > stem」作用域限定（见 quiz.js `_quizSubmit`/`qEl.querySelector`），收敛收益集中在 document-wide 的 `questionSels`；真机应使用哪个窄模式须 H7 dump 校准，否则有「破坏真机命中」风险。
- **状态**：guard 完成；收窄 ⏸ 延后（依赖 H7）
- **交叉引用**：H7

### P3 · 调试分支剔除（构建时剥离 DEBUG）
- **状态**：⏸ 延后（待决策，剥离会破坏运行时调试开关）
- **恢复条件**：用户明确接受「牺牲运行时调试开关换产物精简」，或改 dev/minify 双轨。

### P4 · 站点模块按需拆 `.user.js`
- **状态**：⏸ 延后（高风险，Phase 4 可选）
- **恢复条件**：接口稳定后先以「单仓库多 entry + 构建器仍产出单 bundle」试点。
