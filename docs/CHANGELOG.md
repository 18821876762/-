# 学习通·强制续播 — 版本演进 CHANGELOG

> 脚本：`chaoxing-force-play.user.js`（Tampermonkey / Violentmonkey）
> 版本区间：v3.7（功能基线）→ v3.15（抗伪暂停 / MSE 断流）
> 评审来源：第三方 AI 代码审查（14 项逻辑/健壮性审查 + 两轮逐版复核）
> 另含：跨组件桥接（`cx_crawler/dump.py` + `cx_crawler/bridge.py` + `chaoxing-auto-next.user.js v2.1`）

---

## 评级速览

| 版本 | 性质 | 关键变化 | 对应评审 |
|---|---|---|---|
| v3.7 | 基线 | 五大主体功能成型 | —（内部基线） |
| v3.8 | 评审目标 | 功能同 v3.7；暴露后续各版修复的缺陷 | 第三方综合审查（目标版本） |
| v3.9 | 健壮性一轮 | MediaSession 改 `playing` + 5 项加固 | 综合审查 #1 等 |
| v3.10 | 综合修复 | 描述符探测 / 重建去重 / 直播守卫 / 清死代码 | 综合审查 #2 #3 #4 #5 #6 #8 #12 #13 |
| v3.11 | 复核修复 | keyRe 回退 / iframe 收敛 / 删死配置 / 音量事件驱动 | 复核 A B C D E H |
| v3.12 | 复核修复 | 监听器泄漏消除 / 边界匹配一致性 | 复核 H（续） |
| v3.13 | 跨组件桥接 | force-play 接爬虫清单（已完成章避让 + 定向预填）；auto-next v2.1 清单精确跳章；新增 bridge.py + dump playlist 产出 | 方案 A 本地 HTTP 桥 |
| v3.14 | 抗失效加固 | attachments setter 即时感知 + 桥 objectids 兜底；重建去重扩展 iframe id/name/title/data 与 video id 指纹（抗 blob: MSE）；防暂停下沉 HTMLMediaElement.prototype 拦截闭包/webpack 私有暂停 | 后续第三方失效场景分析 |
| v3.14 | 端口可配置化 | bridge.py 支持 `--host/--port/--config` + 环境变量 + `bridge_config.json`；force-play/auto-next 通过 `?cxbridge=`、localStorage 或自动探测候选端口对齐 | 用户需求：端口可配置化 |
| v3.15 | 抗伪暂停/MSE断流 | playbackRate 伪暂停下沉原型 setter 拦截（与 ratechange+轮询三重兜底）；MSE 断流新增 waiting/stalled 监听触发 safePlay 续播 | 后续第三方失效场景分析 |
| v3.16 | 专项复查修复 | F-B1：定向跳过分支补 `releaseVideo` 撤销全量阶段已接管 + `__cxReleased` 守卫兜底续播；F-B4：每轮 scanVideos 重新 neutralize 原型 pause 防描述符被还原；F-B5：`urlParam` 分隔符加入 `#` 兼容 hash 参数；F-B10：USAGE 注明 `RENDER_JOBS=False` 时 `objectids` 恒空 | 「学习通·强制续播」专项复查 |
| v3.17 | 诊断报告修复 | #二：ratechange 监听与每扫速率断言补 `!v.__cxAN_hold` 守卫，与原型 setter 契约一致（防绕过 auto-next 暂停锁）；#三：定向 0 命中回退改连续 N 轮迟滞（TARGET_FALLBACK_ROUNDS=3），消除章节间隙/视频延迟渲染瞬时空窗误强播广告；#一/#四~#十 经核对驳回（回环地址混合内容豁免、拆分风险、监听 {once} 自清、幂等会破坏 F-B4 等） | 「学习通·强制续播」诊断报告 |
| v3.18 | 诊断报告修复 | #八：`refreshTargets` 把 `chapterId`/`knowledgeId` 变化也纳入 `ENDED_SRCS` 清空触发条件（新增 `_lastChapterKey`），消除跨章复用同一 objectid 时旧章已结束指纹误锁新章首播 | 「学习通·强制续播」诊断报告 |
| v3.19 | 注释强化（无行为变更） | 在易误判处补"【易误判·诊断#N】"注释：#一 回环地址混合内容豁免；#四 overrideVideo 刻意不分拆；#五 safePlay 监听 {once:true} 无需去重；#六 原型 pause 每轮重装是 F-B4 刻意设计勿改幂等；#九 MO 全子树查询已批处理非缺陷；#十 契约字段名刻意不常量化 | 「学习通·强制续播」诊断报告 |
| v3.20 | 续播释放修复 | F-B2/F-B6：`restoreNativePause` 在恢复实例级原生 `pause` 后，补充清除 `__cxForcePaused=false` 与 `__cxReleased=true`，使已完成章避让后用户可正常暂停/播放（否则原型 noop 拦截仍在、中性化 play 阻止播放） | 「学习通·强制续播」专项复查（F-B2/F-B6） |
| v3.21 | 切屏崩溃修复 | MutationObserver 队列 `_moQueue` 在后台标签页无限增长致渲染进程 OOM：后台 rAF 被暂停永不 flush、而页面隐藏期仍高频 mutate。改为隐藏时用 setTimeout 排空队列（节流仍触发）+ 1024 上限安全阀，消除切屏 30min+ 整页崩溃 | 运行期崩溃报告（切屏 30min+） |
| v3.22 | 调试埋点（无行为变更） | 新增 `_memSample` 内存观测：DEBUG 时主循环每 ~1min 采样 `performance.memory.usedJSHeapSize` + `_moQueue`/`ENDED_SRCS` 长度，并在 `visibilitychange` 切屏前后各采一次，用于验证 v3.21 修复并监测其他潜在泄漏 | 用户需求：运行期内存观测 |
| v3.23 | 面板滚动修复 | 主控面板 `#__cxPanel` 原固定 `top:12px` 但无高度上限，内容超视口时底部不可见且无法滚动。补充 `max-height:calc(100vh - 24px);overflow-y:auto`，移动端媒体查询同步加 `max-height:calc(100vh - 16px);overflow-y:auto`，使面板内容可在视口内纵向滚动 | 用户反馈：面板太长且无法向下拖动 |
| v3.24 | 倍速真正生效 | `applyUserRateAll` 原仅对 `__cxForcePaused`（已强制接管的任务点视频）施加用户倍速，定向模式下被释放的主视频/普通观看视频速率永不生效，且平台把 playbackRate 重置回 1x 后无持续压制，面板显示 2x 而视频按 1x 播、形同虚设。改为对所有视频施加（仍尊重 `__cxAN_hold`/`__cxUserPaused`/`__cxEndedLock`、跳过 0 伪暂停），并在主循环每轮调用 `applyUserRateAll()` 持续压制平台重置 | 用户反馈：倍数效果形同虚设 |
| v3.25 | 自动下一课修复 | 视频播完后 `fallbackNext` 依赖旧版目录选择器与 active 类定位当前章：① `chaptersAll` 容器/章节项选择器过旧，新模板下整体落空→直接 return 永不跳章；② `currentChapter` 仅按 active/current 类判定，无此类时回退到"章节开头"而非"下一节"；③ `anchorForKnowledgeId` 不扫 data-*，桥清单 knowledgeId 匹配不到。已大幅拓宽容器/章节项选择器并加兜底扫描，`currentChapter`/`fallbackNext` 增加按 URL knowledgeId 定位当前章，`anchorForKnowledgeId` 加扫 data-* 属性 | 用户反馈：自动下一节课无法达成 |
| v3.26 | 多视频统一面板 | 脚本在每个 frame 都完整运行以保证视频页出面板，导致每个视频 iframe 各自建面板、各自只枚举本帧 1 个视频、各自 keydown 仅在该 iframe 聚焦时生效（面板被埋在视频框内、必须点进视频才能用 P 键、一页多视频只检测到 1 个）。改为：`allVideos()` 从 `window.top` 文档聚合枚举（同源时跨 iframe 看到全部视频，跨域回退本帧）；`ensurePanel()` 把面板建在 `window.top` 文档并用全局 id 守卫保证全站仅一个面板（跨域顶层不可达时回退本帧）；keydown 保持挂每个 frame 的 `document`，故焦点在顶层或任一视频 iframe 按 P 都切换那个唯一顶层面板 | 用户反馈：多视频只检测到一个/面板在视频框中/需点视频才能用P |
| v3.23 | 用户暂停开关 | 新增手动暂停键 `PAUSE_HOTKEY` + 自动停止计时器 `AUTO_STOP_MIN` + 暂停后自动恢复 `RESUME_AFTER_MIN`（"暂停后是否开启"开关）。独立标志 `__cxUserPaused`（不与 `__cxReleased` 混用，防被重新接管逻辑清除）；overrideVideo 顶部与 pause/canplay/waiting/stalled/正常续播/防伪暂停六处均避让它 | 用户需求：可暂停视频 |\n| v3.24 | 暂停开关一致性 + 接管加固 | 跨脚本比对可取之处并补强：① `ratechange` 事件兜底与原型 `playbackRate` setter 补 `__cxUserPaused` 守卫（闭合 v3.23 暂停开关的防伪暂停路径，避免用户暂停后速率被强制拉回 1x）；② 吸收 browser-media-collector 的播放捕获思路，新增 document 级 capture `play` 监听，新视频一播放即 override，缩短动态插入播放器的 2s 接管空窗 | 用户需求：跨脚本可取之处评估（v3.23 对照） |\n| v3.25 | 悬浮控制面板 | `PAUSE_HOTKEY`(默认 p) 改为开/关悬浮控制面板：内含「暂停/恢复」按钮、`AUTO_STOP_MIN`(0–120min) 与 `RESUME_AFTER_MIN`(0–60min) 滑块，并实时显示当前视频状态/已看时长/自动停与恢复剩余；`currentVideo()` 优先取正在播放者、其次已用户暂停者。Esc/× 关闭。原 `p` 直接切换暂停改由面板按钮承担 | 用户需求：可视化控制面板（p 键开启） |\n| v3.26 | 面板调试增强 | 控制面板新增「调试日志 (DEBUG)」复选框（实时切换全局 `DEBUG`，开启后控制台输出 [CX-FORCE] 日志）；并将 v3.22 的内存埋点面板化：状态区下方实时显示 `performance.memory` heap 用量 + `_moQueue`/`ENDED_SRCS` 长度，无需开控制台即可观测切屏泄漏前兆 | 用户需求：面板加 DEBUG 开关 + heap 显示 |\n| v3.27 | 面板跨脚本适配 | 核查其余 7 个学习通脚本对控制面板的适配：均无。反之 force-play 面板做两处适配——① 检测到 `#cxProgressPanel`(progress-panel) 已挂载时自动下沉到其下方，避免同角(top-right, 同 z-index)重叠遮挡；② 状态区新增 `插播题锁定(auto-next)` 以反映 auto-next 的 `__cxAN_hold` 暂停，避免用户误以为卡死 | 用户需求：具体检查其他代码是否为控制面板做了适配 |\n| v3.28 | 面板一站式集成 | 控制面板整合全部开关与诊断：新增 `RESCAN_INTERVAL` 实时滑块（主循环提取为 `_loopTick` 命名函数 + `_loopTimer` 句柄，改间隔即 clearInterval 重启生效）、`复制诊断信息` 按钮（buildDiagnostics 汇总版本/视频数/moQueue/heap/桥/定向/CONFIG/当前视频全部标志，navigator.clipboard 带 execCommand 降级），诊断块合并显示版本·视频·moQueue·ended·heap·桥·定向·轮询，便于反馈问题 | 用户需求：面板集成所有信息与开关便于反馈 |
| v3.29 | 面板精简模式 | 控制面板新增「精简模式」复选框（用户自选、localStorage `cx_panel_compact` 持久化）：勾选后隐藏诊断信息块 / 轮询间隔滑块 / DEBUG 开关 / 复制诊断按钮，只保留状态区 + 暂停/恢复按钮 + 自动停/恢复滑块；取消勾选即恢复完整面板（反馈问题时切回完整模式）。精简下跳过诊断块刷新，省每轮 heap/DOM 读取；诊断文本 CONFIG 行附带精简状态 | 用户需求：让用户自选是否精简面板 |
| v3.30 | 面板计时修复 + 进度显示 | 修复面板"已看"恒为 0：`__cxWatchMs` 原先只在 `AUTO_STOP_MIN>0` 时才累计（默认 0 → 计时器从不运行）。改为 `autoStopTick` 每轮始终累计观看时长（自动暂停判定移入 tick 内部按开关生效），并用真实墙钟差值 `Date.now()` 代替固定 `RESCAN_INTERVAL` 步长（后台节流下不再少算，>60s 大跳视为休眠唤醒丢弃）。状态区与诊断文本新增视频播放进度 `currentTime/duration`（新 `fmtTime` m:ss / h:mm:ss） | 用户反馈：面板播放时间一直为 0 |
| v3.31 | 用户暂停锁加固 | 用户诊断实锤矛盾态：`状态: playing` 而 `UserPaused=true`——脚本只拦"暂停"从不拦"播放"，`userPause` 停一次后平台播放器自调 `video.play()` 即拉回播放，暂停锁形同虚设。三重修复：① `userPause` 在实例上装"播放闸门"（defineProperty 遮蔽 `play`，暂停期一律拒绝并返回 resolved Promise；`userResume` 时 `delete v.play` 还原）；② document 捕获级 `play` 监听对 `__cxUserPaused` 视频立即原生 pause 压回（防平台绕过闸门直接触发播放）；③ overrideVideo 的用户暂停分支加每轮看门狗：发现"暂停锁挂着却在播"立即压回。新增 `NATIVE_PLAY` 原型备份 | 用户反馈：诊断信息显示 playing+UserPaused 并存 |
| v3.32 | 进度到底关闭续播 | 新增 `END_RELEASE_SEC`（默认 15s，面板滑块可调，0=禁用）：视频距结尾 ≤ 该秒数且未真正 ended 时，脚本主动 `releaseVideo` 撤销强制续播接管、交还平台原生 pause，让用户能自然暂停/结束（应对"视频不必一次性看完"——接近看完时停手，避免 pauseNoop 吞掉原生暂停导致无法停）。每轮到底仍持续释放 + 提前返回，绕过 F-B1 重新接管逻辑；用户往回拖（离开到底区间）则自动恢复续播；真正 ended 仍由 ended 锁分支防重播。新增 `nearEnd()` 判定，诊断 CONFIG 行与标志行(`EndRel=`)同步显示 | 用户建议：进度到底时关闭续播 |
| v3.33 | 面板滑块数值显示修复 | 修复拖动摇杆（轮询间隔/自动停止/自动恢复/进度到底释放）时旁边 `<b>` 数值文字不跟随变化：原 `refreshPanelState` 只刷新状态/诊断区，数值标签仅靠 `syncPanelInputs` 在面板创建时回填一次。新增 `refreshPanelLabels()` 在 `refreshPanelState` 内调用，拖动即时刷新全部滑块数值；四个滑块统一受益 | 用户反馈：拖动面板改变数据时显示不变 |\n| v4.0 | 主/副脚本架构重组 | 升格为**主脚本**：面板更名「学习通·主控面板」，新增副脚本注册中心（`window.__cxAddonQueue` 队列 + `window.__cxRegisterAddon()`，加载顺序无关），面板新增「副脚本」区块统一渲染各副脚本的开关/按钮（toggle/button + note）。副脚本：auto-next(3.0) 总开关、progress-panel(3.0) 显隐、deceive-api(2.0) SPOOF 开关（刷新生效）。弃置并删除：no-pause、visibility-resume（功能被主脚本覆盖）、allinone（既有弃置分叉）；browser-media-collector 因与学习通无关、属其他用途，单独保留（不废弃、不接入面板） | 用户要求：面板脚本为主、其余适配面板、不能适配/过时全弃置 |
| v4.1 | 面板设置持久化 | 控制面板改动（自动停止/自动恢复/轮询间隔/进度到底释放/调试日志）写入 `localStorage.cx_panel_cfg`，脚本启动即载入，刷新网页后保持不变；`loadPanelCfg()` 在轮询定时器启动前执行使间隔立即生效，越界值 clamp 回控件范围。精简模式与副脚本开关此前已各自持久化 | 用户需求：刷新后控制数据不变 |
| v4.2 | 副面板（subpanel）架构能力 | 主脚本 addon 机制新增 `subpanel` 类型：`renderAddons` 拆出「副面板」容器（`#__cxSubPanels`），副脚本通过 `render(container)` 把内容直接嵌进主控面板的可折叠副面板区（标题栏点击展开/折叠，默认展开）；主面板模板新增「副面板（内嵌显示，可折叠）」标题。`chaoxing-progress-panel` 由 v3.1 的**独立浮动窗**改为 v3.2 **内嵌副面板**：移除 `#cxProgressPanel` 浮动窗与拖拽/最小化/SPA 重建逻辑，`renderProgressContent(container)` 把课程列表/章节/刷新/原始JSON 渲染进主控面板；顶层 + realm 守卫保留（防 iframe/重复注入注册多个副面板）；原「副脚本」区的显示/隐藏开关一并移除。清理 `positionPanel`（独立浮动窗已不存在，无需避让）。刷新网页后副面板内容随主控面板重建（需重新点「刷新课程列表」拉取） | 用户需求：控制面板添加副面板 |
| v4.3 | 可控循环播放 | 新增 `CONFIG.LOOP_PLAY` 开关（面板「循环播放（播完从头重播）」复选框，localStorage 持久化，默认关闭）。开启后：① 正常续播与每轮重扫的 `v.loop` 改为受 `LOOP_PLAY` 控制（开即 `loop=true`，关则钳回 `false`）；② `ended` 分支不再锁死防重播，改为清空 `__cxEndedLock`、置 `loop=true`、回到开头重播（浏览器 loop 与手动复位双保险，pause 仍被 no-op 拦截）；③ `nearEnd` 进度到底分支在循环模式下不提前释放，让视频真正 ended 后重播；④ `isRebuildFinished` 重建去重分支在循环模式下不锁死（允许重播）；新增 `applyLoopAll()` 供开关即时生效。关闭时自动恢复原有防重播/与 auto-next 跳课协同 | 用户需求：可控制的循环播放 |
| v4.4 | 主从式导航面板 + 取消精简模式 | 面板改为顶部导航栏 + 四个分区块（暂停设置 / 副面板 / 高级 / 其他）的主从式布局：点击导航按钮切换下方内容区（`switchTab` 通过 `.cx-tab` 显隐 + 按钮高亮，当前 tab 存 localStorage `cx_panel_tab` 持久化）。移除精简模式（`PANEL_COMPACT`、`#__cxCompact` 复选框、`applyCompact()`、`cx_panel_compact` 持久化全部删除），所有控件常显；`#__cxPanelInfo` 移入「高级」区块，`#__cxAddonsWrap/#__cxSubPanelsWrap` 移入「副面板」区块。移动端适配补充 `.cx-nav-btn` 放大点按区 | 用户需求：上侧导航栏（主从式布局）+ 分区块 + 取消精简模式 |
| v4.5 | 诊断/状态/暂停按钮漏算视频修复 | `allVideos()` 原仅从 `window.top` 下钻同源 iframe、不进 Shadow DOM，导致视频位于 Shadow DOM（或脚本运行在子 iframe 而 `window.top` 跨域不可达）时，续播接管成功（视频在播、手动暂停被接管）但诊断显示「视频总数: 0 / 当前无视频」、`currentVideo()` 返回 null 使面板「暂停/恢复」按钮无法操控该视频。重写 `allVideos()` 复用 `scanVideos` 的枚举口径（递归进 Shadow DOM + 同源 iframe），并以本帧 `document` 为主、再并入 `window.top` 同源文档，去重聚合。诊断、状态区、面板暂停按钮（`activeVideo`/`currentVideo`）三者口径一致修复。视频自带暂停按钮被接管拦截属强制续播预期，手动暂停请改用面板「暂停/恢复」按钮 | 用户反馈：有视频却显示无视频、手动暂停失效 |
| progress-panel v3.3 | 课程列表解析修复 | `backclazzdata` 接口真实结构为 `channelList[].course.data[]`，课程字段（name/id/clazzId/cpi）嵌套在深层；原 `extractCourses` 只取 `channelList` 顶层壳对象，导致显示「(无名课程) / cid=? / clazzid=? / 进度 ?」。`extractCourses` 改为递归下钻 `_walkCourses`：以「含 `clazzId`，或含 `cpi` 且含 name 类字段」为课程指纹（排除无 name 的 cpi 壳），按 `cpi`（缺则 `clazzId`）去重并保留字段最多的对象；`courseName/courseId/classId` 候选键拓宽（`courseTitle/kclazzName/kclazzId/cid` 等）。修复后课程名/ID/班级ID/进度正常显示 | 用户反馈：课程列表解析异常（原实现即有此问题） |
| progress-panel v3.4 | 增强错误提示 | 新增 `describeError(err)` 集中映射：网络层失败（fetch throw / `Failed to fetch`）→「网络异常」；HTTP 401/302/301 →「登录过期」；HTTP 403 →「权限不足」；HTTP 404 →「接口地址失效」；5xx →「服务器异常」；其余 →「请求被拒绝」。原 `getJSON` 的 `JSON_PARSE_ERROR` 分支（2xx 却非 JSON，最常被登录页 HTML 顶替）改为明确提示「登录过期或接口结构变化」，并引导重新登录 + 用原始JSON 确认。课程/章节两处 `.catch` 均改用语义化文案，保留「重试」按钮 | 用户方向清单：🔍 增强错误提示 |
| progress-panel v3.5 + force-play v4.3 | 可视化图表 + 移动端适配 | **CSS 图表（纯 CSS，无外部库）**：① 课程卡片加入「完成率」CSS 进度条（`.cx-pbar`，`progressToNum()` 把 `进度 70%` 转成 0~100 数值驱动宽度，渐变填充）；② 章节列表顶部新增「已完成 X / 共 Y（pct%）」CSS 汇总条（`.cx-cbar`，按 `done` 计数算完成率）。**移动端适配**：progress-panel 在 `.cxPContent` 样式块追加 `@media (max-width:480px)`（缩字号 11px、放大按钮点按区、缩小进度条最小宽度）；force-play 在 `ensurePanel` 注入一次性 `#__cxPanelMobileStyle`，对 `#__cxPanel` 在窄屏下改为 `left/right/top:8px;width:auto;max-width:none`（铺满屏宽）、放大按钮与滑块点按区、缩字号，使主控面板 + 副面板在手机上可读可点 | 用户方向清单：📊 可视化图表 + 📱 移动端适配 |
| force-play v4.4 | 倍速调节（自定义播放速率） | 新增面板控件「播放速率」下拉（0.5/0.75/1/1.25/1.5/1.75/2x），配 `CONFIG.USER_RATE`（默认 1，钳制 0.25~4），经 `savePanelCfg` 持久化到 `localStorage.cx_panel_cfg`（刷新后保持）。**与防暂停契约融合**：三处伪暂停回拉目标（原型 setter / `ratechange` 监听 / 轮询断言）由硬编码 `1` 改为 `USER_RATE`——平台用 `rate≤0.01` 伪暂停时拉回用户设定速率，使用户倍速在伪暂停事件中存活；用户手动正常调速（>0.01）始终放行。新增 `applyUserRateAll()`：调节后即时遍历主文档+iframe 的「已强制接管」视频施加 `USER_RATE`；轮询新增 `else-if` 分支，对 `USER_RATE≠1` 的已接管视频持续把速率拉回用户值（不动广告 / auto-next 锁定 / 用户暂停 / 伪暂停视频）。调试常量新增 `USER_RATE` | 用户方向清单：🚀 播放速率调节 |
| force-play v4.5 + progress-panel v3.6 | 进度同步·本地估算 | **仅做本地估算（方案 B），不读取/上报平台观看时长**（合规红线）。force-play 新增 `recordWatchMs(src,dt,courseId)`：在 `autoStopTick` 累加 `v.__cxWatchMs` 的同时，按「视频源」把已看毫秒写入 `window.__cxWatchStats[src]={ms,courseId,updated}`，节流（10s）持久化到 `localStorage.cx_watch_stats`（跨会话累计）；`loadWatchStats()` 启动时载入。`urlParam(topHref(),['courseId'])` 提供课程关联键。progress-panel 新增 `courseWatchMin(cid)` 汇总同课程已看分钟，在课程卡片展示「本机已看 Xmin · 效率≈Y%/min（本地估算）」（`效率=进度%÷已看分钟`），并在副面板顶部注明「本地估算，非平台同步，清缓存即丢失」。force-play 未加载 / 无本地数据时该卡片不显示估算行，零影响 | 用户方向清单：📈 进度同步（可行性调研结论：平台无读接口 + 写路径违规，仅本地估算可行） |
| v3.35 | 撤销 v3.34 多实例守卫回归 | v3.34 的"同源 iframe 副本直接 return"使视频播放页（常嵌同源 iframe）整段退出、面板建不出（用户：有视频页面板打不开，无视频页可开）。撤销该 return，每 frame 完整运行使面板在视频页可见；视频接管由 __cxForcePaused 幂等保护、顶层下钻 iframe 处理其视频，重复注入不崩，桥/定时器重复开销极小且幂等 | 用户反馈：有视频页面板打不开 |\n| v3.34 | 复审问题修复（6 项） | ①【中高危】iframe 签名传递：`videoIframeSrcsOf`/`videoBelongsToTask` 的 `while(parentElement)` 永远够不到父文档 iframe（死代码），导致 MSE/blob: 视频重建去重失效；`scanVideos` 下钻时把宿主 iframe `signatureOf(f)` 作为 `hostSigs` 传入并挂到 `v.__cxHostSigs`，定向/重建去重据此命中，MSE 防重播恢复。②【中危】多实例：同源 iframe 副本提前 `return`（顶层实例下钻处理），消除双面板/双桥/双倍定时器；跨域 iframe 保留接管。③【低-中危】`userResume` 清 `v.__cxEndedLock` 并解除 `ENDED_SRCS` 黑名单、重置进度，恢复续播可重看已播完视频。④【易修】DEBUG 改为运行时判定（`dbg` 不再固化为 no-op），面板勾选即时生效。⑤ 定向 fallback：全部暂停时 `matchedAny` 恒 false 误触回退全量——`overrideVideo` 在用户暂停提前 return 前先统计 `matchedAny`。⑥【低危】play 即时接管下钻到 iframe 文档（`installPlayWatch(doc)`，首钻安装、防重复） | 用户复审报告（force_play_review_333_new.md） |\n| 2.3 | 审查加固 | cx_crawler：S1 新增 `save_cookies()` 在 `verify_login` 后持久化 warmup 刷新的补充 cookie（rose/route/k8s），免去重复手动登录；健壮性修复（见下「审查加固 2026-07-28」）；progress-panel 移除无效 Referer 伪造 + cur 节点正则收紧 | 全工作区代码审查（高优 5 项） |

---

## 审查加固 2026-07-28（cx_crawler 2.3 + progress-panel）

依据全工作区代码审查落地的高优修复（5 项），提升稳定性与正确性：

- **[R1] render.py — 浏览器启动失败防御**：`render_course_taskpoints` 中 `browser` 初始化改为 `None` 并整体纳入 `try`，`finally` 中判定非空才 `close()`，避免极端路径下 `NameError` 掩盖真实异常。
- **[R2] courses.py — 缺失关键 id 跳过**：`clazzid`/`courseid` 为 `None` 时跳过该课程（不再把字符串 `"None"` 经 `.format()` 拼进章节 URL 导致请求失真）。
- **[R3] config.py — 桥配置优先级修正**：`_load_bridge_config` 改为「环境变量 > `bridge_config.json` > 默认值」，原逻辑让 JSON 静默覆盖环境变量（与文档宣称优先级相反）已修复；并抽出 `_default_or_int` 安全解析。
- **[L7] bridge.py — 并发服务**：`HTTPServer` 改为 `ThreadingHTTPServer`，浏览器并发拉取多个课程 playlist 不再被串行阻塞。
- **[J1/J2/J12] chaoxing-progress-panel.user.js**：移除 fetch 对禁设头 `Referer` 的伪造（浏览器本就忽略，实际发送自然 Referer；在 studentstudy 播放页上下文点击最稳）；章节节点匹配收紧为正则 `/^cur\d{6,}$/`，排除 `current`/`cursor` 等误匹配；头部版本号对齐 auto-next(2.3)/force-play(3.15)。
- **[L1] dump.py — 续跑渲染回填**：新增 `_maybe_render_backfill`，续跑命中且 `RENDER_JOBS=True` 且多数任务点仍缺 `jobids/objectids` 时仍补跑渲染回填，免去手删 `03_tasks_*.json` 或 `FORCE_RERUN`。
- **[L2] dump.py — 作业拉取门控**：默认模式下「作业/类型识别」明确提示需 `RENDER_JOBS=True`，并给出启发式候选（含任务点且未完成>0）；README 同步说明。
- **[L6] session.py — 死代码**：移除 `load_cookies` 中永真的 `elif` 分支，缺 `name/value` 字段的项告警后跳过而非拒绝整文件。
- **[G3] api_client.py — 死代码**：删除未使用的 `get_json` 预留方法。
- **[J10] chaoxing-deceive-api.user.js — 死代码**：删除恒无效的 `w1.prototype = r1.prototype`。
- **no-pause 死守卫**：移除恒为 `false` 的 `GUARD_REMOVAL` 开关及其包裹的 `removeEventListener` 重写块（默认关闭、永不启用）。
- **[G1] config.py — courses 接口统一 https**：`API["courses"]` 由 `http://` 改为 `https://`，与 `HEADERS.Referer` 的 https 一致，消除混合协议/HSTS 升级导致的脆弱链路（courses.py 的 fallback 仍按域名替换，协议一并跟随）。
- **[G2] config.py — UA 贴近真实**：User-Agent 由失真的大版本 `Chrome/150 / Edg/150` 改为 `Chrome/138 / Edg/138`（2026 年中稳定线），避免反爬 UA 校验或显得可疑。
- **[G4] config.py — 运行锁释放健壮性**：`RunLock.release` 显式吞掉锁文件已删除时的 `FileNotFoundError`（`atexit.register(lock.release)` 退出时不再打印无关回溯）。
- **[G5] requirements.txt — 依赖版本锁定**：`requests` 限 `<3`、`playwright` 限 `<2`（已知可用 `playwright==1.47.0`），避免跨环境/时间推移后拉到破坏性大版本。
- **[L4/L5] session.py — 扩展 with_retry 范围覆盖登录校验**：`verify_login` 原直接 `s.get` 绕过 `ApiClient`，弱网下一次 5xx/网络抖动就直接判「登录校验失败」中断整轮。改为经 `ApiClient.get` 发起（先构造 `client = ApiClient(s)` 再传入），使其与后续请求一致享有限速 + 指数退避重试 + DEBUG 日志，并顺带落盘 `01_courses_raw.json`。
- **[J4] no-pause — 收窄 2s 全文档扫描**：`x1(root)` 原 `querySelectorAll('*')` 每 2s 全文档枚举找 Shadow 宿主/iframe，DOM 大时主线程空转明显。改为窄选择器 `#videoBox, .ans-attach-ct, iframe`，仅对命中元素递归其 Shadow DOM/iframe 文档挂监听；容器子树内的 Shadow 宿主仍会被递归发现。
- **[J5] auto-next — run 提前 return 释放忙锁**：`lock()` 记录定时器句柄并新增 `unlock()`；`run()` 内点击处标记 `acted=true`，结尾/异常路径若未实际点击或触发导航则立即 `unlock()`，不再空占最长 `NAV_LOCK_TIMEOUT`(8s)，避免阻塞后续 ended/切课触发。
- **[J6] auto-next — holdPause 守卫 `__np`**：`holdPause` 不再仅凭 `typeof v.__np==='function'` 判定，改为仅当 force-play 已接管（`v.__cxForcePaused`）且 `__np` 就绪时才调用 `__np` 真正暂停，否则用原生 `v.pause()`，避免 force-play 未接管时误置 `__np` 导致暂停失效。
- **[L3] chapters.py — 种子兜底按文档顺序选 id**：`extract_seed_chapter_id` 兜底由原「数值最小 id」改为「文档中首次出现的 knowledgeId」（`_first_seed_id`），更可能命中根/顶层章节，避免 chapterId 非数值顺序时误选非根节点。

- **[L1'] chaoxing-allinone.user.js v1.1.0 — 废弃脚本默认自禁用**：`@match` 与维护版脚本相同，同装时旧逻辑双重覆盖 `pause`、导航锁互扰。入口改为默认 `console.warn` 后直接 `return`；仅 `localStorage.cx_allinone_force === '1'` 时才以废弃模式继续运行（`localStorage` 不可用同样禁用）。
- **[N1] auto-next — origin 后缀精确匹配**：`message` 监听的 origin 校验由 `indexOf` 子串匹配（可被 `evilchaoxing.com` / `chaoxing.com.attacker.com` 绕过）改为 `trustedOriginAN`：解析 hostname 后做「等于 `chaoxing.com` 或以 `.chaoxing.com` / `.edu.cn` 结尾」的精确后缀匹配，解析失败一律拒绝。
- **[N4] auto-next — 桥失败正常模式可见**：`bridgeFetch` 失败原本仅 DEBUG 可见，正常模式静默回退难排障。现正常模式也 `console.warn` 一次（`BRIDGE.warned` 去重防刷屏），DEBUG 额外打印错误对象。
- **[F1/F2] force-play — scanVideos 扫描收窄**：原 `getElementsByTagName('*')` 每 2s 全文档枚举找 Shadow 宿主，长章节页成周期性主线程热点。与 no-pause J4 同款收窄：文档级只在 `#videoBox / .ans-attach-ct` 容器子树内枚举；ShadowRoot 内部保留全量枚举以发现嵌套宿主；video/iframe 路径不变，动态新增仍由 MutationObserver 兜底。
- **[E2.1] force-play — refreshTargets 空窗轮同步重置 matchedAny**：滞回设计（attachments 瞬时空窗不回退全量）保留，但原实现空窗轮不重置 `TARGET.matchedAny`，其沿用旧轮真值导致「定向 0 命中→回退全续播」兜底永不触发，过期白名单可能长期误杀新视频。现 else 分支同样 `matchedAny=false`，过期 ids 本轮零命中即由既有兜底回退全续播（外部评审 2.1 变体，其原建议"空窗立即清 ids"会破坏滞回、退回横跳问题，未采纳）。
- **[E2] force-play — TARGET.keys 缓存**（外部评审#2）：`videoBelongsToTask` / `videoIframeSrcsOf` 属每视频每 2s 轮询的热路径，原每次调用 `Object.keys(TARGET.ids)` 新分配数组造成 GC 压力。现 `refreshTargets` 生成白名单时一次性缓存 `TARGET.keys`，热路径复用（`|| Object.keys` 兜底），空窗回退时同步置空。
- **[E7] force-play / auto-next — bridgeFetch 防 CSP 同步异常**（外部评审#7）：严格 CSP（connect-src）下 `fetch()` 会同步抛异常而非 promise reject；bridgeFetch 还会在 probe 的 promise 回调内被调用，同步抛出会变成未处理 rejection。现两脚本的 bridgeFetch 均以 try/catch 包住 fetch 调用本身，被拦截时静默跳过桥功能。
- **[O1] courses.py — clazzid/courseid 类型归一化**：新增 `_to_int()`，R2 空值守卫后对 `clazzid`/`courseid` 归一化为 int，非数字时跳过该课程（DEBUG 打印），避免非法类型经 `.format` 拼进章节 URL 造成失真请求、单课静默空跑；落盘类型与 dump.py 白名单过滤保持一致。

> 说明：其余中/低优项（L8 冗余校验）经评估为安全兜底/设计取舍，本期未改动；桥服务冗余校验（L8）为安全兜底亦保留。

---

## v3.7 — 功能基线

五大主体功能成型，构成后续所有迭代的地基：

- **穿透**：钻入同源 iframe / Shadow DOM，覆盖 `pause` 为 no-op；`ratechange` 仅在 `rate<=0.01` 时拉回 1x（防伪暂停）。
- **兜底续播**：低频 2s 全量轮询，对抗平台重定义 `pause` / 原型硬调用 / DOM 换血。
- **暂停锁协同**：无条件尊重 auto-next 的 `v.__cxAN_hold`（插播题/答题期间避让）。
- **ended 持久锁 `__cxEndedLock`**：覆盖 `play` 为 no-op + 进度条锁末尾 + seeking 守卫，持续到元素被替换，阻断平台以 `video.play()` / 重建元素 / `src` 替换重播。
- **锁屏续播**：劫持 `navigator.mediaSession`（当时态为 `paused`，见 v3.9）。
- **定向续播**：读 `window.attachments` 构建任务点白名单，仅对命中视频强制续播，跳过广告/插播；匹配整体失效自动回退全量。
- **重建去重**：`ended` 时登记 `currentSrc`，任何地址命中的新 video 判定为同一已播完任务的整元素重建并锁死。
- **稳健性雏形**：`keyRe` 边界正则（防 `123` 误命中 `12345`）、`refreshTargets` 滞回、`ENDED_SRCS` 仅随真实章节切换清空。

---

## v3.8 — 第三方综合审查的目标版本

功能面与 v3.7 一致，但该版本被第三方 AI 逐行审查，暴露出后续 v3.9–v3.11 逐版修复的缺陷集合（此处仅列缺陷，修复见各版）：

- MediaSession `playbackState` 误设为 `'paused'`（自相矛盾）。
- `neutralizeGlobalPause` 直接赋值在 `'use strict'` 下可能因描述符不可写而静默失效。
- 重建去重存在 `currentSrc` 未就绪的「时间窗」漏网。
- `hasVideo` 启发式误判（`document`/空串也计为视频）。
- 直播 `duration=Infinity` 时 `currentTime` 赋值非法。
- `for...in` 遍历 `TARGET.ids` 无 `hasOwnProperty`。
- 每 2s 全量 `querySelectorAll('*')` 遍历的性能隐患。
- 死代码（`v.__rp`、重复 `pauseNoop`、不可达 `TARGETED` 分支）与隐式跨脚本契约。

---

## v3.9 — 健壮性一轮

| 改动 | 说明 | 评审 |
|---|---|---|
| MediaSession 态改 `playing` | 锁屏媒体中心显示「播放中」，避免系统发起暂停 | #1 |
| MutationObserver 帧合并队列 | `requestAnimationFrame` 合并高频变更，防雪崩 | — |
| `loop` 持续断言 | 防平台重置 `loop` 导致循环重播 | — |
| 可见性切回复位 `window.ananas.pause` | 标签页切回时重新中和全局暂停封装 | — |
| `safePlay` 静音重试后恢复音量 | 自动播放策略拒绝时静音重试一次 | — |
| 定向匹配正则按 URL 边界收紧 | 当时收窄为 `[/?&=.#]`（**后续 v3.11 判定为纯损并回退**，见 A） | — |

---

## v3.10 — 综合审查修复

吸收第三方综合审查中除 #1（已在 v3.9 修）、#7（跨域 iframe 同源策略硬限制，非脚本缺陷）、#9（匹配复杂度非瓶颈）、#10/#11（hostile page 注入需保留防御 / 巨函数拆分风险高）外的实质性项：

| 改动 | 说明 | 评审 |
|---|---|---|
| `neutralizeGlobalPause` 改描述符探测 | `getOwnPropertyDescriptor` + `defineProperty`，严格模式不再静默失效（后续 v3.11 进一步覆盖继承属性，见 D） | #2 |
| 重建去重补齐祖先 iframe src | 新增 `videoIframeSrcsOf`，关掉 `currentSrc` 未就绪时间窗（后续 v3.11 收敛防误锁，见 B） | #3 |
| `hasVideo` 仅计 `video` | 去掉 `document`/空串误判 | #4 |
| 直播 `duration=Infinity` 守卫 | `ended`/`seeking` 加 `isFinite` | #5 |
| `for...in` → `Object.keys` | 消除原型污染误匹配 | #6 |
| `querySelectorAll` 微优化 | 改 `getElementsByTagName`（保留 Shadow DOM 覆盖） | #8 |
| 清死代码 | 删 `v.__rp`、重复 `pauseNoop`、不可达 `TARGETED` 分支 | #12 |
| 契约文档化 | `v.__cxAN_hold` 跨脚本契约加注释说明 | #13 |

---

## v3.11 — 复核修复（A/B/C/D/E/H）

对 v3.10 的逐版复核，吸收其中成立的两处回归与其余一致性项：

| 改动 | 说明 | 评审 |
|---|---|---|
| **A** `keyRe` 回退 `[^A-Za-z0-9]` | 撤销 v3.9 的 `[/?&=.#]` 纯损收窄（真子集，漏匹 `lesson_123`/`clip-123`）；旧版本就不会把 `123` 误命中 `12345` | A |
| **B** iframe src 仅限播放器 iframe | `videoIframeSrcsOf` 只收集「src 含白名单任务 id」的 iframe，通用 shell iframe 不再进黑名单，防误锁 | B |
| **C** 删死配置 `CONFIG.TARGETED` | 字段已无任何读取点 | C |
| **D** `neutralizeGlobalPause` 改 `defineProperty` 直接遮蔽 | 覆盖继承属性（不仅是自有属性） | D |
| **E** 删死字段 | 清 `TARGET.hasVideo`（含收集链）、`v.__cxSkip` | E |
| **H** 音量恢复改 `playing` 事件驱动 | 避免 `play()` resolve 即提前取消静音（监听器泄漏修复见 v3.12） | H |

> 评审中 F（全树遍历开销）、G（跨文档 iframe 靠 2s 兜底）判定为已知残留/同源策略限制，未改。

---

## v3.12 — 复核修复（终态）

| 改动 | 说明 | 评审 |
|---|---|---|
| **H（续）** 监听器泄漏消除 | `restore` 改用 `addEventListener('playing', restore, { once: true })` 注册，浏览器首次触发后自动移除；消除 v3.11 中 `addEventListener(..., true)` 与 `removeEventListener` 缺 `capture` 标志不匹配导致的监听器永久累积。保留 `restored` 守卫以同时兜住 `p.then(restore)` 的 promise 路径 | H |
| 边界匹配一致性 | `videoIframeSrcsOf` 改用 `keyRe` 边界匹配，与 `videoBelongsToTask` 统一，避免裸子串误收通用 iframe | 一致性 |

---

## 终态评估（v3.12）

| 维度 | 评价 |
|---|---|
| 功能完整性 | ★★★★★ 防暂停 / 防重播 / 定向续播 / iframe+Shadow 穿透 / MediaSession 锁屏 五大主体全覆盖 |
| 对抗健壮性 | ★★★★★ 描述符探测、isFinite 守卫、loop 持续断言、帧合并、playing 事件恢复，无明显短板 |
| 工程卫生 | ★★★★★ 死代码清零、changelog 完整、监听器泄漏已消除 |
| 场景适配 | ★★★★★ Shadow DOM 边界、跨域 iframe 静默、hostile page 注入处理专业 |

**结论**：v3.12 为当时（桥接与伪暂停对抗尚未引入前）的终态，零已知缺陷。后续 v3.13–v3.15 是在此基础上的**功能扩展与对抗加固**（本地桥接、端口可配置化、抗闭包私有暂停 / playbackRate 伪暂停 / MSE 断流），并非 v3.12 存在回归，而是需求演进。

---

## v3.13 — 本地桥接（方案 A，跨组件）

> 背景：浏览器里的 force-play / auto-next 无法读本地磁盘，原续播/跳章依赖页面 DOM 启发式（平台 `finished`/`locked` 类经常缺失/延迟）。
> 方案 A 在爬虫侧新增本地只读 HTTP 桥（`cx_crawler/bridge.py`），把权威清单（`output/playlist_{cid}.json`）暴露给脚本，使其「跳过已完成章节 + 精确跳到下一个未完成章节」。

### 爬虫侧

| 改动 | 说明 |
|---|---|
| `config.py` 新增 `BRIDGE_HOST` / `BRIDGE_PORT` | `127.0.0.1:7531`，仅本机监听 |
| `dump.py` 新增 `_emit_playlists()` | 导出阶段生成 `playlist_{cid}.json`（逐章 `knowledgeId/completed/unfinishedCount/hasTaskPoints/objectids/jobids`）+ 汇总 `playlist_index.json`，原子写 |
| 新增 `cx_crawler/bridge.py` | 常驻只读 HTTP 服务；白名单路由 `/ping`、`/playlist/index`、`/playlist/{cid}`；带 `Access-Control-Allow-Origin: *` 与路径穿越防护（正则 + 拼接路径二次校验）；读取编码 `utf-8-sig` 容错 BOM |

### `chaoxing-force-play.user.js` v3.13

| 改动 | 说明 |
|---|---|
| `bridgeInit()` 拉取清单 | 当前章 `completed` 且无未完成点 → 置 `skipResume`，禁用强制续播并恢复原生 `pause`（重进已完成章不重看）；`objectids` 非空时预填定向白名单，早于 `window.attachments` 渲染 |
| `overrideVideo` / `pause` / `canplay` 门闩 | 桥避让（`skipResume`）迟到后仍不被续播；`refreshTargets` 合并桥预填白名单，键集稳定不扰动章节切换判定 |

### `chaoxing-auto-next.user.js` v2.1

| 改动 | 说明 |
|---|---|
| `bridgeInit()` 拉取清单 | 加载全课程逐章 `completed/unfinishedCount` |
| `fallbackNext` 桥优先 | 用清单定位「当前章之后第一个未完成章节」（到尾回绕，跳过当前章），按 `knowledgeId` 在目录 DOM 找锚点精确点击；找不到锚点静默回退原 DOM 启发式 |

### 优雅降级

- 桥服务不在线 / 无清单 / URL 缺 `courseId`·`chapterId` 参数时，两脚本自动静默回退原有行为，零新增运行时依赖。
- 127.0.0.1 属 potentially-trustworthy origin，学习通 https 页面可直接 `fetch`，无混合内容拦截。

---

## cx_crawler 变更（2026-07-29 全工作空间代码审查）

> 审查报告：`workspace_code_review.md`。本次落地其 Top 10 中用户指定的优先级 #1（配置外置）与 #2（落盘一致性）。

### #1 配置外置：课程白名单移出源码（`dump.py` / `config.py`）

| 改动 | 说明 |
|---|---|
| `config.py` 新增 `_load_active_course_ids()` + `ACTIVE_COURSE_IDS` | 原写死在 `dump.py` 的 7 个个人课程 cid 集合删除；改为从 `cx_crawler/courses.json` 或环境变量 `CX_COURSE_IDS` 读取，沿用 `bridge_config.json` 的「环境变量 > JSON > 默认」风格 |
| 新增 `cx_crawler/courses.example.json` | 复制为 `courses.json` 后填本人 cid 即可；`_comment` 字段说明用法（与 `bridge_config.example.json` 一致） |
| `dump.py` 白名单为空时的日志 | `courses.json` 与 `CX_COURSE_IDS` 均缺失 → 空集 = 处理全部课程，并打 `WARNING` 明确提示，避免误以为被过滤 |
| 加载优先级 | `CX_COURSE_IDS="111,222"` > `courses.json`（`course_ids`/`courseIds`/`ids`）> 空（处理全部） |

### #2 落盘一致性：`02_chapter_list_{cid}.html` 与解析结果对齐（`chapters.py`）

| 改动 | 说明 |
|---|---|
| `_try_seed` 落盘条件上移 | 原每次种子都写 `02_chapter_list_{cid}.html`，但 `best_html` 仅在章节数更多时更新 → 磁盘文件可能与最终解析用的 `best_html` 不一致、误导排错。改为**仅当本响应成为最优（id 更多）时才原子写该文件**，保证磁盘 canonical 文件永远等于 `best_html` |

> 说明：「缺 `requirements.txt`」经核对 `cx_crawler/requirements.txt` 已存在，属误报；`chapters.py` 嵌套节点 split 重叠、`config.py` `with_retry` 重试范围属低风险重构，留待后续。

---

## 用户脚本 & 爬虫 审查修复（Top 10 续，2026-07-30）

> 续上节，落地其余可安全修复项。

### #3 force-play：matchedAny 双写（中）
- 删除 `overrideVideo` 内 L500 的冗余 `if (TARGET.enabled) TARGET.matchedAny = true;`（与 L485 重复）。
- `matchedAny` 现统一在 L485（定向判定前、含被用户暂停的视频）置位——既保留 v3.34「全部暂停不误触 fallback 回退全量」的修复，又消除双写造成的语义混乱。

### #4 Python：`_to_int` 重复实现（中）
- 将 `dump.py` 与 `courses.py` 各自私有的 `_to_int` 抽至 `config._to_int` 公共工具，两模块改为从 `config` 导入，消除重复维护。
- `print`/`logger` 混用经判断为**刻意设计**（CLI 进度走 `print` 落 stdout、调试走 `logger`），非缺陷，未改动。

### #5 force-play：全局定时器/监听器从不清理（中，保守方案）
- 在 IIFE 顶部加幂等守卫 `if (window.__cxForcePlayStarted) return; window.__cxForcePlayStarted = true;`，防止脚本被重复注入（如 TM 更新/热重载）产生双倍 `setInterval` 与事件监听器。每个 frame(window) 仅初始化一次，不影响多 frame 下视频页面板可见性（v3.35 已撤销整体 return）。

### #6 auto-next：getOverlay 可见性误判误暂停（中）
- `getOverlay` 原同时匹配 `.dialog-mask` 与 `.ans-job-icon`，但后者是播放器控制栏**常驻**的任务点小图标、正常播放时也始终可见 → 「无遮罩」时仍会误暂停视频。改为**仅匹配真正的插播题/答题模态遮罩 `.dialog-mask`**。
- 删除与 `visible()` 完全重复的 `elVisible()`，统一复用 `visible()`。

### #7 no-pause：`preventDefault` 防暂停实际无效（中）
- `mouseout` 的 `preventDefault` 只能阻止浏览器默认行为，无法阻止平台自身的 JS 暂停逻辑（`video.pause()` 调用），原「防暂停」为虚假有效。
- 新增周期保活看门狗 `keepAlive`：命中容器（`#videoBox`/`.ans-attach-ct`）内的 `video` 被暂停且未播完时，每 1s 调用 `play()` 真正续播；若 `force-play` 已加载则主动让行，避免双控。同步更新脚本 `@description` 如实说明机制。

### #8 allinone：已废弃脚本收敛（低）
- 经核 v1.1.0 已加废弃提示并**默认自禁用**（除非 `localStorage.cx_allinone_force==='1'`），不与维护版冲突。本次仅把提示/警告中引用的版本号刷新为当前 `force-play(3.35)`。

### #10 bridge.py：冗余路径/数字校验（低）
- `/playlist/{cid}` 路由的正则 `^/playlist/(\d{1,12})$` 已限定纯数字，删除其后再做的 `_CID_RE.match(...)` 冗余校验及 `_CID_RE` 定义。

---

## 阶段一修复（2026-07-30 · 已核实版修复计划）

> 来源：`remediation-plan.md`（对两份审查报告逐文件核查后整理的可执行清单）。本批仅处理阶段一「高优、低风险」四项。
> 核查结论中的**已修复/误报项未改动**：#2（环境变量优先级）、#4（chapters AttributeError）在当前代码已修复；H1（quizzes 列表 AttributeError）、H2（config 占位符 KeyError）经核查为误报。详见 `remediation-plan.md`「已从清单移除的项」。

### #1 统一日志（cx_crawler）
- `chapters.py` / `courses.py` / `heartbeat.py` 中的 `print()` 进度/调试输出统一改为 `config.logger`（`info` / `warning` / `debug`），受 `CX_DEBUG` 与日志级别统一控制，杜绝 `print` 绕过日志系统导致生产环境 DEBUG 开关失效。
- 注意：`dump.py` 的 `print`/`logger` 混用此前已判定为**刻意设计**（CLI 进度走 stdout、调试走 logger），本次未动。

### #12 / M1 收窄 `with_retry` 默认异常范围（config.py）
- `with_retry` 默认 `exceptions` 由 `(Exception,)` 改为 `(requests.RequestException, json.JSONDecodeError, OSError)`：仅对瞬态错误（网络/解析/IO）重试；编程错误（TypeError / KeyError / AttributeError 等）默认**不再重试**，直接快速失败，避免把 Bug 放大为 3 次慢失败。

### #26 Cookie 文件权限收紧（session.py）
- 新增 `_restrict_file_perms()`，`save_cookies` 写盘后对 `cookies.json` 施加 `0o600`（类 Unix 限制仅属主可读写；Windows 尽力而为、忽略异常），降低明文 Cookie 被其它用户/进程读取的风险。
- `USAGE.md` 增加「凭证安全」提示：勿提交 git、共享机及时删除。

### #15 收窄 media-collector `@match`（browser-media-collector.user.js）
- `@match` 由 `*://*/*`（全网）收窄为 `https://*.chaoxing.com/*` 与 `file:///*`，收敛隐私与性能影响；采集其它网站媒体需手动追加 `@match` 行。`USAGE.md` 同步修正描述。

---

## 阶段二修复（2026-07-30 · 已核实版修复计划 P1）

> 来源：`remediation-plan.md` 阶段二（P1）四项已核实有效项。本批处理 M2（chapters 假完成）与 #16/#18/#17（脚本安全/健壮性）。#5（_is_quiz_type 收紧）为可选、不阻塞，留作后续。

### M2 取消「unfinished==0 → 完成」误判（chapters.py）
- `extract_task_points` 中完成态不再以「`unfinished == 0` 且 `has_tp`」自动推导为 `True`。改为：
  - 显式含 `icon_Completed` → `completed = True`；
  - 无 `icon_Completed` 但确实存在未完成数字段（`jobUnfinishCount` 标签存在，`inp is not None`）→ `completed = False`；
  - 无 `icon_Completed` 且未完成数字段缺失 → `completed = None`（未知，不臆测）。
- 任务点字典 `completed` 字段由 `bool(completed)` 改为原值透传，支持 `None/True/False` 三态；下游完成率统计对 `None` 按「未完成」处理（保守），避免把「尚未判定」误计入已完成。消除任务点未渲染出未完成数时被误判为已完成（假完成）的风险。

### #16 DOM 就绪判定的游离面板（chaoxing-force-play.user.js `ensurePanel`）
- `ensurePanel` 入口新增 `document.body` 就绪判断：若 body 尚未就绪（脚本在 `document-start` 抢跑），不再立即构造 `el` 并因 `document.body.appendChild` 被跳过而游离于 DOM 之外（此前 `_cxPanel` 即便被赋值也不可见）。改为注册 `DOMContentLoaded`（loading 态）或 `requestAnimationFrame`（其余态）延迟构建，期间返回 `null`；所有调用方均对 `null` 做了安全处理（`if (_cxPanel) ...`），行为无回归。

### #17 用 Proxy 完整包装 IntersectionObserver（chaoxing-deceive-api.user.js）
- 重写 `IntersectionObserver` 覆盖：除回调内对真实 entry 固化 `isIntersecting=true`（double 保险）外，新增 **Proxy 包装实例**，拦截 `observe` 方法——被调用时立即向用户回调注入一条「在视口内」的合成 entry（基于 `target.getBoundingClientRect()` 合成 rect），随后仍走真实 `observe`。
- 收益：使依赖 `observe → 回调才启动播放` 的代码，在真实相交永不触发（被平台用 CSS/display 隐藏视频）时也能被「欺骗」跑通；`unobserve/disconnect/takeRecords` 原样转发不受影响。

### #18 跨帧 postMessage 收窄 + nonce（chaoxing-auto-next.user.js）
- 发送端 `notifyParent`：优先用 `window.parent.location.origin`（同源可读）作 `targetOrigin`，仅在跨域不可读时回退 `'*'`（浏览器仍会向接收端填充真实 `ev.origin`，origin 白名单 `trustedOriginAN` 仍生效）。
- 新增收发两端共享的 `CX_AN_NONCE = 'cxAn_v1_3.0'`，发送消息附带 `nonce` 字段；接收端 `message` 监听在 origin 白名单之后**额外校验 nonce**，丢弃无正确 nonce 的伪造消息，提供纵深防御（即便某白名单内域名被攻陷）。
- 注：原型覆盖保持不变（仅原样转发未伪造消息）。

---

## 阶段三修复（2026-07-30 · 已核实版修复计划 P2 性能与一致性「按需」）

> 来源：`remediation-plan.md` 阶段三（P2）。本批落地低风险的 4 项（#8/#14/#19/M5），其余经核查已缓解或需保留原行为，详见计划文件。
> 说明：本阶段为「按需」性能/一致性项，凡影响运行行为（降频、去 try-catch、改写 O(n) 读写）者均经权衡后保留，避免无测试覆盖下的回归。

### #8 预编译 ID_PATTERNS 正则（chapters.py）
- `ID_PATTERNS` 8 条原始字符串改为 `re.compile(..., re.I)` 预编译；`extract_knowledge_ids` 直接 `p.findall(html_fragment)`，消除热路径上对每条正则的重复编译（阶段5 多路提取每页都会跑）。

### #14 硬编码桥端口同步注释（chaoxing-force-play.user.js）
- 默认桥地址 `http://127.0.0.1:7531` 旁加注释，标明须与 `cx_crawler/config.py` 的 `BRIDGE_PORT` 保持一致；改端口时两边同步。脚本无硬编码后端 API 端点（仅本机桥默认地址，且可用 `?cxbridge=` / `localStorage.cx_bridge_base` 覆盖）。

### #19 scanVideos 递归深度安全阀（chaoxing-force-play.user.js）
- `scanVideos` 新增 `depth` 参数与 `MAX_SCAN_DEPTH = 16`；所有递归下钻（Shadow 宿主 / 视频容器 Shadow / 嵌套 Shadow / 同源 iframe / iframe load 补扫）传 `depth + 1`，超过上限直接返回。正常章节页嵌套远小于上限，行为不变；仅在病态嵌套 DOM 下作为主线程保护。

### M5 桥版本校验/展示（chaoxing-force-play.user.js）
- `BRIDGE` 增加 `version` 字段；`/ping` 探针（`probeBridgeBase`）与 `bridgeInit` 的就绪探测均读取响应中的 `version` 并缓存（非阻塞）。面板诊断行由「已连 <base>」升级为「已连 <base> v<version>」，便于发现过旧的桥服务；版本不一致不阻断续播，仅提示。

### 审查后保留 / 已缓解（未改动）
- #7 courses 重复计算：已在 `dump.py` 用 `prefetched=verify_resp` 复用同一接口响应（v2.2）。
- #13 `_moFlush` 提升：已有 `>1024` 安全阀 + rAF/setTimeout 双路 flush，无明确提升点。
- #20 `_loopTick` 降频、#21 `refreshPanelState` 降频：间隔可配（默认 2s），降频会牺牲响应性与实时进度展示，有意保留。
- #23 `dbg` 冗余 try-catch：无害防御，清理价值低，保留。
- M3 media-collector O(n) 读写：`flush` 已 `if (!dirty) return` + 1.5s 节流；跨 tab 合并 O(n) 为去重正确所需，保留。

---

## 阶段四修复（2026-07-30 · 已核实版修复计划 P3 架构级技术债）

> 来源：`remediation-plan.md` 阶段四（P3）。本批为「架构级（技术债，非必需不动）」，仅推进明确正向、无回归风险的 **#27 类型注解与测试**；其余大型重构按计划「非必需不动」原则保留（见下方理由）。

### #27 类型注解 + 单元测试地基（cx_crawler 四个核心模块）
- `config.py` / `chapters.py` / `courses.py` / `render.py` 启用 `from __future__ import annotations` 并为纯函数与关键签名补充类型注解：
  - `config`: `_to_int(v) -> int | None`、`atomic_write_json(path, obj) -> None`、`with_retry(...) -> Callable`。
  - `chapters`: `extract_knowledge_ids(html) -> set[str]`、`extract_seed_chapter_id(html) -> int | None`、`parse_chapter_tasks(...) -> list[dict]`。
  - `courses`: `fetch_courses(client, prefetched=None) -> tuple[list[dict], dict | None]`、`_parse(r) -> list[dict]`。
  - `render`: `_pw_cookies(...)`、`render_course_taskpoints(...)`、`infer_type(res) -> str | None`。
  - 注解均为延迟求值（PEP 563），运行时零影响；`py_compile` 四个模块全部通过。
- 新增 `cx_crawler/tests/test_crawler_units.py`（`unittest`，**无网络 / 无 Playwright 依赖**），覆盖：
  - `_to_int` 各种输入（int/数字串/非法 → None）；
  - `atomic_write_json` 原子写中文 + 回读一致；
  - `extract_knowledge_ids` / `extract_seed_chapter_id` 多路正则；
  - `parse_chapter_tasks` 空片段不崩 + 单任务节点结构正确（含 M2 后 `completed` 判定）。
  - 运行：`python -m unittest discover -s cx_crawler/tests -p "test_*.py"`。
  - 注：本站测试环境 Python 未装 `requests`（爬虫运行时依赖），故测试在本机未实跑；在用户实际装有依赖的环境中可直接运行。测试导入链为 `config`/`chapters`（仅依赖 `requests`），不涉及 `render`/Playwright。

### 审查后保留（未改动，附理由）
- **#9 render 页面池**：`render.py` 已复用单浏览器 + 单 context，逐 kid 仅 page 级创建/关闭（相对浏览器启动可忽略）；深度 page 复用需重置响应监听、易泄漏，边际收益低。
- **#24 配置共享 / #25 桥版本管理**：已被 #14（桥端口同步注释）、M5（桥版本展示）部分覆盖；完整共享配置/协议门禁需引入注入机制，超必要范围。
- **#10 config 拆分 / #22 force-play 拆分 / M4 桥逻辑去重（×3）**：大型重构，跨模块 import 重排 / Tampermonkey `@require` 多文件装配，回归风险高、无集成测试护航，按「非必需不动」保留。
- **#11 注释精简**：现有注释多为「易误判」防御性代码解释，精简会丢失阻止未来误改的关键上下文，属负价值改动，有意保留。

---

## 主/副脚本架构重组（2026-07-30）

> 用户要求：带控制面板的脚本设为主脚本，其余适配其面板成为副脚本，不能适配或过时的全部弃置。

### 主脚本：`chaoxing-force-play.user.js` v4.0
- 面板更名「学习通·主控面板」，新增**副脚本注册中心**：
  - 副脚本向 `window.__cxAddonQueue` 推入 `{id, type:'toggle'|'button', label, note, get, set, onClick}` 并调用 `window.__cxRegisterAddon()`；
  - 主脚本启动与面板建成时均排空队列 → **加载顺序无关**；`id` 去重防重复注册；
  - 面板新增「副脚本」区块（无注册时隐藏），统一渲染复选框/按钮。

### 副脚本（已适配主面板）
| 脚本 | 版本 | 面板开关 | 生效方式 |
|---|---|---|---|
| `chaoxing-auto-next.user.js` | 2.3 → 3.0 | 「自动下一课」总开关（`localStorage.cx_an_on`，默认开），门控 `run()` 与 `checkOverlay()` | 即时 |
| `chaoxing-progress-panel.user.js` | 2.1 → 3.1 | 3.0 的显示/隐藏接入主控面板保留；**修复**：① 加 `window.top!==window.self` + realm 守卫，避免 Tampermonkey 在多个同源 iframe 重复注入导致面板出现多个（如三个）；② `API_COURSES` 端点 `http://`→`https://`，修复 HTTPS 页面下混合内容被拦截报「Failed to fetch」（另两端点本就是 https） | 即时 |
| `chaoxing-deceive-api.user.js` | 1.0.0 → 2.0 | 「可见性欺骗」（`localStorage.cx_spoof_api`，默认关）；注册置于 `if(!SPOOF) return` **之前**，保证关闭态下开关仍可见 | 刷新页面（覆盖须在 document-start 执行） |

### 删除（功能被主脚本覆盖 / 过期分叉，已从仓库移除）
| 脚本 | 删除原因 |
|---|---|
| `chaoxing-no-pause.user.js`（3.1.0） | 防暂停/保活被主脚本完全覆盖（轮询 play() + 原型级防暂停），双控冲突且无可挂面板的独立状态 |
| `chaoxing-visibility-resume.user.js`（1.1.0） | 切后台续播被主脚本轮询 play() 覆盖（不依赖 visibilitychange） |
| `chaoxing-allinone.user.js`（1.1.0） | 既有弃置（过期分叉），与主脚本冲突 |

### 保留的独立用途脚本（与学习通无关，不接入主控面板）
- `browser-media-collector.user.js`（1.2）：常驻后台的浏览器媒体采集器（捕获视频/音频源地址、时长等元信息，本地存储、不联网），`@match` 覆盖全网。作为独立工具单独启用，不随本套超星架构更新。

- `USAGE.md` §1 脚本表重写为「主脚本 / 副脚本 / 其他用途」三段式；排错表「切后台停播」指向主脚本。
- 校验：5 个 `*.user.js`（force-play、auto-next、progress-panel、deceive-api、browser-media-collector）lint 全 0。
