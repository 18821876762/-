# 聚焦复盘：学习通·强制续播 (force-play) 及其相关代码

> 中心文件：`chaoxing-force-play.user.js`（v3.15）
> 相关/契约文件：`chaoxing-auto-next.user.js`（跨脚本契约 `__cxAN_hold` / `__cxForcePaused` / `__np`）、`chaoxing-no-pause.user.js`、`chaoxing-visibility-resume.user.js`（重叠的暂停/续播逻辑）、`cx_crawler/dump.py`（`_emit_playlists` 生成桥数据）、`cx_crawler/bridge.py`（HTTP 服务）、`cx_crawler/config.py`（`RENDER_JOBS` 决定 `objectids` 是否填充）。

---

## 0. 跨文件契约核对（先确认"接口一致"）

- `dump.py._emit_playlists` 产出的章节对象字段：`knowledgeId`(str)、`index`、`title`、`completed`、`unfinishedCount`、`hasTaskPoints`、`jobids`、`objectids`。
- force-play 读取：`d.chapters[i].knowledgeId`、`ch.completed`、`ch.unfinishedCount`、`ch.objectids`、`ch.title` —— **字段一致 ✓**。
- 默认模式 `RENDER_JOBS=False` 时 `objectids` 恒为 `[]` → 桥"objectids 预填白名单"增强完全失效，白名单只能靠 `window.attachments`（见 F-B10）。
- 与 auto-next 共享标志：`v.__cxForcePaused`（force-play 置）、`v.__cxAN_hold`（auto-next 置）、`v.__np`（force-play 存原生 pause 供 auto-next 穿透）—— 双方读写一致，**契约正确 ✓**。

---

## 1. force-play 内部逻辑复查（按代码路径）

### 1.1 原型级防暂停 / 防伪暂停（L34-68）—— 正确
- `NATIVE_PAUSE` 在加载时捕获 `HTMLMediaElement.prototype.pause` 的原始引用；随后 `HTMLMediaElement.prototype.pause = protoPause`，`protoPause` 仅对 `__cxForcePaused` 的视频 no-op，非接管视频正常暂停 ✓。
- `installPlaybackRateNeutralize`（L55-68）仅在 `__cxForcePaused && rate<=0.01` 时把 `playbackRate` 改写为 1x；force-play 自身 `v.playbackRate = 1`（L457/500）触发该 setter 时条件不成立 → 正常赋值，**不会死循环 ✓**。
- auto-next 的 `holdPause` 用 `v.__np()`（=原始原生 pause）穿透 no-op 真正暂停，与 force-play 的 `pause` 事件监听 `if (!v.__cxAN_hold) safePlay` 互不打架 ✓。

### 1.2 定向白名单 + 滞回（L243-272, L278-285, L289-315）—— **有一处真实缺陷**
**【F-B1 · 中 · 真实逻辑缺陷】定向模式"跳过"不释放已接管的视频。**

复现路径：
1. 页面初始 `window.attachments` 未就绪 → `refreshTargets` 走 else 分支（`TARGET` 未启用）→ force-play 进入"全量续播"，对**所有** video 调用 `overrideVideo`，写入一次性接管标记：`v.pause = pauseNoop`（L474）、`v.__cxForcePaused = true`（L448）、`v.__cx = true`（L472）等。
2. 之后 `window.attachments` 异步到达（或桥 `objectids` 到达）→ `refreshTargets` 置 `TARGET.enabled = true`，并通过 `videoBelongsToTask` 把某个广告/插播 video 判定为"非任务点"。
3. `overrideVideo` 在 **L413** `if (TARGET.enabled && !videoBelongsToTask(v)) { dbg('跳过非任务点视频'); return; }` 直接 early return。

问题：L413 的 early return **不会撤销该 video 已有的接管**——它仍保留 `v.pause = pauseNoop` 与 `__cxForcePaused=true`。结果该广告/插播视频依旧"无法被用户暂停、被强制续播"，与"定向续播跳过广告"的目标**直接相悖**。

- 触发条件很常见：脚本注释已承认 attachments 延迟到达的"无米之炊"风险；或桥 `objectids` 晚于首扫到达。
- 后果：广告/插播视频一旦在全量模式被接管，后续白名单就绪也不会被放行。
- 建议：在 L413 的 skip 分支增加"释放"逻辑——若 `v.__cxForcePaused`（或 `v.__cx`）为真，调用 `releaseVideo(v)`：恢复 `v.pause = v.__np`（存在时）或原生 pause、清除 `__cxForcePaused`/`__cx`、把 `v.play` 还原（若非 ended 锁）、`v.loop` 交还平台；`__cxEndedLock` 可保留。或更彻底：把"是否接管"与"当前是否在白名单"分离，每次 scan 据白名单重新决定接管/释放，而非只在首次 `!v.__cx` 时一次性接管。

### 1.3 overrideVideo 主流程（L408-502）—— 基本正确，少量隐患
- **【F-B2 · 低】** L421-428 ended 锁把 `v.play` 覆盖为 `function(){return Promise.resolve();}`，但 `restoreNativePause`（skipResume 迟到时，L134-145）只还原 `v.pause` 不还原 `v.play`；已完成章节里的 ended 视频在 skipResume 后仍 `play` 为 noop，无法手动重播。符合"防重播"语义，属可接受取舍，仅提示。
- **【F-B3 · 低】** 原生 `pause`/`ratechange`/`canplay`/`waiting`/`stalled` 监听在 `if (!v.__cx)` 内仅挂一次（正确，避免叠加）；SPA 复用同一 video 元素切章节时 `v.__cx` 永不清空 → 这些监听长期挂在旧元素上。无内存泄漏（单元素有限监听），可接受。
- **【F-B4 · 低 · 稳健性】** 原型 `pause` 只 neutralize 一次（L48）。若平台某次用 `HTMLMediaElement.prototype.pause = nativeFn` 还原原型（罕见），之后新建 video 实例的 `video.pause()` 会绕过 force-play 真正暂停。缓解：实例级 `v.pause = pauseNoop` 每 2s 再断言（L474）可覆盖多数新视频，但存在 <2s 窗口。建议 `setInterval`（L561）内也对 `HTMLMediaElement.prototype.pause` 重新 neutralize（幂等）。

### 1.4 bridge 拉取与 skipResume（L85-184, L134-145）—— 契约正确，边界待补
- **【F-B5 · 中 · 边界】** `bridgeFetch` 用 `topHref()` 取 URL 参数 `courseId` / `chapterId|knowledgeId`（L169-170）。若播放页把 `knowledgeId` 放在 **hash**（`#/chapter?kid=...`）或参数名不同，则 `kid` 为 null → `bridgeInit` 直接 return（L171），桥完全不生效（skipResume 与 objectids 白名单增强失效；虽 `window.attachments` 兜底，但增强丢失）。建议同时对 `location.hash` 解析。
- **【F-B6 · 低】** `restoreNativePause` 递归穿透 iframe 还原 `v.pause`，但未清除 `__cxForcePaused`；skipResume 场景下已接管视频虽恢复可暂停，但若平台改用原型 `pause`(protoPause) 调该视频，因 `__cxForcePaused` 仍 true 会被 no-op 拦截——好在 `v.pause` 实例 own 已还原为原生，故实际生效。仅提示。

### 1.5 scanVideos / MutationObserver（L525-552, L579-599）—— 性能热点
- **【F-B7 · 中 · 性能】** L529 `root.getElementsByTagName('*')` 每 2s **全文档枚举**以寻找 shadowRoot；长目录/讨论区页面为 O(N) 全量扫描，主线程开销明显。同仓 `no-pause`（L71）已改用窄选择器 `#videoBox, .ans-attach-ct, iframe`，force-play 未同步。建议改用窄选择器或对已发现的 shadow host 做缓存。
- **【F-B8 · 低 · 性能】** `videoBelongsToTask`（L305）/ `videoIframeSrcsOf`（L348）每次对 video 调 `Object.keys(TARGET.ids)`（重建数组）并逐个 `keyRe(key).test(url)`；ids 多（数百）+ video 多时复杂度 ids×urls×videos。建议在 `refreshTargets` 时把 `Object.keys(TARGET.ids)` 存入 `TARGET.idKeys` 并预编译 `RegExp[]`，扫描时直接遍历该数组（避免反复 `Object.keys` 与正则构造）。

### 1.6 safePlay（L383-404）—— 正确
- 自动播放策略拒绝时先静音重试，`restore` 用 `{once:true}` 在 `playing` 后解静音，避免永久静音 ✓。
- `<2s` 轮询 + `pause`/`canplay`/`waiting`/`stalled` 多路兜底续播 ✓。

---

## 2. 与 auto-next 的跨脚本契约复核
- 字段与读写顺序一致（见 §0）。**无冲突 ✓**。
- **【F-B9 · 中 · 加载竞态】** auto-next 的 `holdPause`（auto-next L465-479）仅在 `v.__cxForcePaused` 为真且 `v.__np` 就绪时穿透原生 pause（评审 J6）。若页面加载时 auto-next 的 `arm` 在 **force-play 的 `scanVideos` 之前**就对该 video 触发 `holdPause`，此时 `v.__cxForcePaused` 尚未置位、`v.__np` 未定义 → auto-next 走 `v.pause()`（此时为原生，因 force-play 还没接管）。之后 force-play 接管并 neutralize。整体语义仍"暂停且不被续播"，**不致命**；但契约隐含"force-play 先接管"的假设，建议两脚本都容忍任意加载顺序（force-play 接管时若 `v.__cxAN_hold` 已置，应直接让位不续播——实际 pause 事件已触发 safePlay，而 safePlay 内 `!v.__cxAN_hold` 守卫使其不续播，正好符合预期 ✓）。

---

## 3. 与 no-pause / visibility-resume 的重叠与冲突
- **no-pause**：仅 `preventDefault` 鼠标移出 `videoBox` 的 pause（不 override `pause`/`playbackRate`），与 force-play 互补、不冲突；同装时各自处理该 mouseout 事件，互不干扰 ✓。
- **visibility-resume**：用 `visibilitychange` + `pause/play` 事件判断"切后台自动暂停"并续播，不 override pause。与 force-play 互补（force-play 负责平台主动 pause，visibility-resume 负责切后台 pause）。
  - 潜在重复续播：两脚本对同一 `pause` 事件都会尝试续播（force-play 的 pause 监听 + visibility-resume 状态机），**幂等无副作用** ✓。
  - **冲突点**：visibility-resume 的 `bh`（L58-70）把"非隐藏窗口内的任何 pause"记 `u1=false`（用户意图暂停）。若 force-play 正在接管并触发 `safePlay→play→平台反击 pause`，visibility-resume 会记为用户暂停，致其后续切后台不再自动续播；但 force-play 仍持续续播，故**最终效果不受影响** ✓，仅 visibility-resume 自身状态机失真。

---

## 4. 数据契约（dump.py / bridge.py）复核
- 字段一致 ✓（见 §0、F-B5 边界）。
- **【F-B10 · 低 · 默认值陷阱】** 默认 `RENDER_JOBS=False` → `objectids` 恒为 `[]`。force-play 的"桥 objectids 预填白名单"增强在默认模式完全失效，白名单只能靠 `window.attachments`；若页面 `attachments` 永不出现，force-play 退化为全量续播（设计兜底）。需在 README 明确：定向白名单的"桥增强"需 `RENDER_JOBS=True`。

---

## 5. 优先修复清单（force-play 聚焦）

| 级别 | 编号 | 问题 | 位置 | 建议 |
|---|---|---|---|---|
| 中·真实缺陷 | F-B1 | 定向 skip 不释放已接管视频 → 广告/插播被永久强制续播 | L413 | 加 `releaseVideo()` 释放接管；或每轮据白名单重判接管/释放 |
| 中 | F-B5 | 桥仅解析 query，不解析 hash → 新模板下桥完全失效 | L169-171 | 同时解析 `location.hash` |
| 中 | F-B7 | 每 2s 全文档 `getElementsByTagName('*')` 找 shadowRoot | L529 | 改用窄选择器 / 缓存 shadow host |
| 低 | F-B8 | 每次 `Object.keys(TARGET.ids)` + 逐 key 构正则 | L305/348 | `refreshTargets` 预编译 `TARGET.idKeys` + `RegExp[]` |
| 低 | F-B4 | 原型 `pause` 仅 neutralize 一次，平台可还原绕过 | L48 | 每轮 `scanVideos` 重新 neutralize 原型 |
| 低 | F-B2/F-B6 | skipResume 迟到时不还原 `v.play` / 不清 `__cxForcePaused` | L134-145 | `restoreNativePause` 一并还原 |
| 中 | F-B9 | 与 auto-next 加载顺序竞态 | 契约 | 双方容忍任意加载顺序（实际已幂等，仅提示） |
| 低 | F-B10 | `objectids` 默认空，桥增强失效 | 文档 | README 注明需 `RENDER_JOBS=True` |

---

## 6. 结论（force-play 专项）
- **正确且扎实的部分**：原型级 pause/playbackRate 下沉拦截、ended 持久锁 + 重建去重（ENDED_SRCS）、`__cxAN_hold` 跨脚本避让、`safePlay` 自动播放策略兼容、MutationObserver 帧合并队、attachments setter 钩子 + 滞回——这些都针对学习通反自动化做了有效加固，逻辑自洽。
- **最关键缺陷是 F-B1**：定向白名单"跳过"分支未释放已在全量模式接管的视频，导致广告/插播被永久强制续播，削弱了"定向续播"的核心价值；建议在 skip 分支补 `releaseVideo()`。
- **次要重点是性能（F-B7/F-B8）**：每 2s 全文档枚举与逐 key 正则匹配，在长页面/多任务点课程上会成为主线程热点，建议同步 `no-pause` 的窄选择器并预编译白名单正则。
- 与 auto-next / no-pause / visibility-resume 的契约总体正确、无破坏性冲突，仅存在加载顺序竞态（不致命）与状态机轻微失真（不影响最终效果）。
