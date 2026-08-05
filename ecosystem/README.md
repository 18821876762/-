# 生态层 (Ecosystem)

集成中枢，使感知层与决策层协同。

- `chaoxing-force-play.user.js` — 主控面板：强制续播 / 防暂停 / 速率 / 循环 / 自动停止；
  提供副脚本注册 `window.__cxRegisterAddon`、命令注册 `window.__cxRegisterCommand`、
  跨进程桥（127.0.0.1:7531）与 `postMessage` 协议，聚合所有层。

## 跨层合约
- 感知层 → 生态层：`postMessage` 上报（如媒体采集）、`__cxRegisterAddon` 注册副面板/副脚本。
- 决策层 → 生态层：`__cxRegisterAddon` 注册行为插件，由主控统一开关。
- 生态层 ⇄ 感知层(爬虫)：本地 HTTP 桥 `GET /playlist/{cid}` 拉取权威章节清单。

## 开发者工作流

### 本地构建
```powershell
cd ecosystem
powershell -ExecutionPolicy Bypass -File build-force-play.ps1
```
脚本把 `src/chaoxing-force-play/` 下 28 个模块按依赖顺序拼装为单个 `chaoxing-force-play.user.js`（仍是零运行时依赖的一个可安装文件）。

支持的参数（便于 CI / 本地用备用路径）：
- `-srcDir <path>` 源目录（默认 `./src/chaoxing-force-play`）
- `-outFile <path>` 输出路径（默认 `./chaoxing-force-play.user.js`）
- `-minify` 产出折叠空行的紧凑产物（保留 `//` 注释；生产级 minify 仍需 terser）
- `-dryRun` 只打印将写入的字符数，不落盘

构建会：
1. 聚合校验缺失的入口/域模块文件（一次性列出全部缺失，而非逐个抛错）；
2. 反向校验源树，任何不在构建清单、也非显式废弃的 `.js` 直接报错（防"拆分后静默漂移"）；
3. 统一 LF 行尾与去除尾空白（跨 OS 一致产物）；
4. 在 `// ==/UserScript==` 之后注入构建元数据（`Built: <时间> commit: <git-SHA> minify: on|off`）；
5. 构建后冒烟校验：元数据块与 IIFE 闭合 `})();` 必须存在，否则产物损坏直接失败。

### 测试
```powershell
cd ecosystem
node tests/pure.test.js        # 纯函数单测：escapeHTML / fmtTime / signatureOf（vm 沙箱，零运行时依赖）
```
纯函数单测不改动 src：用 `vm` 沙箱加载各 src 模块片段捕获函数声明后断言，确保与源码同源、不会随改动失步。

卸载/可卸载性：脚本在 `pagehide` / `beforeunload` 以及 `window.__CX_FORCE_PLAY.uninstall()` 触发 `cleanupListeners()`，撤销全部侵入——包括还原原型方法、ananas 中和、`play` 监听、mediaSession 原 handler，并**删除**脚本在 `window` 上新增的全部全局导出（`__cxRegisterAddon` / `__cxRegisterCommand` / `__cxUI` / `__cxAddonQueue`）与注入的 DOM/样式（`#__cxPanel` 及三个 `*Style`、`#__cxToast`），最终 `delete window.__CX_FORCE_PLAY` 使页面全局回到注入前状态。命令 `/cleardata` 可主动清除脚本写入的 `cx_*` localStorage 键。回归见 `ecosystem/_sim/sim-lifecycle.js`（全局符号/命名空间撤销 5/5）与 `ecosystem/_sim/sim-mediasession.js`（mediaSession 原 handler 保存→劫持→卸载还原契约 6/6，以模拟 mediaSession 闭环，无须真实浏览器实机回归）。

### 体积门禁
- `check-module-size.ps1`：单文件行数红线（软 300 / 硬 350，超硬且不在白名单即失败）。
- `tools/check-build-size.js`：构建产物体积门禁（软 200KB 警告 / 硬 300KB 失败）。

### 持续集成
`.github/workflows/ci.yml`（GitHub Actions，push / PR 到 `master` 时触发）依次执行：
构建 → 全 src 模块 `node --check` 语法检查 → 模块行数门禁 → 产物体积门禁 → 纯函数单测 →
上传构建产物 `chaoxing-force-play.user.js` 作为 Artifact。

### 发布
1. 本地构建并自测通过；
2. 提交并推送（CI 自动跑全套校验）；
3. 在 GitHub Releases 附带 Artifact 中的 `.user.js`，Release note 注明 `git rev-parse --short HEAD` 对应的提交 SHA。

