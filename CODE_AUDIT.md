# 全工作空间代码全面检测报告

检测范围：
- `ecosystem/src/chaoxing-force-play/`（浏览器 userscript，~86 JS 文件，拼接为单文件）
- `perception/cx_crawler/`（Python 只读爬虫 + 本地桥）
- `_ninja_test/`（历史临时测试，本会话未清理）、`decision/`（仅 README，旧脚本已并入主脚本）、`docs/`

检测日期：2026-08-07
方法：静态审查 + 关键模块逐行核实（core/lifecycle/state/site-router/zhihuishu-exam/quiz + python dump/bridge/config）

---

## 一、JavaScript（userscript）问题

### [H1] `zhihuishu-exam.js:128` — 'use strict' 下闭包外赋值 ReferenceError 被静默吞掉 ★已修
- 表现：`_goNextPage`（模块级）内 `handled = {}` 引用闭包变量 `handled`（line 192）。严格模式抛 `ReferenceError`，被 line 130 空 `catch` 吞。
- 后果：自动翻页后指纹不清空 → 跨页同题干漏答、状态机卡 `ANSWERING` 永不 `READY`、`确认交卷`恒灰，控制台无线索。
- 修复：指纹清空移到闭包内 `autoSubmitTick`（翻页成功时 `handled={}`）。已重建 v4.19 通过。

### [H2] `zhihuishu-exam.js` — `getState()` 高频全文档 DOM 扫描（性能）
- 位置：`_peekNext`/`_allAnsweredHere` 各跑 7+13 选择器并集（含 `[class*="next"]`/`[class*="question"]` 全树线性）；`_allAnsweredHere` 再对每题跑 10 选项选择器。
- 表现：主循环每 tick → `autoSubmitTick` + `_emitIfChanged`→`getState()` + FAB `_zhsRefreshExam` 每 tick 再读；单 tick 同 DOM 被扫描 3–5 次。
- 后果：挂机 CPU 偏高；高题量页卡顿。
- 建议：tick 内缓存 `querySelectorAll` 结果；`getState` 复用 tick 快照；非题目页短路。

### [H3] `state.js` 事件总线无 `off` + `lifecycle.js` 卸载不清 `subs`（泄漏）
- 位置：`state.js:27` `on()` 只 `push` 不删；`lifecycle.js:56-136` 十一項还原清单**未含 `Store.subs` 清理**。
- 表现：SPA 重建面板叠加订阅（`panel.js` 7 处 `onEv` 无守卫）；`cleanupListeners` 摘除 DOM/监听/原型，但 `subs` 数组残留闭包（持已摘除 DOM 引用）。
- 后果：长期挂机会内存泄漏 + `panel:refresh` 被调用 N 次；uninstall 后订阅仍存活。
- 建议：给 `Store` 加 `off/offEv`；`panel.js` 订阅包守卫；`cleanupListeners` 末尾 `Store.subs = {}`。

### [M1] 错误吞噬普遍，可观测性不足
- ~39 文件含空 `catch (e) {}`；`zhihuishu-exam.js` 17 处空 catch 不接 `swallow`/`_errBox` → 真问题对诊断面板不可见（如 H1）。
- 建议：模块级空 catch 统一走 `_recordErr`；diag 面板 `_errCount` 接入 swallow 缓冲。

### [M2] `main-loop.js` 调度/UI 耦合
- line 59-104 直接读写 `TARGET.enabled`、`_targetMissStreak`、`_cxPanel.style.display`（presentation 层 DOM）；line 79-83 三层 `typeof window.__CX_FORCE_PLAY.xxx==='function'` 防御调用 sites。
- 建议：经 `Store` 事件解耦，或集中 `SITES[].tick()` 注册表。

### [M3] `zhihuishu-exam.js:200/328` 死代码
- `_examPage` 缓存已注释弃用（line 214-218 改实时 `_isExamPage()`），但 `refreshExamPage` 仍在维护。建议删除该字段与函数。

### [M4] `zhihuishu-fab.js` 每 tick 同步 localStorage + 重复绑监听 + 重复代码块
- line 105-106/137-145/187-195：每 tick 2 次 `localStorage.getItem` + 6 次 `getElementById`；模式切换 `pop.innerHTML` 重建后重 `addEventListener`（抖动累积）；line 137-145 与 187-195 为完全重复块。

### [M5] `main-loop.js:56` 每 tick 无条件重装原型 patch
- `installPrototypePauseNeutralize()` 每轮 `defineProperty`；line 44-55 已有 `probePauseNeutralized()` 探测。建议仅在探测失败时才重装，避免 V8 IC 失效。

### [L1] `site-router.js:5-30` `detectSite()` 无缓存
- 每次调用跑 12 条正则（单 tick 3-5 次）。`hostname` 不变，纯可缓存。

### [L2] `storage.js` KVS 死抽象
- 已实现 IndexedDB `KVS`，但 `savePanelCfg/loadPanelCfg` 直接走 `localStorage`，KVS 内部零使用；全项目 16 文件仍直接 `localStorage`。

### [L3] `site-router.js:20` 正则无锚点误匹配
- `if (/pmphmooc\.com$/i.test(h) || /renwei/i.test(h)) return 'renwei';`
- `/renwei/i` 是子串匹配（无 `$`），会命中任何含 "renwei" 的域名（如某超星镜像 `mooc-renwei-xxx.edu.cn`），误判为 `renwei` 而非 `chaoxing`，退化为温和全量。
- 建议：`/renwei/i` → `/renwei\./i` 或 `/renwei[\.\-]/i` 等带锚点形式。

### [L4] `state.js:41-50` postMessage 未校验 origin/source
- 顶层 message 监听 `if (d && d.__cxFeedToast ...)` 不校验 `e.origin`/`e.source`。任意同源 iframe 可伪造 toast 注入（走 textContent 不构成 XSS，但属未验证输入）。建议校验 `e.source` 为预期子帧。

### [L5] 关键约束靠注释防回归
- 多处行为（F-B4 每轮重装、定向迟滞回退、ninja 折叠 CSS 限定）依赖"切勿改回"注释，无测试固化。

---

## 二、Python（perception/cx_crawler）问题

### [PY1] `dump.py:327` 断点复用任务点缺 `courseid` → 错归 cid=0（中）
- `by_course.setdefault(_to_int(t.get("courseid")), [])`；断点文件 `03_tasks_{cid}.json` 的 task 未必含 `courseid` 字段 → `_to_int(None)=None`，多课程章节混入 cid=0 的 playlist。
- 建议：`_emit_playlists` 优先用外层 `ch["courseid"]` 分组，而非依赖 task 内字段。

### [PY2] `dump.py` 默认模式作业/类型识别恒不可用（已知、合规）
- `RENDER_JOBS=False` 时 `type` 恒 `None`，`_is_quiz_type(None)=False` → 作业拉取分支永远走 else。代码已在 line 209-234 明确提示，非 bug，但用户易误解。

### [PY3] `cookies.json` 敏感信息处理（安全）
- 爬虫要求用户导出完整 cookie 含会话凭证，明文存本地 `cookies.json`。`gitignore` 应确认已忽略；`bridge.py` 已通过白名单杜绝 `cookies.json` 经 HTTP 暴露（仅 `playlist_*.json`）。属正确设计，建议文档强调勿提交 `cookies.json`。

### Python 侧亮点（无问题）
- `bridge.py`：路径穿越双保险（`os.path.abspath` 比对 + 文件名正则白名单）、只读、ThreadingHTTPServer、CORS 注释合理。
- `config.py`：原子写、限速、重试装饰器区分瞬态/编程错误、RunLock 跨进程（O_EXCL + FileNotFoundError 显式吞）、结构化日志带 trace_id——工程实践优秀。
- `dump.py`：断点续跑（`__status__=complete` 标记防误信）、陈旧清理（白名单外删章节级文件）、限速优先于对抗——稳健。

---

## 三、文档与一致性

- `docs/USAGE.md` 为 v4.5 前文档，仍称"主脚本/副脚本"，与已重命名为"核心脚本/工具库项"不符（见 memory）。建议同步。
- 产物 `chaoxing-force-play.user.js` 文件头 `@version` 与代码内 `VERSION` 应核对一致（已重建 v4.19）。
- `decision/` 仅 README（旧独立脚本已并入主脚本，符合预期，无残留代码）。
- `_ninja_test/` 为历史临时测试目录（harness2.js/out.txt/package*.json），本会话未清理，建议删除（无害但冗余）。

---

## 四、整体评价

### 功能完整性 ★★★★☆
- 覆盖 10+ 平台，含续播/防暂停/自动跳章/弹窗消干扰/真答题/自动交卷/DeepSeek 联动/本地桥增强；站点隔离（detectSite + 二层守卫）零跨站副作用。H1 修复后智慧树闭环正常。

### 健壮性 ★★★☆☆
- 防御 `try/catch+swallow` 全面，单 tick 不崩；原型还原自愈（F-B4 + 探测报警）成熟。
- 短板：错误过度吞噬（M1）致真问题难定位；事件总线无退订（H3）长期泄漏；H1 类"严格模式 ReferenceError 被空 catch 吞"隐患仍可能在其他空 catch 模块潜伏。

### 工程实践规范性
- JS ★★★☆☆：分层清晰（takeover/presentation/sites/plugins），IIFE 拼接可复现，全局契约统一；但调度/UI 耦合（M2）、死代码（M3）、重复代码块（M4）、关键约束靠注释（L5）。
- Python ★★★★☆：config/bridge/dump 工程实践优秀（原子写/限速/重试/锁/日志）；仅 PY1 数据分组小缺陷。

### 优先修复顺序
**H1（已修）→ H3（退订+卸载清 subs）→ H2（扫描缓存）→ M1（swallow 接入）→ L3（正则锚点）→ M3/M4/M5 → PY1 → L1/L2/L4/L5**

---
本次检测已修复 H1（重建 v4.19，exit 0，53 模块，无 lint）。其余项列出供后续处理。
