# cx_crawler：章节快照与本地桥

核实日期：2026-10-13。Python 组件版本 2.3，对接核心用户脚本 4.20.3。爬虫以 GET 请求读取课程、章节和可解析的任务点信息；本地桥读取已有 `output/playlist_*.json`，不自行抓取或刷新平台数据。

该组件是可选增强。桥只提供健康检查和章节清单，不提供媒体转发、DeepSeek 应答或 AI 服务。核心客户端可使用已校验的当前章完成态及任务点标识；自动下一课兼容爬虫输出的 `{chapters:[...]}` 对象和旧数组清单。客户端需启用桥配置与自动下一课插件，且桥中已有对应 playlist；桥不可用时仍可尝试 DOM 跳转。

## 文件职责

| 文件 | 职责 |
| --- | --- |
| [dump.py](dump.py) | 校验会话、读取课程/章节、可选渲染并生成快照与 playlist |
| [bridge.py](bridge.py) | 可信来源、可选 Bearer 鉴权及白名单 HTTP 路由，按请求读取 playlist 文件 |
| [config.py](config.py) | 地址、白名单、断点策略、渲染开关、输出目录、限速与运行辅助 |
| [session.py](session.py) / [api_client.py](api_client.py) | Cookie、登录态、GET 请求、超时及重试 |
| [courses.py](courses.py) / [chapters.py](chapters.py) | 课程和章节树解析 |
| [render.py](render.py) | 可选 Playwright 渲染，补充 jobid/objectid 和类型 |
| [quizzes.py](quizzes.py) / [heartbeat.py](heartbeat.py) | 可取得的作业内容与心跳参数分析 |
| [run_bridge.bat](run_bridge.bat) | 切换到本目录，调用 PATH 中的 Python 启动桥 |
| [requirements.txt](requirements.txt) | 依赖版本区间，包含 requests 和 Playwright |
| [tests](tests/) | 本地单元测试 |

## 准备与运行

使用 **Python 3.10+**；可选渲染代码含 `str | None` 类型标注。以下为 PowerShell 命令，从项目根目录开始，安装按需执行一次。

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
Push-Location '.\services\perception\cx_crawler'
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item -LiteralPath 'cookies.example.json' -Destination 'cookies.json'
# 编辑 cookies.json，填写本人有效会话后运行
.\.venv\Scripts\python.exe dump.py
Pop-Location
```

已有 `cookies.json` 时跳过复制样例。支持 JSON 键值对象、`[{name,value,domain}]` 数组，或内容为 `k=v; k=v` 的 JSON 字符串；文件使用 UTF-8。爬虫会保存更新后的 Cookie 到本地明文文件。

运行桥不依赖 requests/Playwright，也不需要 Cookie，但读取课程清单前须已有对应输出文件：

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
& '.\services\perception\cx_crawler\.venv\Scripts\python.exe' '.\services\perception\cx_crawler\bridge.py' --host 127.0.0.1 --port 7531
```

按 Ctrl+C 停止。也可双击 `run_bridge.bat`；它使用 PATH 中的解释器，同样需要 Python 3.10+。

## 抓取配置与数据更新

| 配置 | 当前行为 |
| --- | --- |
| `CX_COURSE_IDS` | 逗号分隔课程 ID，优先于同目录 `courses.json` |
| `courses.json` | 可从 [样例](courses.example.json) 复制；空白名单代表读取全部可取得课程 |
| `RENDER_JOBS` | 默认 false；启用后通过 Edge 渲染补充任务点标识 |
| `FORCE_RERUN` | 默认 false；复用带 `__status__='complete'` 且非空的章节断点 |
| `MIN_INTERVAL` | 当前 1 秒的最小请求间隔 |
| `CX_DEBUG=1` | 开启带 trace_id 的详细日志 |
| `OUTPUT_DIR` | 固定为本脚本目录下的 `output/`，不随启动工作目录变化 |

默认断点策略可以跳过以前完成的课程抓取，所以重新运行并不保证所有章节状态都是新读取。刷新断点课程时先设置 `config.py` 的 `FORCE_RERUN=True`；核对生成时间和章节状态后，再按需恢复断点策略。旧的 playlist 文件也应根据 `generatedAt` 与索引核对，不能仅以文件存在判断其仍有效。

默认不渲染的新章节通常没有 jobids/objectids，已渲染的断点可保留它们。需要渲染时先安装浏览器并开启 `RENDER_JOBS`，建议限定课程后核对输出：

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
Push-Location '.\services\perception\cx_crawler'
.\.venv\Scripts\python.exe -m playwright install msedge
Pop-Location
```

`requirements.txt` 实际包含 Playwright；运行默认不渲染流程时模块采用惰性导入。作业/任务点类型解析也可能依赖渲染结果，不能保证默认模式生成作业文件。

## 输出格式

| 文件 | 内容 |
| --- | --- |
| `01_courses_raw.json` / `01_courses_parsed.json` | 课程原始响应与解析列表 |
| `02_chapter_list_{cid}.html` | 章节树响应 |
| `03_tasks_{cid}.json` | 带完成标记的章节快照 |
| `playlist_{cid}.json` | 课程元信息及 `chapters` 数组 |
| `playlist_index.json` | `generatedAt` 和课程摘要数组 `courses` |
| `04_*.json` | 有相关任务标识时生成的作业或心跳分析结果 |
| `README.md` | 本次输出说明，属于生成数据，不是开发入口 |

课程清单字段结构示例：

```json
{
  "version": 1,
  "generatedAt": "2026-10-03 12:00:00",
  "courseid": 12345678,
  "clazzid": "示例班级ID",
  "cpi": "",
  "courseName": "示例课程",
  "chapters": [
    {"knowledgeId":"123456789","index":1,"title":"示例章节","completed":false,"unfinishedCount":1,"hasTaskPoints":true,"jobids":[],"objectids":[]}
  ]
}
```

桥逐次打开这些文件，更新成功后通常不必重启服务。JSON 解析失败返回 500，文件不存在返回 404；`/ping` 成功只说明服务在线。

## 桥路由与配置

| 路由 | 响应 |
| --- | --- |
| `GET /ping` | `{ok:true, version:'2.3', service:'cx-bridge'}` |
| `GET /playlist/index` | `playlist_index.json` 的内容 |
| `GET /playlist/{cid}` | `cid` 必须是 8–12 位数字，返回 `playlist_{cid}.json` |
| `OPTIONS` | 可信 Origin、白名单路由、请求方法 GET、可选 Authorization 请求头通过检查后返回 204 |

没有通用文件下载路由；`cookies.json`、原始输出及任意磁盘路径不在 GET 白名单中，playlist 符号链接也不能跳出输出目录。默认监听 `127.0.0.1:7531`；仅回环地址允许不配置 token，非回环监听未配置非空 token 时会在探测端口或创建服务前退出。普通使用保持回环地址。

**全部桥设置按字段取最高优先级的值：**

1. 显式 CLI：`--host`、`--port`、`--auth-token`、可重复的 `--allow-origin`。
2. `--config 文件` 中存在的字段。
3. 环境变量 `CX_BRIDGE_HOST`、`CX_BRIDGE_PORT`、`CX_BRIDGE_AUTH_TOKEN`、`CX_BRIDGE_ALLOW_ORIGINS`。
4. 同目录 `bridge_config.json`。
5. 默认值：`127.0.0.1:7531`、无 token、无额外来源。

JSON 字段为 `host`、`port`、`auth_token` 和 `allowed_origins`；环境变量的额外来源使用逗号分隔，CLI 或较高层的列表替换较低层的额外列表。HTTPS 学习通来源始终保留。默认配置也会加载 token 与来源；空白 token 视为未配置。非法配置或指定文件缺失会明确失败，避免静默回退。

可参考 [配置样例](bridge_config.example.json)。默认仅接受 `https://chaoxing.com` 及其合法子域的标准 HTTPS 来源；HTTP、非 443 端口、`null`、用户名/密码、路径、欺骗后缀和重复 Origin 均被拒绝。学校自有域名可通过明确的 `allowed_origins` 或 `--allow-origin 'https://learn.school.example'` 添加，协议和端口也须匹配，不支持 `*`。

来源检查先于鉴权及文件读取。允许的浏览器 Origin 才得到对应 `Access-Control-Allow-Origin`；不可信来源返回 403 且不含该响应头。无 Origin 的本机 CLI 可使用 GET，但不会得到 `*`；响应均带 `Vary: Origin`。OPTIONS 只放行 GET 和 Authorization 请求头，预检不读取数据，后续 GET 仍须通过鉴权。

启用 token 后，包括 `/ping` 在内的每次 GET 都须发送 `Authorization: Bearer <token>`，使用常量时间比较；错误或缺失返回 401。URL 查询参数 `token` 不再用于鉴权，避免密钥进入 URL 历史和代理日志。建议通过环境变量或私有配置传入高熵密钥，避免在命令行参数中填写。非回环连接的 HTTP 仍是明文，远程使用需要另行配置 HTTPS 传输。

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
$env:CX_BRIDGE_AUTH_TOKEN = '填写本地桥密钥'
& '.\services\perception\cx_crawler\.venv\Scripts\python.exe' '.\services\perception\cx_crawler\bridge.py' --port 7531
# 另一个终端用实际密钥验证
# Invoke-RestMethod 'http://127.0.0.1:7531/ping' -Headers @{Authorization='Bearer 填写本地桥密钥'}
```

当前核心和自动下一课客户端不会自动附带桥 token，启用鉴权后需单独解决请求头对接；默认回环无 token 模式保留现有浏览器兼容性，同时应用来源限制。核心桥默认关闭，通过 URL `cxbridge` 或 `cx_bridge_on=1` 开启；自动下一课也须开启插件并服从桥配置，两端候选端口均为 `[7531,7532,7533,8543,9090]`，见 [浏览器使用说明](../../../docs/USAGE.md)。

## 本地验证与排障

以下 71 项测试不需要真实平台登录，其中 38 项桥安全测试使用合成 playlist、临时目录和随机回环端口，不启动或停止已有服务：

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
python -B -m unittest discover -s '.\services\perception\cx_crawler\tests' -p 'test_*.py'
```

抓取失败时优先区分 Cookie 过期、课程 ID/白名单、平台返回格式和网络失败；桥无法启动时检查端口占用、配置格式及非回环鉴权设置。桥 403 时检查实际网页 Origin 是否属于默认或显式允许来源，401 时检查 Bearer 请求头，404 时检查路由、课程 ID 位数与 playlist 文件；数据陈旧时检查断点及 `generatedAt`。本地合成 HTTP 验证不代表真实平台登录态、进度回写或提交验收。

`cookies.json`、课程快照及输出可能含个人信息，避免提交或公开分享。当前流程没有作业交卷或有效进度上报操作；使用本地快照判断的平台状态仍需在页面核对。
