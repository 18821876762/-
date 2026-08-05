# 设计文档：#1 温和模式 + 礼貌模式（最小侵入与抗检测）

> 状态：已落地（P0–P4 全完成）。前置：建议 #10 安全审计面板已落地（`diagnostics.js` 的 `buildInvasionReport`）。
> 目标：在保持「超星强制续播」有效性的前提下，新增两种可降级执行策略，降低对宿主页面的侵入面并降低被平台反篡改探测的概率。
> 范围：仅主脚本 `ecosystem/src/chaoxing-force-play/**`，不涉及爬虫桥（`perception/`）。

---

## 0. 术语

| 词 | 含义 |
|---|---|
| 温和模式（Gentle） | 默认尽量不改 `HTMLMediaElement.prototype`，优先实例 own-property / 事件级接管；仅在确认实例级不足以拦截时才回退原型。 |
| 礼貌模式（Polite） | 抗检测：让 `pause.toString()` / `playbackRate` setter 的来源特征与「未注入」一致，规避平台基于 `toString()` 字面量扫描的反篡改逻辑。 |
| 激进模式（Aggressive） | 现状默认行为：直接包装 `prototype.pause` 与 `playbackRate` setter（见 `config.js:82-116`）。 |
| 入侵面 | 安全审计（#10）盘点的 6 类：`window` 符号 / 注入 DOM / `prototype.pause` / `prototype.playbackRate` / `mediaSession` / 卸载钩子。 |

---

## 1. 现状事实核查（防重复造轮子）

| 现状能力 | 位置 | 备注 |
|---|---|---|
| 原型 pause 中性化 | `config.js:82-95` `installPrototypePauseNeutralize` | 现状默认即激进模式；函数体内硬写字面量 `'__cxForcePaused'`（`config.js:42-43` 注释要求保留，供自有 tamper-guard 检测还原）。 |
| 原型 playbackRate 中性化 | `config.js:102-116` | setter 体内同样引用该字面量。 |
| 全局 `window.ananas.pause` 中和 | `dom.js:194-208` `neutralizeGlobalPause` | 实例 own-property 遮蔽（defineProperty）。 |
| 卸载还原 | `lifecycle.js:55-139` `cleanupListeners` | ① ② 还原 prototype.pause / playbackRate（按 `NATIVE_PAUSE_DESC` / `NATIVE_RATE_DESC` 还原）。 |
| 安全审计 | `diagnostics.js:51-98` | `_cxAuditProtoPause` 用 `String(prototype.pause).indexOf('__cxForcePaused')>=0` 探测包装特征。 |
| 自有篡改报警副脚本 | `decision/chaoxing-tamper-guard.user.js:52,73` | `containsMarker` 同样靠 `pause.toString()` 含 `__cxForcePaused` 判断中性化是否还在。 |

**结论**：#5（可卸载）、#8（面板诊断）、#10（安全审计）已落地；#1 温和/礼貌模式未做。下面两个张力决定设计不能简单照搬「默认不改原型」。

---

## 2. 核心矛盾分析

### 2.1 温和模式：实例 own-property 能否拦住超星闭包 pause？

`config.js:69-73` 注释指出：超星在 webpack 闭包里直接调 `video.pause()`，且视频实例会随「DOM 换血 / 平台重定义原型」频繁重建。

- **实例 own-property 能拦截闭包调用**：闭包持有的是具体 `video` 实例，`video.pause()` 走 own-property 遮蔽（带 own 属性时 own 优先于原型）。所以单看一处调用，own-property 是拦得住的。
- **但存在覆盖窗口**：新实例在 `scanVideos`（`dom.js:276-283`）下一轮扫描前若已被平台 `pause()`，就会漏掉。现 `RESCAN_INTERVAL=2000ms`（`config.js:5`）且 `MutationObserver` 合并队列（`dom.js:316-320`）触发即时 `overrideVideo`，但仍有理论窗口（实例创建→MO 回调之间的微任务间隙）。
- **原型中性化是单点全覆盖**：一次包装，过去/现在/未来所有实例、任何调用点都被拦截，零窗口。这是现状选激进的根因。

> 设计推论：**温和模式在超星上不可用（会偶发漏拦）**；但在「非超星通用视频站」上，实例级 + 事件级足以覆盖且侵入更轻。因此「温和」不应是平台无关的默认，而应「按站点能力自适应」。

### 2.2 礼貌模式：隐藏字面量会破坏自有 tamper-guard

- 平台反篡改常做：`pause.toString()` 是否仍含注入者特征串（即 `config.js:42-43` 提到的探测方式）。礼貌模式需让 `pause.toString()` 看起来像原生函数。
- 但 `chaoxing-tamper-guard.user.js:52,73` 的 `containsMarker` 也靠这个字面量判断是否被平台还原并报警。一旦礼貌模式隐藏字面量，**自有报警副脚本将永久误判为「已被还原」而疯狂报警**。
- 安全审计 `_cxAuditProtoPause`（`diagnostics.js:63-64`）同样依赖该字面量，礼貌模式开启后审计会错误显示「未包装」。

> 设计推论：礼貌模式必须把「还原检测」从「字串扫描」改为「行为探测」，且审计面板需改用行为探测结果，否则三个系统互相打架。

---

## 3. 方案设计

### 3.1 配置模型（新增两个开关）

在 `CONFIG`（`config.js:4-16`）与持久化（`storage.js`）新增：

```js
CONFIG.INTRUSION_MODE = 'auto';  // 'auto' | 'gentle' | 'aggressive'
CONFIG.POLITE_MODE     = false;  // 抗检测：toString 伪装 + 行为级还原检测
```

- `INTRUSION_MODE`：
  - `aggressive`（默认现状，显式锁定）：始终包装原型。
  - `gentle`：仅实例/事件级，绝不碰原型（用户已知超星会偶发漏拦）。
  - `auto`（默认）：运行时探测是否超星上下文（复用 `site/site-router.js` 的站点识别 / `FLAGS` 特征），超星→激进；其余→温和。
- `POLITE_MODE`：叠加在上面的接管实现之上，决定是否对 `pause`/`playbackRate` 做 `toString` 伪装与行为级还原检测。

持久化：在 `savePanelCfg` / `loadPanelCfg`（`storage.js:13-48`）补两字段；`clampCfg`（`storage.js:4-12`）无需夹值（枚举/布尔）。系统页新增两个 checkbox（参照 `panel-template.js:118-120` 的 `SINGLE_VIDEO`/`NINJA` 行）。

### 3.2 温和模式实现（分层接管策略）

抽出一个统一入口 `enforcePauseGuard(v, mode)` 替代 `installPrototypePauseNeutralize` 的「无条件原型」语义：

1. **gentle / auto(非超星)** 路径 —— 实例 own-property 遮蔽：
   - 对 `v` 执行 `Object.defineProperty(v,'pause',{value: ownProtoPause, configurable:true, writable:true})`，`ownProtoPause` 读取 `this.__cxForcePaused` 决定是否 no-op（逻辑同现状 `config.js:85-88`，但挂在实例而非原型）。
   - 同时保留 `playbackRate` 的实例级 `ratechange` 回拉（`applyUserRateAll` 已全量施加，无需改原型）。
   - `scanVideos` 每轮已对全部实例打标，覆盖窗口由 `RESCAN_INTERVAL` + MO 即时回调兜底；温和模式文档明确「超星可能偶发漏拦」。
2. **aggressive / auto(超星)** 路径 —— 维持现状原型中性化。
3. **回退开关**：`INTRUSION_MODE` 运行期变更时，需调用 `cleanupListeners` 对应项还原原型（见 `lifecycle.js:62-75`），再用新模式重装；避免两种中性化并存。

> 注意：温和模式**不**改变 `cleanupListeners` 的还原清单——它只在「未装原型」时跳过 ① ②，其余 ③~⑪ 不变。审计面里 `prototype.pause` / `prototype.playbackRate` 两项在温和模式下自然显示「绿○未侵入」，正是我们想让用户看见的差异。

### 3.3 礼貌模式实现（抗检测）

关键技巧：**把标记字面量从函数体迁到闭包变量，使 `pause.toString()` 不含标记**。

```js
// config.js 顶部新增闭包变量（函数体之外，toString 不暴露）
var _CX_FP = '__cxForcePaused';   // 搬运自 config.js:45，仅作「原型体内部」引用源
// 中性化函数体改为 this[_CX_FP]，而非 'this.__cxForcePaused' 字面量：
function protoPause() {
  try { if (this && this[_CX_FP]) return; } catch (e) { swallow(e); }
  return NATIVE_PAUSE.apply(this, arguments);
}
```

- `protoPause.toString()` 现在显示 `function protoPause(){...this[_CX_FP]...}`，**不含 `__cxForcePaused` 字面量** → 平台字串扫描失效。
- **还原检测改为行为探测**（替代 `containsMarker`）：
  - 在 `dom.js` 维持一个「哨兵视频」探针（或用任一已标 `__cxForcePaused` 的视频）：在 `main-loop.js` 的 `_loopTimer` 周期内，主动 `sentinel.pause()` 一次，下一微任务检查 `sentinel.paused` 是否仍为 `false`；若被真正暂停，说明中性化已失 → 触发重装 + toast 报警。
  - `chaoxing-tamper-guard.user.js` 在检测到 `CONFIG.POLITE_MODE`（经 `window.__CX_FORCE_PLAY` 暴露）时，从「字串扫描」切换到「行为探测」同一逻辑，避免误报。
- **审计协同**：`_cxAuditProtoPause`（`diagnostics.js:63-64`）的 `indexOf('__cxForcePaused')` 在礼貌模式下必然为 `false`，需改为行为探测结果（复用上面的哨兵状态，存到 `window.__CX_FORCE_PLAY._pauseNeutralized`）作为 `on` 判据，否则审计会撒谎。

> 取舍：礼貌模式牺牲「可被字串静态识别」这一副能力（自有 tamper-guard 改行为探测），换取平台反篡改扫描的规避。默认 `POLITE_MODE=false`，不影响现状。

### 3.4 与 #10 安全审计的协同

| 审计项 | 温和模式 | 礼貌模式 |
|---|---|---|
| `prototype.pause` 包装 | gentle 下绿○（未侵入） | 黄● 但来源特征伪装（审计改用 `_pauseNeutralized` 行为标志） |
| `prototype.playbackRate` 同上 | 同上 | 同上 |
| `window` 符号 / DOM / mediaSession / 卸载钩子 | 不变 | 不变 |

审计面板（`panel-template.js:124-132`）图例已说明「绿○=未侵入/已还原」，温和模式天然契合；礼貌模式只需审计判据从「字串」切「行为」。

---

## 4. 回归风险与测试策略

风险点：
1. 温和模式在超星偶发漏拦（已知、可接受，文档明示）。
2. 礼貌模式若行为探测误判（探针被合法暂停），会误报/误重装 → 需去抖（参考 tamper-guard 的 `alarmed` 去抖）。
3. 运行期切换 `INTRUSION_MODE` 时原型残留 → 必须走 `cleanupListeners` 还原再重装。

新增回归（沿用 `_sim` jsdom 范式）：
- `_sim/sim-gentle.js`：验证 `gentle` 模式下 prototype.pause **未**被包装（审计 `_cxAuditProtoPause()===false`），且实例 own-property 拦截闭包 pause 生效。
- `_sim/sim-polite.js`：验证 `POLITE_MODE=true` 时 `String(prototype.pause).indexOf('__cxForcePaused')<0`，且行为探针仍判定中性化在位（`_pauseNeutralized===true`）。
- 既有 `sim-audit.js` / `sim-lifecycle.js` / `sim-mediasession.js` 不受影响（默认模式不变）。

---

## 5. MVP 分阶段落地

| 阶段 | 内容 | 验证 | 状态 |
|---|---|---|---|
| P0 | 新增 `INTRUSION_MODE` / `POLITE_MODE` 配置 + 持久化 + 系统页两个 checkbox | 手动面板开关持久化 | ✅ |
| P1 | 温和模式：`auto` 站点识别 + 实例 own-property 接管路径（超星回退激进） | `sim-gentle.js` | ✅ |
| P2 | 礼貌模式：安装时按 `POLITE_MODE` 选 `protoPause/rateSet` 版本（`toString` 不含标记字面量）+ 行为探测还原检测(`probePauseNeutralized`) | `sim-polite.js`（4/4 通过） | ✅ |
| P3 | 审计判据从「字串」切「行为」(`getPauseNeutralized`)；tamper-guard 副脚本同步切行为探测 | 审计面板 + 副脚本不再误报 | ✅ |
| P4 | `INTRUSION_MODE` 运行期切换走统一还原原语(`restorePrototypeNeutralization`,与 `cleanupListeners` ①② 同一套)→ 新模式重装 + 全量重扫刷新实例级接管 | `sim-intrusion-switch.js`(22/22) 验证双向切换无残留 + POLITE_MODE 下还原不受 `toString` 伪装影响 | ✅ |

---

## 6. 开放问题与决策点

1. **`auto` 的站点识别可靠性**：依赖 `site-router.js` 现有特征，是否覆盖全部超星域名（`.chaoxing.com` / `.edu.cn`）？需列清单回归。
2. **温和模式是否对超星直接禁用选项**：避免用户误选 `gentle` 导致漏拦却不知。建议在面板选 `gentle` 时若识别为超星，弹确认 + 提示「可能漏拦」。
   - ✅ **已落地（2026-08-05）**：`ui/panel-controls.js` 的 `bindPanelControlEvents`（`#__cxIntrusion` change）中，当 `intr.value==='gentle'` 且 `detectSite()==='chaoxing'` 时调用 `window.confirm` 弹确认框（文案含「可能偶发漏拦」）；用户取消则把 `<select>` 回退为 `CONFIG.INTRUSION_MODE` 并 toast 提示保持当前模式。非超星站点或 `detectSite` 不可用时跳过确认，零回归。该绑定已从 `panel-core.js` 的 `ensurePanel` 抽出到独立 `panel-controls.js` 以合规单文件行数红线。
3. **礼貌模式与「平台用 `Object.freeze` 锁原型」的对抗**：`toString` 伪装无法阻止平台 freeze 后重赋值；行为探测负责兜底重装，但仍依赖 `setInterval` 周期——极端情况下有短暂失效窗口，是否可接受？
4. **是否把 `MARK` 外提做成无条件（连非礼貌模式也外提）**？可统一代码路径，但会改变现状 `toString` 特征（影响现有 tamper-guard 字符串扫描基线）。建议仅礼貌模式外提，保持默认行为零回归。

---

## 7. 下一步

P0–P3 已落地（每阶段均跑通 `node --check` + 体积门禁 + `pure.test.js` + 对应 `_sim` 回归）。剩余 P4：`INTRUSION_MODE` 运行期切换走 `cleanupListeners` 还原重装（手动切换无残留 + `sim-lifecycle` 复用）。运行期切换 `POLITE_MODE` 的 `toString` 版本即时性由 `main-loop` 每轮 F-B4 重装兜底（≤ `RESCAN_INTERVAL`，注入态已验证正确；如需即时可在面板切换时主动重装）。
