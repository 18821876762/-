# 诊断工具

本目录承接原根 `_ninja_test` 和应用内 `_ninja` 的诊断脚本。项目根目录、源码、产物和页面样本均通过 `project-paths.cjs` 按脚本位置定位，不依赖个人绝对路径或启动目录。显式传入的相对文件路径按命令当前目录解释。

| 读取位置 | 用途 |
| --- | --- |
| `apps/userscript/src/chaoxing-force-play/` | 当前用户脚本源码 |
| `dist/chaoxing-force-play.user.js` | 当前个人版产物 |
| `dist/chaoxing-force-play-latest.user.js` | 当前个人版分发副本 |
| `apps/userscript/tests/fixtures/chaoxing-page.html` | 离线页面样本 |
| `apps/userscript/_sim/node_modules/` | 沙箱及浏览器探针沿用的仿真依赖 |
| `tools/diagnostics/output/` | 新生成的诊断图片、候选文件等 |

## 只读诊断

从项目根目录运行，源码指标、元数据与字节检查不会改动文件：

```powershell
node tools/diagnostics/audit-metrics.js
node tools/diagnostics/audit-meta.js
node tools/diagnostics/check-bytes.js
node tools/diagnostics/audit-xss.js
node tools/diagnostics/independence-probe.js
node tools/diagnostics/global-leak-probe.js
```

`audit-metrics.js [源码目录]` 和 `audit-meta.js [产物路径]` 支持指定输入。XSS 脚本只做启发式扫描，其提示需要人工判断。`loadcheck-bundle.js` 使用极简历史垫片输出诊断日志，退出码本身不能证明功能通过。`verify_*`、`test.js`、`harness2.js`、`perf-probe*`、`probe-ended.js`、`userscript/dbg-*` 与 `_cx-*-smoke.js` 保留各自历史复现目的和断言，不替代现行回归入口 `scripts/test.ps1`。

## 浏览器与页面内探针

`pw-*.js` 和 `userscript/pw-*.js` 使用仿真包中的 Playwright。浏览器优先使用环境变量 `CX_BROWSER_PATH` 指定的可执行文件，然后使用 Playwright 默认缓存及 Windows 本地缓存中的已有 Chromium。本目录不会自动下载浏览器。截图写入 `output/panel-layout.png`。

`chaoxing-diag.js`、`chaoxing-diag2.js` 和 `userscript/probe-workpage.js` 是页面控制台片段，需在对应页面上下文运行。浏览器性能与布局探针属于离线复现工具，不证明当前真实站点兼容性。

## 需显式输入的历史助手

这些入口缺少参数时只显示用法，不会默认改写历史记录：

```powershell
# 历史 A/B 交互探针；旧版脚本需自行提供，第二个参数默认为当前 latest
node tools/diagnostics/pw-ab-interact.js <Release-4.18脚本> [当前脚本]

# 修复历史 CHANGELOG 的字面换行和特定版本行顺序；输出必须是另一文件
node tools/diagnostics/fix-changelog.js <输入文件> <输出文件>

# 按历史排序算法生成候选清单，不能覆盖现行 build-manifest.txt
node tools/diagnostics/userscript/_recover_manifest.js <源模块目录> <候选清单输出文件>

# 只读查看指定 HTML 及同目录资源；默认仅监听本机 8137 端口
node tools/diagnostics/serve-dep.js <依赖关系HTML> [端口]
```

`fix-changelog.js` 只适用于它原本针对的旧记录，恢复清单的排序也必须人工比较后采用。需要新输出时推荐写到 `tools/diagnostics/output/`；写入助手会拒绝以 `旧文档/` 为输出位置。归档原件和 ZIP 不作为工具默认写入目标。
