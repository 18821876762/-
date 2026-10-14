# 内置插件与工具库

> 核对基线：4.20.3；核对日期：2026-10-14。

插件源码位于 [plugins/addons](../../apps/userscript/src/chaoxing-force-play/plugins/addons)，由 [registry.js](../../apps/userscript/src/chaoxing-force-play/plugins/registry.js)接入面板工具库，随主用户脚本一起构建。当前包含 6 个内置插件，安装主脚本即可获得相应站点能力。

| 模块 | 工具库 id | 当前作用 | 适用范围 |
| --- | --- | --- | --- |
| `auto-next.js` | `auto-next` | 视频完成后检测答题入口或下一章；随堂题暂停保持 | 超星 |
| `keyboard-shortcuts.js` | `keyboard` | M 切换静音，Space 控制接管播放/暂停 | 超星 |
| `tamper-guard.js` | `tamper-guard` | 检测暂停/倍速接管被绕过并反馈 | 超星 |
| `video-ended-notify.js` | `video-ended-notify` | 视频结束后通知；依赖浏览器通知能力及权限 | 超星 |
| `zhihuishu-auto-next.js` | `zh-auto-next` | 开关控制 ended 放行，由平台同页续播下一集；默认关闭 | 智慧树 |
| `quiet-popups.js` | `quiet-popups` | 关闭脚本悬浮提示、报警条和系统通知；保留面板提示流 | 站点无关的偏好 |

## 注册、隔离与共享能力

`auto-next` 的逻辑入口仍为 auto-next.js，依次拼接 auto-next-navigation.js、auto-next-lifecycle.js；三个片段保留同一个插件闭包，插件数量仍为 6。各插件使用嵌套 IIFE 隔离局部变量，通过 `__cxAddonQueue` / `__cxRegisterAddon` 注册工具库项。站点专属插件先核对 `window.__CX_FORCE_PLAY.detectSite()`；静默偏好不要求超星站点。插件打入同一产物，不包含独立 Tampermonkey 元数据头。

共享能力经 `window.__CX_FORCE_PLAY.toolkit` 读取。错误处理入口见[错误处理与反馈](../error-handling-framework.md)，公开挂载点及允许消费的能力见[契约](../CONTRACT.md)。

私有 API Key 与凭据保存接口不在公开命名空间或 toolkit 中。插件不得从 CONFIG、站点 localStorage 或密码控件回读 Key；需要视觉求解时使用既有流程，并保留任务取消上下文。凭据及配置边界见 [安全与隐私](../../SECURITY.md)。

视频协作标记经 `window.__CX_FORCE_PLAY.FLAGS` 读取，例如 `anHold`、`userPaused`、`endedLock` 和 `np`；当前实现使用 Symbol，应按公开接口访问。自动下一课通过 CoreState 的 `navigation` 作用域管理任务，关闭、停机、重置和卸载都会使旧回调失效。

超星自动下一课使用 `IDLE` / `NAVIGATING` / `LOCKED` 三态，等待题目剩余、待提交、待复核与 AI 在途全部结算。导航失败可重试；复用的 video 元素换源后可处理新章节。插件默认关闭，关闭时不探测桥；开启后仍遵守核心桥开关与地址规则。

## 当前桥接能力边界

`toolkit.bridge` 当前提供爬虫桥客户端。旧文档描述的 `__cxBridge` / `bridgeReady` 全局桥，以及 `send` / `status` / `onReady` 多端消息 API，不是当前已实现的公开能力。

`video-ended-notify` 中有按能力探测的消息扩展分支，但现行桥未提供消息 API，实际通知依靠浏览器 Notification 或面板提示降级。不能据此将“多端结束通知”列为已实现功能。

## 构建与验证

这些模块在 [build-manifest.txt](../../apps/userscript/build-manifest.txt)登记，产物位于根目录 [dist](../../dist)。修改插件后在项目根执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
```

涉及站点隔离、播放结束或快捷键的修改应核对对应场景。应用入口见[用户脚本说明](../../apps/userscript/README.md)，模块间协作见[跨模块契约](../CROSS_MODULE_CONTRACT.md)。

当次测试与发布准备见 [4.20.3 记录](../releases/4.20.3.md)；版本基线更新本身不证明当前修改已经通过全部回归。
