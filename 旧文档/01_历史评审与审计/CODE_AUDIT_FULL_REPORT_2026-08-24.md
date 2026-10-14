# 全量代码静态检查与动态分析报告

- 项目：`chaoxing-force-play`（网课强制续播用户脚本，@version 4.19.47）
- 生成时间：2026-08-24
- 环境：Windows / Node v24.19.0（node_home 本地）/ PowerShell
- 扫描范围：`ecosystem/src`（59 个源模块）、`ecosystem/_sim`（75 集成测试）、`ecosystem/tests`（单元测试）、构建产物 `chaoxing-force-play.user.js`（~729KB / 13207 行）、契约文档与门禁脚本

---

## 一、检查方法论与工具清单

| 类别 | 工具 / 方法 | 目标 |
|---|---|---|
| 语法检查 | `node --check`（V8 解析） | 产物与源语法合法性 |
| 代码规范 | ESLint `eslint:recommended`（ecosystem 本地 .eslintrc.cjs） | 潜在错误 / 风格 |
| 安全扫描 | `scripts/check-security.js`（危险 API grep） | XSS / 危险调用 |
| 重复检测 | `scripts/check-dup.js`（跨文件 token 相似度） | 重复代码 |
| 契约门禁 | `scripts/verify_contracts.js` / `verify_contract_semantics.js` | 跨模块符号契约 |
| 元数据门禁 | `scripts/verify_metadata.js` | 版本一致性 |
| 跨模块契约 | `scripts/verify_cross_module.js` | 依赖映射文档漂移 |
| 单元测试 | `node --test`（`tests/pure.test.js` / `quiz-merge.test.js`） | 纯逻辑桩 |
| 集成测试 | `scripts/run-sim.js`（jsdom 全产品注入，75 文件） | 端到端行为 |
| 覆盖率 | `node --test --experimental-test-coverage` | 行级覆盖 |
| 依赖审计 | `package.json` deps vs 实际 `node_modules` | 缺失 / 不一致 |
| 性能指标 | 自研行数/函数/体积分析器（`_ninja_test/audit-metrics.js`） | 模块规模/复杂度 |
| XSS 聚焦 | 自研 sink 分析器（`_ninja_test/audit-xss.js`） | innerHTML 风险判定 |

> 注：所有自动化结果均经实际执行捕获；构建门禁 `build-force-play.ps1`（完整模式）作为总闸复验。

---

## 二、检查结论总览

| 检查项 | 结果 | 说明 |
|---|---|---|
| 语法检查 (node --check) | ✅ PASS | 产物 V8 解析 0 错误 |
| ESLint (recommended) | ✅ PASS | 0 error / 0 warning |
| 安全扫描 (check-security) | ✅ PASS（已评估） | 无高危，5 处疑似均误报（见 §四） |
| 重复代码 (check-dup) | ⚠️ 1 处低风险 | 3 个 addon 注册样板重复 |
| 契约门禁 (verify_contracts) | ✅ PASS | 200 符号 / 269 读点 |
| 契约语义 (semantics) | ✅ PASS | SELFTEST PASS |
| 元数据门禁 (verify_metadata) | ✅ PASS | 版本三处一致 4.19.47 |
| 跨模块契约 (verify_cross_module) | ❌→✅ 已修复 | 文档此前漂移，regenerate 后 PASS |
| 单元测试 (node --test) | ✅ PASS | 52 断言 / 2 test 文件全过 |
| 集成测试 (_sim/jsdom) | ✅ 72 PASS / 3 SKIP | 跳过为 playwright 真机用例 |
| 覆盖率工具 | ✅ 可用 | 核心拼接产品未被 node:test 行级覆盖（架构局限，见 §五） |
| 构建总闸 (build-force-play) | ✅ PASS (exit 0) | 全部子门禁 PASS |
| 依赖审计 | ❌ 配置缺陷 | 见 §六 P1/P2 |
| 性能/规模 | ⚠️ 关注 | 产物 ~729KB，quiz.js 1742 行超长 |

**总体评价**：代码质量在「运行时正确性 / 契约一致性 / 测试覆盖行为」维度表现优秀（门禁全绿、72 集成测试通过、零高危安全漏洞）。主要短板在**工程配置一致性**（npm 脚本路径、依赖安装完整性）与**部分模块规模过大**。

---

## 三、静态检查结果明细

### 3.1 语法检查
```
node --check ecosystem/chaoxing-force-play.user.js  → exit 0，0 语法错误
```
59 个源模块经拼接后产物语法完全合法。

### 3.2 ESLint (eslint:recommended)
运行于 `ecosystem/`（本地 `.eslintrc.cjs`，规则集 `eslint:recommended`）：
```
ecosystem/node_modules/.bin/eslint chaoxing-force-play.user.js  → exit 0
```
0 error / 0 warning。注意：根目录 `node_modules/.bin/eslint` 缺失（见 §六 P2），故 ESLint 仅能在 `ecosystem/` 下运行。

### 3.3 安全扫描 (check-security.js)
危险 API 命中清单：
- `document.write`：1 处（`presentation/panel-controls.js:329`）——该处写入的是脚本自身模板字符串（固定结构），非页面数据，安全。
- `innerHTML` / `outerHTML` / `insertAdjacentHTML`：共 30 处赋值。经 XSS 聚焦分析（§四），全部为内部常量 / 数值 / 图标 / 已 escapeHTML 的路径，**无未转义页面文本注入**。

### 3.4 重复代码 (check-dup.js)
1 处跨文件重复：
- `plugins/addons/{auto-next,keyboard-shortcuts,quiet-popups}.js` 中各含
  `Array.isArray(window.__cxAddonQueue)?window.__cxAddonQueue.push(...):(window.__cxAddonQueue=[...])`
  注册样板。低风险（模板化注册协议），可抽为共享 helper 消除。

### 3.5 契约 / 元数据 / 跨模块门禁
- `verify_contracts`：200 导出符号 / 269 读点，全部解析通过。
- `verify_metadata`：meta.js / panel.js / package.json 版本均为 `4.19.47`，一致。
- `verify_cross_module`：**初始 FAIL**（根 `docs/CROSS_MODULE_CONTRACT.md` 与源码依赖映射漂移）→ 经 `--emit-doc` 重新生成后 **PASS**（59 模块 / 782 裸全局，文档同步）。**该文档现已修复并需提交**（见 §六）。

---

## 四、XSS 风险聚焦评估（对 30 处 innerHTML 逐一判定）

分析器标记 5 处「含变量且附近无 escapeHTML」，逐一审查结论均为**安全**：

| 位置 | 内容 | 判定 |
|---|---|---|
| `plugins/registry.js:93` | 拼接 `STYLES.T.text3`（颜色常量） | ✅ 安全（内部常量） |
| `presentation/dashboard.js:105` | 拼接 `cxIcon('pause',12)`（固定 SVG）+ 中文「已暂停」 | ✅ 安全（图标+字面量） |
| `presentation/dashboard.js:106` | 拼接固定 SVG + 中文「暂停中」 | ✅ 安全 |
| `presentation/dashboard.js:110` | 拼接 `tCur/tDur`（脚本内部计算的视频时长**数值**） | ✅ 安全，但建议改用 `textContent`（风格问题，非漏洞） |
| `presentation/zhihuishu-fab.js:296` | 拼接 `ZHS_FAB_SVG`（常量）+ 固定 class | ✅ 安全 |

其余 25 处均经 `escapeHTML()` 包裹或 `textContent` / `createElement` 路径（标记 `[esc]`）。
**结论：无高危 XSS 漏洞**。唯一改进点：`dashboard.js:110` 将数值直接拼入 innerHTML 不优雅，建议改为模板节点或 textContent。

---

## 五、动态分析结果

### 5.1 单元测试（node --test）
```
tests/pure.test.js  → 52 断言通过（环境变量/CX_KEYS/存储桩等纯逻辑）
tests/quiz-merge.test.js → 通过
合计：2 test 文件 / 2 tests / 0 fail
```
> 注意：memory 记录 `package.json` 的 `test` 脚本为 `node tests/pure.test.js`，但 `tests/` 实际位于 `ecosystem/` 下；从**项目根目录**运行时路径失效（见 §六 P1）。

### 5.2 集成测试（_sim，jsdom 全产品注入）
```
scripts/run-sim.js 默认模式（进程级隔离，逐文件 spawnSync）
结果：72 PASS / 3 SKIP（playwright 真机用例：需浏览器环境）
覆盖：答题/视觉/弹窗/沙箱/线程/幂等/漂移守卫/跨帧/信号灯等多维度
```
历史相关记忆中的「sim-quiz-popup.js 预存在失败」在本次实际运行中**已不存在**（72/72 全绿），说明该用例此前未被纳入默认 skip 列表或已修复。

### 5.3 覆盖率分析
```
node --test --experimental-test-coverage tests/  → 工具可用
```
**架构局限（重要说明）**：项目核心为 IIFE 拼接产物，`node --test` 仅能覆盖被 `require` 的独立桩模块（pure.test / quiz-merge.test），对 ~729KB 核心产品的**行级覆盖率无法自然获取**——原生覆盖率报告显示 `all files 100%` 实为仅统计了被测桩自身，不代表核心代码覆盖。
**真实覆盖来自 `_sim`**：75 个 jsdom 测试通过「全产品注入 + 行为断言」实现功能级覆盖，但**缺少量化行级覆盖率指标**。
**建议**：引入 `c8` 挂接 `run-sim.js`（nyc/c8 可覆盖 IIFE 通过 `--require` 或 source-map 统计），以产出核心代码行级覆盖率数字（见 §六 P4）。

---

## 六、发现的问题与改进建议（按严重级别）

### P1（配置缺陷，导致 `npm` 脚本在根目录失效）
- **`package.json` `test` 脚本路径错误**：`"test": "node tests/pure.test.js"` —— `tests/` 位于 `ecosystem/`，从根目录运行 `npm test` 报找不到文件。修复：改为 `"test": "node ecosystem/tests/pure.test.js"` 或把 `test`/`lint`/`build` 脚本统一在 `ecosystem/` 目录执行（与 `build` 脚本已有的相对路径约定一致）。
- **`package.json` `lint` 脚本不可达**：`"lint": "./node_modules/.bin/eslint ..."` 依赖**根** `node_modules/.bin/eslint`，但 eslint 实际装在 `ecosystem/node_modules`，根缺 eslint → 从根 `npm run lint` 失败。修复：改为 `"lint": "cd ecosystem && node_modules/.bin/eslint ..."` 或在 ecosystem 安装 eslint 并调整 cwd。

### P2（依赖未完整安装，依赖审计暴露）
- 根 `node_modules` 仅 35 包，**缺失** `chai` / `nyc` / `c8` / `glob`（devDependencies 列于 package.json 但未安装，因 npm 自身被 `.7z` 路径污染无法 `npm install`）。
- `ecosystem/node_modules` 有 94 包（含可用 eslint / playwright），但根与子目录依赖不统一，导致跨目录的 npm 脚本行为不一致。
- 修复：在能正常联网/无污染 npm 的环境中 `npm install`（根 + ecosystem），或改用本地 node + 离线包补齐 devDeps。

### P3（已修复，需提交）
- **跨模块契约文档漂移**：`docs/CROSS_MODULE_CONTRACT.md`（根目录，git untracked new file）此前与源码依赖映射不一致，导致构建门禁 `cross-module contract FAILED`。本次已通过 `verify_cross_module.js --emit-doc` 重新生成为同步版本，构建总闸现已全绿。**该文档更新需纳入版本控制**（git add + commit），否则下次克隆/CI 会再次 FAIL。

### P4（覆盖率指标缺失，建议增强）
- 核心产品无行级覆盖率数字。建议引入 `c8` 包裹 `run-sim.js`：
  `c8 --reporter=text --reporter=lcov node scripts/run-sim.js`，
  产出核心代码覆盖率报告；并将 `c8` 加入 devDeps 与 CI 门禁。

### P5（代码规模 / 可维护性，建议关注）
- **产物体积 ~729KB / 13207 行**：对 Tampermonkey 用户脚本偏大，功能累积导致加载/解析成本上升。建议评估可裁剪模块（如非主流站点 biz 适配器）或按需懒加载。
- **`quiz.js` 1742 行单文件超长**：函数粒度与单文件规模偏高，增加维护与回归风险。建议按职责拆分（检测/作答/信号灯/状态机）并补充单元桩（迁移更多逻辑到 `tests/` 以便 node:test 覆盖）。
- **`dashboard.js:110`** 数值直接拼 innerHTML：非漏洞，建议改用 `textContent` 或模板节点，降低误用风险。

### P6（低风险，可优化）
- 3 个 addon 注册样板重复（§3.4）：抽为 `toolkit.registerAddon()` 共享 helper。
- `panel-controls.js:329` `document.write`：虽安全，建议改用 DOM API（`insertAdjacentHTML` 或 `createElement`）统一注入风格，便于审计。

---

## 七、性能指标汇总

| 指标 | 数值 |
|---|---|
| 源模块数 | 59 个 .js |
| 源码总行数 | 13,202 行 |
| 函数声明（function+arrow 估算） | 506 个 |
| 最大源文件 | `quiz.js` 1,742 行 |
| 次大源文件 | `vision-deepseek-web.js` 978 行 |
| 构建产物体积 | 745,991 字节（~729 KB） |
| 构建产物行数 | 13,207 行 |
| 集成测试数 | 75（72 通过 / 3 跳过） |
| 单元测试断言 | 52（全过） |
| 构建门禁耗时 | 含 _sim 约 1–2 分钟，全绿 |

---

## 八、最终判定

| 维度 | 评级 |
|---|---|
| 语法 / 规范 | A（门禁全绿，0 error） |
| 安全 | A（无高危 XSS / 危险调用） |
| 契约一致性 | A（修复后文档同步，200 符号稳定） |
| 测试 | A-（行为级 72/72 通过；缺行级覆盖率量化） |
| 工程配置 | C+（npm 脚本路径/依赖安装存在缺陷，P1/P2） |
| 可维护性 | B（quiz.js 过大、产物偏重） |

**结论**：代码**运行时正确性、安全性、契约一致性、行为测试覆盖均达到高质量水平**，可放心发布（@version 4.19.47 构建门禁全绿）。优先修复 **P1/P2 工程配置缺陷**（否则 `npm test`/`npm run lint` 在根目录不可用、依赖审计不完整），并**提交已修复的跨模块契约文档（P3）**。P4/P5/P6 为质量增强项，可排入后续迭代。

---

## 附：执行命令记录（可复现）

```powershell
# 构建总闸（完整，含 _sim）
cd ecosystem; powershell -ExecutionPolicy Bypass -File .\build-force-play.ps1

# 语法
node --check chaoxing-force-play.user.js

# ESLint（须在 ecosystem 下）
cd ecosystem; node_modules/.bin/eslint chaoxing-force-play.user.js

# 安全 / 重复 / 契约 / 元数据 / 跨模块
cd ecosystem; node scripts/check-security.js
cd ecosystem; node scripts/check-dup.js
cd ecosystem; node scripts/verify_contracts.js
cd ecosystem; node scripts/verify_metadata.js
cd ecosystem; node scripts/verify_cross_module.js          # 校验
cd ecosystem; node scripts/verify_cross_module.js --emit-doc  # 重新生成文档

# 单元测试 + 覆盖率
cd ecosystem; node --test=tests --experimental-test-coverage

# 集成测试
cd ecosystem; node scripts/run-sim.js

# 指标分析（自研，常驻 _ninja_test）
node ../_ninja_test/audit-metrics.js src
node ../_ninja_test/audit-xss.js
```

> 说明：`_ninja_test/audit-metrics.js`、`_ninja_test/audit-xss.js`、`_ninja_test/audit-meta.js` 为本次审计新增的常驻辅助脚本（按项目规约存放于 `_ninja_test/`，非临时清理对象），可供后续复检复用。
