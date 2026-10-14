# 代码沙箱独立性专项审查报告 · 网课强制续播（chaoxing-force-play）

- 审查日期：2026-08-17
- 审查范围：`ecosystem/src/chaoxing-force-play/**`（58 源模块 + 构建产物）的**沙箱/隔离面**：页面沙箱隔离（脚本 ↔ 宿主页全局）、模块间独立（58 模块同 IIFE 的耦合边界）、跨帧/跨窗口隔离、跨标签/进程隔离（GM 桥 + 爬虫桥）、运行环境独立性
- 审查方式：全局写入面全量扫描（window 赋值 / unsafeWindow / 原型修改）+ 实证探针（注入后全局枚举、卸载还原完整性、原型还原、双窗口命名空间独立、跨帧 DS 角色锁）+ 交叉模块契约门禁 + 既有仿真回归
- 沙箱独立性口径：**脚本不应污染宿主全局、不依赖宿主全局；模块间仅经契约接口耦合；多窗口/多标签/多进程互不可见互不干扰；卸载后回到注入前状态；运行结果不依赖宿主环境预设**

---

## 总体结论

**沙箱独立骨架良好，发现 4 处全局泄漏面 + 1 处还原缺陷，全部已修复并实证清零。**

分层结论：

| 隔离层 | 结论 |
|---|---|
| 页面沙箱（脚本 ↔ 宿主全局） | ⚠️ 修复后 ✅：注入期全局收敛于 1 个契约命名空间 + 11 个工具库契约 + 5 个设计内导出/钩子；**卸载后 window 零残留**（实证） |
| 原型/内置对象面 | ✅ 卸载后 `prototype.pause` / `playbackRate` 还原为平台原生（实证）；ananas/mediaSession/attachments 均有归属校验式还原 |
| 跨帧隔离 | ✅ 每帧独立命名空间（实证）；DS 角色仅顶层初始化（上轮 S-2 修复 + 回归用例）；面板 owner 机制防多帧写竞争 |
| 跨标签/进程隔离 | ✅ GM 桥消息校验（remote 过滤 + type 白名单 + 自身消息忽略）；爬虫桥只读 + token 鉴权 + 路径穿越双保险 |
| 模块间独立 | ✅ 58 模块经 @requires/@provides 契约耦合，cross-module 门禁全绿（648 裸全局映射一致）；单一 IIFE 内无 window 传状态 |
| 运行环境独立 | ✅ 产物不依赖 node/宿主全局（多窗口探针实证）；构建确定性（上轮 A1 修复后两次构建逐字节相同） |

**核心指标（实证）**：注入后 `window` 新增全局 = 17 项（1 契约命名空间 + 11 工具库契约 + 5 设计内导出/钩子）；**`uninstall()` 后新增全局 = 0 项** —— 「回到注入前状态」契约在全局面完全成立。

---

## 一、页面沙箱隔离（脚本 ↔ 宿主页）

### 1.1 window 全局写入面全量清单（扫描 58 模块，58 处 window 写点）

| 分类 | 全局 | 处置 |
|---|---|---|
| 契约命名空间 | `__CX_FORCE_PLAY`（core.js 创建，各模块挂载 API） | 卸载时整体 `delete`（⑪）✅ |
| 工具库契约 | `__cxRegisterAddon` / `__cxRegisterCommand` / `__cxUI` / `__cxAddonQueue` / `__cxAddonCleanups` / `__cx*Started`×6 / `__CX_ZHE_STARTED` | 卸载时逐一 `delete`（⑨/⑨-b）✅ |
| 设计内导出 | `EventBus` / `Store`（state.js，addon 通信契约） | **本轮修复**：保存注入前值，卸载还原（有值还原/无值 delete）✅ |
| 设计内导出 | `dsAvailable` / `_dsIsLoggedIn`（vision-deepseek-web.js，工具库探针 API） | **本轮修复**：保存注入前值到命名空间，卸载还原 ✅ |
| 站点钩子 | `attachments`（chaoxing 播放页任务点全局，脚本安装 getter/setter 钩子） | **本轮修复**：还原改为纯 `delete`（见 1.3）✅ |
| 原型修改 | `HTMLMediaElement.prototype.pause` / `playbackRate`（INTRUSION_MODE 治理） | 卸载还原为原生描述符（实证）✅ |

### 1.2 泄漏面实证（global-leak-probe → 已转正 `_sim/sim-sandbox-leak.js`）

注入后枚举（jsdom，chaoxing 站点）：

```
[契约命名空间] __CX_FORCE_PLAY
[工具库契约]   __cxRegisterAddon / __cxRegisterCommand / __cxUI / __cxAddonQueue
                __cxAddonCleanups / __cx*Started×6
[设计内导出/钩子] EventBus / Store / dsAvailable / _dsIsLoggedIn / attachments
```

**修复前**：`uninstall()` 后残留 6 项 —— `EventBus`、`Store`、`__cxAddonCleanups`、`_dsIsLoggedIn`、`attachments`（value=undefined 空属性）、`dsAvailable`。
**修复后**：`uninstall()` 后残留 **0 项**（探针 7/7 PASS）。

### 1.3 修复详情（4 处）

1. **`attachments` 还原缺陷（还原不彻底）**：`lifecycle.js` cleanup ③ 旧实现「`delete` + `defineProperty(注入前快照)`」——hookAttachments 的安装前提是「注入前无该属性」，delete 成功后 defineProperty 又重建了一个 `value=undefined` 的 data property（实证：卸载后 `descriptor.get === undefined` 且属性仍存在）。**修复**：归属校验（getter 引用比对，上轮 G-6）保留，重建逻辑移除——还原目标 = 属性不存在，纯 `delete`。
2. **`__cxAddonCleanups` 残留**：cleanup ⑨-c 清空数组但未删除属性本身。**修复**：⑨ 补 `delete window.__cxAddonCleanups`。
3. **`EventBus`/`Store` 残留**：state.js 有意导出（addon 通信契约）但卸载后闭包状态残留。**修复**：state.js 保存注入前值（含「不存在」），cleanup ⑪ 还原（有值还原 / 无值 delete）。
4. **`dsAvailable`/`_dsIsLoggedIn` 残留**：vision-deepseek-web.js 裸导出未清理。**修复**：注入前值存入命名空间，cleanup ⑪ 还原。

> 注：Tampermonkey @grant 沙箱模式下，脚本 window 是隔离代理，上述裸全局实际落在沙箱 window（页面主世界不可见），泄漏面主要在 @grant none / 直注模式显现；卸载还原修复使两种模式都回到注入前状态。

### 1.4 原型面（实证）

探针预置「平台原生」`prototype.pause` / `playbackRate` 桩 → 注入（aggressive 中性化）→ `uninstall()` → **两者均还原为桩引用**（cleanup ① ② 生效）。

### 1.5 unsafeWindow 使用（核验：受控跨沙箱桥）

- 唯一使用点：`quiz-vision.js` `_quizRealWindow()`（49-53 行）——仅**读取**外部 CDN 脚本（html2canvas/tesseract，白名单多镜像 + 用户自定义地址）挂载的全局；三级回退 `unsafeWindow → wrappedJSObject → window`；加载有隐私开关（`QUIZ_VISION_PRIVACY_OK` 拒绝静默外连）+ 超时/清理/全局存在性校验。**无注入面、无写页面主世界**，判定为设计内受控桥。

---

## 二、模块间独立（58 模块同 IIFE）

- 单一 IIFE 闭包 + 顶层 var/函数 hoist：模块间经 `@requires/@provides` 注解契约耦合（`build-manifest.txt` 顺序拼接）；
- **cross-module 门禁实证通过**：`verify_cross_module.js` 对 58 模块 648 个裸全局做「注解契约 + 文档漂移」双校验（本轮新增 `_origDsAvailable`/`_origDsIsLoggedIn` 跨模块符号已登记）；
- 无模块经 `window` 传递内部状态（全局写入面清单全部收敛于契约/导出白名单）；跨模块共享状态（EventBus、TimerRegistry、_cxPanel 等）均为**显式声明的共享单例**（panel.js 注释明确 `_cxPanel` 扇出契约）；
- 模块级状态（`_quizAIPending` 等）全部为闭包私有，不跨模块读写。

## 三、跨帧/跨窗口隔离

- **命名空间独立**（independence-probe 实证）：同进程两个 jsdom 窗口各自 `__CX_FORCE_PLAY` 独立对象，互不共享单例，node 全局零污染；
- **DS 角色仅顶层初始化**（上轮 S-2 修复 + `_sim/sim-ds-role-lock.js` 回归）：锁挂同源顶层命名空间，子帧无冗余心跳/监听；
- **面板 owner 机制**：共享 DOM（顶层文档）写权经 `_cxPanelOwner` 单帧仲裁，子帧卸载交还 owner（sim-multiframe/sim-panel-owner 回归）；
- **帧间消息**：子帧 toast 经 `postMessage` 转发顶层，接收端严格校验 `e.origin === window.location.origin`（state.js:67，拒绝跨源伪造）；顶层不再回传（防回环）。

## 四、跨标签/进程隔离

- **GM 存储桥**（vision-deepseek-web）：`GM_addValueChangeListener` 回调 `if (!remote) return`（只处理其他标签页变更）；`_emitChannel` 校验消息 `type` 白名单（DS_MSG_TYPES）+ 自身 `_from` 忽略 + 卸载守卫（上轮 S-1）；`GM_removeValueChangeListener` 卸载移除（上轮 G-1）；
- **爬虫桥**（bridge.py）：只读 GET + 白名单路由正则 `^/playlist/(\d{8,12})$` + 路径穿越双保险（拼接后仍须位于 OUTPUT_DIR 内）+ 可选 Bearer/?token 鉴权；仅监听 127.0.0.1；cookies 文件 icacls 收紧权限；
- **进程隔离**：bridge 无状态写、RunLock 跨进程锁（上轮 B3 陈旧锁自动回收）、重复启动端口预检（上轮 B1）。

## 五、运行环境独立性

- 产物不依赖 node/宿主全局（independence-probe：`globalThis.__CX_FORCE_PLAY` 在加载前后均为 undefined）；
- 构建确定性（上轮 A1）：同一源码两次构建 SHA256 逐字节相同；
- 测试隔离：pure.test 沙箱化加载（上轮 A9：预拼 keys.js 桩）；sim 用例无文件写、输出稳定；Python 测试全临时目录隔离。

---

## 六、验证证据（全部实测）

| # | 验证项 | 结果 |
|---|---|---|
| 1 | `_sim/sim-sandbox-leak.js`（新增回归）：注入后全局分类 + 卸载零残留 + 原型还原 | **7/7 PASS** |
| 2 | `_ninja_test/independence-probe.js`：双窗口命名空间独立 + node 全局零污染 | 5/5 PASS |
| 3 | `_ninja_test/diag-*.js`：attachments 还原根因定位（delete+redefine 重建空属性） | 确认并修复 |
| 4 | Fast 构建门禁（node --check / contract verify+doc+semantics / metadata / cross-module + selftest） | 全绿 PASSED |
| 5 | `node tests/pure.test.js` | ALL PASS（52 断言） |
| 6 | 全量 `_sim` 回归（含新增 sim-sandbox-leak、sim-ds-role-lock） | **55/55 passed, 0 failed** |
| 7 | 全局写入面全量扫描（58 模块 58 处 window 写点） | 全部收敛于契约/导出白名单 |

---

## 七、备注

- 本轮改动文件：`takeover/dom/lifecycle.js`（attachments 纯 delete / __cxAddonCleanups 删除 / EventBus·Store·ds 全局还原）、`takeover/foundation/state/state.js`（注入前值保存）、`takeover/engine/vision-deepseek-web.js`（注入前值保存）；契约文档 `docs/CONTRACT.md` / `docs/CROSS_MODULE_CONTRACT.md` 已按流程重新生成。
- 本环境 PowerShell 的 `Get-Content` 默认按 GBK 解码（曾致产物行号假象与一次转码损坏），审查中一律改用 .NET `ReadAllLines/ReadAllText` 处理 UTF-8 文件——与上轮编码治理结论一致。
- 既有 `sim-uninstall-instance`（实例 own 属性还原）/`sim-lifecycle`（命名空间/符号删除）/`sim-multiframe`（跨帧面板 owner）/`sim-bridge-validate`（桥契约）等回归用例继续有效，与新探针互补。
