# 贡献指南（CONTRIBUTING）

> 面向新贡献者与「未来的你」。**先看这里再动手**，避免重复踩坑。

## 1. 上手顺序（5 分钟）

1. 读 `README.md` 了解三层层级；读 `docs/DOC_INDEX.md` 了解文档 7 类分类（最新导航入口；旧两类的 `docs/README.md` 仍可作补充参考）。
2. 改码前必读 🔴 规则文档：
   - `docs/ARCHITECTURE_GOVERNANCE.md` — 分层 / 单文件行数红线 / 新功能归域流程；
   - `docs/CONTRACT.md` — 行为不变量、命名空间与 `toolkit` 契约（有自动门禁守护）；
   - `docs/calibration-guide.md` — 真实站点选择器校准流程（各平台选择器均为 best-effort，改选择器必须先走此流程取证）。
3. 领取任务：看 `docs/TASKS.md`（任务区）——完成任务后**删除该条目并转 `docs/TASK_HISTORY.md`**（规则见 TASKS.md 顶部）。
4. 合规：本仓库含 `NOTICE.md`（仅供学习/风险自担），不鼓励任何学术不端用途。

## 2. 环境准备

- **Node**：优先使用仓库自带绿色版 `node_home/node-v*/node.exe`（已被 `.gitignore` 忽略，属本地工具）。系统 Node 可用亦可。
- **npm**：仅用于安装 devDependency（eslint / jsdom / playwright）。**本机 npm 可能不可用**（见下）。

### Windows 已知坑（务必看）

1. **npm 被污染**：本机 `npm install` 报 `ENOENT spawn D:\VScodexiangmu\...\x86_64-15.2.0...7z`——是 npm 自身配置被指向一个 `.7z` 路径，**与项目无关，不要修 npm**。
2. **构建命令**：用 `node_home` 的 node 直接跑 PowerShell 脚本，**不要用 `npm run build`**：
   ```powershell
   cd ecosystem
   & "c:/Users/24033_1dhcyji/CodeBuddy/20260723173246/node_home/node-v24.19.0-win-x64/node.exe" -e "console.log(process.version)"
   powershell -ExecutionPolicy Bypass -File build-force-play.ps1
   ```
   （上例 node 路径为本机示例；换用你实际的 `node_home/node-v*/node.exe`。）
3. **PowerShell 跑 sim 的 stderr 陷阱**：`sim-*.js` 向 stderr 写日志（如 `console.warn`）时，PowerShell 会把 stderr 当作 `NativeCommandError` **中断整个循环**。遍历测试应写：
   ```powershell
   & $node $_.FullName *> $null
   if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: $($_.Name)" }
   ```
   用 `*> $null` 吞掉输出、再查 `$LASTEXITCODE` 判定 PASS/FAIL。
4. **构建门禁开关**（见 `build-force-play.ps1` 头部注释）：
   - `-Fast`：开发快模式，只跑 `node --check` + 契约/元数据，跳过 `_sim` 与 ESLint（改→验亚秒级）；
   - `-SkipSim`：跳过需 Playwright+浏览器的少数真机仿真（CI 用）；
   - `-Minify`：产出折叠空行的紧凑产物。

## 3. 测试体系

| 层次 | 位置 | 何时跑 |
|---|---|---|
| 仿真回归 | `ecosystem/_sim/sim-*.js`（56 个；含 `verify_fixes.js` 为 57 个） | 构建时自动全量；**新增/修改功能务必补对应 sim** |
| 纯函数单测 | `ecosystem/tests/pure.test.js`（vm 沙箱，零依赖） | 改动 `utils` 等纯函数后 |
| 契约门禁 | `scripts/verify_contracts.js` / `verify_contract_doc.js` / `verify_contract_semantics.js`（含变异自检） | 构建时自动 |
| 元数据门禁 | `scripts/verify_metadata.js`（含自检） | 构建时自动 |
| ESLint | 仅对完整产物 `chaoxing-force-play.user.js` | 构建时自动（`ecosystem/.eslintrc.cjs`，渐进式门禁） |
| Python | `perception/cx_crawler/tests/test_*.py` | `python -m unittest discover`（CI 已接入） |
| 真机浏览器 | `_sim/smoke-pw.js` / `sim-iframe-pw.js` / `sim-bridge-noise-pw.js` | CI 的 best-effort job（`continue-on-error`） |

单条 sim 手动跑：
```powershell
cd ecosystem
& "<node_home 的 node>" _sim/sim-quiz.js
```

## 4. 规范速查

- **归域**：新功能按 `docs/ARCHITECTURE_GOVERNANCE.md` 选择能力域（takeover / sites / plugins / presentation），不跨域硬塞。
- **行数红线**：单文件软 300 / 硬 350 行，由 `check-module-size.ps1` 把关。
- **契约**：改共享状态 / 接管点 / 卸载还原时，必须同步 `docs/CONTRACT.md` 与挂载点总表——契约门禁会拦不匹配。
- **选择器**：改任何站点选择器前先读 `docs/calibration-guide.md` 与 `docs/_archive/element-dump-research.md`（真机取证方法，已归档至 `_archive/`）。
- **文档**：不要无必要地新建文档；`docs/` 文档分类以 `docs/DOC_INDEX.md`（7 类）为准，新增文件先登记进 `DOC_INDEX.md`（旧两类的 `docs/README.md` 同步补充）。过程性审查/快照归 `docs/reviews/`。
- **任务区**：完成 `docs/TASKS.md` 中某任务 → 删除条目 → 在 `docs/TASK_HISTORY.md` 顶部追加完成记录（含实跑证据）。

## 5. 提交 / 发布

- 推送前本地跑一次**全量** `build-force-play.ps1`（非 `-Fast`），保证 `_sim` 全绿 + 门禁全 PASS。
- 不向 `master` 强推；大改动建议先提交后由 CI（`.github/workflows/ci.yml`）复核。
- 发布：在 GitHub Releases 附带 CI Artifact 的 `chaoxing-force-play.user.js`，Release note 注明 `git rev-parse --short HEAD` 的 commit SHA。
