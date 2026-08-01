# 代码审查报告 · 2026

> 审查对象：工作空间全部源码（前端 10 个 Tampermonkey 用户脚本 + 后端 `perception/cx_crawler` 共 10 个 Python 模块 + 配置/示例）。
> 审查日期：2026-07-29
> 配套文件：`code_review_report.md`（第一轮加固，已处理 R1–R3、G1–G5、J4–J6、L3、with_retry 等）、`CHANGELOG.md`、`USAGE.md`、`STAGES.md`、`crawler-framework-architecture.md`。

---

## 1. 系统概览

项目由两套相对独立、通过「HTTP 桥」松耦合的子系统组成：

- **前端（浏览器用户脚本）**：在「学习通（超星）」课程页面上做自动化——强制续播（`force-play`）、播完自动答题/下一课（`auto-next`）、防止鼠标移出暂停（`no-pause`）、进度面板（`progress-panel`）、章节/API 欺骗（`deceive-api`）、经本地桥把「已播完」事件/作业数据回传后端（`auto-next` 的 bridge 部分）。
- **后端（`perception/cx_crawler`，Python）**：只读快照爬虫，按「课程→章节→作业」抓取章节树与作业，落盘 JSON/HTML，供离线分析。**默认 `RENDER_JOBS=False`**，仅做 HTTP 抓取；可选开启 Playwright 无头渲染以补全 `jobid/objectid`。

整体完成度高、注释详尽、针对性加固扎实。但存在少量**可复现的高优先级问题**（依赖装不上、登录态误判），以及若干中优先级的健壮性/性能/冲突隐患。

---

## 2. 问题清单（按优先级）

> 状态图例：✅ 本轮已修复　⚪ 已具备/不适用（复核后非问题）　⬜ 待修复（本报告给出建议）

### 高优先级（High）

#### S1 · `verify_login` 整数比较会误判字符串 `"1"` 为未登录　✅ 已修复（本轮）
- **位置**：`perception/cx_crawler/session.py` `verify_login()`
- **现象**：主判据为 `if result == 1:`（及嵌套 `data["data"].get("result") == 1`）。若 `backclazzdata` 接口把 `result` 以字符串 `"1"` 返回（部分网关/反代偶有此行为），`"1" == 1` 在 Python 中为 `False`，登录校验直接落到后续「登录失败」判定并 `abort` 整轮。
- **影响**：偶发整轮空跑/误报未登录，排查困难。
- **修复**：同时兼容 `int 1` 与 `str "1"`（`result == 1 or result == "1"`，嵌套处 `in (1, "1")`）。

#### P2 · `requirements.txt` 的 `extra` marker 导致 playwright 永远装不上　✅ 已修复（本轮）
- **位置**：`perception/cx_crawler/requirements.txt`
- **现象**：`playwright>=1.40,<2; extra == "render"`。PEP 508 的 `extra` environment marker **在普通 `requirements.txt` 中不被 pip 支持**——pip 安装时没有「当前 extra」上下文，`extra == "render"` 求值为 `False`，该依赖被**静默排除**。执行 `pip install -r requirements.txt` 后 playwright 实际不会被安装，开启 `RENDER_JOBS=True` 时运行即报 `ModuleNotFoundError`。
- **影响**：高。开启渲染模式（作业/测验提取的关键路径）的用户必踩，且无任何报错提示「没装」。
- **修复**：去掉 `extra` marker，直接声明 `playwright>=1.40,<2`，并在注释中说明「如需完全可选，可注释本行、需要时再单独 `pip install "playwright>=1.40,<2"`」。
- **说明**：该错误 marker 在原始 `requirements.txt` 即存在，第一轮 G5 锁定版本时未纠正，本轮一并修复。

### 中优先级（Medium）

#### D3 · `dump.py` 未预创建 `OUTPUT_DIR`（首跑即崩）　⚪ 已具备 / 不适用
- **位置**：`perception/cx_crawler/dump.py` `main()`
- **复核结论**：当前代码第 115 行已有 `os.makedirs(OUTPUT_DIR, exist_ok=True)`，且 `ApiClient.__init__` 也会 `makedirs`。**首跑不会因目录缺失而崩**。该条在当前代码不可复现，标记为 N/A（推测源于旧版本 review）。

#### O1 · `courses.py` 的 `clazzid` 缺类型归一化　✅ 已修复
- **修复**：`courses.py` 新增 `_to_int()`，在 R2 空值守卫后对 `clazzid`/`courseid` 一并归一化为 int，失败（非数字）时 `continue` 并 `DEBUG` 打印；落盘类型与 dump.py 白名单过滤处保持一致。
- **位置**：`perception/cx_crawler/courses.py` `fetch_courses()`
- **现象**：R2 已加 `if clazzid is None or courseid is None: continue` 的空值守卫，且 `courseid` 在白名单过滤处经 `_to_int()` 归一化；但 `clazzid` **未做 `_to_int`/类型校验**。若接口把 `clazzid` 返回为非 int/非 str（如 list、dict 或带单位的字符串），拼进章节 URL（`chapters.py` 的 `NODE_URL`）会出现 `TypeError` 或失真请求，单课静默空跑。
- **建议**：对 `clazzid` 同样做 `_to_int()` 归一化，并在归一化失败（非数字）时 `continue` 并 `DEBUG` 打印。

#### N1 · `message` 监听 origin 用 `indexOf` 子串匹配，会误放行相似域名　✅ 已修复
- **修复**：新增 `trustedOriginAN(origin)`——`new URL(origin).hostname` 后做「`=== 'chaoxing.com'` 或以 `.chaoxing.com` / `.edu.cn` 结尾」的后缀精确匹配，解析失败一律拒绝。
- **位置**：`chaoxing-auto-next.user.js` 的 `window.addEventListener('message', ...)`
- **现象**：`ev.origin.indexOf('chaoxing.com') >= 0 || ev.origin.indexOf('edu.cn') >= 0`。子串匹配会放行 `evilchaoxing.com`、`chaoxing.com.attacker.com` 等。
- **影响**：桥消息来源校验形同虚设，恶意页面可伪造 `message` 触发自动下一课/作业点击逻辑。
- **建议**：基于 `new URL(ev.origin).hostname` 做**后缀精确匹配**——`endsWith('.chaoxing.com') || host === 'chaoxing.com'`，以及 `endsWith('.edu.cn')`（`.edu.cn` 为受限 TLD，可接受）；拒绝前缀命中的伪造域名。

#### N4 · 桥失败原因仅在 DEBUG 输出，正常模式静默　✅ 已修复
- **修复**：`bridgeFetch` 的 `catch` 中正常模式也 `console.warn` 一次（`BRIDGE.warned` 去重防刷屏），提示「桥不可用、已回退 DOM 启发式」；DEBUG 额外打印错误对象。
- **位置**：`chaoxing-auto-next.user.js` `bridgeFetch()` 的 `catch`
- **现象**：桥 `fetch` 失败仅 `dbg(...)`（DEBUG 关闭时为空操作），`if (DEBUG) console.warn(...)` 才告警。正常模式用户完全不知道桥不可用、脚本已静默回退。
- **影响**：排障困难；「为什么没走桥」无从知晓。
- **建议**：桥失败/回退**始终**以 `console.warn`/`console.error` 输出（或 UI 角标），DEBUG 仅额外打印详细 payload。

#### F1/F2 · `force-play` 每 2s 全量遍历 DOM 找 shadowRoot，长目录页性能热点　✅ 已修复
- **修复**：采纳建议 2（与 no-pause J4 同款收窄）——文档级只在 `#videoBox / .ans-attach-ct` 容器子树内枚举 Shadow 宿主；ShadowRoot 内部（子树小）保留全量枚举以发现嵌套宿主；video/iframe 扫描路径不变，动态新增仍由 MutationObserver 兜底。
- **位置**：`chaoxing-force-play.user.js` `scanVideos()` + `setInterval(..., RESCAN_INTERVAL=2000)`
- **现象**：`scanVideos(document)` 每 2s 执行 `root.getElementsByTagName('*')` 遍历**整篇文档**找 shadow 宿主，外加 `querySelectorAll('iframe')`。章节列表很长（数十~上百节点）时成为周期性主线程开销，与滚动/输入争用。
- **影响**：中。长页面卡顿、续航/CPU 占用偏高；功能正确但体验差。
- **建议（参考 no-pause J4 的改法）**：
  1. 用 `MutationObserver` 增量挂载，仅在 DOM 变化时重扫，去掉固定 2s 轮询；或
  2. 将 `*` 扫描收窄到视频容器 `#videoBox, .ans-attach-ct, iframe`（容器子树内的 shadow 宿主仍被递归发现），避免枚举每个无关节点；
  3. 至少把 `RESCAN_INTERVAL` 提高到 5–10s 并加「无新视频则跳过」短路。

#### L1 · `chaoxing-allinone` 已废弃但仍 `@match` 执行旧逻辑，与 3.x 同装冲突　✅ 已修复
- **修复**（v1.1.0，采纳建议 1 变体）：脚本入口默认自禁用——仅 `console.warn` 废弃提示后直接 `return`；仅当用户显式设置 `localStorage.cx_allinone_force === '1'` 才继续以废弃模式运行（`localStorage` 不可用时同样禁用）。保留 `@match` 以便提示可见。
- **位置**：`chaoxing-allinone.user.js`
- **现象**：文件头已标注「已废弃」，但仍 `@match *://*.chaoxing.com/*` 与 `*://*.edu.cn/*`，并内联运行完整的旧版 `force-play 3.2 + auto-next 1.5` 逻辑（双重覆盖 `video.pause`、双重导航锁、旧 `fixed` 遮罩误判等已知缺陷）。若用户同时装有维护版 `force-play 3.15 + auto-next 2.3`，两份脚本会**同时生效、相互冲突**（重复强制播放、导航锁互相干扰、事件监听器叠加）。
- **影响**：行为不可预期、难以调试；新用户按 README 装齐脚本后反而出错。
- **建议**：
  1. 将 `@match` 改空/注释掉使其默认不运行，仅保留废弃 `console.warn` 提示；或
  2. 运行时检测已存在维护版标记（`window.__cxForcePlay` / `window.__cxAutoNext`）则 `return` 自我禁用；并明确在 README 告知「不要再装 allinone」。

---

## 3. 其他观察（非阻断）

- **功能缺口（默认模式）**：后端 `RENDER_JOBS=False` 时，「作业/测验提取 + 心跳分析」实际不可用（见第一轮报告 L1/L2 门控与 `heartbeat.py` 说明）。这是设计取舍，但需在 README 中明确「要拿到 jobid/objectid 必须开启渲染+装 playwright」。
- **工程规范**：注释与架构优秀；主要短板为「无包结构（`perception/cx_crawler` 为多模块平铺）、`requirements` 写法错误（P2）、JS 重复代码/死代码（第一轮已清 GUARD_REMOVAL、J10 等）」。
- **配置示例齐备**：`bridge_config.example.json`、`cookies.example.json` 已提供，桥配置加载逻辑（`config.py` `_load_bridge_config`，env > json > 默认）正确（第一轮 G3 已确认）。

---

## 4. 优先修复清单（Top 7）

| # | 编号 | 问题 | 优先级 | 状态 | 建议动作 |
|---|------|------|--------|------|----------|
| 1 | P2 | `requirements.txt` `extra` marker 使 playwright 装不上 | 高 | ✅ 已修复 | 去掉 marker（本轮已完成） |
| 2 | S1 | `verify_login` 字符串 `"1"` 误判未登录 | 高 | ✅ 已修复 | 兼容 `1`/`"1"`（本轮已完成） |
| 3 | L1 | allinone 废弃脚本仍运行、与 3.x 冲突 | 中 | ✅ 已修复 | 默认自禁用，`localStorage.cx_allinone_force='1'` 才运行 |
| 4 | N1 | `message` origin 子串匹配放行伪造域名 | 中 | ✅ 已修复 | `trustedOriginAN`：hostname 后缀精确匹配 |
| 5 | F1/F2 | force-play 2s 全文档扫描性能热点 | 中 | ✅ 已修复 | `*` 扫描收窄到 `#videoBox/.ans-attach-ct` 容器子树 |
| 6 | O1 | `clazzid` 缺类型归一化 | 中 | ✅ 已修复 | `_to_int` 归一化 + 失败 `continue` |
| 7 | N4 | 桥失败正常模式静默 | 中 | ✅ 已修复 | 正常模式 `console.warn` 一次（去重防刷屏） |

> 说明：D3（OUTPUT_DIR 未预创建）经复核在当前代码已具备（`main()` 第 115 行 `os.makedirs(..., exist_ok=True)`），不构成问题，故未列入 Top 7。

---

## 5. 整体评价

| 维度 | 评分 | 说明 |
|------|------|------|
| 功能完整性 | ★★★☆ | 前端功能闭环良好；后端默认模式下「作业/测验提取 + 心跳分析」因 `RENDER_JOBS=False` 实际不可用（部分缺口，属设计取舍）。 |
| 健壮性 | ★★★★ | 前端对 DOM 换血/跨域/异步兜底充分，N1 安全、L1 冲突已于本轮修复；后端重试降级到位，P2/S1 薄弱点亦已修复。 |
| 工程规范 | ★★★☆ | 注释与架构优秀；缺包结构、`requirements` 写法错误（已修）、JS 重复/死代码（第一轮已清）是可维护性主要短板。 |

**结论**：项目质量整体良好，可投入实用。高优先级两项（P2/S1）已在审查同时修复；中优先级五项（L1/N1/F1-F2/O1/N4）已于 2026-07-29 全部落地修复。Top 7 全部清零。
