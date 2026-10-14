# 贡献、验证与发布准备

先读 [目录结构](docs/PROJECT_STRUCTURE.md)、[架构治理](docs/ARCHITECTURE_GOVERNANCE.md)、[行为契约](docs/CONTRACT.md)和 [跨模块契约](docs/CROSS_MODULE_CONTRACT.md)。

## 修改与验证

1. 编辑 apps/userscript/src/chaoxing-force-play；exports/chaoxing-force-play 是镜像，运行 scripts/sync-copy.ps1 同步。
2. 域模块登记在 apps/userscript/build-manifest.txt。保留原闭包的连续片段使用相同 @source-group，并保持清单中的连续顺序；语法和作用域检查以完整拼装产物为单位。
3. 测试样本使用合成 DOM；真实页面校准样本按 [校准流程](docs/calibration-guide.md)脱敏保存，勿提交账号、Cookie 或课程内容。
4. 状态与导出变化同步契约，运行门禁和有针对性的回归；行数治理检查独立运行。

准备 Node.js 24.15.0+，按现有锁文件安装开发依赖，不无故升级依赖范围：

```powershell
npm ci --prefix apps/userscript
npm ci --prefix apps/userscript/_sim
npx --prefix apps/userscript/_sim playwright install chromium
python -m pip install -r services/perception/cx_crawler/requirements.txt
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -Variant open
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -ExecutionPolicy Bypass -File apps/userscript/check-module-size.ps1
node --test scripts/tests/release-assets.test.cjs
powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1
```

需要浏览器回归时执行 scripts/test.ps1 -Browser；需要 Python 功能时按 [requirements.txt](services/perception/cx_crawler/requirements.txt)安装依赖。-Fast 跳过仿真和 ESLint，仅用于开发。Node/npm 使用系统安装或本地 tools/runtime/node_home 中的版本，并确保调用的是对应版本。

## CI 与发布

[CI](.github/workflows/ci.yml)在 master/main 的 push、pull_request 和手动触发时运行，使用 Node 24 与 npm ci。gate 构建 personal/open、同步 latest，检查纯函数、题解合并、本地仿真、Python、契约及模块体积；browser-sim 依赖 gate，下载同次产物并核验提交、源码 SHA256 和三份产品哈希后运行五个浏览器入口。contents 权限为 read，不创建 release、不上传凭据。

构建头区分完整 Git commit、源码/构建输入是否未提交与源码 SHA256。来源提交 sourceCommit 和当前 checkoutCommit 可以不同：仅提交产物或发布说明后，预检仍逐内容证明构建来源与当前源码/构建输入相同；修改未提交源或用 dirty 产物发布会被阻断。

```powershell
node scripts/release-assets.cjs manifest
node scripts/release-assets.cjs check --git
powershell -ExecutionPolicy Bypass -File scripts/prepare-release.ps1 -Draft
# 源码已提交、已用干净输入重建且版本说明完整后，严格预检与打包：
powershell -ExecutionPolicy Bypass -File scripts/prepare-release.ps1
```

Draft 生成标注 NOT READY 的本地审查包，保留阻断原因；严格模式要求源码和构建输入与 HEAD 一致、来源提交可验证、三份产品及完整 MIT 通知一致、发布说明无待填写项。包包含安装文件、独立服务脚本、LICENSE/NOTICE、第三方说明、版本说明、预检 JSON 和 SHA256SUMS。两种模式都只写本地备份目录，不暂存、提交、推送或创建线上 release。

版本记录放在 docs/releases，说明版本、sourceCommit、checkoutCommit、SHA256、检查范围及真实平台未验证项。大快照和运行日志留在 backups；现行文档不要将只有本机存在的证据作为唯一交付说明。发布源码采用 [MIT](LICENSE)，[NOTICE](NOTICE.md)仅提供风险建议。
