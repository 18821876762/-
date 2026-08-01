# 工作空间代码审查报告

> 审查范围：`perception/cx_crawler/`（10 个 Python 模块）+ 8 个浏览器用户脚本（`.user.js`）
> 审查日期：2026-07-29
> 审查方式：逐文件静态阅读 + 跨文件一致性比对（JS 大文件由并行探索代理辅助定位行号）

---

## 1. 代码结构概览

工作空间由两套独立但**通过 `output/playlist_*.json` + 本地桥(127.0.0.1:7531) + localStorage** 协作的代码组成：

| 组件 | 规模 | 作用 | 运行位置 |
|---|---|---|---|
| `perception/cx_crawler/`（Python） | 10 文件 ~1150 行 | 登录校验 → 拉课程 → 递归解析章节任务点 → 生成 playlist 快照 → 可选渲染/心跳/作业 | 本地 CLI |
| `chaoxing-force-play.user.js` | ~1450 行 | 强制续播、IMA 广告对抗、定向白名单、桥 playlist 拉取 | 学习通页面 |
| `chaoxing-auto-next` / `allinone` | 中 | 自动/手动跳转下一未完成章节、遮罩暂停规避 | 学习通页面 |
| `chaoxing-progress-panel` / `no-pause` / `visibility-resume` / `deceive-api` / `browser-media-collector` | 小 | 进度面板、防暂停、可见性续播、API 欺骗、媒体信息收集 | 学习通页面 |
| `bridge.py`（Python） | 150 行 | 把 `output/` 的 playlist 以只读 CORS 方式暴露给浏览器脚本 | 本地常驻服务 |

整体定位是「**只读快照 + 浏览器侧辅助**」，不提交答案、不上报进度，安全边界设计清晰。

---

## 2. Python 爬虫 `perception/cx_crawler/` 审查

### 2.1 语法 / 解析层
- 全部文件可正常解析，无语法错误；模块导入分层良好（`config` 不 import `requests`，`render` 惰性导入避免强制依赖 Playwright）。

### 2.2 逻辑错误

**【中】`dump.py:264/268` 与 `chapters.py:231` —— 落盘文件与最终解析树不一致**
```python
# chapters.py
if len(ids) > len(best_ids):          # L231 仅在此更新 best_html
    best_ids, best_html = ids, html
...
api_client.get(..., save_raw=f"02_chapter_list_{courseid}.html")  # L264/L268 每次种子都写
```
每次种子尝试都把章节 HTML 写入同一个 `02_chapter_list_{courseid}.html`，但 `best_html` 只在「id 更多」时更新。若后一次种子 id 较少却后写，磁盘上的"原始调试文件"与最终用于 `parse_chapter_tasks(best_html)` 的结果对不上。后果：调试/复现时看到的 HTML 与解析出的任务点不符，误导排错。
**建议**：仅在 L231 分支（更新 `best_html` 时）才写该文件，或最后统一 `atomic_write_text("02_chapter_list_"+cid, best_html)`。

**【低】`chapters.py:157` `_NODE_RE.split` 嵌套节点风险**
按 `<div ... id="cur\d{6,}">` 的 lookahead 切分 HTML。若章节节点嵌套（一个 cur 节点位于另一个 cur 节点内部），`split` 会切出重叠 chunk，导致同一 `kid` 被重复解析、标题/未完数取自外层包裹。后果：任务点列表出现重复章节或完成态误判。
**建议**：用 `re.finditer` 显式匹配每个 cur 节点起止，或对 `kid` 去重。

**【低】`chapters.py:182-183` `completed` 判定过宽**
```python
completed = ('icon_Completed' in ch) or (unfinished == 0 and has_tp)
```
「有任务点且未完成数解析为 0」即判完成。当 `jobUnfinishCount` 解析缺失时 `unfinished=0`，若 chunk 中恰含 `catalog_points_yi` 等 `has_tp` 特征，会**误报完成**。
**建议**：以"明确存在 `icon_Completed`"为完成硬判据；`unfinished==0` 仅作辅助且需 `has_tp` 确为真实任务点。

### 2.3 运行时异常 / 健壮性

- `config.py:205-244` **`RunLock` 无过期锁清理**：进程崩溃后 `.runlock` 残留（注释 L217 也承认），需手动删除。建议写入 pid，acquire 时读 pid 并用 `os.kill(pid,0)` 检测进程是否存活，存活才算占用。
- `config.py:183-202` **`with_retry` 捕获 `(Exception,)`**：会重试所有异常（含 `TypeError`/`ValueError` 等程序错误），非瞬时错误重试无意义且增加延迟。建议仅捕获网络/5xx 相关异常（`requests.exceptions.RequestException`、`ConnectionError`、`Timeout`、`http.client.HTTPException`），或新增参数区分"可重试异常集合"。
- `session.py:163-179` **`save_cookies` 不删除陈旧 cookie**：dict/list 格式合并时只更新/新增，不移除 session 中已不存在的 key。轻微（陈旧 cookie 一般无害）。
- 其余网络/JSON 调用均被 `try/except` 包裹，`courses.py:37-44` 等逐层 `isinstance` 守卫，`r.json()` 失败有兜底；`api_client` 仅对 `>=500` 主动 `raise_for_status` 触发退避重试，4xx 透传给调用方判断——设计合理。

### 2.4 性能

- `chapters.py:53-58` `extract_knowledge_ids` 对**每个种子尝试**（含派生种子循环，可能多次）都跑 8 条全量正则扫描大段 HTML。大课程树 × 多次种子 × 8 正则有可观开销。
**建议**：将 8 条正则合并为单条 `re.findall(组1|组2|...)`，单次扫描完成多组提取；或对同一份 html 缓存结果。
- `bridge.py` 用 `ThreadingHTTPServer` 但无并发上限；本地使用无碍，极端多并发下线程数不受控（低优先）。

### 2.5 可维护性 / 工程规范

- **【高】`dump.py:43-51` `ACTIVE_COURSE_IDS` 硬编码了 7 个具体个人课程 cid**（`265306897` 等）。换用户必须改源码，且散落于源码中易过期。建议移到配置文件（如 `perception/cx_crawler/courses.json` 或环境变量 `CX_COURSE_IDS`），与 `bridge_config.json` 的处理方式一致，并在 README 说明。
- **【中】`print` 与 `logger` 混用**：`courses.py`、`chapters.py`、`session.py` 大量用 `print(...)`，而 `dump.py`/`api_client.py` 用结构化 `logger`。后果：`CX_DEBUG` 无法统一控制输出，日志无 trace_id/时间戳前缀，风格割裂。建议统一为 `logger`。
- **【中】`_to_int` 重复实现**：`courses.py:9-14` 与 `dump.py:107-111` 两份完全相同的拷贝，易漂移。建议抽进 `config` 公共 util。
- **【中】缺 `requirements.txt`**：`requests`、`playwright` 依赖未锁定版本，跨环境复现困难。建议补充并 pin 版本。
- `bridge.py:87` 与 `:86` 重复校验（`re.match(r"^/playlist/(\d{1,12})$")` 已保证数字，再 `_CID_RE.match` 冗余）；`:63` 路径相等性检查恒为 false（两边相等），分支永不触发——均为无害冗余，可删。
- `dump.py:317` 在函数内 `import time`，建议提到模块顶部统一风格。
- `heartbeat.py` / `quizzes.py`：默认模式下 `analyze_heartbeat_params` 因无 `jobid/objectid` 直接 skip、`fetch_quiz` 不被调用——**心跳探测与作业拉取在默认模式是空操作**（仅 `RENDER_JOBS=True` 才有意义）。属功能不完整（见第 5 节），但代码注释清晰说明了限制。
- `bridge.py` 安全性良好：仅白名单路由、cid 数字校验、仅暴露 `playlist_*.json`，无路径穿越。

---

## 3. 浏览器用户脚本审查

> 行号来自对各自文件的逐行阅读；force-play / 小脚本集群由并行探索代理辅助定位。

### 3.1 `chaoxing-force-play.user.js`（v3.35，最复杂）

**【中】`L758`/`L791` 局部 `var dbg` 遮蔽顶层 `function dbg()`**
```js
var dbg = el.querySelector('#__cxDebug');   // 遮蔽模块级日志函数 dbg
```
被遮蔽作用域内未调用 `dbg()` 日志，故**无实际运行时副作用**；但可读性差，后续维护者在同作用域调用 `dbg(...)` 会误触发 `dbg.checked` 类型错误。
**建议**：局部变量改名 `dbgEl`。

**【中】`L485` + `L500` `matchedAny` 双写导致回退保护在特定场景失效**
`overrideVideo` 开头（早于"用户暂停 return"）已对"属于任务点"的视频置 `TARGET.matchedAny=true`，L500 又在 `TARGET.enabled` 下无条件再置。后果：被用户暂停的任务点视频也会撑住命中计数，使"定向白名单整体失效应回退全量续播"的保护（L962 `_targetMissStreak`）在**只剩被暂停视频**时永不触发。
**建议**：明确 `matchedAny` 语义，仅在"真正进入续播路径"时计数。

**【低】`L295` + `L962` `_targetMissStreak` 空窗误累加**
`attachments` 空窗（keyArr 为空但 `TARGET.enabled`）期间仍累加 miss，与注释"空窗不回退"意图部分矛盾——连续空窗会误触发回退全量。
**建议**：仅在 `allVideos().length>0 && TARGET.enabled && !matchedAny` 时累加，空窗则重置。

**【低】`L122` 探测协议不与配置对齐**
`probeBridgeBase` 用硬编码 `http://127.0.0.1:{port}/ping` 探测，而 `resolveBridgeBase` 支持 `?cxbridge=https://...`。若用户配 https 桥，探测只用 http，可能探测到不可用端点。
**建议**：探测 URL 协议跟随用户配置。

**【低】`L199-204` 桥探测容错基本安全**（`r && r.ok` 守卫 + `.catch` 兜底），但 `BRIDGE.base` 为 undefined 时 `fetch(undefined+'/ping')` 抛错虽被捕获，建议探测前先校验 base。

**【低】`L718` `el.innerHTML =` 拼接注入 HTML**（非用户数据，风险可控），建议用 `textContent`/`createElement`。

**【中】全局定时器/监听器从不清理**
`L974 setInterval(_loopTick,...)` 全局轮询除改间隔外从不 `clearInterval`；`L1032-1055 MutationObserver` 从不 `disconnect`；`L978/L996/L1060` keydown/play/visibilitychange 监听从不 `remove`；多 frame / SPA 重建时会累积。
**建议**：封装为可销毁控制器，在脚本卸载/`unload` 时统一清理。

**【低】魔法值分散**：`L103 BRIDGE_PROBE_PORTS`、`L114` 默认桥地址、面板 `z-index/width`（L717-718）等散落，易失同步。建议集中常量。

### 3.2 `chaoxing-auto-next.user.js`

**【中】`L523` `getOverlay()` 可见性误判导致误暂停**
```js
function getOverlay(){ var o=document.querySelector('.dialog-mask');
  if(elVisible(o)) return o; return document.querySelector('.ans-job-icon'); } // L523
```
仅 `.dialog-mask` 分支做 `elVisible` 判定；若 `.dialog-mask` 不存在而 `.ans-job-icon` 存在（即使不可见），`||` 短路返回该不可见元素 → `checkOverlay` 误判"遮罩可见"而**暂停视频**。
**建议**：两选择器分别 `elVisible` 判定后取可见者，或 `return elVisible(o)?o:null`。

**【低】`L614` `setInterval(checkOverlay)` 永不清除**；`@match` 注入每个同源 frame，多 iframe 叠加多个 1.5s 轮询（幂等、开销低，但不优雅）。建议顶层单例 + 退出清理。

**【低】`L77-78`/`L117-122` 探测放大**：多 frame 各向 5 端口探测 → N×5 次无用请求。建议用 localStorage/ROOT 标记探测已完成。

**【低】`L512-520 elVisible` 与 `L212-220 visible` 完全重复**。建议合并为一个。

**【低】`L199 lock()` 内 `setTimeout` 释放不保存句柄**，重复 lock 叠加多个定时器。建议保存 `timer` 句柄 `clearTimeout`。

### 3.3 `chaoxing-allinone.user.js`（已废弃）

**【中】`L230` 宽泛 job 点击不受 `allowFallback` 限制**：`clickFirstText(ct.querySelectorAll('[class*="job"]'), RE)` 在插播题/暂停路径也会点视频区 `.job` 子项，可能误跳整章作业（文件头已声明"已知缺陷"）。建议加 `allowFallback &&` 与 auto-next `L334` 对齐。

**【低】`L246` 弹层点击后 `setTimeout` 4000ms 释放导航锁**，无 `pendingNav.fp`/`confirmNav` 校验，仅靠固定定时器。属已知妥协。

**【低】与 auto-next 关键词不一致**（`L100` 多 `开始|检测`），两版语义漂移。建议：废弃脚本作为单一事实来源或与 auto-next 合并，避免长期并存。

### 3.4 `chaoxing-progress-panel.user.js`

- `L235/L241 drag()` 的 mousemove/mouseup 挂在 `document` 且永不移除；SPA 重建面板（`L327 MutationObserver`）时旧监听器累积。**建议**：重建前 `removeEventListener` 或用 `AbortController`。
- `L49-50 JSON.parse` 已 `try/catch` 返回 `{ok:false}`（安全）；`L126 DOMParser` 仅 catch 返回 `[]`，HTML 为空时静默（已在 L306 提示），可接受。

### 3.5 `chaoxing-deceive-api.user.js` / `chaoxing-visibility-resume.user.js`

- 两者机制不同（deceive 改 getter/IntersectionObserver 欺骗焦点可见性；visibility-resume 监听 pause/play 续播）。deceive 默认 `SPOOF=false` 直接 return，无副作用。
- deceive `L38 Document.prototype.hasFocus = ...`（赋值非 getter）可被平台 `hasFocus.call` 检测，指纹面略大。**建议**：用 `Object.defineProperty` 定义 getter 更稳。
- visibility-resume `L38 u1=true` 初始假设在播，若用户从未播放即切标签，回切会误 `safePlay` 未开始视频（无副作用），可接受。

### 3.6 `chaoxing-no-pause.user.js`

**【中】`L51-52` 防暂停实际"虚假有效"**
`mouseout` 仅当 `relatedTarget` 在容器外才 `preventDefault`，但 `preventDefault` 对 `mouseout` **不能阻止平台基于 `mouseleave`/内部计时器/失焦的暂停**（事件被动语义）。后果：脚本看似防暂停，对多数平台暂停无效。
**建议**：改用 `mouseleave`/`blur` 阻止 + 周期性 `safePlay` 兜底（force-play 已做），或明确声明该脚本的有限作用域。

- `L59` 监听 `{capture:true,passive:false}` 从不移除；配合 `L103 MutationObserver` + `L114` 每 2s `m1()` 重复 `addEventListener`（同源同选项浏览器去重，不重复绑定 ✅），iframe 内重复进入会累积（`L84 i1` 递归），可接受。

### 3.7 `browser-media-collector.user.js`

- `L43 JSON.parse` 已 `try/catch` 返回 `[]`（安全）。
- **【中】`L86/L58` `GM_setValue` 大数组可能 quota 超限**，仅 `warn(L89)` 不丢内存，但下次 flush 反复失败。**建议**：分片存储或压缩。
- `L156/L157 play` 监听从不移除；`L114 message` / `L269 beforeunload` / `L270 visibilitychange` 同理；`@match *://*/*` 全站点注入放大监听数（单页常驻可接受，全站浪费）。
- **【中】`L50-61 appendStore` 与 `L68-92 flush` 跨 frame 双写竞态**：frame 与 top 同时 `GM_setValue` 同一键，读改写竞态可能丢条目（注释 L75 已坦白）。**建议**：统一由 top 单点写入，frame 经 `postMessage` 上报。

---

## 4. 跨文件一致性

**对齐良好 ✅**
- 桥默认端口 `7531`、探测端口列表、localStorage 键 `cx_bridge_base` 在 force-play 与 auto-next 间一致。
- playlist JSON 字段（`knowledgeId/index/title/completed/unfinishedCount/hasTaskPoints/jobids/objectids` + 顶层 `courseid/clazzid/cpi/courseName`）与 `dump.py:329-350` **完全对齐**；`kid` 双方均按 String 兜底比较，`completed` 字段直接用于 force-play 续播决策。

**需注意 ⚠️**
- `cx_skip_intro` / `cx_auto_next` / `cx_progress` 在代码中被字符串提及但**实际不存在**，若有文档引用会误导。
- Python 侧 `ACTIVE_COURSE_IDS` 硬编码白名单，浏览器侧 force-play 通过 playlist 的 `completed` 间接耦合——**Python 侧白名单变更需重跑 `dump.py` 才会反映到浏览器侧**。
- 已废弃的 `allinone` 与现役 `auto-next` 关键词/行为漂移，存在"双事实来源"风险。

---

## 5. 整体评价

**功能完整性：★★★☆☆（3/5）**
- Python 爬虫定位"只读快照"，核心链路（登录校验 → 课程 → 递归章节任务点 → playlist 生成 → 断点续跑/陈旧清理）完整且健壮。
- 但**心跳探测、作业拉取、jobid/objectid 提取在默认模式完全不可用**，需开启 `RENDER_JOBS`（依赖 Playwright/Edge），属于"半完整"。
- 浏览器侧 force-play + auto-next 功能完整；其余为可选辅助脚本，且 `no-pause` 实际防暂停无效、`allinone` 已废弃。

**健壮性：★★★★☆（4/5）**
- Python：每步 `try/except` 包裹、原子写、限速、指数退避重试、运行锁、逐层类型守卫、断点续跑——扎实。
- JS：DOM 解析 / 桥探测均有回退路径；主要薄弱点是**全局轮询与监听器从不清理**（SPA/多 frame 累积）、force-play `matchedAny` 回退保护在特定场景失效、auto-next `getOverlay` 可见性误判误暂停。

**工程规范性：★★★☆☆（3/5）**
- 优点：Python 模块划分清晰、注释详尽（含"审查#X"追溯）；安全边界（只读、仅本机、CORS 仅 playlist）设计到位。
- 缺点：① 个人课程 id 硬编码于源码；② `print`/`logger` 混用；③ `_to_int` 重复实现；④ 缺 `requirements.txt` 锁版本；⑤ JS 大量魔法值/端口分散、重复逻辑（elVisible/visible、双写 store）、已废弃 `allinone` 未清理；⑥ 定时器/监听器无销毁机制。

---

## 6. 优先级修复建议（Top 10）

| # | 优先级 | 位置 | 问题 | 修复 |
|---|---|---|---|---|
| 1 | 高 | `dump.py:43-51` | 个人课程 id 硬编码源码 | 移到 `courses.json`/环境变量 `CX_COURSE_IDS` |
| 2 | 中 | `chapters.py:264/268` + `:231` | 落盘 HTML 与 `best_html` 不一致 | 仅更新 `best_html` 时写文件 |
| 3 | 中 | `force-play L485/L500/L295/L962` | `matchedAny`/`_targetMissStreak` 回退保护失效 | 明确计数语义、空窗重置 |
| 4 | 中 | `courses.py`/`dump.py` | `print` 与 `logger` 混用 + `_to_int` 重复 | 统一 `logger`、抽公共 util |
| 5 | 中 | 全部 JS | 全局定时器/监听器从不清理 | 提供 destroy 清理控制器（AbortController） |
| 6 | 中 | `auto-next L523` | `getOverlay` 可见性误判误暂停 | 两选择器分别 `elVisible` 后取可见者 |
| 7 | 中 | `no-pause L51-52` | `preventDefault` 防暂停实际无效 | 改用 `mouseleave`/`blur` + 周期 `safePlay`，或声明有限作用域 |
| 8 | 低 | `allinone` | 已废弃未清理、与 auto-next 漂移 | 归档/删除，收敛单一事实来源 |
| 9 | 低 | 仓库根 | 缺 `requirements.txt` | 补充并 pin `requests`/`playwright` |
| 10 | 低 | `bridge.py:63/87` | 冗余路径/数字校验 | 删除无效分支 |

**一句话总结**：这是一套目标明确、安全边界清晰、Python 侧工程质量中上的"学习通只读快照+浏览器辅助"工具集；主要风险集中在（a）硬编码个人配置、（b）JS 侧全局资源从不释放与个别回退/判定逻辑缺陷、（c）默认模式下心跳/作业功能缺位。按上表 Top 5 修复后，健壮性与可维护性可明显提升。
