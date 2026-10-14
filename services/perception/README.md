# 感知组件

核实日期：2026-10-14。该目录包含两个独立浏览器脚本和 Python 爬虫/章节清单桥，可按需要使用；配套核心用户脚本为 4.20.3，位于 [apps/userscript](../../apps/userscript/README.md)，安装产物位于 [dist](../../dist/README.md)。

| 组件 | 版本 | 作用与依赖 |
| --- | --- | --- |
| [进度面板](chaoxing-progress-panel.user.js) | 3.6 | 单独安装，注册到核心面板的副面板区；使用浏览器当前登录态读取课程/章节接口 |
| [媒体采集器](chaoxing-media-collector.user.js) | 1.2 | 单独安装，捕获当前页面及匹配 iframe 的媒体元信息，保存至脚本管理器并支持导出 |
| [cx_crawler](cx_crawler/README.md) | 2.3 | Python 读取课程/章节信息，生成本地快照；桥提供快照的 HTTP 读取接口 |

进度面板需要核心脚本的工具库注册入口，不使用 Python 桥。课程/章节读取可能受登录过期、跨域策略和平台页面变化影响；面板中的本机观看统计不等同于平台确认的进度。

媒体采集器不依赖核心脚本，不注册主控面板。当前匹配学习通 HTTPS 子域与 `file://` 页面；其他站点需自行调整其元信息。它只观察已有媒体并在本地保存记录，不主动下载媒体文件或将记录上传到桥。

Python 桥仅支持 `/ping`、`/playlist/index` 和 `/playlist/{8–12位数字课程ID}`，不会提供媒体、DeepSeek 应答或 AI 服务。核心桥客户端默认关闭；自动下一课已兼容 chapters 对象与旧数组，并服从核心桥开关和取消状态，真实章节导航仍需在平台验证。桥仅放行可信 HTTPS 来源，学校独立域名需明确配置；非回环监听必须配置 token，现有浏览器桥客户端不会自动附带 token，不能把它直接接到需要鉴权的部署。

日常安装与浏览器设置见 [使用说明](../../docs/USAGE.md)，Python 配置和数据更新见 [爬虫说明](cx_crawler/README.md)，答题接口见 [逆向接口协议](../../docs/REVERSE_API.md)。`cx_crawler/output/` 是运行数据目录，`cookies.json` 是明文登录凭证，不作为当前开发文档或公开资产整理。
