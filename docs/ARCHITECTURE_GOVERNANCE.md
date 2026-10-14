# 架构治理规约

> 适用：用户脚本源码；核对基线：4.20.3；核对日期：2026-10-14。
> 本页描述目录边界和维护要求。历史版本与重构记录见[归档原文](../旧文档/07_补充归档/2026-10-03/02_版本说明备查/docs/ARCHITECTURE_GOVERNANCE.md)。

## 能力域与归属

源码根目录为 [apps/userscript/src/chaoxing-force-play](../apps/userscript/src/chaoxing-force-play)。按能力归类，新增功能进入相应目录，再按职责拆分文件。

| 能力域 | 职责 | 主要子域 |
| --- | --- | --- |
| `takeover/` | 接管、调度及基础能力 | `foundation/`、`engine/`、`dom/`、`bootstrap/` |
| `sites/` | 站点选择器、适配与调度注册 | 超星、智慧树及其他平台；弹窗答题共享骨架 |
| `plugins/` | 工具库项与注册 | `addons/`、`registry.js` |
| `presentation/` | 面板、提示、诊断与交互 | 样式、面板组件、命令、仪表盘 |

当前共有 108 个 JavaScript 源文件：[build-manifest.txt](../apps/userscript/build-manifest.txt)显式登记 106 个模块，`takeover/meta.js` 与 `takeover/bootstrap/core.js` 为构建器处理的入口。新增或删除模块必须同步清单和依赖声明。4.20.3 新增 `foundation/storage/credentials.js`；私有 Key 与授权 Origin 留在闭包及管理器私有存储，不挂载网页命名空间。

同一逻辑模块可拆成多个连续源码片段，以相同的 `// @source-group: 原入口相对路径` 声明归组，入口与续段必须在清单中连续排列。[source-groups.cjs](../apps/userscript/scripts/source-groups.cjs)按清单顺序拼装逻辑组，对完整源码解析语法与词法作用域，并将真实共享依赖归属实际片段；函数参数、跨片段局部和嵌套插件 IIFE 私有变量不会作为共享提供方。片段不必单独构成完整函数或 IIFE，不能用单片段语法检查替代完整产物检查。

模块拼接到同一 IIFE。函数声明提升允许前向调用，但 `var` 的赋值、对象创建、事件注册与立即执行代码仍按构建顺序发生。检查 `@provides` / `@requires`、变量初始化和闭包捕获；不能仅凭函数提升判定跨文件引用安全。

## 单文件行数要求与当前状态

[check-module-size.ps1](../apps/userscript/check-module-size.ps1)按源码文本分行计数，包含注释、空行及末尾空行。

| 范围 | 门禁结果 | 维护要求 |
| --- | --- | --- |
| ≤300 行 | OK | 目标上限，保持职责集中 |
| >300 且 ≤350 行 | YLW | 查找合理拆分边界 |
| >350 行 | RED | 拆分为同域模块，避免向无关文件转移 |
| 白名单 `takeover/dom/dom.js` | WHT | 历史存量，现行白名单只有此文件 |

2026-10-10 已拆分这 14 个超限模块，全部非白名单源码不超过 350 行，[体积门禁输出](../backups/refactor/2026-10-10/module-split/evidence/拆分后体积检查.txt)为 PASS。唯一白名单仍为 `takeover/dom/dom.js`（670 行），没有新增白名单。完整拼接源码的 AST 在排除 `SCRIPT_VERSION` 显示常量 4.20.1 → 4.20.2 后与拆分前等价，见 [等价结果](../backups/refactor/2026-10-10/module-split/evidence/完整语法等价结果.json)；此结论不代替运行回归，本次全量验收范围见 [拆分记录](../backups/refactor/2026-10-10/module-split/拆分说明.md)。

以上是 4.20.2 的历史结果。4.20.3 的凭据、异步取消和发布验证改变了部分实现，不能继承“仅显示常量变化”的语法等价结论；当前构建、体积和运行回归以 [4.20.3 发布记录](releases/4.20.3.md)的已完成检查为准。

### 历史检查

2026-10-07 的独立检查仍发现 14 个非白名单文件超过 350 行；准确行数见 [本次输出](../backups/fixes/2026-10-07/functions/evidence/模块体积检查.txt)。CoreState 与新增桥请求协调器均为独立小模块，未新增白名单；构建通过不表示历史大模块已完成拆分。此前检查保留在 [2026-10-04 输出](../backups/refactor/2026-10-04/core-state/evidence/模块行数检查.txt)。

## 变更与拆分流程

1. 判断能力域和子域，确认现有文件的职责是否匹配。
2. 小范围修改可以进入职责匹配的文件；文件已超目标或引入新职责时，寻找同域拆分边界。
3. 同层文件使用明确名称，例如 `panel-core.js`、`panel-drag.js`；共享 IIFE 中的函数名应唯一。
4. 更新构建清单、依赖声明和公开能力挂载点，遵循[公开契约](CONTRACT.md)与[跨模块契约](CROSS_MODULE_CONTRACT.md)。
5. 重建并验证相关行为，检查行数门禁。[拆分参考](references/split-gotchas.md)说明 ASI、初始化顺序和切片边界。

文件移动也可能改变闭包、初始化或执行顺序。不能用“只移动代码”代替行为验证。

## 验证入口

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -ExecutionPolicy Bypass -File apps/userscript/check-module-size.ps1
```

统一构建与测试入口检查完整产物、依赖及契约；行数检查是独立的治理检查。默认本地仿真不包含全部浏览器场景，浏览器验证入口见[应用说明](../apps/userscript/README.md)与 [CI](../.github/workflows/ci.yml)。

## 注释与文档维护

源码注释保留约束、设计理由及防回归不变量。版本过程、旧目录沿革和评审长表放在历史资料中，现行说明聚焦当前行为；历史批注原件见[代码批注归档](../旧文档/01_历史评审与审计/docs/code-annotation-history.md)。

更新现行文档时标明核对日期和版本，核对具体实现后再声明功能、默认值和完成状态。归档资料不作为当前能力已实现或验证已通过的依据。

共享的历史评审和归档容器按 [脱敏说明](../旧文档/脱敏说明.md)保留可阅读副本，原件仅存在本机忽略的修正前快照；原始归档哈希与当前副本哈希分别记录。

目录职责见[项目结构](PROJECT_STRUCTURE.md)，文档入口见[文档索引](DOC_INDEX.md)。
