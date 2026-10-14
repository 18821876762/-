# 代码审查报告：学习通续播/爬虫工具集

> 审查范围：`cx_crawler/*.py`（Python 只读爬虫）、`*.user.js`（8 个浏览器用户脚本）、`CHANGELOG.md`、`STAGES.md` 等文档。
> 结论先行：Python 爬虫整体结构清晰、容错设计到位；用户脚本中 `chaoxing-force-play`(3.15) 与 `chaoxing-auto-next`(2.3) 经过多轮硬化，质量较高；**但 `chaoxing-allinone`(1.0.0) 是一个严重滞后的分叉版本，把已被修复的旧缺陷重新引入，且自身存在致命逻辑冲突**；另有若干 Python 健壮性与文档一致性问题。

---

## 一、Python 爬虫（cx_crawler）

### 1. [严重] `session.py:88` —— `verify_login` 缺少请求超时，可能永久挂起
**位置/代码**
```python
# session.py  verify_login 内部
throttle()
r = s.get(API["courses"])      # ← 没有 timeout=
```
**表现**：`requests.Session.get` 在省略 `timeout` 时默认 `timeout=None`，即无限等待。相比之下 `warmup`（同文件 `s.get(..., timeout=TIMEOUT)`）与 `api_client._http_get`（`config.py` 派生的 `timeout=TIMEOUT`）都正确传了超时。
**后果**：若服务器接受 TCP 连接但迟迟不返回（黑洞/慢速连接/Slowloris 场景），`verify_login` 会一直阻塞，`dump.py:main()` 卡死在登录校验这一步，且没有任何重试/超时兜底，整个爬虫进程假死。
**建议**：改为 `r = s.get(API["courses"], timeout=TIMEOUT)`，与项目其它请求保持一致。

### 2. [维护性/死代码] `session.py:28-38` —— `load_cookies` 的 `elif` 分支是不可达的冗余代码
**位置/代码**
```python
if isinstance(item, dict) and "name" in item and "value" in item:
    jar.set(name, value, domain=...)
elif isinstance(item, dict):                     # 仅当上面为 False 时进入
    if "name" in item and "value" in item:      # ← 与第 28 行条件完全相同，永远为 False
        ...
    else:
        raise ValueError(...)
```
**表现**：`elif` 只在“是 dict 但不含 name/value”时触发，而它内部的 `if "name" in item and "value" in item` 又要求“含 name/value”，二者互斥——内部赋值代码永远执行不到，分支只会走到 `raise ValueError`。注释写的“v2.2（#10）兜底分支脆弱”与代码实际行为不符，该分支并未做任何“兜底”解析。
**后果**：误导性代码，读者会误以为这里有容错逻辑；实际与直接删除该 `elif` 行为一致。**非运行时错误，但损害可维护性**。
**建议**：若无需兼容非标准 cookie 格式，直接删除 `elif` 整块（`else: raise` 已覆盖非法格式）；若要真正兜底，应实现有意义的解析而非重复判断。

### 3. [健壮性] `courses.py:66,70,72` —— 用 `(x or {}).get(...)` 假设 dict，但接口可能返回 list，导致整个课程抓取崩溃
**位置/代码**
```python
for ch in channel_list:
    content = ch.get("content", {}) or {}        # 若 ch["content"] 是 list → content 变成 list
    clazzid = ch.get("key")
    cpi     = content.get("cpi")                 # list 没有 .get → AttributeError
    course  = (content.get("course", {}) or {}).get("data", [{}])  # 同样崩溃点
```
**表现**：`(obj or {})` 仅在 `obj` 为 `None`/`""`/`0`/`[]` 等“假值”时才回退为 `{}`。当接口把 `content` 或 `content.course` 返回为**非空 list** 时，`(list) or {}` 返回 list，`list.get(...)` 抛 `AttributeError`。该 `for` 循环**没有 try/except**。
**后果**：一旦某门课程结构略有不同（list 而非 dict），`fetch_courses` 抛异常上抛到 `dump.py:147`，被外层 `except` 吞掉并置 `all_courses=[]`，**整个课程列表为空 → 下游全部章节/任务点抓取静默产出空结果**，无任何课程数据。
**建议**：像 `quizzes.py:44` 那样先做 `isinstance` 守卫：
```python
content = ch.get("content")
if not isinstance(content, dict):
    content = {}
course = content.get("course")
if isinstance(course, dict):
    course = course.get("data", [{}])
# 再对 list 情形做 isinstance 处理
```

### 4. [潜在健壮性] `courses.py:21` —— `_parse` 的嵌套回退对 `data.data` 为 list 同样会抛异常
**位置/代码**
```python
channel_list = (data.get("data") or {}).get("channelList")
```
**表现**：若 `data["data"]` 是非空 list，`(list) or {}` 返回 list，`.get("channelList")` 抛 `AttributeError`。此处虽被外层 try/except 兜住（置空），但意味着一旦 `channelList` 真正嵌套在 `data.data` 这种结构里，课程列表会被判为空。
**后果**：解析静默失败、课程缺失。
**建议**：`d = data.get("data"); if isinstance(d, dict): channel_list = d.get("channelList")`。

### 5. [次要] `config.py:163` —— `with_retry` 默认 `exceptions=(Exception,)` 捕获过宽
**表现**：装饰器会重试**一切** `Exception`，包括本应是代码 bug 的 `ValueError`/类型错误等。
**后果**：若 `_http_get` 内部出现编程错误，会被重试 3 次（约 1+2+4s 等待）后才上抛，既浪费时间又掩盖真实错误。
**建议**：收窄为 `(requests.exceptions.RequestException,)`（或再并入 `requests.exceptions.HTTPError`），非网络异常直接暴露。

### 6. [次要] `config.py:145` / `config.py:193` —— 原子写与运行锁的小加固点
- `atomic_write_text`：`mkstemp(dir=d or ".")`，当父目录在 `makedirs` 与 `mkstemp` 之间被删除时，`mkstemp` 抛 `FileNotFoundError`；`RunLock.acquire` 只 `except FileExistsError`，父目录缺失会抛 `FileNotFoundError` 未捕获。当前 `dump.py` 在 `acquire` 前已 `os.makedirs(OUTPUT_DIR)`，实际安全；但属脆弱耦合。
- **建议**：`RunLock.acquire` 的 `except` 改为 `except OSError`；`atomic_write_text` 在 `os.replace` 失败时给出更明确报错。

### 7. [文档/行为不一致] `heartbeat.py` 在默认模式下根本不运行
**表现**：`analyze_heartbeat_params` 开头 `if not jobid or not objectid: return None`，而默认 `RENDER_JOBS=False`（config.py:66），`jobid/objectid` 恒为 `None` → 心跳参数探测被整体跳过。
**后果**：`STAGES.md` / `USAGE.md` 描述的“心跳接口探测”在默认静态抓取流程中**不会产生任何结果**，与文档暗示不符。
**建议**：在文档中明确“心跳探测仅在 `RENDER_JOBS=True` 时启用”，或给出离线 `dtoken` 配置入口。

### 8. [正面] 其余 Python 模块质量良好
- `bridge.py`：路径穿越防护（正则 + 拼接二次校验）、CORS、白名单路由、utf-8-sig 容错，设计到位（仅建议 `HTTPServer` 改 `ThreadingHTTPServer` 以支持并发 fetch）。
- `quizzes.py`：`_extract_questions` 用 `isinstance(data.get("data"), dict)` 守卫，是防御式解析的范本（应与 `courses.py` 对照修正）。
- `config.py` 的节流、原子写、trace_id、运行锁等基础设施完整规范。

---

## 二、浏览器用户脚本（userscripts）

### 9. [严重/分叉回归] `chaoxing-allinone.user.js` —— 基于过期版本（force-play 3.2 + auto-next 1.5），重新引入已修复缺陷
`@version 1.0.0` 的元数据声称“合并 chaoxing-force-play(3.2) 与 chaoxing-auto-next(1.5)”，而仓库中现行独立脚本已是 **force-play 3.15 / auto-next 2.3**。这导致 allinone 缺失 v3.9–v3.15 的全部硬化，且有若干独立缺陷：

#### 9a. `safePlay` 永不恢复音量（脚本永久静音）  — `allinone.user.js:29-36`
```js
function safePlay(v) {
  var p = v.play();
  if (p && p.catch) p.catch(function(){ v.muted = true; v.play().catch(function(){}); });
  // ← 没有任何把 v.muted 设回 false 的代码
}
```
**表现**：自动播放策略拒绝时，脚本把视频静音后重播，但**全程没有恢复音量的逻辑**（独立 force-play 在 v3.9/v3.11-H 已实现“playing 事件 + promise 双路恢复音量”）。
**后果**：用户看到的视频**永久静音**，体验严重受损。
**建议**：升级 safePlay，在 `playing` 事件中 `if (!wasMuted) v.muted = false`（参考独立 force-play）。

#### 9b. [致命逻辑冲突] 插播题自动暂停依赖 `pause` 事件，但模块 A 把 `pause` 覆盖成 no-op  — `allinone.user.js:332` vs `:44`
```js
// 模块 A：把 pause 直接变 no-op
v.pause = noop;                         // :44
// 模块 B：靠 pause 事件触发 holdPause
v.addEventListener('pause', function(){ ... holdPause(v); ... });  // :332
```
**表现**：平台为插播题调用 `video.pause()` 时，执行的是 no-op，**根本不会派发 `pause` 事件**，于是 `holdPause` 在最常见的触发路径下永不执行——插播题遮罩永远不会被让出，视频在底下照播。模块 B 另设的 `timeupdate(90%)`/`ratechange(0)` 只是部分兜底，对“平台直接 pause”的场景完全失效。独立 auto-next 2.3 正是**为此把检测改为 `checkOverlay` 轮询**才解决。
**后果**：allinone 的核心“插播题暂停让用户答题”功能在多数场景下**实际失效**。
**建议**：照独立 auto-next 2.3 改造为轮询 `.dialog-mask/.ans-job-icon` 可见性，而非依赖 pause 事件。

#### 9c. [致命] `lock()` 不复位 `__cxAN_navigating`，点一次弹层按钮后脚本导航能力永久瘫痪  — `allinone.user.js:99-104`
```js
function lock() {
  ROOT.__cxANbusy = true;
  setTimeout(function(){ ROOT.__cxANbusy = false; }, 8000);  // 只复位 busy，没复位 navigating
}
// 而 run() 开头： if (ROOT.__cxAN_navigating === true) return;   // 永久早退
// fallbackNext() 开头： if (ROOT.__cxAN_navigating === true) return;
```
**表现**：点击弹层里的“继续/答题”等**非导航**按钮（`:214`）会把 `ROOT.__cxAN_navigating` 置为 `true`，但因为这些按钮不是真正跳转，`confirmNav` 不会被安排，`navigating` 再无清除路径（只有 `arm` 在新视频出现时才清，而插播题常发生在同一视频内，`__armed` 守卫使其不再触发）。
**后果**：用户在插播题点一下“继续”后，`run()` 与 `fallbackNext()` 永久早退——**“切下一课/自动答完跳章”彻底失效**。独立 auto-next 2.3 的 `lock()` 同时复位了 `busy` 与 `navigating`（对称超时），不存在此问题。
**建议**：在 `lock()` 的超时回调中同时 `ROOT.__cxAN_navigating = false`；且非导航按钮点击不应置 `navigating` 锁。

#### 9d. `visible()` 用 `offsetParent !== null` 判定可见性，对 `position: fixed` 遮罩失效  — `allinone.user.js:105`
```js
function visible(el){ return !!(el && el.offsetParent !== null); }
```
**表现**：`offsetParent` 对 `position: fixed` 元素恒为 `null`（即使元素可见）。全屏 `.dialog-mask` 多为 fixed 定位，会被判为“不可见”，导致 `clickFirst/clickFirstText` 跳过本应点击的答题入口。
**后果**：插播题/章节检测的按钮点击被静默跳过。
**建议**：改用 `getBoundingClientRect()` 宽高 > 0 且 `getComputedStyle` 的 `display/visibility/opacity` 正常（独立 auto-next 的 `visible()` 已是正确实现，可直接借鉴）。

#### 9e. 其它分叉退化
- 无 ended 重播防护（`__cxEndedLock`/`ENDED_SRCS`/持久覆写 `play`），平台 `video.play()` 重播在两次轮询间可成功。
- `neutralizeAnanas` 用 `a.pause = function(){}` 直接赋值（`:69`），严格模式下若描述符不可写会静默失效（独立 force-play 已改用 `Object.defineProperty`）。
- **完全缺失桥接集成**：不含 `bridgeInit`/`skipResume`/`bridgeNextUnfinished`，无法“精确跳到下一未完成章节”，只能依赖不可靠的 `finished/locked` CSS 类启发式，与 `dump.py` 专门产出的 `playlist_*.json` 设计初衷脱节。

### 10. [真实/高概率] `chaoxing-auto-next.user.js:482-483` —— `getOverlay` 用 `offsetParent` 检测遮罩，对 fixed 遮罩失效
```js
function getOverlay() {
  var o = document.querySelector('.dialog-mask') || document.querySelector('.ans-job-icon');
  if (o && o.offsetParent !== null) return o;   // fixed 遮罩 → offsetParent 恒 null → 返回 null
  return null;
}
```
**表现**：与 allinone 同款缺陷（只是 auto-next 的 `clickFirst` 用的是正确的 `visible()`，唯独遮罩**检测**用错了判断）。当插播题遮罩为 `position: fixed` 时，`getOverlay` 返回 `null`，`checkOverlay`（每 1.5s 轮询）从不暂停视频。
**后果**：auto-next 2.3 的“类型 A 插播题主动暂停”在 fixed 遮罩下失效（注意：auto-next 的点击目标识别 `visible()` 是对的，故“答题入口点击”仍可用，仅“暂停视频”这一环失效）。
**建议**：`return o` 前用 `o.offsetWidth > 0 && o.offsetHeight > 0 || getComputedStyle(o).display !== 'none'` 判断，或复用 `visible(o)`。

### 11. [次要] `chaoxing-no-pause.user.js` —— `document.webkitHidden` 直接赋值可能无效
**表现**：用 `document.webkitHidden = ...` 直接赋值，而 `webkitHidden` 是只读访问器。严格模式或描述符不可写时赋值静默失败，可见性欺骗对依赖 `webkitHidden` 的旧代码路径不生效。
**建议**：对 `webkitHidden` 也用 `Object.defineProperty` 覆写（与 `hidden`/`visibilityState` 一致）。

### 12. [工程规范] `chaoxing-allinone` 与独立脚本的版本/契约割裂
- allinone 元数据写“force-play(3.2)/auto-next(1.5)”，而实际独立脚本为 3.15/2.3；`force-play` 描述又写“与 auto-next(3.4) 共存”——三处版本号互相矛盾。
- allinone 把两个独立演进的脚本**手动合并**成一个巨函数，导致后续无法跟随独立脚本的硬化（v3.9–v3.15 的全部修复都未同步），并引入 9c/9d 这类合并才有的逻辑冲突。
**建议**：除非确有“单脚本分发”的强需求，否则**直接废弃 allinone，改用独立的 force-play + auto-next**（二者已设计为共存）。若必须合并，应改为“构建期拼装”而非手工复制粘贴，以保证与上游同步。

### 13. [正面] 独立 `chaoxing-force-play`(3.15) / `chaoxing-auto-next`(2.3) / `chaoxing-progress-panel` / `bridge.py` 质量较高
- force-play：定向白名单、ended 持久锁、原型 `playbackRate` setter 拦截、MSE `waiting/stalled` 续播、`restoreNativePause` 用自有属性遮蔽原型（正确）、`playing` 事件恢复音量，设计成熟。
- auto-next 2.3：桥清单精确跳章、`checkOverlay` 轮询替代脆弱的 pause 事件、`lock()` 对称复位双锁、`visible()` 用 `getBoundingClientRect` 正确判定。
- progress-panel 为只读展示、risk 低。

---

## 三、文档与工程规范

### 14. [文档自相矛盾] `CHANGELOG.md` 声明“v3.12 零已知缺陷”后又继续迭代到 v3.15
CHANGELOG 在 v3.12 给出“终态评估：零已知缺陷”，随后 v3.13–v3.15 又追加了桥接、端口可配置、伪暂停/MSE 断流等大量改动，使“终态/零缺陷”结论失效且与现状矛盾，易误导维护者。
**建议**：将“终态评估”改为“阶段性评估”，并注明后续仍有迭代。

### 15. [文档/代码不一致] `CHANGELOG.md:6` 写 auto-next 为 `v2.1`，实际文件为 `v2.3`
**建议**：同步版本号，避免读者以为自己拿到的是旧版。

### 16. [架构契约] 跨脚本契约（`v.__cxAN_hold` / `v.__np` / `v.__cxForcePaused`）仅有代码注释约定，缺乏单测/断言
force-play 与 auto-next 通过 DOM 元素上的私有属性协作，是隐式契约。一旦任一脚本字段改名（如 `__cxAN_hold` 拼写变化），另一脚本会静默失效。
**建议**：在双方脚本顶部以常量/常量名集中声明契约字段名，并加运行时一致性自检日志。

---

## 四、总体评价

| 维度 | 评价 | 说明 |
|---|---|---|
| **功能完整性** | Python 爬虫 ★★★★☆；独立用户脚本 ★★★★★；allinone ★★☆☆☆ | 爬虫覆盖课程→章节→任务点→作业→心跳探测全链路；force-play/auto-next 五大主体功能完备。但 allinone 缺失桥接、音量恢复、ended 防护，且插播题暂停/导航在常见场景下失效。 |
| **健壮性** | Python ★★★★☆；独立用户脚本 ★★★★☆；allinone ★★☆☆☆ | 爬虫节流/重试/原子写/运行锁到位；`courses.py` 的 list/dict 假设会导致整轮静默空结果（#3）属明显短板。`verify_login` 缺超时（#1）是潜在挂死点。独立脚本容错良好；allinone 因合并冲突出现“点一次按钮即永久瘫痪”（#9c）等严重问题。 |
| **工程规范** | ★★★☆☆ | 变量命名、注释、`with_retry`/`throttle` 等基础设施规范；但存在死代码（#2）、版本号自相矛盾（#14/#15）、跨脚本隐式契约无保护（#16），以及最突出的“过期分叉 allinone 与上游脱节”（#9/#12）。 |

**最高优先级修复清单**
1. `session.py:88` 给 `verify_login` 加 `timeout=TIMEOUT`（防永久挂死）。
2. `courses.py:66/70/72` 加 `isinstance` 守卫，避免单门课程结构异常拖垮全量抓取。
3. **废弃或彻底重构 `chaoxing-allinone`**：其 `safePlay` 永久静音（#9a）、pause 事件冲突导致插播题失效（#9b）、`lock()` 不复位 `navigating` 导致导航永久瘫痪（#9c）、fixed 遮罩可见性误判（#9d）均为严重缺陷，且本质是过期分叉。推荐直接使用独立的 force-play(3.15)+auto-next(2.3)。
4. `auto-next.user.js:482` 修正 `getOverlay` 的 `offsetParent` 误判。
5. 收敛 `with_retry` 异常范围、`RunLock` 异常捕获；同步文档版本号与“零缺陷”表述。
