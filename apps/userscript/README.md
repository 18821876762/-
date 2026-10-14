# 用户脚本开发与构建

当前本地待交付核心版本为 4.20.3。主源码位于 [src/chaoxing-force-play](src/chaoxing-force-play/)，域模块由 [build-manifest.txt](build-manifest.txt)按顺序登记，另加 takeover/meta.js 和 takeover/bootstrap/core.js 两个入口。

## 工具链与构建

准备 Node.js **24.15.0+**（本地验证版本 24.19.0）。在项目根目录执行：

```powershell
npm ci --prefix apps/userscript
npm ci --prefix apps/userscript/_sim
npx --prefix apps/userscript/_sim playwright install chromium
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
powershell -ExecutionPolicy Bypass -File scripts/build.ps1 -Variant open
```

根 [scripts/build.ps1](../../scripts/build.ps1)默认生成 personal 并同步 latest；open 生成另一变体。直接调用应用 build-force-play.ps1 不负责 latest，发布前使用根入口。构建头记录完整来源提交、源码/构建输入状态与源码 SHA256，不用旧 HEAD 标记代替未提交代码来源。-Fast 跳过仿真和 ESLint，用于开发；-SkipSim 跳过全部本地仿真。生产压缩保留头部完整 MIT 版权与许可通知。

## 验证

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -ExecutionPolicy Bypass -File apps/userscript/check-module-size.ps1
node --test scripts/tests/release-assets.test.cjs
# 浏览器入口需提前安装 _sim 依赖与 Chromium：
powershell -ExecutionPolicy Bypass -File scripts/test.ps1 -Browser
```

根统一入口检查完整产物、纯函数、题解合并、本地仿真、Python 与契约。默认本地运行器跳过 Playwright；-Browser 额外执行 smoke、iframe、bridge-noise、panel-scroll 和 safety-visible 五个入口。数量和执行结果以当次输出及 [版本验证记录](../../docs/releases/4.20.3.md)为准。浏览器模拟成功不能代替真实管理器、真实平台提交或服务端进度验证。

连续源码片段使用 @source-group 声明并在清单中连续排列；[source-groups.cjs](scripts/source-groups.cjs)读取完整逻辑组，对实际拼装顺序解析词法作用域。[CI](../../.github/workflows/ci.yml)的 browser-sim 取得 gate 当次产品并严格核验 SHA256，避免测试旧产物。

## 凭据与数据

官方 API Key 使用面板专用密码框保存；它不放入公开 CONFIG、页面 localStorage、导出配置或日志。支持私有 GM 持久化的管理器将密钥与授权端点 Origin 一并保存；缺该能力时仅当前页面会话有效。改变公开端点设置不授予新 Origin，跨 Origin 使用须重新输入并保存 Key。保存后密码框清空，不回显；清除按钮与恢复默认移除私有凭据。旧页面密钥会被移除，重新保存前不授权发送。操作说明见 [使用说明](../../docs/USAGE.md)。

## 源码与素材

- takeover/sites/plugins/presentation 是四个源码能力域；镜像由根 scripts/sync-copy.ps1 同步。
- [tests/fixtures](tests/fixtures/README.md)采用合成 DOM；真实校准样本单独脱敏。
- 单文件安装不需要 npm 依赖；可选视觉库、AI 端点和浏览器服务有独立的数据流及第三方范围。
- 自有代码采用根 [MIT](../../LICENSE)；[风险提示](../../NOTICE.md)不增加授权条件。

[发布流程](../../CONTRIBUTING.md) · [目录结构](../../docs/PROJECT_STRUCTURE.md) · [文档索引](../../docs/DOC_INDEX.md)
