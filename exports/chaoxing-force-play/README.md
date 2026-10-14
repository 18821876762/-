# 网课强制续播源码镜像

本目录由项目根 [scripts/sync-copy.ps1](../../scripts/sync-copy.ps1)从 [apps/userscript/src/chaoxing-force-play](../../apps/userscript/src/chaoxing-force-play/)同步。修改主源码后再更新此镜像。

四个能力域为 takeover、sites、plugins、presentation；依赖与拼接顺序由 [build-manifest.txt](../../apps/userscript/build-manifest.txt)确定。当前核心版本为 4.20.2（核对日期：2026-10-10）。源码包含 107 个 JavaScript 文件，由 105 项构建清单及 2 个入口组成；同一个 `@source-group` 的连续片段按清单顺序读取，不能把不完整片段单独当作完整模块执行。

在项目根目录同步：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1
powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1 -Watch
```

构建、依赖和测试位于 [apps/userscript](../../apps/userscript/README.md)，安装文件集中在 [dist](../../dist/)。本镜像用于源码阅读与导出。

[项目 README](../../README.md) · [目录结构](../../docs/PROJECT_STRUCTURE.md) · [文档索引](../../docs/DOC_INDEX.md) · [NOTICE.md](../../NOTICE.md)
