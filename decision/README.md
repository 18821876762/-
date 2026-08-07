# 决策层（决策脚本）

该类脚本原本是**独立 Tampermonkey 脚本**（"副脚本"），通过核心脚本 `chaoxing-force-play` 暴露的
`__cxAddonQueue` / `__cxRegisterAddon` 契约挂进面板"工具库"区域运行。

> **现状（2026-08-05）**：下列"有用的原副代码"已**全部迁入核心脚本的工具库**，
> 作为 `ecosystem/src/chaoxing-force-play/plugins/addons/` 下的内置模块，随
> `chaoxing-force-play.user.js` 一并构建分发，**不再以独立脚本的形式存在**。
> 安装核心脚本即自动获得这些能力，无需单独安装。

## 已迁入工具库的模块（`plugins/addons/`）

| 模块 | 工具库项 id | 能力 | 站点归属 |
| --- | --- | --- | --- |
| `auto-next.js` | `auto-next` | 章节视频播完 → 答题入口 / 下一章（Bridge + DOM 双重探测，插播题自动暂停） | 超星学习通 |
| `keyboard-shortcuts.js` | `keyboard` | `M` 静音切换、`Space` 接管播放/暂停（手动暂停后让位核心脚本） | 超星学习通 |
| `tamper-guard.js` | `tamper-guard` | 检测 ananas 暂停/倍速接管被绕过并告警（顶栏色条 + OS 通知） | 超星学习通 |
| `video-ended-notify.js` | `video-ended-notify` | 视频结束 → 系统通知（复用核心 `bridge` 多端联动 + 本地 OS 通知降级） | 超星学习通 |

## 设计要点

- 各模块仍以独立嵌套 IIFE 形式存在，局部变量（`CFG`/`bootstrap`/`createContainer` 等）**不会与核心脚本冲突**。
- 通过 `window.__CX_FORCE_PLAY.detectSite() === 'chaoxing'` 做**站点隔离**：核心脚本是多平台脚本，
  这些工具库项为超星专属逻辑，仅在学习通上下文激活，避免在智慧树/MOOC 等平台误触发。
- 与核心脚本的通信沿用原有契约：`__cxAN_hold`(暂停锁)、`__cxAddonQueue`(工具库项注册)、
  `bridge`(`__cxBridge`/`bridgeReady`，多端联动)、`__cxUserPaused`(键盘暂停意图)。
- 不再包含 Tampermonkey 元数据头与"未检测到核心脚本"的自检告警（已随核心脚本一并分发）。

## 构建

这些模块在 `ecosystem/build-force-play.ps1` 的 `$domainRel` 中登记，随核心脚本一次性拼接输出到
`ecosystem/chaoxing-force-play.user.js`。修改后需重新运行构建脚本。
