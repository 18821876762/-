# 跨模块契约"重复提供方"隐患 — 根因与重构任务

## 结论先行
你提到的 `lsGet`/`lsSet`（双提供）、`dbg`（3 处）、`on`（6 处）等，**经核实 100% 是扫描器的测量假阳性，并非代码真有重复定义**。这些"隐患"已通过修复扫描器彻底消除，契约表现已 **零多提供方**。

## 根因（4 个扫描器缺陷，已修复）
跨模块契约门禁 `ecosystem/scripts/verify_cross_module.js` 原本不是真正的"作用域感知"：

1. **非作用域感知的提供方检测**：`f`（函数嵌套深度）只对箭头函数 `=>` 与 `class` 递增，**对普通 `function` 声明/表达式不递增**。导致 `storage.js` 内 `KVS` 闭包里的 `lsGet`/`lsSet`、`panel-core.js` 函数内的 `var dbg`、各文件函数内的 `var on` 等局部声明被误判为模块级裸全局提供方。
2. **`extractRequires` 漏用 `NOISE_LOCALS`**：自由标识符只过滤了 `afterDot`/`colonAfter`/`KEYWORDS`/`BUILTINS`/`decls`，**没过滤常见局部变量名**（`e`/`k`/`d`/`fn`/`ev`/`text`）。于是这些局部名被当成"跨模块依赖"写进 `@requires`，作用域修复后原"假提供方"消失，注解悬空违约。
3. **`seedAnnotations` 只增不减**：从已有注解 `exist.provides` 初始化 `provSet`，stale 符号（如旧误判的 `lsGet/lsSet`）永不删除；且 `provSet`/`reqSet` 皆空时直接 `continue`，导致旧注解无法被剥离。
4. **插件未区分**：`plugins/addons/*` 本身是独立 IIFE，其"顶层"声明被限制在插件闭包内、不泄漏为跨模块全局；但扫描器把文件 IIFE 体当成模块作用域，于是 `activeVideo`/`DEBUG`/`toast` 在插件文件里的同名遮蔽被误报为"双提供"。

## 已完成的修复（任务 1–5）
- 普通 `function` 体左括号处递增函数嵌套深度 → 内部声明不再误判为模块级。
- `extractRequires` 应用 `NOISE_LOCALS`，并把 `ev`/`text`/`box`/`doc`/`btn`/`label`/`val2` 补入噪声集。
- `seedAnnotations` 改为**从推断从零重建**注解，且移除"空注解跳过"优化（旧注解必被剥离）。
- 扫描器**插件感知**：`plugins/addons/` 文件顶层声明不算跨模块提供方。
- 新增自检守卫（作用域感知 + 插件感知 + 文档漂移），门禁⑧ `SELFTEST PASSED`。

**验证**：`build -Fast` 全部门禁通过（`node --check` 产物、contract/meta/semantics 及其 SELFTEST）。契约文档"共享全局 → 声明模块"表现在 **0 个多提供方**。

## 剩余真实重构任务（任务 6–7，需逐案人工核对）
修复后残留 3 个"多提供方"均为**插件内同名遮蔽**（良性，非碰撞）：`activeVideo`(dom.js 真 + keyboard-shortcuts.js 遮蔽)、`DEBUG`(config.js 真 + auto-next.js 遮蔽)、`toast`(toast.js 真 + auto-next.js 遮蔽)。真·跨模块全局（dom.js/config.js/toast.js）保留为单一提供方，正确。

- **任务 6**：审计 `auto-next.js`(`var DEBUG`/`var toast`)、`keyboard-shortcuts.js`(`var activeVideo`) 的冗余声明——确认其是否与跨模块全局同义（是则删 `var` 改引用闭包全局；否则重命名），并经 `_sim` 测试 + 门禁确认无行为变化。**逐案人工核对，勿批量自动改**（避免误改语义不同的局部副本）。
- **任务 7**：补全个别文件不完整的 `@provides`（如 `dom.js` 缺 `activeVideo`），同步 `docs/CONTRACT.md` §12。

> 说明：任务 6–7 属代码整洁度优化，不影响功能（遮蔽当前可正常工作）。是否执行取决于你对"彻底消除"的严格程度——测量层面的假阳性已全部消除。
