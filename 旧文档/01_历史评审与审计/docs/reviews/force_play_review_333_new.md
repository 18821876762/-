# 强制续播脚本（chaoxing-force-play）复审报告 v3.33 → v3.34

> 复审基准：v3.33
> 结论：**v3.33 未引入新的语法/硬崩溃级缺陷**，但确认并修复了此前存疑与新增的多处问题。
> 对应修复版本：**v3.34**

---

## 一、首轮问题升级（确定性结论）

### #1 升级为「功能整体失效」（中高危）—— iframe 签名重建去重死代码
- **位置**：`videoIframeSrcsOf` / `videoBelongsToTask` 内的
  `while (el && el.parentElement) { if (el.tagName === 'IFRAME') ... }`
- **根因**：iframe 的后代全部位于独立的 `contentDocument`，视频若在 iframe 内，其 `parentElement` 链停在 iframe 自身文档、链尽头是 `<html>`，**永远够不到属于父文档的 iframe 元素**。因此对超星常态的 iframe 内播放器，这段判定是**死代码**。
- **影响**：重建去重只剩 `currentSrc` 一条路径；而 MSE/blob: 视频的 `currentSrc` 是一次性 blob: URL，重建后不匹配 → **MSE 视频的防重播实际失效**（会重复播放已看完的视频）。
- **修复（v3.34）**：`scanVideos(root, hostSigs)` 下钻同源 iframe 时，把宿主 iframe 的 `signatureOf(f)`（id/name/title/data-*，含任务 id）作为参数传入，并挂到 `v.__cxHostSigs`；`videoIframeSrcsOf` / `videoBelongsToTask` 同时并入该宿主签名进行匹配。视频 ended 时据此把含任务 id 的签名登记进 `ENDED_SRCS`，重建后 `isRebuildFinished` 命中即锁死，MSE 防重播恢复。

---

## 二、新增问题

### #2 多实例 / 双面板（中危）
- **现象**：`@match` 同时命中顶层页与同源 iframe，Tampermonkey 默认每个匹配 frame 各注入一份脚本 → 控制面板可能同时出现两个、桥被重复 fetch、定时器 / MutationObserver 双倍开销。
- **修复（v3.34）**：在 IIFE 顶部加同源去重守卫——
  `if (window !== window.top && 同 origin) return;`
  顶层实例的 `scanVideos` 会下钻同源 iframe 处理其视频，故同源 iframe 副本直接退出，消除重复面板/桥/定时器；**跨域 iframe**（顶层无法下钻）保留副本自行接管，避免视频无人处理。

### #3 userResume 无法解除 ended 锁（低-中危）
- **现象**：用户对已 `ended` 视频点「恢复续播」，`userResume` 未清 `v.__cxEndedLock`，下一轮 `overrideVideo` 立刻把 `v.play` 重新设回 no-op → 面板显示已恢复但实际仍锁死、无法重看。
- **修复（v3.34）**：`userResume` 中若 `v.__cxEndedLock` 为真，则清锁、重置进度到 0、并从 `ENDED_SRCS` 删除本视频地址与宿主签名黑名单（再次播完仍会重新锁），随后 `delete v.play` 还原原生 play 并 `safePlay` 从头重看。

### #4 iframe 内 play 事件即时接管可能缺位（低危，依赖注入策略）
- **现象**：顶层 `document` 上的 `play` 捕获监听覆盖不到未注入脚本的 iframe 内视频，只能靠 2s 轮询兜底。
- **修复（v3.34）**：抽离 `installPlayWatch(doc)`，顶层文档与每个下钻到的同源 iframe 文档各装一份（首钻安装、用 `f.__cxPW` 防重复）；配合多实例守卫，同源场景由顶层实例统一下钻覆盖。

---

## 三、确认仍真实存在的首轮问题（本轮一并修复）

### #5 DEBUG 运行时开关失效（易修）
- **现象**：面板勾选 DEBUG 不生效。原 `dbg` 在 `DEBUG=false` 时被固化为 no-op 闭包，运行期改 `DEBUG` 不改 `dbg`，日志永不输出。
- **修复（v3.34）**：`dbg` 改为每次调用检查 `DEBUG` 的运行时函数（`if (!DEBUG) return;`），面板勾选即时生效，开销仅一个布尔判断。

### #6 用户全部暂停时误触定向 fallback 回退全量
- **现象**：`overrideVideo` 在「用户暂停」分支提前 `return`，而 `TARGET.matchedAny` 仅在非暂停分支累计；若所有视频都被用户暂停，`matchedAny` 恒 false，达到 `TARGET_FALLBACK_ROUNDS` 后 `TARGET.enabled=false` → 回退全量续播。
- **修复（v3.34）**：在 `overrideVideo` 顶部（用户暂停提前 return 之前）先 `if (TARGET.enabled && !matchedAny && videoBelongsToTask(v)) matchedAny = true;`，使暂停态任务视频也计入命中，避免误触发 fallback。

---

## 四、修复优先级回顾
1. iframe 签名传递（中高危）✅
2. 多实例去重（中危）✅
3. userResume 解 ended 锁（低-中危）✅
4. DEBUG 开关（易修）✅
5. 用户暂停 fallback 误判 ✅
6. iframe 内 play 即时接管（低危）✅

全部已于 v3.34 修复，`lint` 0 报错。
