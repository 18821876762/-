# 工作空间代码审查报告（2026-08-12）

审查范围：`ecosystem/src/chaoxing-force-play`（58 个 JS 源文件，单一 IIFE 拼接的 Tampermonkey 用户脚本）、`perception/cx_crawler`（Python 合规只读爬虫，含 bridge/session/api_client/chapters/quizzes 等）。

---

## 一、总体评价

| 维度 | 评价 | 说明 |
|------|------|------|
| 功能完整性 | **良好** | 覆盖视频强制续播、原型中性化防暂停、多平台（超星/智慧树/知到/icourse163 等）弹窗与题目页自动作答、DeepSeek 视觉应答端联动、面板与命令台；Python 侧完成课程树/任务点/章节快照的只读抓取。 |
| 健壮性 | **良好** | 全局采用 `bestEffort`/`safeGet`/`try-catch` 防御式编程，去重上限防内存泄漏，落盘原子写，卸载/还原清单完整；无明显运行期崩溃路径。 |
| 工程规范性 | **中等偏上** | 模块注释详尽、有 ESLint 与沙箱单测、CORS/鉴权/反检测都有考量；但无 ES Module 契约、依赖单 IIFE 拼接顺序、部分 best-effort 选择器待真实站点校准。 |

**结论**：代码工程质量在同类用户脚本中属于较高水平，防御式编程到位。审查中曾怀疑的"Windows cookie 权限""跨模块重定义""桥 CORS 反射"等问题，**经二次核对源码均已修复或核实为低风险**（详见第五节）。现存问题均为中低危的"待校准/可加固"项，无致命语法/逻辑错误。

---

## 二、自动化检测记录（本次续测执行）

| 检测项 | 命令/方法 | 结果 |
|--------|-----------|------|
| 构建产物语法 | `node --check ecosystem/chaoxing-force-play.user.js` | ✅ 通过（注：单文件 `node --check` 对 `core.js` 等 IIFE 片段会误报，以产物为准） |
| 跨文件**最外层**函数重名 | 扫描所有 JS 顶层 `function NAME(` | ✅ `NO_OUTER_DUP_FN`（无会真实冲突的重定义） |
| 重复文件名（构建歧义） | 按 Name 分组 | ✅ `NO_DUP_FILENAMES` |
| 危险语句 `eval`/`debugger`/`document.write`/`new Function` | 全量正则 | ✅ 未发现（`exec(`/`subprocess` 命中均为 `.exec()` 正则与 `icacls` 调用，良性） |
| Python 注入面 `os.system`/`shell=True`/`pickle`/`child_process` | 全量正则 | ✅ 未发现 |

---

## 三、具体问题清单

### 🟡 中低危（建议择机处理，非阻断性 bug）

**1. best-effort 选择器过宽，需真实站点校准（已知限制，已做兜底）**
- 位置 A：`sites/zhihuishu-exam.js`（`CFG.optionSels` 含 `label`、`[class*="option"]`、`[class*="choice"]`；`questionSels` 含 `[class*="question"]`）。
- 位置 B：`takeover/engine/vision-deepseek-web.js` 的 DeepSeek 登录/输入框/发送/生成中等选择器（标 TODO）。
- 表现：子串匹配命中范围较大。但代码已做多重兜底：① `zhihuishu-exam` 的 `_zheOptions` 对命中项二次过滤（仅保留含 `input[radio/checkbox]` 或类名匹配 `option|choice|answer|select` 的元素，裸 `label` 被滤除）；② 全局 `dsAvailable()` 硬闸门：未连 DeepSeek 时锁死作答+交卷；③ 所有 DeepSeek 选择器均带 `!== 'TODO'` 守卫，占位时退回通用兜底或跳过，不会 `querySelector` 抛错。④ `popup-quiz.js` 的 `dialogSels` **已收紧**（移除 `question/topic/answer` 宽属性选择器，仅保留 `[class*="popup"]` 兜底），无需再动。
- 后果：宽项理论上可能误匹配非目标元素→误答/误关，但受上述兜底约束，实际风险可控，属 best-effort 校准项。
- 建议：在真实超星/智慧树/DeepSeek 页面用 DevTools 校准一次后收窄 `zhihuishu-exam.optionSels/questionSels` 与 DeepSeek 选择器；优先用稳定 `data-*`/ID。

**2. 跨模块依赖靠单 IIFE 闭包 + 函数提升隐式建立（架构债务，当前安全）**
- 位置：`takeover/foundation/utils/utils.js` 的 `toolkit`（前向引用 `metrics.js`）、`swallow` 的 `_errCount`（定义于 `metrics.js`）。
- 表现：58 文件由 `build-force-play.ps1` **顺序文本拼接**为单一 IIFE，共享状态靠固定加载顺序 + `var` 提升隐式建立（代码注释已标注"有意为之的 hoisting 耦合"）。本次扫描确认**无外层重名函数**（`NO_OUTER_DUP_FN`），当前顺序下运行安全。
- 后果：若（a）构建顺序调整、（b）某模块改 `const/let`、（c）出现同名 `var` 遮蔽，会**静默**失效。不过 `swallow` 仅在运行时（异常分支）被调用，此时 `metrics.js` 顶层已执行，`_errCount` 已初始化为 0，不会得 `NaN`（此前担心的"窗口期 NaN"为理论情形，当前无此路径）。
- 建议：把共享契约显式挂到 `window.__CX_FORCE_PLAY`（站点引擎已有先例）；在 CI 增加"拼接后重名函数/未定义引用"静态校验。

**3. OCR/视觉答案字母解析仅覆盖 A–D**
- 位置：`takeover/engine/quiz.js`（`_quizVisionAnswer`）：`({A:0,B:1,C:2,D:3})[res.answer] ?? parseInt(res.answer,10)`。
- 表现：E+ 或多选字母串 `parseInt` 得 `NaN`，被范围检查兜底为随机作答。
- 建议：支持多字母拆分（如 `"ACE"`→`[0,2,4]`）；E 及以上显式映射。

**4. 注入式文本写入对标准原型有隐性依赖**
- 位置：`takeover/engine/vision-deepseek-web.js`（约 193 行）：`Object.getOwnPropertyDescriptor(proto,'value').set`。
- 表现：依赖原生 `HTMLTextAreaElement.prototype` 的 `value` 访问器；自定义元素/被重写的输入可能返回 `undefined` 抛错（已被 `safeGet` 兜底为 `inject-failed`→转随机答）。
- 建议：先判 `desc && desc.set`，否则退守 `ta.value = text` 并记录诊断。

### 🟢 低危（可择机优化）

**5. 桥接鉴权 token 经 query 参数携带**
- 位置：`perception/cx_crawler/bridge.py`（`_check_auth`）：支持 `?token=` 与 `Bearer` 头。
- 表现：token 出现在 URL。但桥**默认绑定 127.0.0.1、仅只读、不服务 `cookies.json`**，且 token 为可选项（默认无鉴权仅本地读非敏感 `playlist_*.json`）；非回环监听时会 loud 告警并要求 token。风险低。
- 建议：可统一走 `X-CX-Token` 头；token 加 TTL。

**6. `Access-Control-Allow-Origin` 反射请求 Origin**
- 位置：`perception/cx_crawler/bridge.py`（`_send_json`）：`Origin` 存在时回显该 `Origin`，否则 `*`。
- 建议：收紧为固定 `http://127.0.0.1`（或白名单），而非无条件回显（当前因仅回环 + 数据非敏感，实际影响有限）。

**7. 全局命名空间污染（非 `__cx` 前缀）**
- 位置：`sites/zhihuishu-exam.js`（`window.__zheStarted = true`）。
- 建议：改为 `window.__CX_ZHE_STARTED`，与 `__cx*` 契约一致。

**8. `quiz.js` 每次轮询读 localStorage 无缓存**
- 位置：`_quizSource()`：`localStorage.getItem(CX_KEYS.QUIZ_SOURCE)`。
- 建议：首次读后缓存到模块变量，监听 `storage` 事件失效。

### 🟢 已确认良好 / 已修复的设计点

- `popup-quiz.js` 的 `_pqDismiss`（先点跳过/关闭、再兜底 DOM 移除、幂等）已解决"删→弹"死循环；`cx_popup_block==='1'` 时静默关闭不作答（解决"关了还冒出"）。✅
- `zhihuishu-exam.js` 的 `dsAvailable()` 硬闸门：未连 DeepSeek 时锁死作答+交卷，开关灰禁。✅
- `main-loop.js`/`site-router.js`：`SITE_TICKS` 注册表自注册 + `_loopTick` 唯一轮询入口；DeepSeek 控制台分支提前 return 不空转。✅
- `panel-core.js`：ensurePanel 已加 `#__cxPanelClose/#__cxBtnPause/#__cxResume/#__cxRescan/#__cxEndRel` 的 null 守卫。✅
- `dom.js`/`lifecycle.js`：卸载/还原清单完整（十二项 + 多帧沙箱修复），`discardElement`/原型还原防范跨域异常。✅
- `perception/cx_crawler/session.py`：**Windows cookie 权限已修复**——`os.chmod(0o600)` + Windows 分支 `icacls /inheritance:r /grant:r <USER>:(R,W)`，且 `subprocess.run` 用列表参数（非 shell，无注入）。✅
- `perception/cx_crawler/bridge.py`：默认 `127.0.0.1`；非回环地址**告警**并要求 token；文件名正则防路径穿越；只服务 `playlist_*.json`。✅
- `config.py`/`chapters.py`：原子写、正则预编译、种子兜底策略合理。✅
- 无 `eval`/`new Function`/`document.write` 注入用户内容；`innerHTML` 写入均经 `escapeHTML`/`.replace(/</g,...)` 转义，未发现 XSS 路径。✅
- `commands.js`：命令解析安全（参数 `parseInt` 校验、异常 `swallow`），无注入。✅

---

## 四、性能与可维护性

- **性能**：`walkVideos` 设 `MAX_SCAN_DEPTH=16` 防深 DOM 卡顿；`quizTick` 依赖 dirty-gen 节流；`MO_QUEUE_CAP=1024` 合并 MutationObserver 回调；`ENDED_SRCS_CAP/PQ_HANDLED_CAP/QUIZ_HANDLED_CAP` 等去重上限防长会话内存膨胀。整体合理（唯一微优化见问题 8）。
- **可维护性**：
  - 优势：模块顶部注释说明职责/修复点；`CONST`/`SELECTORS`/`FLAGS` 集中；文档（`docs/`、`CODE_REVIEW*.md`）详尽；`_sim` 沙箱单测覆盖主要路径。
  - 劣势：58 文件靠顺序拼接为单 IIFE，无 import/export 契约（问题 2）；`toolkit` 双实现（核心注入复用 / 未注入回退本地最小实现）增加维护成本。
  - 建议：迁移到 ES Module 或引入"跨模块契约清单" + CI 重名校验。

---

## 五、续测二次核对结论（与首轮报告差异）

首轮曾将以下三项列为"中危"，经比对真实源码后**更正**：

1. **「Windows cookie 明文权限未受保护」→ 已修复**：`session.py` 已用 `icacls` 收紧 ACL（见第三节良好项）。
2. **「跨模块重定义静默失效」→ 未发生**：扫描确认 `NO_OUTER_DUP_FN`，当前靠构建顺序安全；仅属架构债务（问题 2），非现网 bug。
3. **「桥 CORS 反射 / token query」→ 风险显著低于原评估**：桥默认回环 + 暴露告警 + 不服务敏感文件 + token 可选项，实际影响有限（问题 5/6）。

此外，`popup-quiz.js` 的宽选择器在现有代码中**已收紧**（首轮描述基于旧版本残留），仅 `zhihuishu-exam` 与 DeepSeek 选择器仍待真实站点校准（问题 1）。

**最终优先级**：① 问题 1（真实站点校准选择器，择机）｜② 问题 2（跨模块契约显式化，排期）｜③ 问题 3/4（答题正确率加固，排期）｜④ 问题 5–8（低危优化，按需）。无紧急阻断项。

---

## 六、工具库项（addons）与视觉识别层（quiz-vision）专项审查（任务 #7）

审查文件：`plugins/registry.js`、`plugins/addons/{auto-next,keyboard-shortcuts,tamper-guard,video-ended-notify,quiet-popups,zhihuishu-auto-next}.js`、`takeover/engine/quiz-vision.js`。

**整体良好点**：所有 addon 均具备「幂等守卫（`window.__cx*Started`）+ 站点隔离（`detectSite()==='chaoxing'|'zhihuishu'`）+ 工具库项注册」三段式骨架；`auto-next`/`keyboard`/`zhihuishu-auto-next` 都已注册卸载清理到 `window.__cxAddonCleanups`；`quiet-popups` 正确委派给核心 `isQuietPopups/setQuietPopups`（解耦良好）；`zhihuishu-auto-next` 把真正的放行逻辑下沉到核心 `dom.js` 的 `_ovEnforce`（职责划分合理）。

### 🟡 中低危

**A7-1. `findNextDOM` 第三步遍历全页 `button/span/li/div`，性能与误命中风险**
- 位置：`plugins/addons/auto-next.js:235`（`var clickable = $dom.all('button, [role="button"], [onclick], span, li, div')`），每次视频结束（含 `resolveNext` 兜底路径）都会全量遍历整页所有 `div/span/li`。
- 表现：课程页 DOM 节点常达数千，`ct.length <= 8` 仅过滤文本长度但不缩减候选规模，逐节点 `textContent`/`isVisible` 开销随页面增长；同时 `NEXT_TEXT_RE`（:191）把 `章节测验|章节测试` 这类**题目词**混入"下一节"正则，在 `probeQuizEntry` 未命中时可能把题目链接当作"下一节"误导航。
- 后果：大页面轻微卡顿；极端情况下视频结束跳错页面（跳到题目而非下一节）。
- 建议：候选集限定在章节导航容器（如 `#prevNextFocusNext` 的祖先区块）而非全页；把题目词从 `NEXT_TEXT_RE` 剥离为独立的 `QUIZ_TEXT_RE`（文件内 :193 已有 `QUIZ_TEXT_RE`，应复用而非重复匹配）。

**A7-2. `quizAskDeepSeek` 全局依赖未做存在性守卫**
- 位置：`takeover/engine/quiz-vision.js:145`（`return quizAskDeepSeek(dataUrl, _opts);`）。
- 表现：`quizRecover` 的 `deepseek-web` 分支直接调用全局 `quizAskDeepSeek`，但若 `vision-deepseek-web.js` 未加载（如当前答题源非 DeepSeek），将抛 `ReferenceError` 且未被 `bestEffort` 包裹 → Promise 链 `uncaught rejection`。
- 建议：调用前加 `typeof quizAskDeepSeek === 'function'` 守卫，否则 `reject(new Error('DeepSeek responder 未就绪'))` 交由 `quiz.js` 的兜底逻辑。
- **续审复核（2026-08-13）**：不成立（误报，已关闭）。`quizAskDeepSeek` 为 `vision-deepseek-web.js:382` 的函数声明，构建 manifest 将其与 `quiz-vision.js` 拼入同一 IIFE 闭包；调用发生在运行时（`quizRecover` 执行期）而非顶层，函数提升/赋值均已就绪，不存在 `undefined` 调用，不会 `uncaught rejection`。

### 🟢 低危（可择机优化）

**A7-3. `cid()` 重复 `p.get('courseId')`（复制粘贴）**
- 位置：`plugins/addons/auto-next.js:90`：`return p.get('courseId') || p.get('clazzid') || p.get('courseId')`。
- 表现：第三个子句与第一个完全相同，是冗余/复制粘贴错误（疑似想写 `clazzId` 或 `courseId` 仅取一次）。
- 后果：无害（第三个在第二个为 null 时本就返回 null），但属明显代码异味。建议直接改为 `p.get('courseId') || p.get('clazzid')`。

**A7-4. `video-ended-notify.js` 死代码**
- 位置：:9 `var swallow = TK.swallow || function(e){};`（定义后全文未使用）；:11 `window.__cxEndedNotifyReady = true;`（设置后无任何读取方，注释称"跨脚本就绪标志"但并无消费方）。
- 建议：删除未使用的 `swallow` 与 `_ready` 全局，或确实在 `start()` 前用 `__cxEndedNotifyStarted` 做跨脚本去重（当前仅 `window.__cxEndedNotifyStarted` 守卫，而 `__cxEndedNotifyReady` 形同虚设）。

**A7-5. `video-ended-notify.js` 未确保 `__cxAddonQueue` 存在**
- 位置：:144 `if (window.__cxAddonQueue) window.__cxAddonQueue.push(addon);`。
- 表现：仅做真值判断，未像 `auto-next.js:407` 那样 `if (!Array.isArray(window.__cxAddonQueue)) window.__cxAddonQueue = [];` 兜底。若核心脚本未能就绪（队列未创建），此 addon 被**静默丢弃**而非降级注册。
- 建议：统一写法，先确保数组存在再 push。

**A7-6. `zhihuishu-auto-next.js` 的 storage 监听泄漏**
- 位置：:49 `window.addEventListener('storage', ...)` 注册后**未**向 `window.__cxAddonCleanups` 推入反注册函数（对比 `auto-next.js:431`/`keyboard.js:110` 均有 `removeEventListener` 清理）。
- 后果：脚本卸载（如用户临时禁用）后该 storage 监听残留，可能在新页面继续改写 `zhsAllowEndedReplay`。
- 建议：补 `window.__cxAddonCleanups.push(() => window.removeEventListener('storage', handler))`。

**A7-7. `quiz-vision.js` 选项选择器字符串重复**
- 位置：:112 与 :141 两处完全相同的 `'[class*="option"], li[class*="choice"], .option-item, .q-option'`。
- 建议：抽为 `QUIZ_VISION.OPTION_SELS` 常量复用，避免日后只改一处导致不一致。

**A7-8. `tamper-guard.js` 无手势请求通知权限 + `ns` 未判空**
- 位置：:131 `init()` 内 `Notification.requestPermission()`；:69 `notify()` 内同样在无用户手势场景下请求权限。
- 表现：现代浏览器对无手势的 `requestPermission()` 会**自动拒绝或静默**（且控制台告警），导致"被绕过"告警的 OS 通知形同虚设。`init()` 内 `ns.TimerRegistry.setInterval`（:124）也未判 `ns` 空，核心未注入时抛错被 `bestEffort` 吞掉 → 守护定时器不启动，但开关仍注册（用户误以为已启用）。
- 建议：权限请求改为在用户首次点击"开启告警"时触发（如 `set()` 回调内）；`init` 入口加 `if (!ns || !ns.TimerRegistry) { /* 核心未就绪，降级 */ return; }`。
- **续审复核（2026-08-13）**：`ns` 未判空属误报（已关闭）——`tamper-guard.js:140` 站点隔离 `if (!(window.__CX_FORCE_PLAY && typeof ...detectSite === 'function')) return` 在 `init()` 前提前返回，核心未注入时守护根本不激活，`ns` 不会被解引用；仅保留"无用户手势请求权限"一项（低危）。

**A7-9. `registry.js` 求值期即调用 `drainAddonQueue()`**
- 位置：:111（模块拼接后立即 `drainAddonQueue()`），此时面板尚未建立，因 `renderAddons` 内 `if (!_cxPanel) return`（:17）而安全空转，但属一次无副作用的预排空。
- 表现：强依赖同 IIFE 内 `STYLES`/`cxIcon`/`_cxPanel`/`bestEffort` 在这些调用前已定义（构建顺序耦合，见问题 2）。当前顺序安全，但无编译期保证。
- 建议：无需改动（已安全），仅作为问题 2「跨模块契约显式化」的佐证案例记录。

### 续审复核与修复（2026-08-13）
对上列 9 项逐条比对真实源码与构建产物：A7-1/3/4/5/6/7 属实并已修复；A7-2 与 A7-8 的 `ns` 未判空为误报（见各条复核）已关闭；A7-8 的"无用户手势请求权限"维持低危建议；A7-9 维持原结论。

**已落地修复（源码 `ecosystem/src/chaoxing-force-play`）：**
- **A7-1** `plugins/addons/auto-next.js`：从 `NEXT_TEXT_RE` 移除 `章节测验|章节测试`（题目/作业/考试入口改归 `QUIZ_TEXT_RE` 处理），避免视频结束兜底查找把题目链接误当"下一节"导航。
- **A7-3** `plugins/addons/auto-next.js`：`cid()` 删除重复子句 `|| p.get('courseId')`。
- **A7-4** `plugins/addons/video-ended-notify.js`：删除未使用的 `var swallow` 与 `window.__cxEndedNotifyReady = true` 死代码。
- **A7-5** `plugins/addons/video-ended-notify.js`：注册前确保 `window.__cxAddonQueue` 为数组，并在核心就绪（`__cxRegisterAddon` 存在）时立即调用排空，杜绝 addon 被静默丢弃。
- **A7-6** `plugins/addons/zhihuishu-auto-next.js`：将 `storage` 监听的反注册函数登记到 `window.__cxAddonCleanups`，修复脚本卸载后监听泄漏。
- **A7-7** `takeover/engine/quiz-vision.js`：抽出 `QUIZ_VISION.OPTION_SELS` 常量，统一 `quizVisionAsk`/`quizRecover` 两处内联选择器（消除重复、单点维护）。

**验证**：全量 `build-force-play.ps1` 已重跑通过——`node --check` / `eslint` / 契约(`_verify`,`_doc`,`_semantics`) / `metadata` / `_sim (via run-sim.js) PASSED`，产物 `chaoxing-force-play.user.js` 已重建。期间 A7-7 初版误写成对象字面量自引用（`OPTION_SELS: QUIZ_VISION.OPTION_SELS`）触发 `undefined` 读错，已由 `_sim` 门禁捕获并改为字面量属性值后通过。

### 续审复核与修复（2026-08-13，第二轮）
继续落地首轮「低危/可加固」与任务 #7 复核中确认仍成立的项：

- **A7-8-①（低危，已修复）** `plugins/addons/tamper-guard.js`：原 `notify()`（line 69）与 `init()`（line 131）均**无用户手势**时调用 `Notification.requestPermission()`，浏览器会忽略/拦截。修复：`notify()` 仅在 `permission === 'granted'` 时弹通知、移除其内 `requestPermission`；`init()` 删除自动请求块；把权限请求移入用户点击开关的 `set(v)` 手势内（line 150–151）。
- **问题 8（`__zheStarted` 命名空间污染，低危，已修复）** `sites/zhihuishu-exam.js`（line 23–24 幂等守卫）与 `takeover/dom/lifecycle.js`（line 142 清理列表）统一改名为 `__CX_ZHE_STARTED`，与 `__cx*` 命名约定一致，避免全局命名空间污染。
- **问题 4（OCR 仅解析 A–D，低危，复核：已过时/不成立）** 当前 `zhihuishu-exam.js` 的 `_zheResolve`（line 103–118）走题库匹配（`src==='bank'`）或随机（`Math.random`），**已无** `ans.match(/[A-D]/g)` 形式的 OCR 字母解析；报告所述的多选超 4 项转随机逻辑在现行代码中不存在，故关闭，无需改动。
- **问题 9（localStorage 重复读无缓存，低危，维持原结论暂不处理）** `_zheResolve` 每次调用读 `CX_KEYS.QUIZ_BANK` 并 `JSON.parse`，属 minor 性能项，无正确性风险，排期择机。

**本轮验证**：全量 `build-force-play.ps1` 重跑通过——`node --check` / `eslint` / 契约(`_verify`,`_doc`,`_semantics` + SELFTEST) / `metadata`(+SELFTEST) / `_sim (via run-sim.js) PASSED`，产物已重建。

### 与总体结论的关系
以上 9 项**均不阻断运行**，且与第三节的评估一致：工具库项架构清晰、防御式到位。唯一值得排期的是 **A7-1（导航选择器范围/题目词混入）** 与 **A7-2（DeepSeek 未就绪守卫）**，二者影响实际功能正确性，建议并入"问题 1/3"一并择机处理；其余为代码异味与一致性加固。
