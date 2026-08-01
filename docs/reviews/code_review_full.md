# 工作空间代码审查报告（全量）

> 审查范围：`chaoxing-force-play.user.js`、`chaoxing-auto-next.user.js`、`chaoxing-deceive-api.user.js`、`chaoxing-progress-panel.user.js`、`browser-media-collector.user.js`，以及 `cx_crawler/` 下全部 Python 模块（`config / api_client / session / courses / chapters / heartbeat / quizzes / dump / render / bridge`）。
>
> 说明：本仓库是一套「学习通自动播放/跳章/采集 + 本地爬虫」工具链，浏览器端 5 个脚本与 Python 爬虫通过本地 HTTP 桥（`bridge.py`）协作。整体代码**防御性较强**（大量 try/catch、一次性挂钩 `v.__cx` 去重、`{once:true}` 监听、原子写盘），但存在若干可量化缺陷。

---

## 一、总体评价

| 维度 | 评价 | 说明 |
|------|------|------|
| **功能完整性** | 中上 | 自动播放、定向任务点、跳章、插播题遮罩暂停、进度面板、媒体采集、本地爬虫拉课/章节树/任务点渲染均有实现。但 `heartbeat`（心跳）、`multimedia`（多媒体日志）、`quiz`（作业）在默认模式下为占位/死代码，启用相关开关会因缺参而失效或抛错。 |
| **健壮性** | 中上 | 浏览器端对抗平台反制（原型 `pause` 还原、全局暂停封装、iframe 下钻、Shadow DOM）设计严谨；Python 侧有重试、节流、原子写、运行锁、登录校验。但重试策略过宽、部分解析对异常响应形状缺乏防御，存在被掩盖的潜在崩溃路径。 |
| **工程实践规范性** | 一般 | 缺乏统一版本号（脚本 v1.2~4.5 vs Python `VERSION=2.3`）、桥逻辑三份重复拷贝、超长文件与函数、内联注释过载、保留但不可用的 API 占位符形成 KeyError 雷区。 |

**核心结论**：功能可用、运行期崩溃风险低，但**可维护性、部分特性真实可用性、以及少数解析/重试逻辑**需要改进。下面对问题按严重程度列出。

---

## 二、问题清单

### 🔴 高（会导致特性失效或异常）

#### H1. `quizzes.py` — `_extract_questions` 对「`data` 为数组」的响应会抛 `AttributeError`
- **位置**：`cx_crawler/quizzes.py` 中 `_extract_questions` 的候选列表：
  ```python
  (data.get("data") or {}).get("questions"),
  (data.get("data") or {}).get("list"),
  (data.get("data") or {}).get("data", {}).get("questions") if isinstance(data.get("data"), dict) else None,
  ```
- **表现**：当接口返回 `data["data"]` 是 **list**（部分学习通接口确实如此）时，`(list or {})` 求值结果为该 list（truthy），随后 `.get(...)` 在 list 上调用 → `AttributeError`。该候选位于列表推导内，异常未被捕获，会冒泡到 `fetch_quiz` → `dump.py` 主循环 try/except，最终仅打印「获取作业失败」并**静默丢失该作业数据**。
- **后果**：启用 `RENDER_JOBS` 抓作业/测验时，只要遇到 `data` 为数组的接口形态，整批作业解析失败，用户无感。
- **建议**：统一用「先判 `isinstance(..., dict)` 再取」的写法，例如：
  ```python
  def _pick(d, *keys):
      if not isinstance(d, dict): return None
      for k in keys:
          if isinstance(d.get(k), (list, dict)): return d.get(k)
      return None
  ```
  或直接把前三个候选也加上 `isinstance(data.get("data"), dict)` 守卫（与第 5 个候选一致）。

#### H2. `config.py` — 保留 API 模板含未填充占位符，启用即 `KeyError`
- **位置**：`API = _load_api()` 默认字典中的 `node_detail / multimedia / quiz` 模板，例如：
  ```python
  "multimedia": "https://mooc1.chaoxing.com/multimedia/log/a/{clazzid}?...&courseId={courseId}&...&dtoken={dtoken}...",
  "quiz": ".../getListByJobIdV2?jobid={jobid}&courseId={courseId}...",
  ```
- **表现**：`dtoken`、`chapterId` 等占位符在代码里**从未被赋值**（`dtoken` 没有任何提取逻辑，`chapterId` 也未传入 `buildMultimediaParams`）。`heartbeat.buildMultimediaParams` 仅填充了 `clazzid/courseId/knowledgeId/...`，缺少 `dtoken`，一旦走 `API["multimedia"].format(...)` 即 `KeyError`。
- **后果**：这些开关在 `dump.py` 默认是「预留/未实装」状态，但**配置上仍暴露给用户**。任何用户把这些特性打开，运行即抛 `KeyError`（且 `with_retry` 会重试 3 次放大错误）。
- **建议**：二选一——(a) 真正实现 `dtoken` 获取与 `chapterId` 传参；或 (b) 在 `config.py` 中明确标注为不可用，并在 `dump.py`/`heartbeat.py` 入口 **显式拒绝**这些开关（抛清晰的错误或 `warn` 后跳过），而不是把 `KeyError` 雷区留给用户。

#### H3. `heartbeat.py` — `dtoken` 缺失导致心跳特性实际永远不生效
- **位置**：`heartbeat.analyze_heartbeat_params(jobid, objectid)` 的调用方 `dump.py` 中 `_maybe_render_backfill` / `_render_and_backfill` 仅在 `course_taskpoints` 非空时组装参数；而 `buildMultimediaParams` 从不填充 `dtoken`。
- **表现**：即便开启渲染，`analyze_heartbeat_params` 返回的参数字典无法被 `API["multimedia"]` 正确 format（见 H2）。更隐蔽的是：`client.s.cookies.get("UID","0")` 取 `UID` 作为 `userid`，但 `dtoken` 无从获取，逻辑上该特性从设计上就不可达。
- **后果**：用户以为「作业/测验心跳已发送」，实际从未发出，统计/进度失真。
- **建议**：要么从播放器页面抓取 `dtoken`（渲染阶段本就在浏览器内，可一并提取），要么在文档与代码里明确标注心跳为「未实装」并移除相关调用路径，避免假象。

---

### 🟠 中（稳健性/性能/可维护性隐患）

#### M1. `config.py` — `with_retry` 捕获 `(Exception,)` 重试范围过宽
- **位置**：`cx_crawler/config.py` 的 `with_retry` 装饰器默认 `exceptions=(Exception,)`。
- **表现**：任何异常（含 `KeyError`、`TypeError`、`ValueError`、解析错误等**非瞬态编程错误**）都会被重试 3 次。例如 H1/H2 的 `AttributeError`/`KeyError` 会被重试 3 次后才失败，既**掩盖真实 bug**，又让单次失败从「立即暴露」变成「约 3×超时」才暴露。
- **建议**：将默认异常收窄为网络/HTTP 类，例如 `exceptions=(requests.exceptions.RequestException,)`，并在需要时单独为解析层加 `try`。可在装饰器参数保留可覆盖性，但默认不应吞掉所有异常。

#### M2. `chapters.py` — `completed` 启发式存在误判（假完成）
- **位置**：`parse_chapter_tasks` 中：
  ```python
  completed = ('icon_Completed' in ch) or (unfinished == 0 and has_tp)
  ```
- **表现**：当某章节 `unfinishedCount == 0` 但平台尚未渲染真实完成标记（如刚进入、数据未到位）时，会被判为「已完成」；`has_tp` 使用 `'catalog_points_yi' in ch` 这类子串匹配，可能误命中。
- **后果**：爬虫可能跳过本未完成章节，导出数据不准。
- **建议**：优先依赖 `icon_Completed`/`icon_Unfinished` 等显式标记；`unfinished==0` 作为**辅助**判定，且应结合 `isNew`/`status` 等多字段交叉验证，避免单纯用数字 0 判定完成。

#### M3. `browser-media-collector.user.js` — frame 端每次采集触发 O(n) 全量读写
- **位置**：`appendStore()`（约第 50 行）在**每个 frame、每条记录**都 `loadAll()`（完整 `JSON.parse`）+ 合并 + `GM_setValue`（完整序列化，最大约 5MB）。
- **表现**：顶层 `captureRec` 已通过 `postMessage` 把记录汇总到顶层并由顶层 `flush()` 统一落盘，而 frame 端又**重复**调用 `appendStore` 写同一份共享存储。于是每条记录被写两次，且 frame 端每次都是 O(n) 解析+序列化。
- **后果**：多 frame、高频播放场景下写入放大明显，逼近 `GM_setValue` 配额时可能抛错（虽然被 `try/catch` 兜住，但数据可能未落盘）；同时顶层与 frame 双写存在「读改写非原子」丢数据窗口（代码注释已如实说明，但 frame 端写是放大源）。
- **建议**：frame 端**只** `postMessage` 上报、不做本地写（`isTop` 判定已在）；顶层统一负责持久化与去重。若确需 frame 耐久备份，改为顶层的批量合并而非逐条 O(n) 写。

#### M4. 桥逻辑三份拷贝（DRY 违反）
- **位置**：`resolveBridgeBase` / `probeBridgeBase` / `bridgeFetch` 在 `chaoxing-force-play.user.js`、`chaoxing-auto-next.user.js`、`chaoxing-progress-panel.user.js` 中**各实现一遍**，端口探测列表（`[7531,7532,7533,8543,9090]`）也重复硬编码。
- **表现**：三份逻辑需手动保持一致；任何修复（如 CSP 同步异常兜底，已在 force-play/auto-next 各自修过）要在三处同步。
- **后果**：维护成本高，易出现「一份修了、另两份仍是旧 bug」的漂移。
- **建议**：抽成共享模块（例如一个 `@require` 的 `cx-bridge-helper.js`，或通过 `window.__cxBridge` 单例），三脚本统一引用。

#### M5. 版本号与状态不一致（工程规范）
- **表现**：`config.py` 中 `VERSION = "2.3"`，而 `force-play` 自称 `4.0/4.5`、`auto-next 3.0`、`collector 1.2`、`deceive-api`/`progress-panel` 未明确。Python 爬虫与浏览器脚本是**同一工具链的两端**，却没有统一版本与兼容性约束。
- **后果**：排障时难以判断两端是否匹配；桥端口/协议约定靠口头注释对齐。
- **建议**：引入统一的 `PROTOCOL_VERSION`，启动时由脚本与 `bridge.py` 握手校验，版本不符即告警；或至少在 README/USAGE 中声明两端版本对应关系。

---

### 🟡 低（可读性 / 微优化）

#### L1. `chaoxing-force-play.user.js` — 同名 `dbg` 遮蔽
- **位置**：顶层 `function dbg(...)`（日志函数）与 `ensurePanel` 内 `var dbg = el.querySelector('#__cxDebug')`（约第 1002 行）同名。后者是 `ensurePanel` 局部作用域，不会真正破坏全局 `dbg`，但同名极易误导阅读者。
- **建议**：将局部变量改名为 `dbgChk` / `debugChkbox`，消除歧义。

#### L2. `chaoxing-force-play.user.js` — 执行顺序依赖函数提升
- **位置**：第 82 行 `loadWatchStats();` 在定义（约第 529 行）之前调用，靠函数声明提升成立。
- **建议**：虽能跑，但可读性差；建议把初始化调用集中放到 IIFE 末尾或显式依赖顺序处，并加注释说明「依赖提升」。

#### L3. `chaoxing-force-play.user.js` — 巨型文件与深层闭包
- **位置**：单文件 ~1200+ 行，`overrideVideo`/`ensurePanel`（含大段 innerHTML 模板）/`_loopTick` 等函数体很大，闭包嵌套深。
- **建议**：把面板 HTML 模板、诊断采集、桥逻辑拆为独立模块/函数；`installPrototypePauseNeutralize` 每轮重装（第 1196 行，设计如此防反制）可加一个「已是最新描述符则跳过重建闭包」的轻量守卫，减少每 2s 创建新 `protoPause` 闭包的垃圾。

#### L4. `dump.py` — 函数内 `import time`
- **位置**：`_emit_playlists` 内部 `import time`，以及在 `_render_and_backfill` 中写 `03_tasks_{courseid}.json` 与 `done` 映射加载时序。
- **建议**：`import time` 提到模块顶部；comments 中「resume 时先 backfill 再标记 done」逻辑正确，但建议把「done 映射是否回填新抓取任务」这个易错点加单元测试或断言。

#### L5. `chaoxing-auto-next.user.js` — 答题入口关键词过宽
- **位置**：`ANSWER_KEYWORDS = /章节检测|作业|测验|继续|答题|考试|下一题/`。
- **表现**：`继续`/`下一题` 等词可能命中普通导航按钮，导致误点击。脚本注释声明「不自动提交、仅点入口」，但入口误判会跳错页面。
- **建议**：把「纯导航类」（继续/下一题）与「答题类」（章节检测/作业/测验/考试）分开处理，或加白名单 `class`/`href` 校验后再点。

#### L6. `chaoxing-deceive-api.user.js` — 重写 `window.fetch`/`XHR` 的冲突风险
- **位置**：脚本通过替换 `window.fetch` 与 `XMLHttpRequest.prototype` 来改写 API 响应（标记任务点完成等）。
- **表现**：若页面/其它用户脚本也包裹了 fetch/XHR，包裹顺序与对原始引用的保存方式决定成败；该脚本与 force-play/auto-next 同期注入时，存在双重包裹导致其中一个失效或 `this` 绑定异常的可能。
- **建议**：用 `WeakRef`/保存原始引用 + 幂等包裹（检测已被自己包裹则跳过），并尽量只拦截特定 URL（白名单），降低副作用面。

#### L7. `chaoxing-progress-panel.user.js` — 周期 DOM 查询性能
- **位置**：进度面板按 `setInterval` 全量查询章节完成状态。
- **表现**：在课程目录很大时每轮遍历全部 `cur\d{6,}` 节点，存在不必要的重复解析。
- **建议**：缓存节点引用、`MutationObserver` 增量更新，或在不可见时降低刷新频率（参考 `browser-media-collector` 的可见性节流思路）。

---

## 三、亮点（值得保留）
- 浏览器端对抗平台反制（`installPrototypePauseNeutralize` 每轮重装、`neutralizeGlobalPause`、`iframe`/`shadowRoot` 下钻、`v.__cx` 一次性挂钩去重）设计扎实。
- Python 侧 `atomic_write_text`（临时文件 + `os.replace`）、`RunLock`（O_EXCL）、`throttle` 节流、`with_retry` 封装、`verify_login` 失败即抛 `RuntimeError` 被主流程捕获，工程细节到位。
- `browser-media-collector` 已做 XSS 防护（innerHTML→textContent）、blob 导出用 `<a download>`、顶层聚合避免 frame 写入放大（但见 M3）、清空令牌 epoch 解决跨 tab 清空失效——安全意识好。
- 大量 try/catch 与「失败静默回退 DOM 启发式」让工具在桥不可用时不至于整体瘫痪。

---

## 四、改进优先级建议
1. **立刻修**：H2（保留 API 占位符 KeyError 雷区）、H1（`quizzes.py` 数组响应崩溃）。
2. **尽快修**：H3（心跳不可用）、M1（重试范围过宽）、M3（frame 写入放大）、M2（完成误判）。
3. **工程改进**：M4（桥逻辑抽公共）、M5（版本握手）、L 系列可读性优化。

> 注：H3/L6 涉及的「伪造完成态/欺骗 API」属于对平台上报数据的篡改行为，技术上可改进，但是否合规使用由使用者负责；本审查仅从代码正确性角度指出其特性不可达与冲突风险。
