# 数据治理计划（统一本地数据生命周期）

> 版本目标：v4.19.30
> 范围：脚本运行时产生的**所有本地数据**（内存缓存 / GM 存储中继 / localStorage / IndexedDB / 控制台与面板状态）的统一分类、出清与周期巡检。

---

## 一、背景

v4.19.29 已实现「自动答题缓存出清系统」——仅在答题缓存（quiz.js 内 `_quizHandled` 等十几个对象）满足条件时出清。但脚本在运行期还会写入其它本地数据，散落各处、无统一视图、无统一出清入口：

- GM 存储中继键（`cx_ds_ask_v1` 含截图 base64、`cx_quiz_lights_v1` 灯镜像）—— 大值，消费后应释放，但目前仅靠 DS 页消费后置空，无统一出清。
- localStorage 统计/收藏/位置键（`cx_watch_stats` / `cx_cmd_fav` / `cx_cmd_recent` / `cx_ninja_pos` / `cx_quiet_popups`）—— 长会话缓慢累积。
- localStorage 用户配置键（CX_KEYS 全部 + 题库 `cx_quiz_bank`）—— 应**受保护**，永不被自动出清。
- IndexedDB 库 `cx_kvs` / 指纹命名空间 `cx_fp_` —— 当前无业务写入（仅底座 API），预留为治理桶。
- 面板/控制台内存状态（FAB 位置、DS_STATUS、当前 tab）—— 非持久，页面关闭即失，但跨「答题时段」也需可重置。

本计划把上述数据收敛为**统一治理注册表（DataGov）**：业务模块自注册「数据桶（bucket）」，引擎按分类统一出清。

---

## 二、数据清单与分类

| 桶 id | 分类 | 数据内容 | 出清策略 |
|---|---|---|---|
| `quiz-cache` | session | 自动答题缓存：已答去重 / 在途题解 / 失败登记 / 信号灯 / DS 宽限 / 手动置位 | 事件触发（换视频/换课/空闲）+ 命令 + 周期 |
| `relay-gm` | relay | GM 键 `cx_ds_ask_v1`(答题大图) / `cx_quiz_lights_v1`(灯镜像) | 事件/周期出清大值；**保留** `cx_ds_bridge_v1` 心跳键 |
| `stats-ls` | stats | localStorage `cx_watch_stats`/`cx_cmd_fav`/`cx_cmd_recent`/`cx_ninja_pos`/`cx_quiet_popups` | 周期巡检（默认禁用）+ 命令 |
| `config-ls` | config | localStorage 全部 `cx_*` 配置 + 题库 `cx_quiz_bank` | **受保护**：永不自动出清（由 `/cleardata` 显式处理） |
| `kvs-idb` | indexeddb | IndexedDB 库 `cx_kvs` | 预留（当前空），命令可清 |
| `fp-ls` | fp | localStorage 指纹命名空间 `cx_fp_` | 预留（当前空），命令可清 |

分类常量：`config` / `session` / `relay` / `stats` / `indexeddb` / `fp`。

**核心原则**：`config` 类受保护，任何 `evict`/`evictAll` 都跳过；配置清零只能由现有 `/cleardata`（清全部 `cx_*`）显式执行，杜绝误删用户设置。

---

## 三、触发方式（统一收口）

| 触发 | 出清分类 | 说明 |
|---|---|---|
| 同平台下一视频开始（前台视频稳定键变化） | `session` + `relay` | 学习通/智慧树限制多开视频，换视频=换节=答题时段结束 |
| 课程/章节 URL 变化（去 hash） | `session` + `relay` | 换课/换章 |
| 答题空闲超时（`QUIZ_CACHE_EVICT_ON_IDLE_MIN`，默认禁用） | `session` + `relay` | 长空闲兜底 |
| 周期巡检（`DATA_GOV_PERIOD_MIN`，默认禁用） | `stats` + `relay` | 长会话防 localStorage 缓慢膨胀，低频 |
| 命令 `/evict`、`/evict-all` | 全部非受保护 | 手动一键出清 |
| 命令 `/evict-session` | `session` + `relay` | 仅清答题态（等价于旧 `/evict` 语义扩展） |

事件/空闲触发保留旧 `quizCacheEvict` 行为并升级为「出清 session+relay」；周期触发为新增，默认禁用（`DATA_GOV_PERIOD_MIN=0`）。

---

## 四、统一治理 API（DataGov）

```js
window.__CX_FORCE_PLAY.dataGovernance = {
  CAT,                       // 分类常量
  registerBucket(b),        // b = {id, category, desc, size(), evict(reason), protected?}
  unregister(id),
  evict(categories, reason),// categories: ['session','relay'] 或 []（全非受保护）；protected 桶恒跳过
  evictAll(reason),         // = evict([], reason)
  snapshot()                // [{id, category, desc, size, protected, lastEvict}]
};
```

每个桶 `lastEvict = {reason, ts, cleared}` 供诊断展示。

---

## 五、命令（commands.js）

| 命令 | 行为 |
|---|---|
| `/evict` | `dataGovernance.evictAll('command')` —— 出清所有非受保护桶（含答题缓存 + GM 大值 + 统计），显示总清除项数 |
| `/evict-all` | 同 `/evict` |
| `/evict-session` | `evict(['session','relay'], 'command')` —— 仅清答题态与中继 |
| `/cleardata` | 保留：清全部 `cx_*` localStorage（含 config，刷新后归零） |

---

## 六、诊断展示（diagnostics.js）

在诊断信息中新增「数据治理」行：列出桶数 + 各桶 `id:size(最近出清原因)`，并保留原「答题缓存出清」行（读 `quizStats.lastEvict` 兼容）。

---

## 七、落地文件

1. `takeover/foundation/storage/data-governance.js`（新增）：注册表 + 内置 5 桶 + 公开 API。
2. `takeover/foundation/meta-config/config.js`：新增 `DATA_GOV_PERIOD_MIN`。
3. `takeover/engine/quiz.js`：注册 `quiz-cache` session 桶（v4.19.33 起委托 `quizHardReset`——等同刷新网页的完整运行时归零；`quizCacheEvict` 保留为兼容别名入口）。
4. `takeover/bootstrap/main-loop.js`：出清评估段委托 `dataGovernance.evict`（保留 `quizCacheEvict` 回退）。
5. `presentation/commands.js`：`/evict` 升级 + 新增 `/evict-all` `/evict-session`。
6. `presentation/diagnostics.js`：治理快照行。
7. `build-manifest.txt`：登记 `data-governance.js`（storage 区，utils 之后）。
8. 契约文档重生成 + 版本 4.19.30 + CHANGELOG + 回归 `sim-data-governance.js`。

---

## 八、风险与边界

- **不破坏已有行为**：`quizCacheEvict` 保留为公开入口，main-loop 在 `dataGovernance` 不可用时回退旧逻辑；`/cleardata` 不变。
- **周期巡检默认禁用**：`DATA_GOV_PERIOD_MIN=0`，不改变现网默认行为，仅事件/命令触发。
- **受保护桶**：config 类永不自动清，避免误删用户配置导致刷新后丢失开关。
- **预留桶**：kvs/fp 当前无业务写入，注册为治理桶仅作统一视图与未来兜底。
- **GM 心跳保留**：relay 桶只清 `cx_ds_ask_v1`/`cx_quiz_lights_v1`，保留 `cx_ds_bridge_v1` 心跳（误清会断连 DS）。
