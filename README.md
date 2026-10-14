# 网课强制续播项目

浏览器用户脚本提供续播、答题辅助和主控面板；可选 Python 感知服务提供采集与本地桥。当前本地待交付核心版本为 **4.20.3**，发布准备与验证范围见 [版本记录](docs/releases/4.20.3.md)。真实平台学习进度回写、有效成绩和提交结果须以平台确认状态为准。

主源码在 [apps/userscript/src/chaoxing-force-play](apps/userscript/src/chaoxing-force-play/)，安装产物在 [dist](dist/README.md)，源码镜像在 [exports/chaoxing-force-play](exports/chaoxing-force-play/README.md)。同一浏览器只安装一个核心变体；默认安装入口为 [latest](dist/chaoxing-force-play-latest.user.js)。

## 开发入口

准备 Node.js **24.15.0+**（本地工具链为 24.19.0）及 Python 3.10+。从项目根目录执行：

```powershell
npm ci --prefix apps/userscript
npm ci --prefix apps/userscript/_sim
npx --prefix apps/userscript/_sim playwright install chromium
python -m pip install -r services/perception/cx_crawler/requirements.txt
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -Variant open
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1
```

`-Fast` 用于开发反馈；浏览器验证使用统一测试的 `-Browser`。单文件脚本包含完整 MIT 通知，不需要 npm 运行时安装。AI/视觉与本地桥属于可选功能，启用前阅读 [使用说明](docs/USAGE.md)。

CI 构建两种变体并同步 latest，运行本地及 Python 检查；浏览器 job 下载同次构建，先核验版本、源码摘要、提交和三份产物 SHA256，再执行五个浏览器入口。CI 只上传检查产物，不自动发布。可审查的本地发布包和源码提交要求见 [贡献与发布流程](CONTRIBUTING.md)。

## 项目导航

- [目录结构与职责](docs/PROJECT_STRUCTURE.md)
- [核心状态机](docs/CORE_STATE.md)
- [当前文档索引](docs/DOC_INDEX.md)
- [文档现状与时效](docs/DOCUMENT_STATUS.md)
- [账号与数据安全](SECURITY.md)
- [Python 感知服务](services/perception/cx_crawler/README.md)
- [修改记录](docs/CHANGELOG.md)
- [历史文档归档](旧文档/归档说明.md)

本项目自有代码使用 [MIT 许可证](LICENSE)。[风险提示](NOTICE.md)不增加许可条件；第三方依赖和外部内容范围见 [第三方说明](THIRD_PARTY_NOTICES.md)。backups 保存本机快照和临时证据，随克隆交付的脱敏验证摘要登记在 docs/releases。
