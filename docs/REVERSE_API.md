# 逆向接口协议

核实日期：2026-10-14。适用核心版本：4.20.3；协议版本：1。本接口用于接收其他程序发来的状态查询、求答或页面操作请求，与 Python 章节清单桥相互独立。

## 实现与能力

| 项目 | 浏览器接收端 | 独立 HTTP 服务 |
| --- | --- | --- |
| 实现 | [reverse-api.js](../apps/userscript/src/chaoxing-force-play/takeover/engine/reverse-api.js)，随核心脚本注入 | [server.js](../apps/userscript/reverse-api/server.js)，单独运行的 Node 进程 |
| 传输 | `window.postMessage`、`BroadcastChannel('cx_reverse_api')` | `POST /rpc` |
| 启用条件 | `QUIZ_VISION_USE_API_KEY` 开启且闭包内私有凭据存在；先等待管理器读取完成 | 环境变量 `REVERSE_API_KEY` 非空 |
| 未启用 | `SERVICE_UNAVAILABLE` | `AUTH_REQUIRED` |
| `status` | 当前脚本、站点、配置及答题快照 | 当前 HTTP 进程配置及运行时长 |
| `answer` | 调用页面的 `quizVisionAsk` | 将图片转发到配置的模型端点 |
| `submit` / `run` | 调用当前页面引擎 | 返回 `METHOD_UNAVAILABLE` |

共享协议常量与 HTTP 错误码映射在 [protocol.js](../apps/userscript/reverse-api/shared/protocol.js)。浏览器端内联了等价常量。HTTP 服务不会自动找到浏览器页面或转发 `run/submit` 给浏览器。

## 请求与响应

```json
{
  "v": 1,
  "id": "req-001",
  "method": "status",
  "params": {},
  "auth": "与接收端配置相同的密钥"
}
```

`v` 必须是数字 `1`，`method` 必须是字符串，`id` 必须已定义；建议使用唯一字符串。当前信封校验不检查 `id` 的具体类型。`params` 可省略；下列方法说明中的参数类型是调用约定。

成功和失败响应原样带回 `id`：

```json
{"v":1,"id":"req-001","ok":true,"result":{}}
```

```json
{"v":1,"id":"req-001","ok":false,"error":{"code":"AUTH_INVALID","message":"认证失败"}}
```

浏览器通过信封 `auth` 与闭包内的私有 Key 做字符串等值校验，`CONFIG.QUIZ_VISION_API_KEY` 始终为空，不能从 CONFIG 取得认证值。接口启用仅表明开关和 Key 存在；执行 `answer` 还必须通过私有 Origin 授权、端点白名单、传输协议和运行许可检查。旧格式 Key 或未授权迁移值可以满足 Key 存在条件，但不能据此向任意端点求答。

HTTP 使用环境变量中的共享密钥，并接受 `Authorization: Bearer <key>`，仅当信封未提供有效的 `auth` 值时从请求头补入；已填写错误 `auth` 不会被正确请求头覆盖。HTTP 的同一 `REVERSE_API_KEY` 也被用于上游模型请求的 Bearer 认证。这个独立进程不会读取浏览器管理器的私有凭据。

## 方法

### status

无需业务参数。浏览器返回：

```json
{
  "version": "4.20.3",
  "site": "chaoxing",
  "config": {"OCR": "endpoint", "endpoint": null, "useApiKey": true, "model": null},
  "quiz": {"handled": 0, "pendingSubmit": 0, "submitted": false}
}
```

以上为字段结构示例，值取自当前运行状态。HTTP 返回不同结构：

```json
{"role":"reverse-api-server","uptimeMs":1234,"endpointConfigured":false,"keySet":true,"model":"deepseek-chat"}
```

### answer

`params.image` 为图片 dataURL，`params.prompt` 为提示词，`params.question` 是 `prompt` 的备选字段。

浏览器分发器允许提供图片或提示文本中的至少一项；接口启用时 `quizVisionAsk` 使用 API Key 模式，构造含 `image_url` 的 OpenAI 兼容流式请求。纯文本虽然通过分发校验，仍会发送空图片地址，不能保证上游接受；调用时应提供图片。HTTP 必须提供 `image`，单独传文本返回 `PARAM_INVALID`，同样向配置的 `chat/completions` 端点发送流式请求。该入站 `answer` 方法不会根据页面 OCR/DeepSeek 网页模式切换到网页应答端。

结果为 `{text, answer}`，其中字段可能为 `null`。HTTP 从明确答案字段、答案句或纯标签序列提取 A–Z，支持多选去重；解释文字中的普通单词不作为选项，冲突或不确定结果返回 `null`。协议未携带选项数量，调用方仍需按题目的实际选项范围复核；成功信封不等同于答案正确或平台认可。

浏览器在 `reverseApiHandle` 收到 `answer` 时捕获 `quiz-vision` 上下文，在 GM 凭据等待结束、发送前及响应读取时复核原任务许可，停止后恢复不能重启旧请求。取消返回 `ANSWER_FAILED`（取消消息），并释放上下文；`status` 查询不创建该业务任务。带 Key 的浏览器上游请求使用授权 Origin、HTTPS（本地回环可 HTTP）与 `redirect:'error'`，不回显网络异常中的敏感详情。以上是浏览器实现的约束；独立 HTTP 服务的请求、超时和错误处理不自动继承 CoreState 或浏览器凭据模块。

### submit

仅浏览器可用，调用 `quizSubmitPending()`，返回 `{submitted: 数量}`。这是本次引擎提交操作的计数，不代表平台已确认提交成功。没有可提交项或引擎函数缺失时可能返回 0。

### run

仅浏览器可用，调用 `quizScanOnce()` 并立即返回：

```json
{"triggered":true,"stats":{"handled":0,"pendingSubmit":0,"submitted":false}}
```

`triggered` 表示扫描函数已被调用，`stats` 是调用后立即读取的快照；它不等待异步求答或提交完成。操作仍受引擎的总开关、自动启动、来源和提交策略等约束。当前不解析 `params.scope`，不能用它选择弹窗或指定任意页面。

## 传输边界

浏览器监听器只处理带 `method` 且 `v===1` 的消息。`postMessage` 来源须通过接收端的校验：同源、`origin='null'` 或实现允许的文件/扩展来源；跨站 Web 来源直接忽略。响应发回 `event.source` 并使用原 `event.origin`。

BroadcastChannel 通道名称为 `cx_reverse_api`，受浏览器同源及存储分区规则限制，不是任意网站之间的跨标签总线。同一通道可能有多个接收端，应以 `id` 关联响应。接收端导出的 `window.__CX_FORCE_PLAY.reverseApiHandle()` 仍进行信封和密钥校验。

`postMessage` 和 BroadcastChannel 的请求信封可被同源页面脚本观察，`auth` 使用真实 Key 时也会进入信封；私有存储不能使这种消息保密。不要将真实视觉 Key 粘贴到站点控制台、网页脚本或页面消息中。下方浏览器示例只供使用假凭据的合成夹具验证；直接调用、扩展隔离和具体管理器环境也须分别核验，本文不声明这些调用方式已经实现运行时保密。

HTTP 服务默认监听 `127.0.0.1:8787`，允许 `OPTIONS` 预检并返回 204；业务请求必须是 `POST /rpc`，其他请求返回 404。CORS 当前为 `*`，不是调用者鉴权。请求体累计字符串长度超过 `1e6` 时实现会销毁连接，并有 413 分支；调用方应同时处理断连，不能依赖每次都收到 JSON 错误。

## HTTP 启动与调用

PowerShell 从项目根目录运行；统一使用项目开发基线 Node 24.15+。独立 HTTP 服务使用原生 `fetch`，与用户脚本管理器私有存储相互独立。

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
$env:REVERSE_API_KEY = '填写实际密钥'
$env:REVERSE_API_ENDPOINT = '填写模型的 chat/completions 完整地址'
$env:REVERSE_API_MODEL = '填写该端点支持的模型名'
$env:REVERSE_API_HOST = '127.0.0.1'
$env:REVERSE_API_PORT = '8787'
node '.\apps\userscript\reverse-api\server.js'
```

另一终端查询状态（状态查询无需模型端点，但需要共享密钥）：

```powershell
$body = @{v=1; id='r1'; method='status'; auth='填写同一密钥'} | ConvertTo-Json -Compress
Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8787/rpc' -ContentType 'application/json' -Body $body
```

在合成夹具中先配置相同的假凭据，再注册响应监听；下面字符串不是生产凭据：

```javascript
window.addEventListener('message', function onResponse(e) {
  if (e.source !== window || e.origin !== window.location.origin) return;
  if (!e.data || e.data.id !== 'r1' || typeof e.data.ok !== 'boolean') return;
  console.log(e.data);
  window.removeEventListener('message', onResponse);
});
window.postMessage({v: 1, id: 'r1', method: 'status', auth: 'synthetic-fixture-key-never-real'}, window.location.origin);
```

以上查询示例不执行页面答题或提交。`answer` 会向配置的上游端点发送题目图片/文本；`run` 和 `submit` 会调用当前页面引擎。选择方法时应按所需操作发送请求。

## 错误码

| code | HTTP 映射 | 当前含义 |
| --- | --- | --- |
| `BAD_ENVELOPE` | 400 | 信封校验不通过或 HTTP JSON 无法解析 |
| `PARAM_INVALID` | 400 | 缺少求答输入；HTTP 没有图片 |
| `AUTH_REQUIRED` | 401 | HTTP 没有配置共享密钥 |
| `AUTH_INVALID` | 401 | 请求密钥不匹配 |
| `METHOD_UNKNOWN` | 404 | 未实现的方法或非 `/rpc` 业务路径 |
| `METHOD_UNAVAILABLE` | 501 | HTTP 收到 `run` 或 `submit` |
| `NO_ENDPOINT` | 409 | 端点缺失；浏览器还可能因端点白名单校验失败返回此码 |
| `ANSWER_FAILED` | 502 | 引擎/模型求答失败 |
| `SUBMIT_FAILED` | 502 | 浏览器提交函数抛出异常 |
| `SERVICE_UNAVAILABLE` | 503 | 浏览器接口未启用或执行引擎不可用 |
| `INTERNAL` | 500 | 内部异常 |
| `RATE_LIMITED` | 429 | 已定义的预留码，当前接口未实现限流 |

浏览器传输没有 HTTP 状态码；使用 `ok` 和 `error.code` 判断。服务默认使用本机地址，配置密钥不应写进版本库、日志或共享示例文件。

当前源码核对与验证状态见 [4.20.3 发布记录](releases/4.20.3.md)及 [安全与隐私](../SECURITY.md)。本地合成验证不能代替真实管理器、平台或独立服务上游验收。
