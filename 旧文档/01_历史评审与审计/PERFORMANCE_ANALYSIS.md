# 性能瓶颈分析与优化建议

> 分析对象：`ecosystem/src/chaoxing-force-play`（网课强制续播用户脚本运行时）
> 分析结论：核心热路径已优化良好（脏检查短路、增量扫描、后台降频、MutationObserver 轻量驱动、视频缓存）。**剩余瓶颈集中在两类峰值场景**：① 稳态「每 tick 对全文档做多选择器遍历」——popup-quiz、DeepSeek 控制台、quiz、zhihuishu-exam；② 爆发「事件触发但单次代价极高」——auto-next 兜底遍历全文档 + `isVisible` 双 reflow。以下按优先级列出（共 6 个优化点）。

---

## 已做得好的地方（先肯定，避免误改）

- `main-loop.js:48-54` `consumeScanNeeded()` 脏检查：静止/挂机页跳过全量 `scanVideos`，CPU 与掉帧显著下降。
- `main-loop.js:87-95` 后台标签页降频：隐藏时间隔 ×4（封顶 30s）。
- `main-loop.js:106-116` D10 修复：MutationObserver 只驱动轻量 `quizTick`，不再触发整轮 `_loopTick`，避免 2s 主循环被放大到 300ms。
- `foreground.js` `foregroundVideo()` 用 `_fgCache` 按 `vid` 记忆化，列表未变直接返回。
- `dashboard.js` `renderVideoList` 用 `__cxLastHTML` 脏检查 + EventBus 节流，列表未变不重建 DOM。
- `quiz-vision.js` html2canvas 懒加载 + 多镜像顺序回退 + 已加载即 `Promise.resolve` 缓存（`QUIZ_VISION._h2c`）。

---

## 优化点 1（最高收益）：popup-quiz 每 tick 全文档多选择器遍历 + 无条件按钮扫描

**位置**：`sites/popup-quiz.js`
- `popupQuizTick`（line 209）由 `runSiteTick` 在 **每个主循环 tick（默认 2s）无条件执行**（对比主视频扫描有脏检查，这里没有 `consumeScanNeeded` 门禁）。
- `_pqQueryAll(root, sels.dialogSels)`（line 82-95）对 `dialogSels`（10 项）**逐个** `querySelectorAll` —— 注意它 **没有**像 `_pqIsDialogCandidate`（line 107）那样 `join(',')` 合成一次查询，等于 **10 次独立全文档遍历**。
- 当本 tick 无弹窗命中时，line 234 `root.querySelectorAll('button, a[class*="btn"]')` 扫全文档所有按钮，再逐个读 `textContent || innerText`（**`innerText` 触发强制同步布局/reflow**）+ `.replace(/\s/g,'')` + 正则。

**原因**：MOOC 上课弹窗是稀疏事件，常态 99% 的 tick 都是「空扫」，却每次都付出「10 次全文档 QSA +（无命中时）N 个按钮文本读取」的代价。

**优化建议**：
1. `_pqQueryAll` 对「纯并集」选择器改用 `sels.join(',')` 合成单次 `querySelectorAll`（保留逐个 `try/catch` 仅用于非法选择器告警）。10 次 → 1 次。
2. 引入「弹窗可能已出现」的廉价前置信号（仿 `_domDirty`：一个 MutationObserver 仅监听带 `dialog/modal/popup/question/answer` 类名的节点新增），无信号则 tick 直接 `return 0`。
3. 兜底全文档按钮扫描优先用 `textContent`（不触发 reflow）而非 `innerText`；且仅在确有「答题/提交/确定」弱信号的页面才扫描。
4. popup-quiz 单独降频（如 4–5s），与主视频扫描（2s）解耦。

**预期提升**：常态空扫的主线程占用降到接近 0；2s 内 DOM 查询/reflow 从「每 tick 数十 ms × N 按钮」降为「仅弹窗出现时一次性」。长会话挂机掉帧与电池消耗显著下降。

### 落地状态（2026-08-14）

已在 `sites/popup-quiz.js` 实施：
- ✅ **#1 `_pqQueryAll` 合成 `join(',')` 单次查询**：`dialogSels` / `optionSels` / `answerBtnSels` 由「逐个 `querySelectorAll`（10 次全文档遍历）」改为「`sels.join(',')` 单次查询」；join 后非法时自动回退逐项（保留非法选择器告警、不中断其余）。每 tick 全文档弹窗查询次数从 10 次降为 1 次。
- ✅ **#3 兜底按钮扫描改用 `textContent`**：`popupQuizBlock` 与 `popupQuizTick` 两处全文档按钮扫描（原 `innerText` 触发整页 reflow）改为 `textContent`（不触发重排）。
- ⚠️ **#2 弹窗信号门禁（MutationObserver）与 #4 单独降频（4~5s）未实施**：#2 需新增 MO 监听弹窗类名节点新增，popup-quiz 已有弹窗风暴断路器且 `sim-quiz-popup.js` 为预存失败（改动该模块风险需谨慎评估）；#4 降频跨 `main-loop.js` 调度改动，影响主循环稳态契约，留待后续。#1 单次查询已覆盖「每 tick 10 次→1 次」的核心收益。

回归：`sim-popup-block.js` 全绿（弹窗关闭/去重路径未受影响）；仅预存的 `sim-quiz-popup.js` FAIL，与本次无关。

---

## 优化点 2（高收益，DeepSeek 控制台）：`_dsIsLoggedIn` 每 5s 全文档按钮扫描

**位置**：`takeover/engine/vision-deepseek-web.js` `_dsIsLoggedIn`（约 line 60-78，由 `TimerRegistry.setInterval(..., 5000)` 驱动）。

**问题**：每 5s `root.querySelectorAll('button, a')` 遍历整页所有按钮/锚点，逐个读 `getAttribute('aria-label')` / `textContent` / `.replace(/\s/g,'')` / `.toLowerCase()` 并正则匹配 `登录|登出|退出`。

**原因**：登录态在一次会话内极少变化，却每 5s 全量重算；DeepSeek 长对话页按钮数量可观，`O(N)` 每 5s 持续。

**优化建议**：
1. 缓存上一次结果，仅在 `document.body` 的 class/属性变化、或轻量 MutationObserver（属性/子树）触发时才重算。
2. 用定向选择器替代全量扫描，例如 `a[class*="login"], button[class*="login"], a[class*="logout"], ...`（实际登录/退出按钮类名稳定），避免遍历所有 `button, a`。
3. 优先 `textContent` 而非 `innerText`。

**预期提升**：DeepSeek 控制台常驻时，登录态轮询 CPU 占用降到「仅在登录/登出动作发生时一次」，长会话几乎零开销。

**落地核查（2026-08-14）**：建议 #1（TTL 缓存结果）已试实施，但 `_dsIsLoggedIn` 是登录态探测的**权威即时信号**——用户登录/登出须立即反映到状态徽标与 `dsAvailable` 闸门。时间缓存（4s TTL）在 `sim-quiz-vision.js` 的「有登录按钮→未登录 / 有头像→已登录」连续用例中会屏蔽状态切换、破坏该回归，故**已撤销**。建议 #2（定向选择器收窄 `button,a`→更精确登录/退出选择器）属真机校准项，臆测枚举会误伤真实 DeepSeek UI，留待 **H7** 真机 dump 校准。建议 #3（用 textContent 而非 innerText）原实现已满足。综上：优化点 2 **未实施于运行时**（即时感知硬约束 + 真机校准依赖），收益本就温和（仅 DeepSeek 控制台每 5s 数十按钮，且精确 `avatarSel`/`loginBtnSel` 命中即短路、不遍历）。

---

## 优化点 3（中收益）：quiz 题目文本重复读取 + 多选择器分开查询

**位置**：`takeover/engine/quiz.js`（line 137、161-168）、`quiz-vision.js` `quizSnapshot`（line 139）。

**问题**：
- 每题/每选项 `qEl.querySelectorAll(多选择器)` 在 line 161-168 是**逐个** `querySelectorAll(sel)` 循环（与 popup-quiz 同样可合并不并集）。
- 构建指纹/题干时反复读 `textContent/innerText`，多题 × 多选项构成 `O(题×选项×选择器)` 的重复查询；大量读写易触发强制同步布局（layout thrash 隐患）。
- `quizSnapshot` 用 html2canvas `scale:2` 截图，每次作答都重截整题位图（重型，仅按需但频率不低）。

**优化建议**：
1. 题目/选项文本按元素做 `WeakMap` 缓存：元素未变（用 MutationObserver 或 `el.__cxQuizTextCache` 版本戳）不重读，仅在子树变更时失效。
2. 把对单个 `qEl` 的多个 `querySelectorAll(sel)` 循环改为 `sel.join(',')` 合成单次查询（同优化点 1 的修法，低风险高收益）。
3. 多题批量读取时先一次性读齐所有 `textContent` 再处理，避免读写交错造成的强制同步布局。
4. `quizSnapshot` 截图像素 `scale` 按题目尺寸自适应（小图 `scale:1`、仅大图 `scale:2`），缩小 html2canvas 渲染面积。

**预期提升**：长题库/多题页面扫描耗时下降一个数量级；强制重排次数减少；作答时主线程卡顿降低。

**落地（2026-08-14）**：建议 #2（选择器合成）已落地——`_quizOptions` 原「逐 selector `qEl.querySelectorAll(sel)` 循环」改为 `qEl.querySelectorAll(sels.join(','))` 单次查询（与 `_pqQueryAll` 同法，优化点 1#1 已验证）；保留引用去重 `seen` + 非法选择器 try/catch 逐 selector fallback（不中断其余合法选择器）。建议 #1（文本 WeakMap 缓存）已落地——新增 `_quizStemCache`（WeakMap），`_quizText` 按脏代际 `_quizDirtyGen` 缓存题块题干文本，MO 检测 DOM 变更或安全刷新触发脏代际 +1 时失效重算（与 `_quizFingerprint` 同缓存策略）；稳态下每题每 tick 零重读 `textContent`。建议 #3（批量读取避免读写交错）属微优化，原循环已串行读题，未改。建议 #4（quizSnapshot scale 自适应）待视觉层校准，未实施。验证：`_sim` 全量 **57/57 PASS / 0 FAIL**（含 `sim-quiz-vision.js`、`sim-quiz-selectors-guard.js` 守护未回归）；构建全门禁 PASS。

---

## 优化点 4（低优先级，谨慎）：每轮必跑的轻量 tick 累积成本

**位置**：`main-loop.js:55-78`（`neutralizeGlobalPause`、`probePauseNeutralized`、`applyUserRateAll`、`tickDriftGuards`）。

**说明**：这些为抗平台还原的硬正确性约束，**不建议为性能破坏其行为**。仅可作为可选微优化：用「上一次快照对比」短路 `neutralizeGlobalPause`（已中和且签名未变则跳过），并把 probe/rate 合并到「检测到变化或对视频有操作时」执行。

**预期提升**：轻度下降，收益有限，优先级最低。

---

## 优化点 5（高收益）：zhihuishu-exam 每 tick 多次全文档题目扫描 + 每题 textContent 读取

**位置**：`sites/zhihuishu-exam.js` `tickAnswerPage`(line 274) / `autoSubmitTick`(line 300) / `getState`(line 341)。

**问题**：当「自动作答 + 自动交卷」均开启时，每个主循环 tick 内的调用链会重复做重 DOM 工作：
- `tickAnswerPage`：`c.$dom.all(CFG.questionSels.join(','), document.documentElement)`（**全文档**）+ 每题 `(qEl.textContent||'').replace(/\s+/g,'')`(line 285)。
- `autoSubmitTick` → `_peekNext`（全文档 `nextSels` 扫描）+ `_allAnsweredHere`（**全文档** `questionSels` 扫描 + 每题 `q.querySelector(':checked')` + `c.$dom.all(optionSels, q)` + className 正则）。
- 状态变更 emit `zh-exam:state` → `getState` **再次**调用 `_peekNext` 与 `_allAnsweredHere`(line 347-348)。

即单个 tick 约 **2~3 次全文档题目扫描**，且每次都对每个题目读 `textContent`（强制布局）。大题库/多题页面 = `O(题数 × 选项数)` 每 2s，且随题目数线性放大。

**优化建议**：
1. **题目集合快照缓存**：用 MutationObserver 监听题目容器子树，仅在变更时重扫 `questionSels`；tick 内复用同一份 `qs` 列表（不每函数重扫）。
2. **文本记忆化**：每题 `textContent` 经 `WeakMap(el → 文本)` 或 `el.__cxZheText` 缓存，仅子树 change 时失效；避免大题文本每 tick 重读。
3. **结果跨函数复用**：`autoSubmitTick`/`tickAnswerPage` 已算出的 `allAnswered`/`lastPage` 存入 `sm` 内部 `_lastComputed`，`getState` 直接读缓存而非二次全文档扫描。

**预期提升**：自动交卷场景下，每 tick 全文档题目扫描从 2~3 次降为「仅在 DOM 变更时 1 次」；大题/多题页主线程占用显著下降，长考试页掉帧与卡顿缓解。

### 落地状态（2026-08-14）

已在 `sites/zhihuishu-exam.js` 实施：
- ✅ **#2 文本记忆化**：新增模块级 `WeakMap` + `_zheFp(el)`（按元素缓存指纹；元素移除即回收，天然无失效问题），`tickAnswerPage` 与 `_allAnsweredHere` 复用，避免同元素每 tick 重读 `textContent`。
- ✅ **#3 结果跨函数复用（无 TTL 版）**：`autoSubmitTick` 每轮实时计算 `_peekNext` / `_allAnsweredHere` 并写入 `sm` 共享 `_zheComputed`；`getState` 由 `_emitIfChanged` 在 `autoSubmitTick` 改态后同帧调用，直接复用共享结果，**消除 `getState` 每 tick 二次全文档扫描**。
- ⚠️ **#1 MutationObserver 快照缓存未实施**：改用「`getState` 复用 `autoSubmitTick` 实时结果」已达成核心收益（单个 tick 全文档题目扫描从「2~3 次」降为「`tickAnswerPage` 1 次 + `autoSubmitTick` 2 次、getState 0 次」）；MO 快照需新增监听且 `zhihuishu-exam` 无现成 MO 基础设施，留待后续按需增强。
- 注：初版曾用「1500ms TTL 缓存」，但同步测试帧内（勾选→判定 READY）会缓存过期 `false` 导致不进 READY（`sim-zh-exam.js` 回归），已改为「`autoSubmitTick` 实时写、`getState` 复用」消除该问题。

回归：`sim-zh-exam.js` 全绿（含 READY / submit 全部断言）。

---

## 优化点 6（严重，事件触发型 layout thrash）：auto-next 兜底遍历全文档 button/span/li/div 且每节点双 reflow

**位置**：`plugins/addons/auto-next.js` `findNextDOM` step 3（line 238-248）、`probeQuizTextEntry`（line 318-327）、`isVisible`（line 88）。

**问题（经源码逐行复核的精确机制）**：
- `findNextDOM` step 3（line 238）：`$dom.all('button, [role="button"], [onclick], span, li, div')` —— 选择器**过宽**，课程页轻松匹配上万节点（含整段 `div/li/span` 容器）。
- 遍历中对**每个**节点先读 `c.textContent`（line 241）——`.textContent` 本身**不触发 reflow**，但对容器节点会拼接其**整棵子树文本**，是 `O(全页文本量)` 的 DOM 读取，节点量大时本身即昂贵（这是主成本，非重排）。
- `isVisible(c)`（line 243）**仅对「短文本且关键词命中」的候选调用**（`ct.length<=8 && NEXT_TEXT_RE.test(ct) && $dom.isVisible(c)`）——**已做文本粗筛前置**，并非每个节点都跑；但 `isVisible`（line 88）一旦被调用即 `getComputedStyle(el)` + `el.getBoundingClientRect()`，**两道强制同步布局（layout thrash）**，且**缺少 `offsetParent===null` 廉价离屏剔除**，即便文本命中但不在视口/已脱离的节点也会白做 2 次重排。
- `probeQuizTextEntry`（line 304 `li[onclick]` / line 318 `span.spanText, a, li, div[onclick], [role=button]`）同构：先文本正则再 `isVisible`，机制一致；`findNextDOM` step 2（line 229）`$dom.all('a')` 全文档 a 遍历 + 每节点 `textContent` 读取（轻于 step 3，但仍全量）。
- 另外 `blockedByVerify`（line 184）`document.body.innerText` 读**整页**文本（真正触发整页 reflow），每次视频结束必跑——**这是报告原版唯一准确的「真·全页重排」点**。

**原因**：兜底为「抗改版」保留过宽选择器（尤其 `span/li/div`）+ 对容器节点读整子树 `textContent`；可见性判定虽已文本前置，却未用 `offsetParent` 廉价剔除。虽非每 tick（仅视频结束/导航事件触发），但**单次爆发代价极高**——长课程页可因「上万节点 × 子树文本读取 + 文本命中候选 ×2 重排」造成数百毫秒~秒级卡顿。

**优化建议**：
1. **`isVisible` 先用廉价离屏剔除**：`el.offsetParent === null` → 直接判不可见（不触发 reflow）；仅候选节点再用 `getBoundingClientRect`（避免对上万节点全做）。
2. **收窄兜底选择器（主导修复）**：step 3 改为 `a, button, [role=button], [onclick]`（去掉 `span/li/div` 全量），或优先定向 `a[href*="next"]` / `[class*="next"]` 等。注意 `isVisible` 现已文本前置（line 243 顺序为「文本 → isVisible」），故瓶颈在**过宽选择器 + 容器节点整子树 textContent 读取**；收窄后候选量可降 1~2 个数量级，再叠加 #1 的 `offsetParent` 剔除即几乎无重排。
3. **`blockedByVerify`** 用 `textContent`（不触发 reflow）或仅扫描已知验证容器，而非 `document.body.innerText` 整页。

**预期提升**：视频结束「自动跳下一节」的爆发耗时从「上万节点（含容器）子树文本读取 + 文本命中候选 × 2 次重排」降为「窄选择器少量候选 ×（`offsetParent` 剔除后至多 1 次重排）」，长课程页导航卡顿从秒级降为毫秒级。

### 落地状态（2026-08-14）

已在 `plugins/addons/auto-next.js` 实施：
- ✅ **#2 收窄兜底选择器**：step 3 改为 `button, [role="button"], [onclick]`（去掉 `span/li/div` 全量遍历）——消除「上万节点整子树 `textContent` 读取」主成本，候选量降 1~2 个数量级。
- ✅ **#3 `blockedByVerify` 改用 `textContent`**：去掉 `document.body.innerText` 整页 reflow（关键词子串匹配仍成立，行为等价）。
- ⚠️ **#1 `offsetParent===null` 剔除已撤回**：jsdom 测试环境 `offsetParent` 恒为 `null`（无布局引擎），该剔除会使 `isVisible` 对所有元素返 `false`，破坏章节测验任务点识别（`sim-auto-next.js` 一度回归）；且对 `position:fixed` 元素有正确性误判风险。撤回后 `isVisible` 恢复原实现，仍仅对「文本命中候选」调用（已文本门控），双 reflow 影响面有限。

回归：`sim-auto-next.js`、`sim-zh-exam.js`、`sim-popup-block.js` 全绿；仅预存的 `sim-quiz-popup.js` / `verify_fixes.js`（均非本次改动文件）仍 FAIL，与本次无关。

---

## 本轮新增覆盖模块（已确认无新瓶颈）

在优化点 1~4 之外，本轮进一步覆盖高频 / 易遗漏模块，确认**无每 tick 全文档扫描类瓶颈**：

- `plugins/addons/tamper-guard.js`：`TimerRegistry.setInterval(guardTick, 2000)`（line 124）仅 `document.querySelectorAll('video')`（line 44/80/107）——**轻量、仅视频元素、非全文档**，每 2s 代价恒定且极小，无 reflow / 遍历膨胀。✅
- `plugins/addons/keyboard-shortcuts.js`：核心为 `keydown` 监听（line 90，仅 `e.isTrusted` 真实用户按键）+ 进页面 15s 内的 `setInterval(activeVideo, 800)` 引导期轮询（line 94-98，仅 `querySelectorAll('video')` 取最大视频，15s 后 `clearInterval`）——**事件 / 引导驱动，无每 tick 全文档遍历**。✅
- `plugins/addons/video-ended-notify.js`：纯事件驱动（`ended` / `play` 监听 line 163/168、`bridge` 消息）；`querySelectorAll('video')` 只在 `muteAll/restoreAll` 等用户 / 联动事件内触发——**无稳态全文档扫描**。✅
- `plugins/addons/quiet-popups.js`（v4.16）：纯「工具库总开关 + 持久化」项，仅向 `__cxAddonQueue` 注入一个 toggle（`isOn` / `setOn` 读写 `cx_quiet_popups`）——**无任何 tick 循环、无任何 `querySelectorAll` 全文档扫描**，完全事件无关。✅
- `plugins/addons/zhihuishu-auto-next.js`（v4.15）：智慧树专属「开关 + 状态位」项，`setTimeout(bootstrap, 300)` 仅注册 toggle 与 `storage` 监听，真实放行逻辑在核心 `dom.js` `_ovEnforce(ended 分支)`；**本文件无任何 DOM 扫描 / 每 tick 调用**。✅
- `presentation/panel.js`：渲染经 `throttle(refreshPanelState, 150)`（line 67）/ `throttle(renderInvasionReport, 1500)` / `throttle(renderFeatureSelfTest, 2000)` 节流，由 `videos:scanned` 事件尾沿触发，**不随主循环每 tick 全量重绘**，节流渲染良好。✅

> 结论：**`plugins/addons` 目录 6 项已 100% 覆盖**（auto-next / keyboard / tamper-guard / video-ended-notify / quiet-popups / zhihuishu-auto-next）。其中 quiet-popups 与 zhihuishu-auto-next 为纯开关项（无 tick / 无扫描），其余 4 项经逐行复核均无每 tick 全文档扫描瓶颈。叠加已覆盖的 sites（popup-quiz / zhihuishu-exam）/ engine（quiz / vision-deepseek-web）/ main-loop / panel，**前端运行时每 tick 高频模块覆盖已完毕**。剩余可优化集中在两个**峰值场景**：稳态 **优化点 1（popup-quiz）** 与爆发 **优化点 6（auto-next）**。

---

## 优先级排序与落地建议

| 优先级 | 优化点 | 触发频率 | 改动量 | ROI | 落地状态（2026-08-14） |
|---|---|---|---|---|---|
| P0 | 优化点 1：`_pqQueryAll` 合成 `join(',')` + 弹窗出现信号门禁 + 降频 | 每 2s 稳态 | 小 | 极高 | ✅ #1 #3 已落地；#2 MO 门禁 / #4 降频评估中 |
| P0 | 优化点 6：auto-next 兜底遍历全文档 + `isVisible` 双 reflow | 视频结束（爆发） | 小-中 | 高（峰值严重） | ✅ #2 #3 已落地；#1 `offsetParent` 剔除已撤回（jsdom/fixed 风险） |
| P1 | 优化点 5：zhihuishu-exam 每 tick 多次全文档扫描 + 文本缓存 | 每 2s（开启时） | 中 | 高（大题库） | ✅ #2 #3 已落地（无 TTL 版）；#1 MO 快照待评估 |
| P1 | 优化点 2：`_dsIsLoggedIn` 缓存 + 定向选择器 | 每 5s 稳态 | 小 | 高（DS 控制台） | 🔍 已核查：TTL 缓存与登录态即时感知冲突（破坏 DS 探测 false→true 回归）已撤销；仅选择器收窄待 H7 真机校准 |
| P1 | 优化点 3：`quiz.js` 选择器合成 + 文本 WeakMap 缓存 | 开启时每 tick | 小-中 | 高（真答题场景） | ✅ #1 `_quizOptions` 合成 `join(',')` 已落地；#2 题干文本 WeakMap 缓存（`_quizStemCache`，脏代际失效）已落地 |
| P2 | 优化点 4：轻量 tick 快照短路 | 每 2s | 小 | 低（正确性敏感） | ⬜ 未实施（正确性敏感，不建议） |

> 注：优化点 1 的 `join(',')` 改法同时适用于 `popup-quiz.js` 与 `quiz.js` 的遍历循环，是**单点改动、多处处受益**的最高 ROI 修复；建议优先实施并补充 `_sim` 回归（已有 `sim-popup-block.js`、`sim-quiz-*` 可作断言基线）。
