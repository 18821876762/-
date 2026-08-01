# 工作空间代码审查报告

> 审查范围：`perception/cx_crawler/`（Python 只读爬虫 + 本地桥服务）与 9 个浏览器用户脚本（`*.user.js`）。
> 项目本质：一套「超星/学习通」**只读**自动化工具——Python 侧抓取课程任务点快照并暴露本地 HTTP 接口，浏览器侧脚本实现强制续播 / 自动下一章 / 防暂停 / 进度面板等。
> 说明：行号基于本次审阅的代码版本，部分以「函数名 / 片段」定位以保证准确。

---

## 一、总体结论（先给结论）

| 维度 | 评价 | 说明 |
|------|------|------|
| **功能完整性** | ★★★☆☆ | 核心目标（只读快照 + 本地 playlist 驱动续播/跳章）完成度高；但「作业拉取」「心跳」在默认（无渲染）模式下几乎失效（被 Playwright 渲染门控）。 |
| **健壮性** | ★★★★☆ | Python 侧突出（原子写、运行锁、断点续跑、多层类型守卫防静默空跑）；薄弱环节在 `render.py` 的 `finally` 引用未绑定变量、`courses.py` 对 `None` 值无守卫、`bridge.py` 单线程服务、配置优先级反转。 |
| **工程规范性** | ★★★☆☆ | 模块 docstring 与「审计注释（#N）」习惯很好；但存在文档/行为漂移、若干死代码、无测试、依赖未锁定版本、JS 重度依赖函数提升与缩进巧合。 |

**最高优先级修复（建议先做）**：
1. `config.py` 桥配置优先级反转（env 被 json 覆盖，违背文档）。
2. `render.py` `finally` 中 `browser` 可能未绑定 → `NameError` 掩盖真实错误。
3. `progress-panel.user.js` 给 `fetch` 设置 `Referer`（禁设头）导致章节详情拉取很可能失败。
4. `courses.py` 对 `clazzid/cpi` 为 `None` 无守卫 → URL 注入字符串 `"None"`，章节请求失真。
5. `bridge.py` 使用单线程 `HTTPServer`，浏览器并发请求会串行阻塞。

---

## 二、Python 端问题清单（`perception/cx_crawler/`）

### 🔴 严重 / 运行时风险

**R1. `render.py` — `finally` 引用可能未绑定的 `browser`**
- 位置：`render_course_taskpoints` 的 `try/finally`（launch 与 `finally: browser.close()`）。
- 表现：`browser = pw.chromium.launch(...)` 若抛异常（如未装 Edge / `playwright install` 缺失），`browser` 从未赋值；进入 `finally` 执行 `browser.close()` 触发 `NameError`。
- 后果：真实启动错误被 `NameError` 掩盖，且 `NameError` 本身可能未被上层 `dump._render_and_backfill` 的 `try/except` 完全兜住，导致栈混乱、难以定位。
- 建议：
  ```python
  browser = None
  try:
      browser = pw.chromium.launch(channel="msedge", headless=True)
      ...
  finally:
      if browser is not None:
          browser.close()
  ```

**R2. `courses.py` — `clazzid`/`cpi` 为 `None` 时未守卫**
- 位置：`fetch_courses` 内 `clazzid = ch.get("key")`、`cpi = content.get("cpi")`、`courseid = course.get("id")`（约 76–89 行）。
- 表现：已对「非 dict 的 channel/content/course」做了 `isinstance` 守卫，但对**值为 `None`** 的情况没有拦截。随后 `API[...].format(clazzid=None, cpi=None, ...)` 会把字符串 `"None"` 拼进 URL。
- 后果：该课程后续章节拉取得到畸形 URL → 200 但空数据 / 404，且因为 `channelList` 不为空，不会触发 fallback，表现为「该课任务点为空」而非报错。
- 建议：对 `clazzid is None or courseid is None` 直接 `continue` 并打印告警（与现有逐层兜底风格一致）。

**R3. `config.py` — 桥配置优先级反转（env 被 json 覆盖）**
- 位置：`_load_bridge_config`（约 91–116 行）；文档见 `bridge.py` 第 19–20 行注释：`命令行 > 环境变量 > bridge_config.json > 默认值`。
- 表现：代码先读环境变量，再用 `bridge_config.json` 的 `host/port` **无条件覆盖**（`if c.get("host"): host = str(c["host"])` 等）。实际优先级变为 `命令行 > json > 环境变量 > 默认`。
- 后果：用户设 `CX_BRIDGE_PORT=7532` 期望覆盖 `bridge_config.json` 中的旧值，会被静默忽略，桥监听在错误端口，浏览器侧连不上。
- 建议：JSON 仅在 env 缺失时兜底：
  ```python
  host = (os.environ.get("CX_BRIDGE_HOST") or c.get("host") or _BRIDGE_DEFAULT_HOST)
  env_port = os.environ.get("CX_BRIDGE_PORT")
  port = int(env_port) if env_port else (int(c["port"]) if c.get("port") is not None else _BRIDGE_DEFAULT_PORT)
  ```

### 🟡 逻辑 / 健壮性问题

**L1. `dump.py` — 断点续跑跳过了渲染回填**
- 位置：`main()` 中 `if cid in done and not FORCE_RERUN: ... continue`（约 172–175 行）。
- 表现：命中断点的课程直接 `all_tasks.extend(done[cid])` 并 `continue`，**不会**调用 `_render_and_backfill`。
- 后果：首次跑过（默认无渲染）后，即便后续开启 `RENDER_JOBS=True`，已续跑的课程永远拿不到 `jobid/objectId/type`，除非手删 `03_tasks_*.json` 或 `FORCE_RERUN`。
- 建议：续跑命中时，若 `RENDER_JOBS` 且 `done[cid]` 中多数缺 `jobids`，仍调用渲染回填。

**L2. `dump.py` / `quizzes.py` — 作业拉取在默认模式下形同虚设**
- 位置：`quiz_task = next((t for t in all_tasks if _is_quiz_type(t.get("type"))), None)`（约 192 行）。
- 表现：`type` 字段仅在 `RENDER_JOBS=True` 渲染后由 `infer_type` 填充；默认模式恒为 `None` → `_is_quiz_type(None)` 为 `False` → `quiz_task` 恒 `None` → 永远走 `else`（只打印 type 取值）。
- 后果：默认配置下「作业拉取」功能完全不可用，与 README/文档给人的「能拉作业」印象不符。属于**功能完整性缺口**。
- 建议：在文档与 README 显著说明「作业/类型识别需 `RENDER_JOBS=True`」；或默认模式也用启发式（如 `hasTaskPoints` 且 `unfinishedCount>0`）提示作业章。

**L3. `chapters.py` — 种子兜底取「最小 id」未必是根节点**
- 位置：`extract_seed_chapter_id` 末尾 `return sorted(ids, key=lambda x: int(x))[0]`（约 75 行）。
- 表现：前两手（firstLayer / cur）都失败时才用「全部 knowledgeId 中数值最小者」作种子，注释称「最可能是根/顶层」。
- 后果：`cur` 节点 id 是递增业务 id，最小值往往是**最深的叶子**而非根；用叶子作种子可能只返回该分支子树，章节抽取不全。
- 建议：优先保留 firstLayer；无 firstLayer 时直接用 `"0"` 种子（文档已承认 `"0"` 在正确 Referer 下可返回完整树），避免「取最小」这一脆弱假设。

**L4. `api_client.py` — 4xx 不重试也不抛错**
- 位置：`_http_get` 中 `if r.status_code >= 500: r.raise_for_status()`（约 66–72 行）。
- 表现：4xx（如 cookie 过期 403、资源 404）不抛异常、`with_retry` 不触发，调用方拿到空/错误 body。
- 后果：设计上「客户端错误不重试」可接受，但 `verify_login` 直接 `s.get` 绕过了 `ApiClient`，弱网下一次抖动就让整轮「登录校验失败」。
- 建议：保持现状可接受；仅建议 `verify_login` 也走 `ApiClient.get` 以获得一致的限速/重试/DEBUG 日志。

**L5. `session.py` — `verify_login` 绕过封装、无重试**
- 位置：`verify_login` 内 `throttle()` 后 `s.get(API["courses"])`。
- 表现：未使用 `ApiClient`，瞬时 5xx 不会重试，异常直接上抛（在 `dump.main` 被捕获返回）。
- 后果：弱网下一次抖动就让整轮「登录校验失败」。建议复用 `ApiClient.get`。

**L6. `session.py` — `load_cookies` 的 `elif` 分支是死代码且行为混乱**
- 位置：`load_cookies` 的 list 分支（约 28–38 行）。
- 表现：第一层 `if isinstance(item, dict) and "name" in item and "value" in item` 已吃掉所有合法 dict；`elif isinstance(item, dict)` 只在「缺 name/value」时进入，而其中又 `if "name" in item and "value" in item`——此条件**永远为假** → 必然 `raise ValueError`。注释提到的「#10 兜底分支脆弱依赖字典插入顺序」与实际（直接拒绝）不符。
- 后果：可维护性差、注释误导；任何缺字段的 cookie 项都会被拒绝而非跳过/告警。
- 建议：合并为单一路径，对缺字段的项 `logger.warning` 后 `continue`，仅对无法识别的结构才 `raise`。

**L7. `bridge.py` — 单线程 HTTP 服务**
- 位置：`main()` `httpd = HTTPServer(addr, _Handler)`（第 135 行）。
- 表现：`HTTPServer` 同步串行处理请求。浏览器常并发发 `/ping` + `/playlist/index` + 预检 OPTIONS + 实际 GET，且若有请求慢（JSON 解析/大文件），后续请求排队。
- 后果：本地桥在页面并发拉取时可能出现「转圈/偶发卡顿」，极端下若某请求阻塞会拖住全部。
- 建议：改用 `from http.server import ThreadingHTTPServer`（`ThreadingHTTPServer(addr, _Handler)`），改动一行、收益明显。

**L8. `bridge.py` — 冗余校验与正则**
- 位置：第 63 行路径穿越双校验；第 87 行 `m and _CID_RE.match(m.group(1))`（`_CID_RE` 已被 `^\d{1,12}$` 的 `re.match` 保证）。
- 表现：路径穿越检查中 `path = os.path.join(OUTPUT_DIR, filename)` 与 RHS 恒等（filename 已由 `\d{1,12}` 校验，不可能穿越），校验形同摆设；`_CID_RE` 重复校验。
- 后果：无害但增加阅读噪音。建议删除冗余校验、保留一处清晰的注释说明「cid 已正则校验，filename 不可外部构造」。

### 🟢 性能 / 可读性 / 规范

**G1. `config.py` — `API["courses"]` 用 `http://`**
- 位置：第 18 行 `http://mooc1-api.chaoxing.com/...`，而 `HEADERS` 的 `Referer` 是 `https://`。
- 后果：混合协议；现代站点可能 HSTS 升级/301，`courses.py` 的 fallback 仅做域名字符串替换、仍保留 `http`，链路脆弱。
- 建议：统一 `https://`。

**G2. `config.py` — 不真实的 User-Agent**
- 位置：第 45 行 `Chrome/150.0.0.0 ... Edg/150.0.0.0`。
- 后果：Chrome/Edge 实际大版本约 12x，150 明显失真，可能触发反爬 UA 校验或显得可疑。建议用贴近真实的值（如 `120.0.0.0` 区间）。

**G3. `api_client.py` — `get_json` 死代码**
- 位置：`get_json` 函数（保留/未使用）。
- 后果：无害；清理或加 `@unused` 注释以免误用。

**G4. `dump.py` — `atexit` 释放锁遇锁文件已删会抛 `FileNotFoundError`**
- 位置：`atexit.register(lock.release)` + `RunLock.release` 的 `os.remove`。
- 后果：若用户手动删过 `.runlock`，退出时 `os.remove` 抛 `FileNotFoundError`，在 `atexit` 中打印无关回溯。建议 `release` 内 `try/except FileNotFoundError: pass`。

**G5. 依赖未锁定版本**
- 位置：`perception/cx_crawler/requirements.txt`（`requests>=2.25.0`、`playwright>=1.40.0`）。
- 后果：`>=` 范围在跨环境/时间推移后可能拉到破坏性大版本（尤其 playwright API 变动频繁），复现性弱。建议锁定主版本或给出已知可用版本（如 `playwright==1.4x`）。

---

## 三、JavaScript 端问题清单（`*.user.js`）

### 🔴 严重 / 运行时或功能失效

**J1. `chaoxing-progress-panel.user.js` — 给 `fetch` 设置 `Referer`（禁设头）**
- 位置：`getText` 中 `headers: {'Referer': referer, 'X-Requested-With': 'XMLHttpRequest'}`（章节详情抓取处）。
- 表现：`Referer` 属于**禁止设置头（forbidden header name）**，浏览器会静默忽略。而 Python 侧 `build_chapter_headers` 明确「Referer 校验必需」。
- 后果：「章节详情」子功能发出的请求缺少 Referer → 接口大概率拒绝/返回空，面板章节数据拉不到或残缺。这是真实功能失效。
- 建议：浏览器无法用 fetch 伪造 Referer；要么在已处于 `studentstudy` 页面的上下文里直接抓取，要么用带正确 Referer 的导航 iframe，或在代码/文档中明确该子功能受限。

**J2. `chaoxing-progress-panel.user.js` — `[id^="cur"]` 过度匹配**
- 位置：`parseChaptersHTML` 内 `root.querySelectorAll('[id^="cur"]')` 再 `n.querySelector('[id^="cur"]')`。
- 表现：匹配**任何**以 `cur` 开头的 id（`current`、`cursor`、`cur-xxx`），而 Python 侧用 `cur\d{6,}`（6 位以上数字）。随后 `kid = n.id.replace(/^cur/, '')` → 例如 `id="current"` 会得到 kid `"rent"`。
- 后果：面板章节列表混入垃圾条目、key 失真。
- 建议：改成正则过滤 ` /^cur\d{6,}$/`，与 Python 对齐。

**J3. `chaoxing-browser-media-collector.user.js` — 本地端点分支必然失败**
- 位置：`sendToLocalEndpoint` 依次尝试 `/.cx-collector-frame` 与 `http://127.0.0.1:7532`。
- 表现：桥服务（bridge.py）监听 `7531` 且**没有** `/.cx-collector-frame` 路由；`7532` 也无对应服务。于是该分支每次都连不上/404，被静默 catch 后回退到 `console`。
- 后果：「发送到本地端点」功能开箱即无效（虽不致命，有 console 兜底），但命名与默认端口（7531 vs 7532）不一致，易误导。
- 建议：若确实需要本地采集服务，另起并文档化一个监听 7532 的服务；否则移除此分支，避免「假功能」。

### 🟡 逻辑 / 健壮性问题

**J4. `chaoxing-no-pause.user.js` — 每 2 秒全文档扫描（性能瓶颈）**
- 位置：`setInterval(m1, 2000)` → `m1` 调 `x1()`；`x1` 执行 `document.querySelectorAll('*')` 遍历**整棵文档**每个元素，检查 `shadowRoot`/`iframe` 并递归进入所有影子根与 iframe 注入监听。
- 表现：页面复杂（多 iframe / 影子 DOM / 弹幕）时，每 2 秒一次 O(N) 全量扫描 + 递归，开销可观；与已有的 `MutationObserver(s1)` 去抖去重形成「双保险但重复劳动」。
- 后果：复杂课程页可能掉帧/卡顿，尤其低端机或后台多标签页。
- 建议：以 `MutationObserver` 为主，全量 `x1` 仅在初始化与少量兜底时调用；或将扫描范围限定到播放器容器而非 `document`。

**J5. `chaoxing-auto-next.user.js` — `lock()` 提前 return 后仍占用忙锁最长 8 秒**
- 位置：`run(allowFallback)` 入口 `lock()`（约 304 行），`NAV_LOCK_TIMEOUT` 默认 8000ms；函数内多处 `return` 发生在 `lock()` 之后。
- 表现：即便本次 run 立刻 `return`（例如点了作业按钮、或无需动作），`busy` 仍为真最长 8 秒，期间其它 `run()` 被挡在 `if (busy) return`。
- 后果：8 秒去抖偏长，可能错过快速连续出现的「下一章」机会（与「自动下一章」诉求相悖）。
- 建议：成功执行了导航/点击后主动 `unlock()`；或缩短超时（如 1500–3000ms）。

**J6. `chaoxing-auto-next.user.js` — `holdPause` 依赖 `v.__np`（强制播放未接管时失效）**
- 位置：`holdPause`：`var nat = v.__np || v.pause; nat();`。
- 表现：force-play 会安装 `v.__np`（原生 pause）。若 force-play 未安装或该视频尚未被 force-play 接管，`v.__np` 为 `undefined`，退化为 `v.pause()`；但 force-play 一旦安装就会把 `HTMLMediaElement.prototype.pause` 覆写为「强制播放视频的 no-op」——若该视频恰好**未被** force-play 标记 `__cxForcePaused`，`v.pause()` 走原型 no-op → **暂停失败**。
- 后果：极少数「force-play 已装但未接管该视频」场景下，auto-next 的暂停（用于等待自动暂停）静默失效。
- 建议：在调用前显式判断 `if (v.__np) v.__np(); else v.pause()` 已做；但更稳妥是检测 force-play 是否在场，或统一通过事件协调，而非依赖原型覆写副作用。

**J7. `chaoxing-visibility-resume.user.js` — 回到前台可能恢复「旧视频」**
- 位置：`vh`（visibilitychange→visible）恢复 `y1`（自动暂停那一刻捕获的 video）。
- 表现：SPA 在隐藏期间已切到新章节，`y1` 仍 `isConnected` 且 `paused` → 脚本会播放**旧**视频而非当前可见视频。
- 后果：回到前台后可能播放一个已不在视口/非当前的视频。
- 建议：恢复前重新查询「当前播放中的可见视频」，而非固定 `y1`。

**J8. `chaoxing-force-play.user.js` — `TARGET.enabled` 一旦置真永不回退**
- 位置：`refreshTargets` 中 `if (info && info.ids && Object.keys(info.ids).length) TARGET.enabled = true; else if (!TARGET.enabled) { TARGET.enabled = false; }`。
- 表现：`enabled` 只在「本就 false 且本次空」时才置 false；一旦为 true 则恒 true。注释称「瞬时空窗保持稳定」，但副作用是离开课程页后脚本仍长期停在「定向模式」。
- 后果：非课程页也可能持续做视频接管/restoreNativePause；通常无害，但增加不必要开销与误伤风险。
- 建议：增加「离开课程页/一段时间无匹配」后主动复位 `enabled=false` 的策略。

### 🟢 可读性 / 规范 / 轻微

**J9. `chaoxing-force-play.user.js` — 缩进异常与依赖函数提升**
- 位置：约 186 行 `collectAttachmentIds` 缩进多出 4 空格（看似嵌套），但它是顶层 `function` 声明，靠提升可用；`refreshTargets`（约 244 行）在其后被引用同样靠提升。
- 后果：非 bug，但降低可读性，后续维护易误改。建议修正缩进、将工具函数集中到顶部。

**J10. `chaoxing-deceive-api.user.js` — `w1.prototype = r1.prototype` 是死代码**
- 位置：`function w1(...){ return new r1(...); }` 之后 `w1.prototype = r1.prototype;`。
- 表现：`w1` 构造函数内部 `return new r1(...)`，`new w1()` 实际得到 `IntersectionObserver` 实例，`w1.prototype` 永不被使用。
- 后果：无害死代码。建议删除。

**J11. `chaoxing-allinone.user.js` — `@require` 版本漂移**
- 位置：`@require` 写死各独立脚本 URL（含版本号）。
- 表现：独立脚本升版后，allinone 不会自动跟随，可能拉到旧版；也无单一版本源。
- 建议：在 README 标注「allinone 的 @require 版本需随独立脚本手动同步」，或改由构建脚本生成。

**J12. `chaoxing-progress-panel.user.js` — 文档/版本漂移 & 无超时**
- 位置：文件头注释「与 auto-next(2.0)/force-play(3.4) 共存」（实际 2.3/3.15）；`getJSON`/`getText` 无 `AbortController` 超时。
- 后果：注释误导；请求挂起时面板卡在「加载中…」。建议更新版本号、给 fetch 加 `AbortController`（如 15s）。

**J13. `chaoxing-visibility-resume.user.js` — 自动暂停判定窗口偏紧**
- 位置：`w1 = 1500`（ms）判定窗口。
- 后果：若平台在 `visibilitychange(hidden)` 后 >1.5s 才发出 `pause` 事件，会被误判为「用户手动暂停」，导致回到前台不续播。建议适度放宽（如 3000ms）或结合 `play` 事件反向校正。

---

## 四、跨文件 / 工程实践问题

**P1. 文档与行为漂移**
- `crawler-framework-architecture.md` 提到 `create_session`，实际代码是 `build_session`+`verify_login`+`warmup`——函数名不符，新人按文档找不到入口。
- `chaoxing-progress-panel.user.js` 头注释版本号过期；`chaoxing-allinone.user.js` 的 `@require` 版本无单一真相源。
- 建议：文档与代码同步更新，关键 API 改名时在文档标注。

**P2. 无测试、无 lint 配置**
- 整个仓库无单元测试、无 `pytest`/`flake8`/`mypy` 配置。对于含大量正则解析（chapters/courses/progress-panel）与并发逻辑（render/bridge）的代码，回归风险高。
- 建议：至少对 `parse_chapter_tasks`/`extract_knowledge_ids`/`_parse` 等纯函数加少量单测；CI 加 `flake8`。

**P3. 浏览器脚本间隐式耦合**
- force-play 通过原型覆写 `pause` 并把原生实现放进 `v.__np`；auto-next/visibility-resume/no-pause 都依赖这一约定。任一脚本改名/失效，协作即破。虽有 `window.__cxForcePaused` 等标志协调，但属「全局副作用」式设计，可维护性一般。
- 建议：用显式事件（`dispatchEvent`/`CustomEvent`）或共享命名空间对象做协调，降低对原型覆写的依赖。

**P4. 一致的「只读合规」姿态做得好**
- 值得肯定：`dump.py` 全链路 try/except 防静默空跑、`_load_done_tasks` 仅接受非空列表作断点、`atomic_write_*`、`.runlock` 跨进程锁、`reverse_enc`/心跳只分析不上报——这些共同保证了「不提交/不修改平台状态」的承诺，是项目最扎实的部分。

---

## 五、修复优先级建议（行动清单）

1. 【高】`render.py`：`browser = None` + `finally: if browser: browser.close()`（R1）。
2. 【高】`courses.py`：对 `clazzid/courseid/cpi` 为 `None` 守卫并 `continue`（R2）。
3. 【高】`config.py`：桥配置改为「env 优先于 json」（R3/G 一致性）。
4. 【高】`progress-panel.user.js`：去掉对 `Referer` 的 fetch 设置或改用可行的抓取上下文（J1）；`[id^="cur"]` 加 `^\d{6,}$` 过滤（J2）。
5. 【中】`bridge.py`：改用 `ThreadingHTTPServer`（L7）。
6. 【中】`dump.py`：续跑命中时也允许渲染回填（L1）；明确作业拉取需 `RENDER_JOBS`（L2）。
7. 【中】`no-pause.user.js`：缩小全量扫描范围、以 MutationObserver 为主（J4）。
8. 【中】`auto-next.user.js`：成功动作后主动解锁、缩短 NAV 锁（J5）；`holdPause` 兼容 force-play 缺位（J6）。
9. 【低】清理死代码：`get_json`(G3)、`load_cookies` 的 `elif`(L6)、`w1.prototype`(J10)、`GUARD_REMOVAL=false` 的未启用守卫。
10. 【低】`requirements.txt` 锁定主版本（G5）；补 `flake8`/`pytest` 骨架（P2）。

---

## 六、一句话总评

这是一套**目标清晰、在「只读合规」边界上设计得很克制且 Python 侧相当健壮**的工具集；主要风险集中在少数几个**明确的运行时/功能失效点**（render 的 `finally` 引用未绑定变量、courses 的 `None` 守卫缺失、桥配置优先级反转、进度面板的禁设头 `Referer` 与过度匹配选择器），以及若干**JS 性能/可读/耦合**问题。修复上述前 5 项即可显著提升整体可靠性，工程规范性随「补测试 + 文档对齐」而补齐。

---

## 七、修复状态（2026-07-28）

行动清单前 5 项已全部落地，并通过 `py_compile` 与 JS lint 校验：

| # | 项 | 状态 | 落点 |
|---|---|---|---|
| 1 | R1 render.py `finally` 未绑定变量 | ✅ 已修复 | `browser=None` + 纳入 `try` + `if browser is not None: close()` |
| 2 | R2 courses.py `None` 守卫 | ✅ 已修复 | `clazzid/courseid` 为 `None` 时 `continue` 跳过 |
| 3 | R3 config.py 桥配置优先级反转 | ✅ 已修复 | 改为 env > json > 默认；抽出 `_default_or_int` |
| 4 | J1/J2 progress-panel Referer 伪造 / cur 过度匹配 | ✅ 已修复 | 移除禁设头 `Referer`；`parseChaptersHTML` 用 `/^cur\d{6,}$/` 过滤；头部版本号对齐 |
| 5 | L7 bridge.py 单线程 | ✅ 已修复 | `HTTPServer` → `ThreadingHTTPServer` |
| 6 | L1 dump.py 续跑跳渲染回填 | ✅ 已修复 | 新增 `_maybe_render_backfill`，续跑命中+RENDER_JOBS 且缺媒体 id 过半时补跑 |
| 7 | L2 dump.py 作业拉取门控 | ✅ 已修复 | 默认模式提示需 RENDER_JOBS + 启发式候选；README 同步 |
| 8 | L6 session.py 死 elif | ✅ 已修复 | 缺字段项告警后跳过，不再 raise |
| 9 | G3 api_client.get_json 死代码 | ✅ 已修复 | 删除未使用预留方法 |
| 10 | J10 deceive-api w1.prototype 死代码 | ✅ 已修复 | 删除恒无效赋值 |
| 11 | no-pause GUARD_REMOVAL 死守卫 | ✅ 已修复 | 移除恒 false 开关及其包裹块 |
| 12 | G1 config.py courses 接口 http→https | ✅ 已修复 | `API["courses"]` 改 `https://`，与 HEADERS.Referer 协议一致 |
| 13 | G2 config.py 失真的 User-Agent | ✅ 已修复 | `Chrome/150`/`Edg/150` → `Chrome/138`/`Edg/138` |
| 14 | G4 config.py RunLock.release 健壮性 | ✅ 已修复 | 显式吞掉 `FileNotFoundError`，atexit 不再打印无关回溯 |
| 15 | G5 requirements.txt 依赖版本锁定 | ✅ 已修复 | `requests<3`、`playwright<2`（已知可用 1.47.0） |
| 16 | L4/L5 扩展 with_retry 范围至登录校验 | ✅ 已修复 | `verify_login` 改经 `ApiClient.get`，纳入限速+重试+DEBUG 日志 |
| 17 | J4 no-pause 收窄 2s 全文档扫描 | ✅ 已修复 | `x1` 改窄选择器 `#videoBox/.ans-attach-ct/iframe`，仅命中元素递归 |
| 18 | J5 auto-next run 提前 return 释放忙锁 | ✅ 已修复 | 新增 `unlock()`，未实际点击/导航时立即释放，不空占 8s |
| 19 | J6 auto-next holdPause 守卫 `__np` | ✅ 已修复 | 仅 force-play 接管(`__cxForcePaused`)时调用 `__np`，否则原生 pause |
| 20 | L3 chapters 种子兜底按文档顺序选 id | ✅ 已修复 | 新增 `_first_seed_id`，取文档首次出现的 knowledgeId 替代数值最小 |

其余中/低优项（L8 冗余校验）评估为安全兜底/设计取舍，本期未改动；桥服务冗余校验（L8）为安全兜底亦保留。crawler 版本号升至 `2.3`，详见 `CHANGELOG.md`。
