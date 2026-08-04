# 架构治理规约 · chaoxing-force-play

> 适用范围：`ecosystem/src/chaoxing-force-play/**` 全部源码。
> 生效：2026-08-03。本规约用于在"解构重构"之后**长期保持**代码的分类边界，杜绝单文件再次膨胀。

---

## 0. 核心铁律（一句话）

**所有代码必须严格按"层 + 域"归类存放；任何新功能都新建/归入对应域文件，禁止把内容反复追加进某一个现有文件使其膨胀。**

---

## 1. 分层与分类（强制）

所有源码落在 `ecosystem/src/chaoxing-force-play/` 下的固定目录，单一 IIFE 闭包、函数声明 hoist，跨文件引用天然安全。

| 层（目录） | 职责 | 现有文件 |
|---|---|---|
| `utils/` | 纯工具函数（dbg / swallow / cxState） | `utils.js` |
| `state/` | 状态集中层（Store 事件总线 get/set/on/emit） | `state.js` |
| `meta-config/` | 元信息：CONFIG / STYLES / CONST / FLAGS / 原型中和 | `config.js` |
| `storage/` | 配置持久化（saveXxx/loadXxx/clampCfg） | `storage.js` |
| `site/` | 站点适配 / 页面路由 | `site-router.js` |
| `biz/` | **业务域**：按子域细分文件 | `targeting` `dedup` `playback` `stats` `foreground` |
| `dom/` | 接管引擎：overrideVideo / 视频枚举 / 用户暂停恢复 / 计时器 / toast / MO 自启动 | `dom.js` |
| `ui/` | **界面域**：按关注点细分文件 | `addons` `panel` `panel-template` `panel-core` `panel-drag` `diagnostics` `dashboard` `commands` |
| `bootstrap/` | 自启动：IIFE 开启+幂等守卫 / 主循环 | `core.js` `main-loop.js` |

`biz/` 与 `ui/` 是"域"最多的两层，新功能优先落在这两层，并按子域继续拆文件（见 §3）。

---

## 2. 单文件红线（硬性约束）

| 等级 | 阈值 | 处置 |
|---|---|---|
| 目标上限 | **≤ 300 行**（含注释/空行） | 新代码必须遵守 |
| 警示线 | 300–350 行 | 标黄，建议下次顺手拆分 |
| 硬上限 | **> 350 行** | 必须拆分或新建同层文件，**禁止**横向塞入无关文件 |

- 历史存量超线文件进入**白名单**（仅 `dom/dom.js`，438 行），标记为"待重构"，**白名单不得新增**。
- 自检：`ecosystem/check-module-size.ps1`（见 §5）。超出硬上限且不在白名单 → 退出码非 0，CI/提交前必须清零。

**禁止行为（反面教材）：**
- ❌ 把悬浮面板 UI（~900 行）塞进核心业务文件 → 这正是 `core-biz.js` 曾膨胀到 1500 行的根因。
- ❌ 把主循环、调度逻辑反复追加进同一个"业务"文件。
- ❌ 同一职责跨多文件重复实现（重复代码同样违规）。

---

## 3. 新功能归属判定流程（每次改/加代码前必走）

```
1) 判定层：基础 / 业务(biz) / 接管引擎(dom) / 界面(ui) / 自启动(bootstrap)
2) 判定子域：在对应层内，功能属于哪个已有"域文件"？
3) 决策：
   a. 现有域文件 ≤ 300 行 且 职责匹配  → 允许小步追加（仍不得破坏单一职责）
   b. 现有域文件 > 300 行 或 职责不匹配 → 【新建】同层文件（连字符细分，如 xxx-core / xxx-drag）
4) 同步构建清单：把新文件加入 ecosystem/build-force-play.ps1 的 $domainRel 对应层段 + 更新分层注释
5) 重建 + 校验：powershell -File build-force-play.ps1，并跑 check-module-size.ps1
```

**命名约定：** 同层多文件用连字符细分（`panel` → `panel-core` / `panel-template` / `panel-drag`）；函数名全局唯一（同 IIFE 提升，避免重名覆盖）。

## 4. 拆分机械约束（防回归红线）

用脚本切片把大文件拆成小文件时，必须保留原代码的**语法边界**，否则会产生静默 bug。最关键一条：**`return` 后不得单独成行**（JS 的 ASI 会自动插入分号，使函数返回 `undefined`）。

> 反例/正例代码、自检 grep 规则、切片后必做校验清单等具体细节 → 见 `docs/references/split-gotchas.md`。

---

## 5. 构建与校验（强制）

- 所有域文件在 `build-force-play.ps1` 中**显式列出**（不使用脆弱的目录 glob）。
- 任何文件增删后必须重新构建：`powershell -File ecosystem/build-force-play.ps1`。
- 产物须通过：以 `// ==UserScript==` 开头、`})();` 结尾、大括号配平、`node --check`（环境无 node 时用结构校验脚本替代）。
- 行数红线自检：`powershell -File ecosystem/check-module-size.ps1`。

---

## 6. 红线自检脚本

`ecosystem/check-module-size.ps1`：
- 遍历 `src/chaoxing-force-play/**/*.js`，输出每个文件行数；
- `> 350` 且不在白名单 → 标 RED，脚本退出码 1；
- `300–350` → 标 YELLOW（提示可拆分）；
- 白名单（待重构历史存量）：`dom/dom.js`。
- 废弃名单（deprecated）：历史重构前被域文件取代的旧单体 `core-biz/core-biz.js` 与 `ui/ui.js` 已于 2026-08-04 删除清空，当前 `$deprecated` 为空，所有源文件均参与构建或属强制入口。

运行：
```powershell
cd ecosystem && powershell -File check-module-size.ps1
```

---

## 7. 历史教训（为何立此规约）

`core-biz.js` 曾膨胀至 **1500 行**，原因正是把本属 `ui/` 层的悬浮控制面板（~900 行）与主循环误塞进"核心业务"文件，且新功能持续往里追加。
已于 2026-08 起解构重构为域文件（当前 20 个，见各层表格）；本规约目的是**防止复发**，把分类边界固化下来。

---

## 8. 注释规范（时效性红线）

代码注释只写 **"为什么"（约束/坑位/防回归不变量）**，不写 **"哪版加的"（版本叙事）**；版本演进统一归 `CHANGELOG.md`，代码内不得残留 `vX.Y` 徽标或"旧版…"历史对比。

**必须保留（why 类，删则丢关键不变量）：**
- 防回归警告：`F-B4`（每轮重 neutralize 原型 pause，勿改幂等）、`修复 #16`（body 未就绪 deferred）、`审查#5`（重复注入守卫）、`吸收评审#2/#D`（实例 own 属性遮蔽）等；
- 设计约束：`positionPanel` 空壳保留理由、`旧版拖拽` 裁切坑、`旧版固定 288px` 窄态混淆坑、`F-B1` 释放/重新接管边界。

**必须迁出（叙事类，转 `docs/code-annotation-history.md`）：**
- 任何 `v4.7 命令面板` / `v4.8 运维仪表盘` / `v4.0 主脚本架构` 等带版本号的功能标记；
- 任何"原先与…同处…" / "原先仅 AUTO_STOP_MIN>0 才…"等历史组织结构叙述。

> 维护者改码时，看到 why 类注释应立即停手核对不变量；叙事类注释若在代码里出现，视为时效坏账，按本节约迁。

---

## 9. 变更记录

| 日期 | 事项 |
|---|---|
| 2026-08-03 | 立规：分层分类、单文件红线（目标 300 / 硬上限 350）、新功能归域流程、白名单仅 `dom/dom.js`、附 `check-module-size.ps1` |
| 2026-08-03 | 规约瘦身：§4 拆分机械约束的 ASI 代码示例外移至 `docs/references/split-gotchas.md`；修正重复的 §4 编号（现 §4 拆分约束 / §5 构建校验 / §6 自检脚本 / §7 历史教训 / §8 注释规范 / §9 变更记录） |
| 2026-08-04 | 注释时效治理：代码内 `vX.Y` 功能徽标与历史叙述类注释迁出至 `docs/code-annotation-history.md`；新增 §8 注释规范红线（why 类保留 / 叙事类迁出）；`core-biz/core-biz.js` 与 `ui/ui.js` 删除清空 `$deprecated` |
