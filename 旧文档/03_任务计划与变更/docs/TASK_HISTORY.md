# 任务历史（已完成归档）

> 已完成任务从 `docs/TASKS.md` 迁移至此（含验证证据）。当前活跃任务见 `docs/TASKS.md`。

---

## TEST-1 · sim-quiz-popup.js 预存失败根因修复（2026-08-14 完成）
- **根因**：测试使用了早已不存在的选择器方案（`.dialog/.question-item/.choice/.submit-btn`）调 `chaoxingTickQuiz`（仅扫 `div.TiMu` 等 exam 容器），两者在当前架构下都不匹配——`chaoxingTickQuiz` 只处理考试页，弹窗路径实际由站点无关的 `popupQuizTick`（允许站点）承担。8 项断言全因 `chaoxingTickQuiz` 找不到 popup 题块返回 0 而失败。
- **修复**：重写 `sim-quiz-popup.js`，对准当前 `popupQuizTick` + `POPUP_QUIZ` 选择器 + `_pqIsDialogCandidate` 候选判定，断言改为真实行为（允许站点作答+关闭 / 同指纹去重不重复作答 / 不同指纹可重复处理 / `cx_popup_quiz=0` 与 `cx_popup_block=1` 静默关闭不作答 / 非允许站点零副作用 / 非弹窗节点不被误删）。注意 `popupQuizBlock` 返回已关闭计数（≥1），故「关开关」断言「已关闭且不作答」而非「返回0」。
- **验证**：`sim-quiz-popup.js` 22 断言全 PASS；全量 `_sim` 套件 57/57 绿；`sim-popup-block.js` 保持绿（弹窗屏蔽路径未回归）。
- **改动范围**：仅测试文件 `_sim/sim-quiz-popup.js` 重写，零生产代码改动。

## TEST-2 · verify_fixes.js 预存失败根因修复（2026-08-14 完成）
- **根因**：三项失败均属「修复标记文案过时、修复本身在位」——
  1. `scanVideos_hostSigs`：产物 `scanVideos` 签名已为 `scanVideos(root, hostSigs, depth, incremental)`（4 参），测试却查 3 参子串 `scanVideos(root, hostSigs, depth)`（带 `)`）→ 不匹配；
  2. `answer_letter_to_idx`：字母→索引改用 `charCodeAt(0) - 65`（产物 L2473），标记仍写旧 `A: 0, B: 1, C: 2, D: 3`；
  3. `tg_double_timer_fix`：`_tgTimer` 在位，但注释为「避免双重调度」非「防止双重启动」。
- **修复**：更新 `verify_fixes.js` 三处标记为当前实际实现片段（`scanVideos(root, hostSigs, depth,`、`charCodeAt(0) - 65`、`避免双重调度`）。
- **验证**：`verify_fixes.js` `ALL_FIXES_VERIFIED`（15/15）；全量 `_sim` 套件 57/57 绿。
- **改动范围**：仅测试文件 `_sim/verify_fixes.js` 标记更新，零生产代码改动。

## ITER-4.19.49 · 诊断反馈驱动 9 组修复（2026-08-28 完成，v4.19.50 翻版收尾）
- **驱动**：用户连续 6 轮真实诊断反馈（信号灯完成态 / DS 控制台 UI / 提示流并入复制诊断 / 诊断全面性 / 应答端与课程页双端问题 / 视觉答题红灯与重复作答）。
- **交付**（详见 `docs/CHANGELOG.md` v4.19.49）：
  1. 信号灯完成态——视觉 hold 补挂 `_quizPendingSubmit`、dsMode 超时解占坑让红灯语义生效、settle/onFail 幂等断言 `_quizHandled`；
  2. DS 应答端控制台 UI 现代化（状态卡/对话式最近交互/遥测 chips/异常条，全走令牌随深色模式）；
  3. 提示流并入复制诊断——`_toastFeedLog` 环形缓冲 + `toastFeedRecent`/`pushToastFeed` 公开接口，订阅提前到模块加载（面板未打开也记录）；
  4. 诊断全面性补全——同源帧数、QUIZ配置行（自动提交/CDN授权/答案源）、题库规模，[8] 新增「各帧答题」概览行 + MO 判定改 sched 源（修「MO=未挂载」伪信号）；
  5. DS_LAST_ANSWER 截断 48 字符（原来内联 500+ 字思维链撑爆诊断）、应答器落提示流、[11] 分区归属修正、应答端页主循环不启动；
  6. `_dsParseAnswer` 三重缺陷（置信结构规则 / 语义分支 ≤12 字符重写 / 否定词全文优先）+ dsMode 视觉超时恒 90s + 发题代际 `_quizVisGen` 防重复作答（settle/onFail/一级与二级超时定时器全链代际校验）。
- **验证**：`_sim` 80/80、`pure.test` 52/52、构建全门禁（契约 doc 208 符号）、sim-ds-parse 50 断言（含真实失败文本回归）。
- **收尾**：v4.19.50 仅为版本号翻版（无行为变更），三处一致；开源镜像已同步。
- **遗留阻塞**：P1-3 / P1-13 / H7（真实站点选择器校准）——恢复条件已降级为「题目停留在页面时的复制诊断」（[8] 各帧答题行可区分「未扫描=选择器未命中」vs「扫到未答=状态机」），待用户真机复测后提供。
