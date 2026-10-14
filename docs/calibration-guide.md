# 真实站点校准流程

本文件保留仍可使用的采集方法。旧版列举的变量、行号、选择器及待校准状态已随原文归档，当前状态应以实际源码与页面样本核对。

## 页面采集

1. 在目标站点打开实际课程、互动弹窗、题目页或应答页面，等待相关界面出现。
2. 打开开发者工具的 Console。
3. 将 [scripts/calibrate-dump.js](../scripts/calibrate-dump.js) 的内容粘贴到控制台并执行。
4. 在本机忽略的输出目录保存 CALIBRATION DUMP 与 END 标记之间的输出，同时记录采集时间、平台、页面类型和触发步骤；共享前去除账号标识、会话参数和真实题目，只保留必要结构。
5. 将样本与实际模块的选择器比较，再修改源码、补回归场景并重新构建验证。

可复用的手工合成 DOM 位于 [tests/fixtures](../apps/userscript/tests/fixtures/README.md)，包括 chaoxing-page.html 和 deepseek-page.html；它们不是原平台页面捕获。采集输出位于 services/perception/cx_crawler/output/，不直接入库。合成 fixture 或源码静态断言不自动等同当前真实站点回归。源码定位以 [主源码目录](../apps/userscript/src/chaoxing-force-play/) 为准，避免使用旧文档的固定行号。

完整旧版清单与研究材料见 [历史归档](../旧文档/归档说明.md)。
