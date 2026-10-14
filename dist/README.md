# 安装产物

当前本地待交付核心版本为 **4.20.3**；源码在 [apps/userscript](../apps/userscript/README.md)，验证与发布准备状态见 [版本记录](../docs/releases/4.20.3.md)。

| 文件 | 用途 |
| --- | --- |
| [chaoxing-force-play-latest.user.js](chaoxing-force-play-latest.user.js) | 默认安装入口，与 personal 逐字节同步 |
| [chaoxing-force-play.user.js](chaoxing-force-play.user.js) | personal 变体 |
| [chaoxing-force-play.open.user.js](chaoxing-force-play.open.user.js) | open 变体，含首次预热 |

同一浏览器只保留一个核心变体。根 scripts/build.ps1 构建 personal 并同步 latest，添加 -Variant open 构建另一变体。源码变更后重新构建并运行统一测试；完整流程见 [贡献说明](../CONTRIBUTING.md)。

每份单文件保留完整 MIT 版权和许可通知，构建头注明源码摘要、来源提交及未提交状态。CI 使用三份产物 SHA256 清单把浏览器验证绑定到当次构建；该清单由 scripts/release-assets.cjs manifest 生成，不是自动线上发布。

尚未固定远程更新渠道，当前不声明 @updateURL/@downloadURL。按实际分发来源手动更新；管理器是否从安装 URL 自动检查由其配置决定。@namespace 是脚本标识，改变前评估已有安装的迁移。可审查的本地 ZIP 由 scripts/prepare-release.ps1 生成，严格发布模式要求源码与 Git 及发布说明一致。
