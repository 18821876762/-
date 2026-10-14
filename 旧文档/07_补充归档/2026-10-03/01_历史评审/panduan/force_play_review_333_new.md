# 复审补充报告：学习通·强制续播 v3.33（相对首轮评审的新发现）

> 结论先行：v3.33 相比首轮评审**没有引入新的语法错误或硬崩溃缺陷**；但经更深入回溯，发现：
> 1. 首轮判定的「中高危 #2」现已**可确认升级为"功能整体失效"**（结构性死代码）；
> 2. 新发现 1 个中危、2 个低-中危、若干低危问题。
> 以下问题均独立于首轮报告，建议在合并首轮修复后再处理。

---

## 一、首轮 #2 升级确认：iframe 签名收集是结构性死代码，MSE 防重播形同虚设

**原判定**：iframe 内视频沿 `parentElement` 爬不到承载 iframe 元素 → 签名收集失效。
**复审确认（确定性结论）**：`videoIframeSrcsOf` / `videoBelongsToTask` 中的这段

```js
var el = v;
while (el && el.parentElement) {
  el = el.parentElement;
  if (el && el.tagName === 'IFRAME') { /* 收集 iframe 签名/src */ }
}
```

**在所有真实场景下都永远匹配不到承载播放器的 iframe**，原因是 DOM 树拓扑：`<iframe>` 元素的子节点全部位于其**独立的 `contentDocument`** 中；视频若在该 iframe 内，其 `parentElement` 链始终停留在 iframe 自己的文档里，链尽头是 iframe 文档的 `<html>`（其 `parentElement` 为 `null`），**永远够不到 iframe 元素本身**（它属于父文档）。而"视频与 iframe 元素同处一个文档且 iframe 是其祖先"在 HTML 中不可能成立（iframe 的后代不活在宿主文档树里）。

**后果（比首轮更严重）**：
- `videoIframeSrcsOf` 实际**只会收集 `v.id`**，永收不到任何 iframe 签名 → v3.14 主打的「iframe id/name/title/data-* 重建去重」对超星常态的 iframe 内播放器**完全不生效**（死代码）。
- 重建去重只剩 `videoSrcOf`（currentSrc/src）一条路径。而 **MSE/blob: 视频的 `currentSrc` 是一次性 `blob:` URL，元素重建后必然不同** → `ENDED_SRCS` 中登记的 blob: 指纹与新建视频永不匹配 → **MSE 视频的"防整元素重播"实际失效**，跳课/重看时仍可能被平台以 blob: 源重建重播。

**修复方向**：在 `scanVideos` 下钻 `f.contentDocument` 时，把宿主 iframe 元素 `f` 的签名（id/name/data-*）作为参数传入 `overrideVideo`/`videoIframeSrcsOf`/`videoBelongsToTask`，使 iframe 内视频能补上"父 iframe 这一层"指纹；或在每轮扫描时为 iframe 内视频把 `f` 签名的命中结果预存到 `v.__cxHostSig`。

---

## 二、新发现：多实例/双面板问题（中危）

**位置**：`@match *://*.chaoxing.com/*` 同时命中顶层页与同源播放器 iframe。
Tampermonkey 默认对**每个匹配 frame 注入脚本**，因此顶层页与播放器 iframe 会各跑一份**完全独立的脚本实例**（各自闭包状态、`_moQueue`、定时器、面板互不可见）。

**表现与后果**：
1. **控制面板可能同时出现两个**（顶层一个、iframe 一个），按 `P` 时取决于焦点落在哪个 frame，用户困惑。
2. **桥 `/playlist` 被两个实例重复 fetch**，且若两个实例都判定 skipResume/白名单，逻辑重复。
3. 两份实例各自 `setInterval` + `MutationObserver`，资源双倍开销。

**修复方向**：在 IIFE 开头用 `if (window.top !== window && !isPlayerFrame()) return;` 之类判断，仅让"顶层负责面板+桥"、或"仅播放器 frame 负责接管"，避免重复。若坚持全 frame 注入，至少用 `window.name`/自定义标记保证面板与桥只在一个实例初始化。

---

## 三、新发现：userResume 无法解除 ended 锁（低-中危）

**位置**：`userResume(v)` 与 `overrideVideo` 的 `if (v.__cxEndedLock)` 分支。

```js
function userResume(v) {
  v.__cxUserPaused = false; v.__cxResumeAt = 0; v.__cxWatchMs = 0;
  try { delete v.play; } catch (e3) {}   // 只拆了播放闸门，没动 __cxEndedLock
  try { safePlay(v); } catch (e) {}
}
```

**表现**：用户对**已 ended** 的视频点「恢复续播」，`userResume` 清了用户暂停锁、删了 play 闸门，但**没有清除 `v.__cxEndedLock`**。下一轮 `overrideVideo` 进入 `if (v.__cxEndedLock)` 分支，立刻把 `v.play` 重新设回 `function(){return Promise.resolve();}`，并把 `v.pause` 设回 no-op。

**后果**：面板显示"已恢复"，实际视频仍被锁死、无法重看；用户点恢复"毫无反应"，疑似脚本卡死。属于"恢复"语义与 ended 锁语义未打通。

**修复方向**：`userResume` 在用户**主动**恢复时，若视频已 ended，应同时清 `v.__cxEndedLock` 并从 `ENDED_SRCS` 移除该视频指纹（或提供"重新观看"专用入口），让恢复真正生效。

---

## 四、新发现：`play` 事件即时接管在 iframe 内可能完全缺位（低危，依赖注入策略）

**位置**：`document.addEventListener('play', ..., true)` 注册在**顶层 document**。

**表现**：若 Tampermonkey 仅向顶层页注入（未注入播放器 iframe），则 iframe 内视频的 `play` 事件不会冒泡到顶层监听器 → "即时接管 / 用户暂停闸门即时压回"对 iframe 视频失效，只能等 2s 轮询 `scanVideos(f.contentDocument)` 才接管。结合第二节的多实例问题：若 TM 反而**只注入 iframe**而顶层未注入，则顶层视频缺接管。

**后果**：动态插入的 iframe 视频在插入后到下次 2s 轮询之间（最长 ~2s）处于"无防护窗口"，期间平台可完成一次暂停/伪暂停；用户暂停闸门（基于实例 `play` 覆盖）仍有效，但"play 事件即时复查"缺失。

**修复方向**：确保每个匹配 frame 都注入（默认即如此），并在 iframe 内也注册 `play` 监听（与多实例修复一并处理）。当前依赖 2s 轮询兜底，影响有限。

---

## 五、其余低危/确认项

- **首轮 #1（DEBUG 开关失效）确认仍为真实 bug**：`var dbg = DEBUG ? 日志 : noop` 在加载时即绑定 no-op，面板「调试日志」复选框只翻 `DEBUG` 变量、不改 `dbg` 引用，全代码数十处 `dbg(...)` 永远静默；只有两处直接 `if (DEBUG)` 的埋点生效。建议把 `dbg` 改为运行时读 `DEBUG` 的包装：`function dbg(){ if(!DEBUG) return; console.log.apply(...) }`。
- **首轮 #3（用户暂停误触定向 fallback）确认**：`overrideVideo` 在 `__cxUserPaused` 分支提前 return、不置 `matchedAny`，所有任务点视频均被用户暂停时连续 3 轮 `matchedAny=false` → 回退全量续播，可能误强播广告/插播。建议命中白名单即置 `matchedAny`，与是否在播解耦。
- **每轮 `installPrototypePauseNeutralize()` 重新 new 闭包并赋原型**：功能正确，但每次生成新函数对象（旧者待 GC），非必要，可改为只首次安装 + 每轮仅断言 `HTMLMediaElement.prototype.pause === protoPause`（不相等才重装）。
- **`restoreNativePause` 仅下钻一层 iframe**：`contentDocument` 内若还有嵌套 iframe 视频不会被恢复；属边缘场景，低危。
- **`refreshTargets` 在 `bridgeFetch` 异步回调里用最新 `topHref()`**：若桥响应慢于用户切章，存在"旧章 objectids + 新章 key"的极短竞态，实际影响可忽略。

---

## 六、整体复核结论

| 维度 | 本轮补充判定 |
|------|------|
| 是否引入新语法/崩溃缺陷 | **否** |
| 相对首轮最重要的修正 | 首轮 #2 升级为"功能整体失效"（iframe 签名收集结构性死代码 → MSE 防重播失效），需优先修 |
| 新缺陷数量 | 1 中危（多实例/双面板）+ 2 低-中危（userResume 不解 ended 锁、iframe 即时接管盲区）+ 若干低危 |
| 修复优先级建议 | ① 修 #2 的 iframe 签名传递（中高危）→ ② 多实例去重（中危）→ ③ userResume 解 ended 锁（低-中危）→ ④ DEBUG 开关（中危，易修）→ ⑤ 用户暂停 fallback 误判（低-中危）→ 其余低危 |

> 复核仍沿用首轮合规提示：本脚本为浏览器端自习辅助自动化，请使用者自行评估并遵守所在平台服务条款与学校规章制度。
