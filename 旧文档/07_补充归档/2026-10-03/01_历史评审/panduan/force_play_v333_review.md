# 学习通·强制续播 v3.33 问题审查（基于 v3.16 → v3.33 增量）

本审查首先核对上一轮（v3.16 诊断报告）确认的 3 项待修复问题是否已在 v3.33 正确落地，再针对 v3.33 新增的「悬浮控制面板 / 用户暂停开关 / 自动停止计时 / 暂停后自动恢复 / 进度到底释放 / 切后台队列安全阀」等模块做问题排查。所有定位均基于 `chaoxing-force-play.user.js` 的实际行号。

## 一、上轮 3 项确认修复的落地核查（全部正确）

- 问题二（hold 锁速率处理一致性）：已在三处补齐 `__cxAN_hold` 守卫——原型 `playbackRate` setter（第 68 行：`!this.__cxAN_hold && !this.__cxUserPaused`）、实例 `ratechange` 监听器（第 533 行：`!v.__cxAN_hold && !v.__cxUserPaused`）、每扫速率断言（第 576 行：`!v.__cxReleased && !v.__cxAN_hold && !v.__cxUserPaused`）。与原型 setter 的契约一致，修复成立（并顺带把新增的 `__cxUserPaused` 也纳入守卫，更严谨）。
- 问题三（定向 0 命中回退致广告误强播）：已引入 `_targetMissStreak` 连击计数与 `TARGET_FALLBACK_ROUNDS=3` 迟滞（第 259 行声明，第 935-936 行判定）。单轮瞬时空窗不再立即关闭定向，修复成立。但此处的"回退"实现存在新的可达性缺陷，见问题 N1。
- 问题八（ENDED_SRCS 跨章同 id 误锁）：已纳入 `_lastChapterKey` 章节参数跟踪，章节切换时清空黑名单（第 280 行 `_chapChanged`，第 282 行 `ENDED_SRCS = {}`）。跨章复用同 objectid 的误锁已消除，修复成立。

结论：上轮 3 项确认问题均已正确落地，可关闭。

## 二、v3.33 新增/遗留问题

### 问题 N1（中优先级，逻辑缺陷）：定向回退「全量续播」实际不可达，且与文档承诺语义相反

位置：第 289 行 `TARGET.enabled = true;`（refreshTargets 内）与第 933-936 行（_loopTick 内迟滞判定）。

表现：`_loopTick` 每轮先调用 `refreshTargets()`，只要白名单 `ids` 存在（无论对错），第 289 行就无条件把 `TARGET.enabled` 置为 `true`；随后 `scanVideos` 在 `enabled=true` 状态下扫描；第 935-936 行即便把 `TARGET.enabled` 置为 `false`，也要等下一轮。而下一轮的第一步 `refreshTargets` 又把 `enabled` 置回 `true`。于是 `enabled` 在「第 289 行置真 → 扫描 → 第 935 行置假」之间每轮翻转，但**任何一次 `scanVideos` 都发生在 `enabled=true` 之后**，导致「回退全量续播」状态从未真正作用于任何一次扫描。

后果分两层：
1. 回退形同虚设：当白名单 ids 长期存在但视频迟迟未渲染（连续 0 命中），3 轮后 `enabled=false` 被置出，但下一轮立刻被 `refreshTargets` 撤销，永远到不了「全量强播」分支。
2. 语义与文档相反：脚本头部注释明确承诺「匹配规则整体失效时自动回退为全量续播」。但由于 `enabled=true` 期间 `overrideVideo` 对未命中视频执行 `releaseVideo`（交还平台而非强制续播），实际表现是「全部释放、一个都不强播」，与「全量续播」相反。典型触发场景：平台改版导致 `collectAttachmentIds` 抽出的 id 格式偏差（ids 非空但永远不匹配真视频），用户会**静默失去强制续播能力**——脚本面板正常、却什么都不做，极难排查。

改进建议（二选一，推荐 A）：
- A（与作者「绝不误强播广告」立场一致，并修正文档）：保留 `enabled=true` 期间 `releaseVideo` 的安全失败语义，但废弃「回退全量续播」这一不可达且危险的回退；将第 289 行注释与脚本头部「回退全量续播」措辞改为「匹配失败时安全放行（不强制）」，并把第 933-936 行改为仅做诊断计数（不再置 `enabled=false`），避免每轮无意义的置位翻转。
- B（若要保留全量回退原意）：在 `refreshTargets` 内引入一个 sticky 的 `_fallbackFull` 标志，仅在「连续 N 轮 ids 存在但 0 命中」时置位且不被 `refreshTargets` 撤销；第 289 行改为 `if (!_fallbackFull) TARGET.enabled = true;`，使回退真正可达。同时需评估此时强播广告的风险（这正是作者一直回避的），故 B 风险更高。

### 问题 N2（低优先级，一致性缺陷）：releaseVideo 未恢复实例级 `play`，ended/rebuild 锁遗留的 noop play 会阻断已释放视频

位置：第 443-449 行 `releaseVideo` 仅恢复 `v.pause`，未触碰 `v.play`；而 `overrideVideo` 的 `ended` 分支（约第 548 行 `v.play = function(){return Promise.resolve();}`）与重建分支（约第 539 行）会把 `v.play` 覆盖为 noop。

表现：若某视频曾处于 ended 锁或重建锁（`v.play` 被写成 noop），之后因定向不匹配（第 470 行 `releaseVideo(v)`）或「进度到底」nearEnd（第 472 行，仅在 `!__cxEndedLock` 时调用，对重建锁视频无此保护）被释放，其 `v.play` 仍残留 noop。被释放本意是「交还平台正常播放」，但平台调用 `video.play()` 会因 noop 直接返回已解决 Promise 而不真正播放，该视频（典型如被重新归类为非任务的广告）将无法重播。

后果：窄场景（重建锁/ended 锁视频又被重新归类为非任务），表现为被释放视频点不动/播不起。不影响主流程任务点视频。

改进建议：在 `releaseVideo` 末尾补充 `try { if (v.__cxEndedLock === undefined && v.__cxsRebuild !== true) { delete v.play; } } catch(e){}`——即仅当视频不是 ended/重建锁对象时才拆除 noop play，恢复原型播放；对真正需永久锁死的视频保持 noop 不变。与「保留 ended 锁/重建去重」的既有约束不冲突。

### 问题 N3（低优先级，可维护性/隐性雷）：`dbg` 变量遮蔽模块级日志函数

位置：第 733 行 `var dbg = el.querySelector('#__cxDebug');`（ensurePanel 内），第 766 行 `var dbg = _cxPanel.querySelector('#__cxDebug');`（syncPanelInputs 内）。这两处局部 `dbg` 遮蔽了文件顶部第 28 行定义的调试日志函数 `dbg`。

表现：当前无害（ensurePanel / syncPanelInputs 内未再调用日志 `dbg`）。但 `dbg` 同时承担「日志函数」与「复选框元素」双重身份，且靠作用域遮蔽区分，任何后续维护者在这两个函数内误用 `dbg('...')` 都会变成对 DOM 元素调用而报 `dbg.checked` 之外的 TypeError，排查困难。

改进建议：将两处局部变量改名为 `dbgChk`（或 `debugChk`），消除与日志 `dbg` 的同名遮蔽。属低成本、纯可读性修复。

### 问题 N4（低优先级，耦合）：`positionPanel` 硬依赖另一个脚本的 DOM id

位置：第 871-878 行 `positionPanel` 读取 `document.getElementById('cxProgressPanel')` 并把本面板下沉避让。

表现：`#cxProgressPanel` 来自 auto-next 脚本，属跨脚本隐式契约，与文档注释中「不提取常量」的 auto-next 契约同源风险。若 auto-next 改版/未加载，本面板只是顶部对齐略有重叠，无功能损坏（已有 `if (pp && ...)` 守卫），故仅影响布局观感。

改进建议：维持现状可接受；若想更稳，可用 `getElementById` 失败静默 + 加一个常量注释说明该 id 的来源与两端同步义务。优先级最低。

### 问题 N5（极低优先级，可读性）：`_memPoll` 声明晚于使用

位置：第 935 行 `_loopTick` 内 `++_memPoll`（DEBUG 分支），而 `_memPoll` 的 `var _memPoll = 0;` 声明在第 971 行（MutationObserver 段内，晚于 `_loopTick` 与 `setInterval` 调用）。

表现：因 `var` 提升，`_memPoll` 在 IIFE 顶部已声明为 `undefined`，赋值语句在第 971 行同步执行，早于首个 `setInterval` 回调，故运行期无 `undefined`/NaN 问题。但源码阅读顺序上「先使用后声明」易误导维护者以为存在 TDZ 或引用错误。

改进建议：将 `var _memPoll = 0;` 与 `_memSample` 函数上移到 `_loopTick` 之前，或合并到计时相关变量区，使声明在使用之前。纯可读性。

## 三、整体评价

功能完整性：v3.33 在 v3.16 五大机制（原型 pause 拦截、ratechange/setter 伪暂停对抗、定向白名单 + 边界正则、ended 持久锁 + seeking 守卫、重建去重）之上，补齐全了用户交互闭环——悬浮面板、手动暂停开关（含 play 闸门）、自动停止计时、暂停后自动恢复、进度到底释放，并引入切后台队列安全阀（修复 OOM 崩溃）。功能面已相当完备。

健壮性：容错/守卫体系成熟（跨域 iframe 跳过、HTMLMediaElement 缺失守卫、CSP fetch 同步抛错兜底、duration=Infinity 的 isFinite 守卫、hold/用户暂停/桥避让三锁互不冲突、MutationObserver rAF↔setTimeout 双路径）。上一轮 3 项真实逻辑缺陷已闭环。N2 为窄场景一致性瑕疵，N1 为唯一值得修的逻辑缺陷（回退不可达且语义与文档相反）。

工程规范性：注释溯源极其详尽、每个历史决策都有 tag（F-Bx / 诊断#x / 评审#x），可维护性高；主要扣分为 N3 的变量遮蔽、N5 的声明顺序、以及 N1 暴露的「注释承诺与实现行为不一致」——后者建议优先收口（推荐 N1 方案 A：承认安全失败语义并修正文档，删除不可达回退），既消缺陷又守住「绝不误强播广告」的设计底线。

建议修复排序：N1（中，优先）→ N2（低）→ N3/N5（低，顺手）→ N4（最低，可不动）。
