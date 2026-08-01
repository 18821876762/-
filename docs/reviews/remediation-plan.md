# 修复计划（已核实版）

> 综合 `code_review_report.md`（27 项 #1-#27）与第二份逐行审查报告（H1-H3 / M1-M5），
> 并对每个被点名的源文件做**实际代码核查**后得出。
>
> 核查方法：直接读取 `perception/cx_crawler/*.py` 与 `.user.js` 源码，按报告给出的位置逐行确认，
> 而非采信报告自身的结论。结果暴露出两份报告均含**已修复项**与**误报项**——
> 当前代码已带大量 `审查#/R3/Lx` 修复标记，比报告描述更健壮。
>
> 本文件是**唯一可执行清单**：已修复/误报项已从行动项移除，仅保留确认有效的问题。

---

## 一、核查结论速览（状态表）

| 原编号 | 描述 | 核查结果 | 证据 |
|--------|------|----------|------|
| #2 | 环境变量优先级矛盾 | ✅ **已修复** | `config.py` L103-136 `_load_bridge_config` 已实现 env 优先、JSON 回退（注释标"修复 R3"） |
| #4 | chapters.py AttributeError | ✅ **已修复** | `chapters.py` L175-180 已改为 `if inp: vf=re.search(...); if vf: ...` |
| H1 | quizzes.py 列表 `.get()` AttributeError | ❌ **误报** | `quizzes.py` L37-38 `_extract_questions` 有 `if not isinstance(data, dict): return None` 守门；L14-18 JSON 解析失败已兜底为 `{}` |
| H2 | config 占位符（dtoken/chapterId）KeyError | ❌ **误报** | `config.py` L23 `multimedia` 占位符为 `{jobid}/{oid}/{kid}/{cid}/{clazzid}`，**无** dtoken/chapterId；`heartbeat` 的 `{dtoken}` 由 `heartbeat.py` L31 提供（值 `"0"`）。当前调用方均填全，不会 KeyError |
| #3 | save_cookies 并发写入 | 🟡 **已缓解** | `dump.py` L105 全程持有 `RunLock`；`save_cookies` 用 `atomic_write_json`（os.replace 原子）。同目录并发已被锁隔绝 |
| #6 | atomic_write_text 临时目录 | 🟡 **已缓解** | `config.py` L219-222 `d=os.path.dirname(path)` 经 `os.makedirs(d)` 保证非空，实际不会退化到 `"."` |
| #5 | `_is_quiz_type` 子串过宽 | 🟡 **确认但低危** | `dump.py` L351-353 确为子串匹配；但 `type` 默认 `None`、仅 `RENDER_JOBS=True` 渲染后才有值，默认模式该分支为死代码，误判无实际影响 |
| #1 | 日志不一致（print vs logger） | ✅ **仍有效** | `chapters.py` 多处仍用 `print()`（L252/L273 等），与 `config.logger` 混用 |
| #12 / M1 | `with_retry` 捕获 `(Exception,)` 过宽 | ✅ **仍有效** | `config.py` L240 默认 `exceptions=(Exception,)`，会重试编程错误（3× 慢失败） |
| #26 | Cookie 明文存储 | ✅ **仍有效** | `session.save_cookies` L176 明文写 `cookies.json`，无权限限制 |
| #15 | media-collector @match 过宽 | ✅ **仍有效（JS）** | `browser-media-collector.user.js` `@match *://*/*` |
| M2 | chapters 完成态启发式假完成 | ✅ **新确认** | `chapters.py` L183 `completed = ('icon_Completed' in ch) or (unfinished==0 and has_tp)` —— 任务点节点若未渲染出未完成数即判定完成，存在假完成风险 |
| H3 | heartbeat `dtoken` 恒为 `"0"` | 🟡 **确认但属设计** | `heartbeat.py` L31 硬编码 `dtoken="0"`；模块声明为只读 GET 探测，永不产生可上报进度——特性"永远不生效"是**合规设计**而非缺陷，仅需文档澄清期望 |
| M4 | 桥逻辑三份重复 | ✅ **确认（架构）** | force-play / auto-next / 各自实现桥拉取 |
| M5 | 两端无版本/兼容校验 | ✅ **确认（低危）** | 桥协议无 version 字段 |

> 其余原 #7/#8/#9/#10/#11/#13/#14/#19/#20/#21/#22/#23/#24/#25/#27 与第二份报告的低优先级项，
> 经核查与首份报告一致，**仍有效**，统一归入下方阶段三/四，不再逐条复述证据。
> （注：#16/#17/#18 已上移至阶段二并修复完成，见上。）

---

## 二、确认仍需处理的行动项（按优先级）

### 阶段一：高优先级、低风险（建议立即做）
1. **#1 统一日志**：`chapters.py` 等模块的 `print()` 改为 `logger`（`config.get_logger` 已就绪）。中工作量 / 低风险。
2. **#12 / M1 收窄 `with_retry`**：`config.py` L240 默认 `exceptions` 改为 `(requests.RequestException, json.JSONDecodeError, OSError)`，仅对瞬态错误重试；保留 `except Exception` 作兜底不重试。中 / 低。
3. **#26 Cookie 文件权限 + 文档警示**：`save_cookies` 写后 `os.chmod(path, 0o600)`（Windows 用 `icacls` 等效）；USAGE.md 增加"勿提交 git / 共享机删除"提示。低 / 中（跨平台需测）。
4. **#15 收窄 media-collector `@match`**：改为 `@match https://*.chaoxing.com/*` 或默认关闭 + 配置开全站。低 / 低。

### 阶段二：明确缺陷 / 小型安全健壮（低风险）—— ✅ 已完成（2026-07-30）
5. **M2 修正 chapters 完成启发式**：`chapters.py` L183 取消 `unfinished==0 → completed` 的自动判定，仅以 `icon_Completed` 显式标记为准；缺失未完成数时 `completed` 置 `None`（未知）而非 `True`。低 / 低。 **✅ 已落地**
6. **#16 force-play DOM 空值检查**：`ensurePanel` 入口加 `document.body` 就绪判断（`DOMContentLoaded` 或 `requestAnimationFrame`），body 未就绪时延迟构建并先返回 `null`。 **✅ 已落地**
7. **#18 auto-next postMessage 安全**：优先用 `location.origin` 具体源，仅跨域不可读时回退 `'*'` 并带 `CX_AN_NONCE` nonce 校验（接收端 origin 白名单 + nonce 双校验）。 **✅ 已落地**
8. **#17 deceive-api IntersectionObserver 完整代理**：用 `Proxy` 包装实例 `observe`（被调用时立即注入「在视口内」合成 entry），并回调内固化 `isIntersecting=true`；`unobserve/disconnect/takeRecords` 原样转发。 **✅ 已落地**
9. **#5 `_is_quiz_type` 收紧**（可选）：改为白名单/前缀匹配；鉴于当前为默认模式死代码，可随 RENDER_JOBS 文档一起处理，不阻塞。（本期未做）

### 阶段三：性能与一致性（按需）—— 部分落地（2026-07-30）
- **#7 courses 重复计算**：✅ 已落地（先前 v2.2 已在 `dump.py` L138-140 用 `prefetched=verify_resp` 复用 verify_login 的同接口响应，避免重复请求）。本期无需再改。
- **#8 正则预编译**：✅ 已落地（`chapters.py` `ID_PATTERNS` 改为 `re.compile(..., re.I)` 预编译，`extract_knowledge_ids` 直接 `p.findall`，消除热路径重复编译）。
- **#14 硬编码 API 同步注释**：✅ 已落地（`force-play` 默认桥端口旁加注释，标明须与 `config.py` `BRIDGE_PORT` 同步；脚本仅硬编码可配置的本地桥默认地址，无硬编码后端 API）。
- **#19 scanVideos 深度限制**：✅ 已落地（`scanVideos` 新增 `depth` 参数 + `MAX_SCAN_DEPTH=16` 安全阀，递归调用传 `depth+1`；正常章节页嵌套远小于上限，行为无变化）。
- **M5 桥版本校验**：✅ 已落地（`BRIDGE` 增加 `version` 字段；`/ping` 探针与 `bridgeInit` 均缓存桥版本并在面板诊断行展示 `桥 已连 <base> v<version>`，非阻塞、不阻断续播）。
- **#13 `_moFlush` 提升**：⏸ 审查后认为已缓解——现有 `_moFlush` 已有 `>1024` 安全阀 + 可见 rAF / 隐藏 setTimeout 双路 flush，`overrideVideo` 幂等（`__cxForcePaused` 守卫），无明确可提升点，保持。
- **#20 `_loopTick` 降频 / #21 `refreshPanelState` 降频**：⏸ 审查后**有意保留**——间隔由 `CONFIG.RESCAN_INTERVAL`（默认 2s）可配，降低默认会牺牲响应性；面板刷新仅 `display!=='none'` 时触发且需实时展示「已看 Xmin」进度，降频会削弱体验，故不动。
- **#23 `dbg` 冗余 try-catch**：⏸ 审查后保留——`console.log.apply` 的 try-catch 属无害防御（极端环境 console 缺失/抛错时避免炸脚本），清理价值极低、且改动无测试覆盖，留待顺手时。
- **M3 media-collector O(n) 读写**：⏸ 审查后认为已缓解——`flush` 顶部 `if (!dirty) return` + 1.5s 节流已避免空转；跨 tab/frame 的读改写合并 O(n) 是去重正确性所需（注释已如实说明极小竞态），`loadAll` 仅在 dirty 时触发，5000 条上限下可接受，不动。

### 阶段四：架构级（技术债，非必需不动）—— 部分落地（2026-07-30）
- **#27 类型注解与测试**：✅ 已落地（核心收益项）。`config.py` / `chapters.py` / `courses.py` / `render.py` 为纯函数与关键签名补充类型注解（`from __future__ import annotations` + 现代泛型语法，运行时零影响）；新增 `perception/cx_crawler/tests/test_crawler_units.py`（unittest，无网络/Playwright 依赖，覆盖 `_to_int` / `atomic_write_json` / `extract_knowledge_ids` / `extract_seed_chapter_id` / `parse_chapter_tasks`）。运行：`python -m unittest discover -s perception/cx_crawler/tests -p "test_*.py"`。
- **#9 render 页面池**：⏸ 审查后认为已缓解——`render.py` 已复用「单浏览器实例 + 单 context + cookie 注入一次」，逐 kid 仅 `new_page/close`（相对浏览器启动开销可忽略）；进一步 page 复用需重置 per-page 响应监听、易引入泄漏，边际收益低，保持。
- **#24 配置共享 / #25 桥版本管理**：⏸ 部分已由阶段二/三覆盖（#14 桥端口同步注释、M5 桥版本展示）。完整的「Python↔JS 共享配置 / 协议版本门禁」需引入配置注入机制，超出必要范围，保持。
- **#10 config 拆分 / #22 force-play 拆分 / M4 桥逻辑去重（×3）**：⏸ 大型重构，涉及跨模块 import 重排 / Tampermonkey `@require` 多文件装配，回归风险高且无测试覆盖护航，按「非必需不动」保留。若未来确需拆分，建议在具备集成测试后再做。
- **#11 注释精简**：⏸ **有意保留**——现有注释多为「易误判」防御性代码（如「看似死代码实为默认模式」「看似未用实为种子」）的解释，精简会丢失阻止未来误改的关键上下文，属负价值改动。

> 阶段四结论：仅推进了明确正向、无回归风险的 #27（类型注解 + 单元测试地基）；其余架构级重构按计划「非必需不动」原则全部保留，避免在无集成测试护航下对正常工作的模块做高风险改动。

---

## 三、已从清单移除的项（理由）
- **#2 环境变量优先级**：已修复（R3）。
- **#4 chapters AttributeError**：已修复。
- **H1 quizzes 列表 AttributeError**：误报（有 isinstance 守门）。
- **H2 config 占位符 KeyError**：误报（`multimedia` 无 dtoken/chapterId 占位；`heartbeat` 的 dtoken 已提供）。
- **#3 save_cookies 并发**：已被 `RunLock` + 原子写缓解。
- **#6 atomic_write_text 目录**：已被 `os.makedirs` 保证非空缓解。
- **H3 heartbeat dtoken="0"**：设计如此（只读探测），非缺陷；仅建议在 README 澄清"心跳不产生可上报进度"。

## 四、给两份报告的修正提示
1. 第二份报告称"启用 multimedia/quiz 开关即 KeyError"不成立——这两个模板当前是**预留接口**，无未填充占位符，启用前本就不会触发 KeyError。
2. 第二份报告 H1 称 `data` 为 list 时 `(data.get("data") or {})` 抛错，但 `_extract_questions` 入口已 `isinstance(data, dict)` 守门，list 直接返回 `None`。
3. 首份报告 #2/#4 在**当前工作区代码**中已修复，若基于更早快照生成需更新。
