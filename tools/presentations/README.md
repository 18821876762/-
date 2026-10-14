# 演示稿生成工具

本目录承接原 `build-ppt.js` 与 `_ninja_test/pptx_build` 的生成器和已有依赖。`project-paths.cjs` 按脚本位置定位项目根目录；新生成 PPT 统一写到 `dist/presentations/`，不覆盖 `旧文档/` 内的历史原件。

**生成器仍使用历史讲稿。** 此次整理仅修正目录、构建入口和输出路径。讲稿中的 56 模块、56 仿真用例、版本与功能完成情况等历史数字没有重新核准，生成文件不能作为当前项目现状报告。当前使用入口以根 README、`scripts/build.ps1` 和 `scripts/test.ps1` 为准。

从项目根目录运行：

```powershell
node tools/presentations/build-ppt.js
node tools/presentations/build.js
node tools/presentations/verify.js dist/presentations/网课强制续播系统-项目介绍.pptx
node tools/presentations/verify.js dist/presentations/网课强制续播系统-架构与设计.pptx
```

| 入口 | 默认输出 |
| --- | --- |
| `build-ppt.js [输出PPTX]` | `dist/presentations/网课强制续播系统-项目介绍.pptx` |
| `build.js [输出PPTX]` | `dist/presentations/网课强制续播系统-架构与设计.pptx` |
| `verify.js [PPTX或目录]` | 只读输出文件大小、幻灯片数量与编号序列；默认检查输出目录中的首个 PPT |

生成器使用现有 `pptxgenjs`。`verify.js` 是包结构探针，不包含页面渲染或内容时效性核验。显式传入的相对路径按命令当前目录解释。

原 `copy.js` 与 `copy2.js` 保留为历史兼容入口，必须显式指定输入和输出：

```powershell
node tools/presentations/copy.js <源PPTX> <目标PPTX>
node tools/presentations/copy2.js <源PPTX> <目标PPTX>
```

复制助手保留源文件并拒绝覆盖已有目标；所有写入入口拒绝把 `旧文档/` 作为输出位置。若要基于历史资料做新稿，先输出到 `dist/presentations/`，再独立更新和审核内容。
