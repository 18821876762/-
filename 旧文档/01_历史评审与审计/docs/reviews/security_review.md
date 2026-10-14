# 工作空间代码安全性检测报告

生成时间：2026-07-31
检测范围：`perception/cx_crawler/`（Python 爬虫 + 本地桥服务）、5 个浏览器用户脚本（`*.user.js`）、相关配置与文档
检测方式：静态代码审查 + 敏感模式扫描（`eval/exec/subprocess/shell=True/pickle/verify=False/innerHTML/document.write` 等）

---

## 1. 高危（Critical）

### C1. 明文真实会话凭据存储于 `perception/cx_crawler/cookies.json` ⚠️ 必须立即处理

`perception/cx_crawler/cookies.json` 中包含**真实有效的学习通登录会话**，可直接用于账号冒用（account takeover）：

- `UID` = `099000003`（账号标识）
- `p_auth_token` = 完整 JWT（`uid=099000003`，`exp≈2026-08-07`），是登录态核心凭证
- `xxtenc`、`vc3`、`uf`、`cx_p_token`、`_d`、`jrose`、`rose`、`route`、`k8s` 等会话/路由/反爬校验票据

任何能读取到该文件的人，都能以你的身份调用学习通接口（查看/操作你的课程数据）。风险点：

1. **未纳入 `.gitignore`**：当前根目录 `.gitignore` 未排除 `cookies.json`。一旦 `git add` 提交，凭据将永久进入版本历史，即使后续删除也无法彻底抹除（需 `git filter-repo` 清理历史）。
2. **明文落盘 + 自动回写**：`session.py:save_cookies()` 会在运行后把刷新后的 cookie 写回 `cookies.json`；`session.py:_restrict_file_perms()` 在 Windows 下 `os.chmod(0o600)` 几乎无效（仅设置只读位），共享机器上其他本地用户仍可读取。
3. 仓库内同时存在 `cookies.example.json`（占位模板，值为 `123456`/`abc`），进一步说明 `cookies.json` 是真实凭据而非示例。

**修复建议（按优先级）：**
- 立即作废当前凭据：修改学习通密码 / 退出全部设备登录，使泄露的 `p_auth_token`/`vc3` 等失效。
- 删除工作区中的 `cookies.json`，并加入 `.gitignore`（追加 `cookies.json`）。
- 改用环境变量或专用密钥存储承载凭据，避免在磁盘明文保存。
- 若此前已提交到 git，必须用 `git filter-repo`/`BFG` 从历史中彻底清除，并作废凭据。

---

## 2. 中危（Medium）

### M1. 本地桥服务 `bridge.py` 的 CORS `*` 与可绑定 `0.0.0.0` 的信任边界问题

`bridge.py` 设计上仅监听 `127.0.0.1`，但存在两点需关注：

1. **`Access-Control-Allow-Origin: *`**（`bridge.py:52`、`bridge.py:93`）。当通过文档中明示的 `python bridge.py --host 0.0.0.0` 绑定到局域网时，配合 `*` 的 CORS，浏览器在访问任意网站时该站点可经用户浏览器向 `http://<本机IP>:7531` 发起请求（虽受同源端口固定限制，但存在 DNS 重绑定类放大风险）。
2. **信任本地桥返回数据**：`force-play` / `auto-next` 直接 `fetch` 桥接口并用其返回的 playlist JSON 决定章节跳转与点击行为。若本机存在恶意进程占用该端口，或发生 DNS 重绑定，攻击者可注入伪造 playlist，影响脚本的点击/跳转逻辑（影响范围基本限于学习通站内导航，危害有限，但属于信任边界缺陷）。

**修复建议：**
- 默认值保持 `127.0.0.1`，对 `--host 0.0.0.0` 显式告警。
- CORS 收紧为学习通源（`https://*.chaoxing.com`）而非 `*`；或在桥上增加一次性 token 校验。
- 桥数据仅作"建议"，脚本侧对 playlist 内容做合法性校验（所属域名、章节 ID 范围）后再使用。

---

## 3. 低危（Low）

### L1. 用户脚本 `@match` 匹配域过宽（`chaoxing-force-play.user.js`）
`force-play` 的 `@match` 包含 `*.edu.cn`，会在**任意** `.edu.cn` 子域注入 `HTMLMediaElement`、`navigator.mediaSession` 等原型覆写。逻辑本身是学习通专属，但降低了脚本隔离性——恶意 `evil.edu.cn` 页面也会加载该脚本。建议收窄到具体域名（如 `*.chaoxing.com` 与已知学校域名）。

### L2. Windows 下凭据文件权限收紧无效（`session.py:_restrict_file_perms`）
`os.chmod(0o600)` 在 Windows 仅设置只读位，无法限制同机其他用户读取 `cookies.json`。多用户/公共机器上仍有泄露风险。建议：凭据放在仅当前用户可读的私有目录，且绝不提交、不在共享机留存。

### L3. `output/` 落盘含个人学习数据（`perception/cx_crawler`）
爬虫会把课程列表、章节树等 API 原始响应写入 `output/`（`SAVE_ALL_RAW=True` 时范围更大）。这些数据包含个人课程/进度信息，若被提交或分享，构成轻度 PII 泄露。代码注释称 `output/` 已 gitignore，但根 `.gitignore` 未显式列出，建议核实并补加 `perception/cx_crawler/output/`。

---

## 4. 正面发现（安全实践良好 ✅）

- **无危险函数调用**：全仓库扫描未发现 `eval` / `exec` / `subprocess` / `os.system` / `shell=True` / `pickle` / `yaml.load` / `verify=False` / `document.write` / `new Function` 等高危模式。
- **XSS 防护到位**：`chaoxing-progress-panel.user.js` 对服务端返回的课程名、章节名等动态内容统一走 `escapeHTML`；`browser-media-collector.user.js` 用 `textContent` 构建 UI（已从旧版 `innerHTML` 改造）；`force-play` 的面板为静态模板，未插值外部数据。
- **桥路径穿越防护**：`bridge.py:_send_file` 用正则 `^\d{1,12}$` 校验文件名，并做 `os.path.abspath` 相等性二次校验，杜绝 `../` 穿越读取 `cookies.json` 等敏感文件。
- **运行时健壮性**：`config.py` 提供 `throttle()` 限速、`with_retry()` 指数退避（仅 5xx 重试）、`atomic_write_*` 原子写、`RunLock` 跨进程锁、结构化日志 + `trace_id`。
- **只读姿态明确**：所有爬虫请求均为 GET/只读型 POST，注释明确"绝不用于提交/修改平台状态"；桥服务白名单路由且永不暴露 `cookies.json`。

---

## 5. 合规与使用风险说明（非代码漏洞，但需知悉）

- `chaoxing-deceive-api.user.js` 通过覆写 `Document.prototype.visibilityState`/`hidden`/`hasFocus` 与 `IntersectionObserver` 来伪装"页面可见/获焦"，用于**绕过平台防挂机检测**；`force-play` 强制视频倍速/禁止暂停、`auto-next` 自动跳章。**这类脚本可能违反学习通/超星的用户协议与所在机构的学术诚信规定**，存在账号被封禁或违纪处理的风险。
- `deceive-api` 自身代码注释也承认该伪装属于**强攻击特征**，平台侧有检测手段。请自行评估使用后果与合规性。

---

## 6. 处置优先级清单

| 等级 | 项 | 立即动作 |
|------|----|----------|
| Critical | C1 明文凭据 | 改密/踢设备作废 `cookies.json`；删除文件；加入 `.gitignore`；勿提交 |
| Medium | M1 桥 CORS/绑定 | 默认保持 127.0.0.1；收紧 CORS；校验 playlist |
| Low | L1 匹配域 | 收窄 `@match` |
| Low | L2 权限 | 私有目录存放凭据；不在共享机留存 |
| Low | L3 落盘 | gitignore `perception/cx_crawler/output/` |

> 注：报告未列出真实令牌值，仅以字段名与过期时间说明泄露面，防止二次扩散。

---

## 7. 处置状态更新（2026-08-12）

| 等级 | 项 | 状态 | 说明 |
|------|----|------|------|
| Critical | C1 明文凭据 | ✅ 已消除 | `cookies.json` 未落盘、未纳入 git、从未进入版本历史（仅 `cookies.example.json` 模板受控）；原令牌 `exp≈2026-08-07` 已过（当前 2026-08-12）。`.gitignore` 已排除 `cookies.json` 与 `perception/cx_crawler/output/`。如曾外泄，仍建议改密/踢设备作废。 |
| Medium | M1 桥 CORS/绑定 | ✅ 已加固 | `bridge.py` 已：CORS 反射请求方 Origin（非 `*`）、`--host 0.0.0.0` 显式告警、支持 `--auth-token` 鉴权（Bearer / `?token=`）。**脚本侧补强**：`bridge.js` 新增 `validateBridgePlaylist()`，对桥清单做结构/同域校验（knowledgeId 纯数字、字段类型、拒绝非超星域绝对 URL 注入），非法则静默忽略桥数据（M1 信任边界闭环）。 |
| Low | L1 匹配域 | ✅ 已收窄 | `@match` 保留 `*.edu.cn` 以覆盖高校自建超星镜像；但非超星特征 edu.cn 现已回落安全基线 `edu` 并**完全惰性**（main-loop 三处接管入口短路），消除"任意 edu.cn 误接管"副作用。 |
| Low | L2 权限 | ⚠️ 残余（低风险） | `session.py:_restrict_file_perms` 在 Windows 仍仅 `os.chmod(0o600)`（基本无效）。因凭据未落盘 + 已 gitignore，实际泄露面极低；如需强化可改用 `icacls` 仅授当前用户。 |
| Low | L3 落盘 | ✅ 已修复 | `perception/cx_crawler/output/` 已加入 `.gitignore`。 |

**净结论**：原报告的 1 Critical + 1 Medium + 3 Low 中，C1/L3/L1/M1 已实质处置；L2 残余但风险极低（凭据不存在、不入库）。另：全仓仍无 `eval/exec/subprocess/shell=True/pickle/verify=False/innerHTML/new Function` 等高危模式（除桥为可选只读组件、且已加 token 鉴权），XSS 防护（escapeHTML / textContent / 静态面板模板）维持到位。

---

## 7.1 跨上下文消息与监听加固（P2 / P3 / P4，2026-08-14）

在 L1 之外，本轮进一步对「跨上下文通信」做纵深防御（源于审计建议加固项 P1–P4；P1 即 L1 的 edu 接管子集，见下）。三项均已落地并经测试无回归：

| 加固项 | 位置 | 状态 | 说明 |
|--------|------|------|------|
| P2 · DS 跨上下文消息类型白名单 | `takeover/engine/vision-deepseek-web.js` `_emitChannel` | ✅ 已落地 | 入站消息须声明已知 `type`（`ds-state`/`ds-ping`/`ds-ask`/`ds-answer`），否则静默 `return`；杜绝同源任意页 / GM 存储变更伪造消息驱动应答端行为。 |
| P3 · `message` 监听 origin 校验 | `takeover/foundation/state/state.js` 顶层 `message` 监听 | ✅ 已落地 | 仅接受 `e.origin === window.location.origin` 的同源消息，拒绝任意跨源页注入 `ui:toast` 轻提示。 |
| P4 · 重试链终端 `.catch` | `takeover/engine/vision-deepseek-web.js` `quizAskDeepSeek` | ✅ 已落地 | 重试链末端显式 `.catch` 声明「拒绝上抛」契约，防止未来调用方遗漏返回值时产生未处理 rejection（调用方 `quiz.js`/`quiz-vision.js` 已 `.catch`，此为一致性兜底）。 |

### P1 处置决定（2026-08-14 追查结论）
P1 即 L1「`@match` 过宽」中的「edu.cn 视频接管」子集。经核查：
- `.edu.cn` 视频接管受**回归 #1 硬性约束**（「edu.cn 视为 chaoxing 须接管视频」）；`SITES.edu` 已满足 L1 收窄（空附件键、不钩超星私有全局、非超星特征 edu.cn 回落安全基线 `edu` 并完全惰性）。
- 故 **P1 不应改动运行时接管行为**（「完全不接管」会破坏该回归）；其唯一安全缓解是**收窄 `@match` 域名清单**。
- 收窄需用户提供实际使用的学校镜像域名（如 `mooc.xxx.edu.cn`），否则臆测枚举会误伤真实超星镜像。当前 `@match` 维持 `*.edu.cn` + 惰性基线，副作用已收敛。

**验证（无回归）**：构建产物 `chaoxing-force-play.user.js` 已重建并含 P2/P3 加固代码（L3093 `DS_MSG_TYPES`、L204 `e.origin` 校验）；`_sim` 全量 **57/57 通过、0 失败**；`verify_fixes.js` **0 失败**；`node --check` 通过；改动文件 lint 0 诊断。
