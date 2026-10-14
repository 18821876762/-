# 学习通·强制续播用户脚本（v3.16）问题诊断报告

本报告针对脚本中存在的语法、逻辑、运行时异常、性能与可维护性问题逐条列出，并给出改进建议，最后给出整体评价。行号以 `chaoxing-force-play.user.js` 为准。

## 一、严重问题：桥服务在生产环境因混合内容被完全阻断

位置：`resolveBridgeBase`（第 91–101 行，默认值 `return 'http://127.0.0.1:7531'`）、`probeBridgeBase`（第 111 行 `fetch('http://127.0.0.1:' + port + '/ping')`）、`bridgeFetch`（第 149 行 `fetch(base + '/playlist/' + cid)`）、`bridgeInit`（第 180 行 `fetch(base + '/ping'...)`）。

具体表现：脚本默认用 http 协议访问 127.0.0.1 的本地桥服务，并注释称"127.0.0.1 属 potentially-trustworthy origin，https 页面可直接 fetch，无混合内容拦截"。该判断是错误的——`http://127.0.0.1` 并不是 HTTPS，在学习通这类 https 页面上发起的 http 主动请求属于被浏览器禁止的混合内容（mixed content），会直接被拦截；端口探测同样走 http，故全部候选端口都探不到。

可能后果：两个核心桥功能（当前章 completed 时整体避让 `skipResume`、用爬虫 `objectids` 预填定向白名单）在生产环境完全失效，脚本静默退化为纯 2s 轮询，定向续播的"更早更稳"优势丧失，且重进已完成章节时不再避让续播。

改进建议：桥服务改监听 HTTPS（自签或 localhost 证书）；或在 `resolveBridgeBase` 中检测 `location.protocol === 'https:'` 时优先使用 https base、跳过 http 桥；至少在注释与文档中明确"桥必须 https，否则线上不可用"。

## 二、逻辑矛盾：速率伪暂停的两个实例级处理未尊重自动跳课暂停锁

位置：实例 `ratechange` 监听器（第 479–481 行）与每扫速率断言（第 523 行）。

```js
// 第 479–481 行
v.addEventListener('ratechange', function () {
  try { if (v.playbackRate <= 0.01) v.playbackRate = 1; } catch (e) {}
}, true);
// 第 523 行
if (v.playbackRate <= 0.01 && !v.__cxReleased) { v.playbackRate = 1; }
```

具体表现：原型 `playbackRate` setter（第 61–65 行）在改写时会检查 `!this.__cxAN_hold`，即尊重 auto-next 的暂停锁；但上述两处实例级处理把条件写成 `if (v.playbackRate <= 0.01) ... = 1`，完全忽略了 `__cxAN_hold`。脚本头部与多处注释都强调"所有续播路径都检查 `__cxAN_hold` 并一律避让"，这里与契约自相矛盾。

可能后果：若 auto-next 通过把 `playbackRate` 设为 0 来实现暂停（锁定时），setter 因尊重 hold 而放行速率=0，随后 `ratechange` 事件触发，实例监听器又把速率改回 1，导致暂停锁被绕过、视频继续以 1x 播放。即便 auto-next 只用原生 pause 锁，这段矛盾代码也意味着一旦平台改用速率伪暂停配合 hold，本脚本的速率回拉会与之冲突。

改进建议：两处统一加 `!v.__cxAN_hold` 守卫，与原型 setter 保持一致，例如 `if (v.__cxAN_hold) return; if (v.playbackRate <= 0.01) v.playbackRate = 1;`。

## 三、逻辑缺陷：重扫 0 命中即关闭定向，导致广告/插播视频被临时强制续播

位置：定时器内的回退逻辑（第 604–606 行）。

```js
try { if (TARGET.enabled && !TARGET.matchedAny) { dbg('定向匹配 0 命中，回退全续播'); TARGET.enabled = false; } } catch (e) {}
```

具体表现：每个 2s 周期先 `refreshTargets()` 再 `scanVideos()`。而 `refreshTargets` 在白名单非空（attachments 或桥 objectids 有效）时每轮都会把 `TARGET.enabled` 重新置为 `true` 并把 `matchedAny` 重置为 `false`。当白名单有效、但当前页面此刻没有命中任务点视频（例如任务视频尚未渲染、章节切换的间隙、或页面里只有插播题），`matchedAny` 保持 `false`，于是本行把 `TARGET.enabled` 关掉。在该被关闭的 2s 窗口内，`overrideVideo` 的定向跳过判断 `if (TARGET.enabled && !videoBelongsToTask(v))` 为假，于是所有视频（含广告/插播）都被接管为 `pause=noop`、`__cxForcePaused=true`，直到下一轮 `refreshTargets` 重新启用定向并由 `releaseVideo` 撤销接管。

可能后果：广告与插播视频被间歇性强制续播（每次最长约一个轮询周期），与"仅对任务点视频强制续播、跳过广告"的设计目标直接相悖；在视频渲染较慢的页面上这一现象会更频繁。

改进建议：`refreshTargets` 在白名单为空时已会把 `TARGET.enabled=false`，故这里的额外回退是多余且有害的。应删除此行，或仅在"白名单自身为空/失效"时才回退全量，或对该回退加连续 N 轮空命中的迟滞计数，避免瞬时无视频即横跳。

## 四、可维护性：overrideVideo 函数过长、嵌套过深、多 early return

位置：第 429–527 行，单函数约 100 行，内含桥避让、定向跳过、ended 锁、重建去重、MediaSession 劫持、五个事件监听器挂载、ended 状态处理、正常续播等多个职责，并通过至少 5 处 `return` 提前退出。

具体表现：所有状态分支挤在一个函数内，配合大量 try/catch 与注释，认知负荷高；问题二所揭示的"速率处理忽略 hold"正是在这种密集分支中难以察觉的。

可能后果：后续迭代极易引入类似的逻辑不一致（例如新增续播路径时漏写 hold 守卫），回归风险高。

改进建议：拆分为 `handleEndedLock(v)`、`handleRebuild(v)`、`ensureListeners(v)`、`handleNormalResume(v)` 等子函数，`overrideVideo` 仅做分支调度，每个子函数集中处理一类状态并统一遵守 hold/桥避让契约。

## 五、潜在运行时累积：safePlay 每次调用都注册 playing 监听器

位置：第 392–416 行，`safePlay` 内 `v.addEventListener('playing', restore, { once: true })`。

具体表现：每次调用 `safePlay` 都会新增一个 `{once:true}` 的 `playing` 监听器。监听器只有在视频真正进入 `playing` 后才被浏览器自动移除。若视频因缓冲枯竭而 `waiting→safePlay` 被反复调用、或自动播放策略彻底禁止（无用户手势）导致永远不 `playing`，这些监听器会持续累积，直到某次 `playing` 触发才一起移除。

可能后果：极端卡顿/被禁自动播放场景下，单视频上瞬时挂载多个恢复监听器，造成轻微内存与事件开销；虽然 `{once:true}` 保证最终会清理，但瞬时增长无必要。

改进建议：用标志位去重，例如 `if (!v.__cxRestorePending) { v.__cxRestorePending = true; v.addEventListener('playing', function(){ v.__cxRestorePending=false; restore(); }, {once:true}); }`，在 `restore` 内复位标志。

## 六、冗余：原型 pause 覆盖每轮重装且缺乏幂等判断

位置：`installPrototypePauseNeutralize`（第 36–48 行），在定时器内每 2s 调用一次（第 604 行）。

具体表现：每轮都重新把 `HTMLMediaElement.prototype.pause` 赋值为一个新 `protoPause` 闭包。功能上无害（每次都直接引用原始 `NATIVE_PAUSE`，不会形成包装链），但每 2s 创建一个新函数对象，且本意是"防平台在严格模式下还原描述符"，实际每次都无条件重装。

可能后果：微小且持续的内存/CPU 开销；若未来某平台代码捕获了原型方法引用，重装还可能造成微妙行为差异。

改进建议：加幂等标志，例如 `if (!HTMLMediaElement.prototype.__cxPauseNeutralized) { ...; HTMLMediaElement.prototype.__cxPauseNeutralized = true; }`，仅首装。

## 七、可维护性：伪暂停速率阈值 0.01 作为魔法数字重复出现

位置：第 63 行（setter）、第 480 行（ratechange 监听）、第 523 行（每扫断言）以及正常续播分支，共 4 处硬编码 `0.01`。

具体表现：同一语义的阈值散落多处，且其中两处（第 480、523 行）还漏了 hold 守卫（见问题二），修改阈值需同步多处、易遗漏。

改进建议：提升到 `CONFIG.FAKE_PAUSE_RATE = 0.01`，并统一通过一个 `isFakePaused(v)` 辅助函数判断，使阈值与 hold 逻辑集中管理。

## 八、边界条件：ENDED_SRCS 仅在白名单键集变化时清空，跨章同 id 可能误锁

位置：`refreshTargets`（第 246–284 行）中 `if (keys !== _lastTaskKey) { _lastTaskKey = keys; ENDED_SRCS = {}; _keyReCache = {}; }`。

具体表现：已结束地址黑名单只在"任务点 id 集合"发生字符串变化时才清空，章节切换依赖 id 集合不同来触发。若用户跳到另一个章节但该章节复用了相同的 objectid（同一课程资源被不同章节引用、或 id 空间重复），键集不变，`ENDED_SRCS` 不清空，上一章已结束的视频指纹仍残留。

可能后果：新章节中同一资源视频因其 iframe 签名或 src 命中旧 `ENDED_SRCS` 而被判定为"重建重播"锁死不播，用户需手动刷新页面才能恢复。

改进建议：除键集变化外，把 `chapterId/knowledgeId` 也纳入清空触发条件（脚本已能通过 `topHref()`/`urlParam` 取得 kid），章节参数变化时一定清空黑名单；或在 `isRebuildFinished` 命中的同时校验该视频确实处于"已结束/未播放"的异常态而非正常新章节首播。

## 九、轻微性能：MutationObserver 对每个新增节点全子树查询 video

位置：MutationObserver 回调（约第 580–600 行）中对每个 `addedNodes` 调用 `n.querySelectorAll('video')`。

具体表现：文档级 `subtree:true` 下，任意新增节点（包括大块弹幕/评论区 DOM）都会触发一次整子树 `querySelectorAll('video')`。虽有 `requestAnimationFrame` 合并到下一帧，但在 DOM 高频变动的页面上，单次批处理仍可能扫描很大的子树。

可能后果：极端情况下主线程出现周期性尖峰；对比 `scanVideos` 已把 Shadow 宿主扫描收窄到 `#videoBox/.ans-attach-ct`，此处未做同样收窄，风格不一致。

改进建议：仅当节点本身是 `VIDEO` 或位于 `.ans-attach-ct/#videoBox` 内时才对其查 `video`，避免对无关大子树做全量查询。

## 十、工程规范：跨脚本契约仅靠注释约定，缺乏保护

位置：全脚本多处依赖 `v.__cxAN_hold`、`v.__np`、`v.__cxForcePaused` 等私有字段与 auto-next 协作。

具体表现：这些字段名是隐式契约，仅以注释说明；一旦任一协作脚本改名或拼写变化，本脚本会静默失效（例如问题二中若 auto-next 改用别的 hold 字段名，本脚本的"尊重"全部落空）。

改进建议：在脚本顶部以常量集中声明契约字段名（如 `var F_HOLD = '__cxAN_hold'`），并在启动期对协作脚本存在性做一次性自检日志，提升可维护性。

## 整体评价

功能完整性：较高。脚本围绕"防暂停、防伪暂停、防重播、定向续播、桥避让"五大目标设计，机制覆盖全面（原型级拦截、ended 持久锁、seeking 守卫、重建去重指纹、MediaSession 劫持、MSE 断流续播等）。但问题一导致桥相关两项功能在生产 https 页面实际不可用，使定向白名单预填与章节避让依赖退化的轮询，功能完整性打了折扣。

健壮性：中高。异常吞掉到位（几乎每个外部调用都有 try/catch）、`isFinite` 守卫直播 `Infinity`、跨域 iframe 静默跳过、CSP 同步抛错兜底、滞回避免空窗横跳——这些设计成熟。但问题二（hold 锁逻辑矛盾）与问题三（定向振荡误强播广告）属于会真实影响运行表现的逻辑缺陷，应优先修复；其余多为冗余/边界/规范层面，不至于造成运行崩溃。

工程实践规范性：中等。注释极度详尽且带有缺陷修复溯源，可读性在"理解意图"层面很好；但 `overrideVideo` 函数膨胀、魔法数字重复、跨脚本隐式契约无保护、版本演进叙述堆在注释中，损害了长期可维护性。建议按问题四做函数拆分、问题七做常量提取、问题十做契约常量化，整体规范可明显提升。

优先级建议：先修问题一（桥混合内容）与问题二（hold 锁矛盾），二者直接影响线上核心行为；其次修问题三（定向振荡）；其余可维护性/边界问题可在后续迭代中逐步清理。

## 十一、作者复核结果：驳回与确认汇总

经作者结合项目既有决策（v3.10 #10/#11、F-B4 等）复核，对上述 10 项作出如下处置。我方接受全部驳回，并纠正两处自身误判。

已驳回（7 项）：

- 问题一（混合内容）：误报。回环地址 127.0.0.1 属 potentially-trustworthy origin，混合内容策略对其豁免，https 页 fetch 它不被拦截；且 https base 已可经 `?cxbridge=` / `localStorage` 配置。L82 注释正确，无需改。我方确认此前对混合内容规则的理解有误，予以收回。
- 问题四（拆分 overrideVideo）：强顺序状态机，拆分引入回归风险，与 v3.10 #10/#11 既有决策一致，维持现状。
- 问题五（safePlay 监听）：`{once:true}` 保证 `playing` 触发即移除，仅"自动播放彻底被禁且永不 playing"的病理场景暂存，非真实泄漏，维持现状。
- 问题六（原型 pause 幂等）：不可采纳——每轮重装正是 F-B4 的修复目的（防 use strict 下描述符被平台还原），加幂等标志会还原 F-B4 缺陷。我方确认此处重装是刻意设计，此前"冗余"判断不成立，予以收回。
- 问题七（0.01 常量）：风格偏好，且 L482/L525 两处将随问题二修复一并补上 hold 守卫，提取 CONFIG 与既有决策冲突，维持现状。
- 问题九（MO 收窄）：rAF 已合并批处理，影响极小，列为可选低优，非必须。
- 问题十（契约常量化）：风格，既有决策拒绝配置提取，维持现状。

确认保留（3 项，为可执行修复清单）：

- 问题二（hold 锁速率处理一致性）：作者未驳回。原型 setter 尊重 `__cxAN_hold`，而实例 `ratechange` 监听器（L479）与每扫断言（L523）漏写该守卫，属与契约自相矛盾。注：实际影响取决于 auto-next 是否以 `playbackRate=0` 实现 hold；若其仅用原生 pause，则为一致性/防御性修复，仍建议补齐以与注释承诺一致。
- 问题三（定向 0 命中回退致广告误强播）：作者未驳回。`refreshTargets` 每轮按白名单重新启用 `TARGET.enabled`，但定时器在 `!matchedAny` 时又关闭它（L606），白名单有效而任务视频暂未渲染的瞬间，广告/插播会被临时接管强播，与定向跳过目标相悖。建议删除该回退或加连续空命中迟滞。
- 问题八（ENDED_SRCS 跨章同 id 误锁）：作者未驳回。黑名单仅在白名单键集变化时清空，若跳到的章节复用相同 objectid，旧指纹残留会锁死新章节的同一资源视频。建议把 `chapterId/knowledgeId` 也纳入清空触发条件。

最终应修复清单：问题二、问题三、问题八。其中问题三对线上表现影响最直接，建议优先。
