// ==UserScript==
// @name         学习通·强制续播（主脚本）
// @namespace    https://github.com/cx-force-play/chaoxing-force-play
// @version      4.10
// @author       anon
// @description  钻入同源 iframe / Shadow DOM，覆盖 pause 为 no-op、ratechange 仅在 rate<=0.01 时拉回 1x、低频 2s 轮询兜底续播；无条件尊重 auto-next 的 __cxAN_hold 暂停锁。ended 状态采用持久锁(__cxEndedLock)覆盖 play 为 no-op、进度条锁末尾、seeking 守卫，并持续到元素被替换(阻断平台以 video.play()/重建元素/src 替换重播)，与 auto-next 的 ended 跳课协同(避免重播吃掉跳课时机)；劫持 navigator.mediaSession 应对锁屏续播。无视平台自定义暂停指令(window.ananas.pause / 直接 video.pause / playbackRate=0 伪暂停 / postMessage)。【定向续播】读取 页面全局 attachments 构建任务点视频白名单，仅对命中的任务点视频强制续播，跳过广告/插播视频；匹配规则整体失效时自动回退为全量续播。【重建去重】ended 时登记 currentSrc，任何地址命中的新 video 判定为同一已播完任务点的整元素重建并锁死不播，彻底杜绝跳课后的重播。【稳健性】定向匹配改边界正则(防 123 误命中 12345)、refreshTargets 加滞回(附件瞬时空窗不回退全量)、ENDED_SRCS 黑名单仅随真实章节切换清空。【v3.9 健壮性】MutationObserver 改为帧合并队列(防高频雪崩)、loop 持续断言(防循环重播)、可见性切回复位 全局暂停封装、mediaSession 态改 playing、safePlay 静音重试后恢复音量、定向匹配正则按 URL 边界[/?&=.#]收紧。【v3.10 健壮性】neutralizeGlobalPause 改 defineProperty+描述符探测(严格模式不再静默失效)、重建去重补齐祖先 iframe src 关掉 currentSrc 未就绪时间窗、直播 duration=Infinity 加 isFinite 守卫、for...in 改 Object.keys、hasVideo 仅计 video、querySelectorAll 微优化为 getElementsByTagName、清死代码(__rp/重复 pauseNoop/不可达 TARGETED 分支)。【v3.11 复核修复】keyRe 回退 [^A-Za-z0-9](撤销纯损的 [/?&=.#] 收窄，防漏匹 lesson_123/clip-123)、iframe src 仅限承载任务 id 的播放器 iframe 进黑名单(防通用 shell iframe 误锁)、neutralizeGlobalPause 改 defineProperty 直接遮蔽(覆盖继承属性)、删死配置 TARGETED 与死字段 hasVideo/__cxSkip、safePlay 音量恢复改 playing 事件驱动(避免提前取消静音)。【v3.12 复核修复】safePlay 的 restore 监听器改用 {once:true} 注册(消除 addEventListener(capture) 与 removeEventListener 缺 capture 标志不匹配导致的监听器永久累积泄漏)、videoIframeSrcsOf 改用 keyRe 边界匹配(与 videoBelongsToTask 统一，避免裸子串误收通用 iframe)。【v3.14 抗失效】①定向续播：安装 页面全局 attachments setter 钩子(AJAX 异步到达即重建白名单，不等 2s 轮询)，attachments 永不出现时由桥 objectids 独立撑起白名单(防"无米之炊")；②重建去重：指纹由仅 video.src/iframe.src 扩展为 iframe id/name/title/data-* 与 video 自身 id——抗 MSE 的 blob: 源(无 objectid)与通用 src 播放器重建；③防暂停：下沉到 HTMLMediaElement.prototype.pause(仅拦截 __cxForcePaused 视频)，连闭包/webpack 私有 pause() 也拦得住，未命中广告/插播仍可正常暂停，auto-next 经原生备份 v.__np 真正暂停。【v3.15 抗伪暂停/断流】①playbackRate 伪暂停下沉 HTMLMediaElement.prototype.playbackRate setter 拦截（对 __cxForcePaused 视频赋 0/极小速率直接改写为 1x，与 ratechange+轮询双重兜底，不采用 SourceBuffer Hook 以免花屏）；②MSE 断流：新增 waiting/stalled 事件监听，缓冲枯竭即 safePlay() 触发新一轮数据请求续播（不跳秒以免 seek 出错）。【v4.x 面板化】命令面板(/唤起、↑↓/Tab/Enter/Esc、星标收藏夹持久化)、运维仪表盘(实时 CPU/内存/网速监控)、Ninja 折叠态(胶囊居中图标+播放/暂停状态指示)、面板设置刷新后持久化、副脚本注册中心(可扩展命令与开关)；v4.9 面板位置策略锁定右上角安全位、禁用拖拽避免遮挡。【v4.10 智慧树适配】新增 @match *://*.zhihuishu.com/*；站点私有全局/选择器收口 SITES 映射(detectSite 实时分发)；智慧树无 window.attachments 白名单与 window.ananas 私有暂停封装，auto 模式同样激进原型中性化强制续播，白名单/平台暂停对抗待真实站点校准。
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://*.zhihuishu.com/*
// @run-at       document-idle
// @grant        none
// @compatible   Tampermonkey
// @compatible   Violentmonkey
// @compatible   Greasemonkey 4
// @license      MIT
// ==/UserScript==
