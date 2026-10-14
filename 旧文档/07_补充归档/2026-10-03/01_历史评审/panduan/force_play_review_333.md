# 代码审查报告：学习通·强制续播（iframe穿透 + 防暂停 + 防伪暂停 + 防重播）v3.33

> 审查对象：用户提供的单文件 UserScript（`@version 3.33`，约 700 行，IIFE + `'use strict'`）。
> 审查维度：语法错误、逻辑错误、潜在运行时异常、性能瓶颈、可读性与可维护性。
> 结论先行：脚本工程化程度很高，防御面（原型级 pause/playbackRate 下沉、MSE 断流、定向白名单、重建去重、用户暂停闸门、面板、桥接）覆盖全面；但仍有 **3 个值得修复的中/中高危缺陷**（DEBUG 开关失效、iframe 内视频祖先签名收集失效、用户暂停误触 fallback）和若干低危/可维护性问题。

---

## 一、确认的缺陷

### 1. [中危] DEBUG 运行时开关失效 —— 散布全代码的数十处 `dbg(...)` 永远是空操作

**位置**
```js
var DEBUG = false;
var dbg = DEBUG ? function () { /* console.log */ } : function () {};   // ① 加载即绑定为 no-op

// 面板复选框
var dbg = el.querySelector('#__cxDebug');
dbg.addEventListener('change', function () { try { DEBUG = !!dbg.checked; ... } ... });  // ② 只改 DEBUG 变量
```

**表现**：`dbg` 在脚本加载时（`DEBUG=false`）就被绑定为 no-op 闭包，且全代码无任何 `dbg = ...` 的重新赋值。面板「调试日志 (DEBUG → 控制台)」勾选后只翻转了 `DEBUG` 变量，并未改变 `dbg` 函数引用。代码里只有两处直接用 `if (DEBUG)` 判断的埋点（`_memSample('vis:...')` 与 `_loopTick` 的 `_memPoll` 采样）能生效，**其余所有 `dbg(...)` 调用（包括所有 `dbg('...')` 诊断输出）永远不输出任何内容**。

**后果**：用户按面板勾选「调试日志」期望在控制台看到续播/释放/回退等诊断，实际一无所获；排查「为何没续播/为何回退全量」时关键线索缺失。注释自称「用条件定义替代运行时 `if(!DEBUG)`…热路径零开销」，但代价是**运行时无法开启日志**，与 UI 承诺相悖。

**修复**：让 `dbg` 始终指向一个读 `DEBUG` 的包装函数（一次 `if` 判断的运行时开销对调试热路径可忽略，或仅保留 `if (DEBUG)` 分支，把 `dbg` 改为 `function dbg(){ if(!DEBUG) return; console.log.apply(...) }`）。

---

### 2. [中高危] iframe 内视频的祖先 iframe 签名 / src 收集失效 —— 重建去重与 iframe 白名单基本失效

**位置**
```js
function videoIframeSrcsOf(v) {
  var el = v;
  while (el && el.parentElement) {
    el = el.parentElement;
    if (el && el.tagName === 'IFRAME') { /* 收集 el.src / id / name / data-... */ }
  }
}
function videoBelongsToTask(v) {
  // 同样用 while (el && el.parentElement){ if (el.tagName==='IFRAME') urls.push(el.src) }
}
```

**表现**：两者都沿 `v.parentElement` 向上爬，并只在「同一文档树内出现 `<iframe>` 祖先」时收集。但**当视频位于 iframe 的内部文档时，其 `parentElement` 链始终停留在 iframe 自己的 `document` 内，永远够不到 iframe 元素本身**（iframe 元素属于父文档，不在视频所在文档的祖先链上）。`scanVideos` 是递归进 `f.contentDocument` 扫描的，所以 `overrideVideo(v)` 拿到的 `v` 是 iframe 内视频，向上爬不出 iframe。

**后果**：
- `videoIframeSrcsOf` 收集不到承载播放器的 iframe 的 `id/name/data` 签名 → v3.14 引以为傲的「iframe 签名重建去重」（专门对抗 **blob: 源 MSE 视频**因 `currentSrc` 无 objectid 而取不到指纹的场景）**对 iframe 内播放器几乎完全失效**，跳课后仍可能被整元素重建重播。
- `videoBelongsToTask` 的 `iframe.src` 匹配分支同样失效；所幸 `v.currentSrc` 直匹配仍工作，定向白名单主路径未断，但若平台把任务 id 仅编码在 iframe 地址/属性上（不含在视频 `currentSrc`），定向会漏匹。

**修复**：在 `scanVideos` 下钻到 `f.contentDocument` 时，把宿主 iframe 元素 `f` 连同其签名一并传入 `overrideVideo`/`videoIframeSrcsOf`/`videoBelongsToTask`（如增加 `hostIframe` 参数），让它们能补上「视频所在文档的父 iframe」这一层签名；或在每轮扫描时为 iframe 内视频预先把 `f` 的签名注入 `v.__cxHostSig`。

---

### 3. [低-中危] 定向 fallback 误判：用户暂停的任务点视频使 `matchedAny` 恒为 false

**位置**
```js
// overrideVideo 开头
if (v.__cxUserPaused) { /* 恢复原生 pause 后 return，未置 matchedAny */ return; }
...
if (TARGET.enabled) TARGET.matchedAny = true;   // 仅在「未用户暂停且通过定向」时置位

// _loopTick
if (TARGET.enabled && !TARGET.matchedAny) {
  if (++_targetMissStreak >= TARGET_FALLBACK_ROUNDS) { TARGET.enabled = false; }  // 回退全量
}
```

**表现**：`matchedAny` 用于判定「白名单是否失效」。但一个**属于任务点、只是被用户暂停**的视频会走 `__cxUserPaused` 分支提前 return，不置 `matchedAny`。若当前页面所有任务点视频都处于用户暂停态，连续 3 轮 `matchedAny=false` → 触发 `TARGET.enabled=false` 回退为**全量续播**。

**后果**：用户只是想暂停看一会儿，结果脚本误以为白名单失效，开始对广告/插播视频强制续播（尽管用户已暂停，新插入/未暂停的广告视频仍会被接管）。属于「白名单判定只看『是否在播』而非『是否命中』」的逻辑漏洞。

**修复**：把「命中白名单」与「是否实际续播」解耦——在 `overrideVideo` 的 `__cxUserPaused` 分支里也 `TARGET.matchedAny = true`（命中即算，与播放状态无关），或在 `_loopTick` 回退判定前用一个独立的「本轮回扫到的任务点视频数」计数器代替 `matchedAny`。

---

### 4. [低危] `safePlay` 在自动播放被彻底拒绝时永久静音

**位置**
```js
function safePlay(v) {
  var wasMuted = v.muted;
  function restore() { if (restored) return; restored = true; if (!wasMuted) v.muted = false; }
  ...
  v.addEventListener('playing', restore, { once: true });
  var p = v.play();
  p.then(restore).catch(function () {
    v.muted = true;                     // ← 已静音
    var p2 = v.play();
    p2.then(restore).catch(function () {});  // 若静音播放也失败，restore 永不触发
  });
}
```

**表现**：若浏览器连「静音自动播放」也拒绝（极罕见，如策略完全禁用），`v.muted = true` 已执行但 `restore`（恢复音量）永远不被调用。

**后果**：视频永久静音，且 `wasMuted` 状态丢失（再次成功播放也不会恢复）。虽属病理场景，但应在最外层 catch 兜底 `v.muted = wasMuted`。

---

### 5. [低危/可维护性] `ensurePanel` 内 `var dbg` 遮蔽外层日志函数

**位置**
```js
function ensurePanel() {
  ...
  var dbg = el.querySelector('#__cxDebug');   // 与顶层 function dbg() 同名，函数作用域内遮蔽
  dbg.addEventListener('change', ...);
}
```

**表现**：局部 `dbg` 是复选框 DOM 元素，遮蔽了模块级日志函数 `dbg`。当前功能无碍（面板内不调用日志 `dbg`），但后续维护者若在 `ensurePanel` 内补一行 `dbg('xxx')` 期望打印，会得到 `dbg is not a function` 运行时异常。建议改名（如 `dbgChk`）。

---

### 6. [低危/可读性] `safePlay` 上方重复注释块

**位置**：`safePlay` 定义前存在两段几乎完全一致的中文注释：
```js
  // 安全 play：兼容浏览器自动播放策略拒绝（先静音再播，Edge 友好）
  // 安全 play：兼容浏览器自动播放策略拒绝。按原始 muted 状态尝试；被拒则静音重试一次，成功后恢复用户预期音量。
```
删除其一即可。

---

### 7. [低危/可维护性] `SCRIPT_VERSION` 与 `@version` 两处手写同步

**位置**：文件头 `@version 3.33`，代码内 `var SCRIPT_VERSION = '3.33'`。两者靠注释「与文件头保持一致」人工同步，升级时极易遗漏其一（面板与诊断信息会显示错误版本）。

**修复**：可由 `// @version` 解析，或至少在注释里加显眼提醒；亦可接受现状但列为发布检查项。

---

### 8. [低危/资源] `ENDED_SRCS` 仅章节切换清空，长会话缓增

**位置**：`ENDED_SRCS` 是模块级对象，仅在 `refreshTargets` 检测到任务点 id 集或章节参数变化时清空。正常按章节推进会清，但若用户在同一章内长时间反复播放多段视频（或诊断里看到的条目数增长），该表单调增长。实际影响极小（键为字符串、数量有限），仅作提示，必要时可对 `_lastTaskKey` 关联的已结束指纹加上限/老化。

---

### 9. [低危/性能] `scanVideos` 对 Shadow 宿主的 `getElementsByTagName('*')` 枚举

**位置**：文档级已收窄到 `#videoBox, .ans-attach-ct` 子树内枚举 Shadow 宿主（吸收了 no-pause 的优化），但 ShadowRoot 内部仍 `querySelectorAll('*')` 全量枚举。对典型章节页足够；仅在「视频容器本身挂在超长 DOM（如巨量讨论/评论）内」时才有主线程压力。注释已认知该取舍，列为低优先优化项（可按需限制枚举深度）。

---

## 二、被良好处理、无需改动的点（说明评审未发现隐患）

- **原型级 pause / playbackRate 下沉**：`HTMLMediaElement.prototype.pause` 与 `playbackRate` setter 的 no-op/改写拦截，配合 `v.__cxForcePaused` 标志与 `v.__np` 原生备份，逻辑自洽；`__cxAN_hold` 暂停锁、桥 `skipResume`、用户暂停三态互不冲突。
- **`{once:true}` 的 playing 恢复监听**：消除了 v3.12 之前 `addEventListener(capture)` 与 `removeEventListener` 缺 capture 标志导致的监听器泄漏，设计正确。
- **MutationObserver 帧合并 + 隐藏态 `setTimeout` 兜底**：正确规避了后台标签页 `requestAnimationFrame` 被完全挂起导致 `_moQueue` 无限膨胀的 OOM 路径，且设了 `_moQueue.length > 1024` 安全阀。
- **ended 锁 + seeking 守卫 + `isFinite(duration)` 直播保护 + `currentTime=duration` 拉尾**：重播阻断链路严密，且对 `duration=Infinity` 直播流做了守卫。
- **用户暂停闸门**（`Object.defineProperty(v,'play',...)`）：与 `__cxUserPaused` 协同，能压回平台绕过闸门直接触发的 `play()`，设计到位。
- **桥接探测与回退**：CSP 同步抛错被 `bridgeFetch` 就地兜住、`probeBridgeBase` 端口回退、attachments setter 钩子缺失时退回轮询，容错充分。

---

## 三、整体评价

| 维度 | 评级 | 说明 |
|------|------|------|
| **功能完整性** | ★★★★★ | 覆盖强制续播、防暂停、防伪暂停、防重播、定向白名单、重建去重、用户暂停/计时、面板、桥接，几乎无遗漏。 |
| **健壮性** | ★★★★☆ | 绝大多数边界（MSE 断流、直播流、跨域 iframe、后台 OOM、CSP、自动播放拒绝）已硬化；但 **#2 iframe 签名收集失效** 削弱了 blob:/MSE 视频的防重播这一核心卖点，**#3 用户暂停误触 fallback** 是真实可触发的逻辑漏洞。 |
| **工程实践规范性** | ★★★★☆ | 注释充分、版本演进记录详尽、防御纵深清晰；扣分点在 **#1 DEBUG 开关自相矛盾**（UI 承诺 ≠ 实际行为）、**#5/#6/#7** 命名/注释/版本同步的小瑕疵。 |

**优先修复顺序**：
1. **#2** iframe 内视频祖先签名/白名单收集失效（影响防重播核心能力，中高危）。
2. **#1** DEBUG 运行时开关失效（影响可诊断性，且与 UI 矛盾，中危）。
3. **#3** 用户暂停误触定向 fallback（可触发误强播广告，低-中危）。
4. 其余 #4~#9 低危项随版本清理即可。

> 说明：本脚本为教学/自习辅助用途的浏览器端自动化，请用户自行评估并遵守所在平台的服务条款与学校规章制度，合理使用。
