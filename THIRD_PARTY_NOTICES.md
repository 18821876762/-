# 第三方依赖与素材范围

项目自有代码使用根 [MIT 许可证](LICENSE)。该许可不重新许可 npm/Python 依赖、浏览器、模型服务或外部站点内容。

开发依赖由各 package.json 和 package-lock.json 锁定，安装时保留依赖包自带许可证。包括 ESLint/Espree/eslint-scope、esbuild、jsdom、Playwright 和 PPTXGenJS；开发依赖不打包进核心单文件用户脚本。Python 依赖见 services/perception/cx_crawler/requirements.txt，各依赖保留自己的许可。

视觉功能可能按配置懒加载 html2canvas 或 Tesseract.js，或访问用户配置的 AI/视觉端点。相关库、浏览器运行时、模型服务与返回内容适用其自身许可或服务规则；是否传出截图和题目取决于用户启用的配置，不能据“零运行时 npm 依赖”推断无外部通信。

测试夹具应使用合成内容。真实页面采样、抓包和课程数据应脱敏后保留在本机；旧归档的来源与清理记录见归档说明。MIT 许可只覆盖本项目可授权的自有部分，不授予平台专有内容或用户数据的权利。
