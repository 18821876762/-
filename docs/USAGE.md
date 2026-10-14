# 使用说明

核实日期：2026-10-13。核心用户脚本版本：4.20.3。本页说明当前安装、面板操作和可选本地桥；项目布局见 [目录结构](PROJECT_STRUCTURE.md)。

## 安装与日常操作

在浏览器用户脚本管理器中打开 [最新安装脚本](../dist/chaoxing-force-play-latest.user.js) 并安装。此文件对应个人版；同一浏览器只保留一个核心版本，避免同时注入个人版、公开版和 latest。分发文件说明见 [dist](../dist/README.md)。

打开脚本元信息 `@match` 覆盖的课程页面后，查看悬浮面板。**P 键只切换面板显示，不直接暂停视频**；输入框聚焦时不处理该快捷键。暂停和恢复续播使用面板按钮，或已启用的快捷键增强。

| 操作 | 当前行为 |
| --- | --- |
| 续播卡 | 调整接管、视频选择、速率、循环、停止计时与暂停后恢复 |
| 做题卡 | 调整自动答题、自动启动、答案来源和提交策略；具体操作受站点适配与引擎开关约束 |
| 工具库 | 管理已内置的自动下一课、Space/M 快捷键、篡改报警和视频结束通知 |
| 洞察/诊断 | 查看站点识别、接管状态、提示和问题信息 |

新配置的主要默认值如下；面板持久化配置可以覆盖它们。

| 配置或存储键 | 默认值 | 用途 |
| --- | --- | --- |
| `PAUSE_HOTKEY` | `p` | 显示或隐藏面板 |
| `RESCAN_INTERVAL` | 2000 ms | 全量重扫间隔 |
| `USER_RATE` | 1 | 被接管视频的播放速率 |
| `LOOP_PLAY` | false | 结束后循环播放 |
| `AUTO_STOP_MIN` | 0 | 累计观看到指定分钟后停止；0 为关闭 |
| `RESUME_AFTER_MIN` | 0 | 暂停后恢复计时；0 为保持暂停 |
| `cx_quiz_auto` | 开启 | 通用自动答题总开关，设为 `0` 关闭 |
| `cx_quiz_auto_start` | 开启 | 检测后自动开始；关闭后登记题目并等待手动开始 |
| `cx_quiz_source` | `random` | 答案来源，可在面板切换题库或 AI |
| `cx_quiz_autosubmit` | 开启 | 自动提交；设为 `0` 后挂起待确认 |
| `cx_an_on` | 关闭 | 学习通自动下一课 |
| `cxKb_on` / `cxTg_on` / `cxEndedNotify` | 开启 | 快捷键、篡改报警、结束通知 |

自动下一课优先查找页面中的题目入口和下一节入口。平台结构、任务解锁条件或弹窗变化可能影响跳转；出现验证码时，先完成人工验证，再检查面板状态。操作细节见 [内置插件](modules/decision.md)。

## 官方 API Key 与配置数据

在面板“使用官方 API Key”的专用密码框输入 Key，然后移开焦点触发保存。密码框随即清空，不回显。状态显示私有持久化是否可用及授权端点 Origin，不显示 Key；无法使用管理器私有存储时仅在当前页面会话有效，刷新后重新输入。

保存非空 Key 时，当前 API 端点的完整 Origin 与 Key 一起放入私有存储，发送时必须匹配该授权 Origin。更改公开 CONFIG 或页面白名单不授予另一 Origin；切换服务地址后重新输入并保存 Key。远程凭据请求要求 HTTPS 并拒绝重定向。

“清除 API Key”按钮或“恢复默认”清除凭据及授权绑定。旧 cx_quiz_vision_api_key 页面 localStorage 会被删除；旧格式迁移记录在重新保存前不授权发送。不要通过 CONFIG.QUIZ_VISION_API_KEY 或 localStorage 设置密钥。

普通配置可以导入、导出；导出移除凭据及嵌套凭据字段，导入包含这些字段会拒绝整份配置。提交问题报告时仅提供脱敏配置和状态；私有管理器能力仍需在真实管理器中确认。更多边界见 [账号与数据安全](../SECURITY.md)。

## 可选感知组件

| 组件 | 位置与作用 |
| --- | --- |
| 进度面板 3.6 | [独立脚本](../services/perception/chaoxing-progress-panel.user.js)，安装后注册为核心面板的副面板；通过浏览器登录态向平台发送 GET 请求 |
| 媒体采集器 1.2 | [独立脚本](../services/perception/chaoxing-media-collector.user.js)，记录已打开媒体的地址与元信息，存于脚本管理器并可导出 |
| Python 爬虫 2.3 | [cx_crawler](../services/perception/cx_crawler/README.md)，抓取本地快照并生成章节清单 |
| Python 本地桥 | 将已有章节清单通过本机 HTTP 提供给用户脚本 |

进度面板不依赖 Python 桥；其中“本机已看”来自本地统计，不等同于平台确认的学习进度。媒体采集器独立运行，不加入核心面板，也不由桥转发媒体。

基础续播可以在未启动 Python 组件时运行。桥仅提供 `/ping` 和 `/playlist/...`，不提供媒体服务、DeepSeek 应答服务或 AI 接口。逆向答题接口是另一组件，见 [协议说明](REVERSE_API.md)。

## 准备与启动 Python 桥

以下命令使用 PowerShell，均从项目根目录开始。Python 完整功能按 **3.10+** 准备；安装步骤按需执行一次，运行前在爬虫目录准备有效的 `cookies.json`，格式和配置见 [爬虫说明](../services/perception/cx_crawler/README.md)。

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
Push-Location '.\services\perception\cx_crawler'
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
# 准备 cookies.json 后生成清单；会访问学习通并更新本地 output
.\.venv\Scripts\python.exe dump.py
Pop-Location
```

另开一个 PowerShell 终端启动桥；桥在前台常驻，按 Ctrl+C 退出。

```powershell
Set-Location 'D:\gongJu\xiangmu\xiangmu-xue.xi.tong'
& '.\services\perception\cx_crawler\.venv\Scripts\python.exe' '.\services\perception\cx_crawler\bridge.py' --host 127.0.0.1 --port 7531
```

未建立虚拟环境时，可将上述解释器路径替换为已安装依赖的 `python`。`run_bridge.bat` 使用 PATH 中的 Python，未保证使用项目的虚拟环境。

```powershell
Invoke-RestMethod 'http://127.0.0.1:7531/ping'
Invoke-RestMethod 'http://127.0.0.1:7531/playlist/index'
```

`/ping` 在线不代表已有课程清单。`/playlist/{courseid}` 只接受 8–12 位数字课程 ID；文件缺失返回 404。数据位于 `services/perception/cx_crawler/output/`，生成时间见 JSON 的 `generatedAt`。

`dump.py` 默认使用完整的章节断点快照。需要刷新已完成断点中的状态时，将 `config.py` 的 `FORCE_RERUN` 设为 `True` 后重跑；完成后按需要恢复。默认 `RENDER_JOBS=False`，新抓取章节通常没有 `objectids/jobids`，已有渲染断点可能保留这些字段。

## 浏览器连接桥

核心桥客户端默认关闭。可在播放页 URL 追加 `cxbridge=7531`：原 URL 已有 `?` 时用 `&cxbridge=7531`。也可在该课程页面控制台执行后刷新：

```javascript
localStorage.removeItem('cx_bridge_off');
localStorage.setItem('cx_bridge_base', 'http://127.0.0.1:7531');
localStorage.setItem('cx_bridge_on', '1');
```

只设置 `cx_bridge_base` 不会开启桥。`cx_bridge_off=1` 优先关闭核心桥；URL 指定地址优先于本地保存地址。核心客户端仅接受本机回环地址，失败时尝试端口 `[7531,7532,7533,8543,9090]`。成功获取并校验清单后，核心可使用当前章节完成态和 `objectids`；清单异常或不可达时忽略该增强。

核心桥的同源帧共享请求协调，各帧仍消费自己的章节状态。停止、关闭、卸载或页面身份变化会取消旧消费者，迟到响应不再改写状态；跨域帧分别管理。

自动下一课默认关闭。开启插件且核心桥配置允许后，插件使用核心桥地址规则和回环端口 `[7531,7532,7533,8543,9090]` 探测；关闭插件时不探测。它兼容 `dump.py` 返回的 `{chapters:[...]}` 和旧数组清单，桥不可达时使用 DOM 跳转。待提交、待复核或 AI 求解未结算时保持等待；关闭、停机或卸载会取消旧导航。当前运行状态与取消规则见 [核心状态机](CORE_STATE.md)。

桥启用 token 后，核心与自动下一课当前不会自动发送鉴权参数，不能直接沿用上述连接流程。鉴权配置及完整优先级见 [爬虫桥配置](../services/perception/cx_crawler/README.md)。

## 排查问题

| 现象 | 检查方法 |
| --- | --- |
| 脚本未显示 | 检查管理器是否启用、页面是否匹配 `@match`，以及是否同时安装多个核心版本 |
| 按 P 没反应 | 先移出输入框焦点，再检查 `PAUSE_HOTKEY`；暂停视频请用面板按钮 |
| 视频未续播 | 查看总开关、课程关闭名单、逐视频开关、用户暂停/计时状态、验证停机与已完成章判定 |
| 自动下一课未跳转 | 检查工具库开关、页面是否有可点击入口及课程是否已解锁；桥当前不保证精确跳章 |
| 桥返回 404 | 区分路由/课程 ID 不合规则、清单文件缺失；先检查 `/playlist/index` |
| 桥返回 401 | 已启用 token；检查客户端是否发送对应鉴权 |
| 桥在浏览器连接失败 | 分别测试 `/ping`、清单接口与浏览器控制台；检查端口、CSP、浏览器本地网络权限及请求拦截 |
| 数据不是最新 | 检查 `generatedAt` 与断点策略，必要时启用 `FORCE_RERUN`；桥逐次读文件，通常无需重启 |
| 进度面板获取失败 | 检查浏览器登录态、平台接口、跨域限制；Python 桥在线不代表该面板接口可用 |

需要 Python 详细日志时，在运行 `dump.py` 前执行 `$env:CX_DEBUG='1'`；结束后用 `Remove-Item Env:CX_DEBUG` 恢复。核心调试开关可从面板调整；自动下一课使用自己的日志配置。

`cookies.json` 含明文登录凭证；本地采集数据也可能包含课程和媒体信息。它们属于运行数据，应保留在本机并避免提交、分享。是否真正完成平台任务，以平台页面和服务端状态为准。

## 开发验证与许可

开发使用 Node.js 24.15.0+、npm ci 安装应用与 _sim 的锁定依赖；Playwright 场景还需安装 Chromium。命令、发布预检与本地打包见 [贡献说明](../CONTRIBUTING.md)。源码采用 [MIT](../LICENSE)，每份独立用户脚本带完整版权与许可通知。[风险提示](../NOTICE.md)不增加 MIT 授权条件。当前版本检查范围与线上未验证项见 [4.20.3 记录](releases/4.20.3.md)。
