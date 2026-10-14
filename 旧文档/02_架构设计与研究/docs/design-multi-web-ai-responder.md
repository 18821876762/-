# 多网页端免费多模态 AI 答题应答端（元宝 / 千问 / Kimi）—— 可行性评估与设计方案

> 缘起：长远计划——让"做题"能调用所有**网页端免费、具备视觉多模态能力**的 AI（腾讯元宝、阿里通义千问、Kimi 等），把它们都变成 AI 答题后端，形成一个可切换/轮询的"工具大杂烩"。
> 日期：2026-08-14
> 结论：**可行性高**，建议分阶段落地，不要一次性全做。

---

## 0. 结论速览

| 维度 | 评估 |
|---|---|
| 技术可行性 | **高**——现有 DeepSeek 网页版 adapter 已证明整条链路跑得通（截图→注入图片→发送→流式轮询→跨源回传答案） |
| 架构契合度 | **高**——只要把"单例 DeepSeek responder"升级为"可注册 registry"，三站与 DeepSeek 完全同构 |
| 工作量 | 中等偏高：基础设施（纯重构，低风险）约 1 天；每站 adapter 校准 + 风控实测约 0.5–1 天（风控可能无限延长，需设"不可行即弃"阈值） |
| 主要风险 | ① 各站需登录；② 腾讯/阿里风控较强，脚本化 paste/click 可能被标记（**最大不确定性**）；③ 流式"生成中"判定；④ 免费额度限流；⑤ 题目截图发往第三方（知情同意） |
| 建议 | 先启动 P0 基础设施（零行为风险），再按 **元宝 → Kimi → 千问** 顺序逐个真实站点校准，每站设风控可行性闸门，**不写死"三站必全上"** |

---

## 1. 现状：可直接复用的资产

- **视觉识别层** `takeover/engine/quiz-vision.js`
  - 题目节点截图（html2canvas）→ 三种后端：① 本地 Tesseract OCR；② `endpoint` 模式 POST 多模态 AI 端点；③ **DeepSeek 网页版** `quizAskDeepSeek(dataUrl, [], VISION_PROMPT)`。
  - 关键前提：超星等题干在 DOM 中是混淆假字，只有截图才是真实题目，故一律只发截图 + 视觉提示词，**绝不附 DOM 文本**。
- **应答端驱动** `takeover/engine/vision-deepseek-web.js`（**这就是每个网页 AI 的 adapter 范本**）
  - `DEEPSEEK` 配置对象：`{ host, loginBtnSel, inputSel, fileInputSel, sendBtnSel, msgListSel, lastReplySel, generatingSel }` —— **adapter 契约**。
  - `_dsRespond(m, done)`：注入题目图 → 点发送 → 轮询末条回复 → 生成中判定 → 回传 `ds-answer`。
  - `_dsIsLoggedIn()`：登录态探测（未登录 / 未知 → 不作答，面板显"不可用"）。
  - **跨源通道**：GM 存储中继 `_postChannel` / `_onChannel`（`remote=true` 跨标签页/跨源）。因课程页（chaoxing.com）与 AI 页（chat.deepseek.com）不同源，BroadcastChannel 失效，GM 存储中继是既定解法——元宝(yuanbao.qq.com) / 千问(tongyi.aliyun.com) / Kimi(kimi.moonshot.cn) 同样跨源，**此机制直接复用，零改动**。
  - **并发护栏**：`_dsResponding` + 单槽队列 + `reqId` 去重（消除"重复上传"）。
  - 图片注入：经 `input[type=file]` + `DataTransfer`/`File` 程序化注入（由 dataURL 构造 `File`）。
- **站点路由** `takeover/foundation/site/site-router.js`
  - `detectSite()` 已把 `chat.deepseek.com` → `'deepseek'`；`SITES` 映射 + `SITE_TICKS` 注册表是新增站点的标准扩展点。
- **面板** `presentation/panel-ds-console.js`：已为 DeepSeek 特化"应答端控制台"（连接状态 / 开关 / 最近 ask / 最近 answer）。

---

## 2. 目标架构：单例 responder → 可注册 registry

```
quiz-vision.js
  └─ quizAskWebAI(provider, dataUrl, prompt)        // 新增统一派发入口
        ├─ responder-deepseek.js   (由 vision-deepseek-web.js 抽接口，契约对齐)
        ├─ responder-yuanbao.js    (新 adapter：host/selector 配置 + respond()/isLoggedIn())
        ├─ responder-qianwen.js    (新)
        └─ responder-kimi.js       (新)

ResponderChannel   // 由现有 _postChannel/_onChannel 抽出的通用跨源通道，带 provider 字段
RESPONDERS = { deepseek, yuanbao, qianwen, kimi }   // 注册表
```

- **Adapter 契约**（对齐现有 `DEEPSEEK` 对象）：
  ```js
  {
    host, loginBtnSel, inputSel, fileInputSel, sendBtnSel,
    msgListSel, lastReplySel, generatingSel,
    respond: function (m, done) { /* 注入图片+prompt → 发送 → 轮询 → done(answer) */ },
    isLoggedIn: function () { /* 返回 true / false / undefined */ }
  }
  ```
- **统一跨源通道**：抽 `ResponderChannel`（复用现有 GM 存储中继），每个 adapter 订阅 `ask`、回发 `answer`，带 `provider` 字段区分来源。
- **注册表 + 路由**：`RESPONDERS` 映射；`detectSite()` 识别各 host；`SITES` 增加三站配置（无视频容器，`taskContainerSel` 留空，同 `deepseek` 处理）。
- **派发**：`quiz-vision.js` 读 `localStorage.cx_web_ai_provider`（默认 `deepseek`）决定用哪个 adapter；或进入"轮询 / 共识"模式（见 §4）。

---

## 3. 各 AI 可行性细分

| AI | 网页域 | 多模态上传 | 登录方式 | 风控难度 | 备注 |
|---|---|---|---|---|---|
| 元宝（腾讯） | yuanbao.qq.com | ✅ 附件/图片 | 微信 / QQ 扫码 | **高**（腾讯风控强） | 需真实页校准选择器；**建议作为第一个落地站**以尽早验证风控 |
| 千问（阿里通义） | tongyi.aliyun.com / qianwen.aliyun.com | ✅ | 淘宝 / 支付宝 | 中高 | 校准成本中等 |
| Kimi（月之暗面） | kimi.moonshot.cn | ✅ | 手机号 | 中 | 界面简洁，校准成本低，**建议作第二个落地站** |
| DeepSeek（基线） | chat.deepseek.com | ✅ | 手机号 | 中 | 已有，作对照基线 |

共性：均支持"聊天框粘贴/上传图片 + 流式回复"，与 DeepSeek 同构 → **adapter 模式完全成立**。差异仅在 DOM 选择器、登录检测、风控强度。

---

## 4. "工具大杂烩"模式（轮询 / 共识）

- **单选**：面板下拉选当前 AI（默认 DeepSeek，用户可切元宝 / 千问 / Kimi）。
- **轮询（round-robin）**：每题换一个 AI，分摊免费额度、降低单站风控触发率。
- **共识（consensus）**：同题并发问 N 个 AI，多数投票取答案（提升准确率，但延迟 ×N、消耗 ×N）。
- **降级**：某站限流 / 不可用 → 自动切到下一个可用 AI（consensus 模式尤其需要）。
- 持久化：选择存 `localStorage.cx_web_ai_mode` / `cx_web_ai_provider`。

---

## 5. 关键实现要点 / 风险与缓解

1. **登录态**：每个 adapter 必须实现 `isLoggedIn()`；未登录 → 面板显"不可用"、不作答（复用 DeepSeek 的 `not-logged-in` 短路）。
2. **跨源通信**：直接复用 GM 存储中继（`_postChannel` / `_onChannel` + `remote=true`），无需改 BroadcastChannel。
3. **图片注入**：复用 DeepSeek 的 `input[type=file]` + `DataTransfer`/`File` 程序化注入（dataURL → `File`）；若某站只支持 paste，用 `ClipboardItem` + `dispatchEvent('paste')` 兜底。
4. **流式"生成中"判定**：各站 `generatingSel` 不同，采用 DeepSeek 同款"文本兜底"（匹配 思考中 / 生成中 / Thinking / Generating + loading / spinner 类） + **回复长度单调不增超时兜底**（避免某站无生成中信号导致轮询卡死）。
5. **风控 / 反自动化**：腾讯 / 阿里风控较强，脚本化 paste / click 可能被标记。**最大不确定性**。缓解：① 用真实 DOM 事件（`dispatchEvent` 而非直接设值）；② 加随机微延迟（如 200–600ms）；③ 轮询模式降低单站频率。**必须在真实站点实测验证，设"不可行即弃"阈值**。
6. **免费额度 / 限流**：轮询模式天然分摊；单站限流时自动降级到下一个可用 AI。
7. **隐私**：题目截图发往第三方 AI（用户主动选择，知情同意）。保留现有 `QUIZ_VISION_ENDPOINT_ALLOW` 白名单思路，web-AI 模式在面板显著提示"题目图将发送至所选 AI"。

---

## 6. 分阶段落地建议

- **P0 基础设施（纯重构，零行为风险）**
  - 抽 `ResponderChannel` + adapter 契约 + `RESPONDERS` registry + `quizAskWebAI` 派发入口 + 面板 provider 单选 UI。
  - `detectSite` / `SITES` 加三站（先用 best-effort 选择器，暂不真正驱动）。
  - 让 **deepseek 走新 registry** 验证无回归；新增 `sim-responder-registry.js` 断言：派发 / `reqId` 去重 / 未登录短路 / 未知 provider 降级。
- **P1 元宝**：DevTools 校准 yuanbao 选择器 + 风控实测；若风控不可破，记录并转备选。
- **P2 Kimi**：校准（成本低，优先于千问）。
- **P3 千问**：校准。
- **P4 大杂烩 UI**：轮询 / 共识模式 + 降级策略。

---

## 7. 工作量估计

- 基础设施（抽 registry / 契约 / UI）：~1 天，低风险（纯重构，sim 守护）。
- 每站 adapter 校准 + 风控实测：~0.5–1 天 / 站（风控实测可能无限延长，需设"不可行即弃"阈值）。
- 合计：若三站全可行，约 3–4 天；若某站风控不可破，则 1–2 天（只做可行站）。

---

## 8. 最终结论

可行性**高**，架构已就绪，核心机制（跨源通道、登录探测、流式轮询、并发护栏）均可直接复用。建议**立即启动 P0 基础设施（纯重构、零行为风险）**，再按 **元宝 → Kimi → 千问** 顺序逐个真实站点校准落地，每站设风控可行性闸门。先不写死"三站必全上"，以真实站点实测为准。
