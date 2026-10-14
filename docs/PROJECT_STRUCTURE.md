# 项目目录结构

目录调整日期：2026-10-02；原结构验收日期：2026-10-03；源码核对日期：2026-10-14（4.20.3）。按应用、服务、产物、工具和备份组织：

```text
项目根目录/
├─ apps/userscript/             用户脚本源码、构建器、配置与测试
│  ├─ src/chaoxing-force-play/  takeover、sites、plugins、presentation
│  ├─ tests/fixtures/           学习通与 DeepSeek 最小合成 DOM 样本
│  ├─ _sim/                    仿真回归
│  └─ reverse-api/             独立 HTTP 接口服务
├─ services/perception/        感知脚本与 Python 采集服务
│  └─ cx_crawler/              本地桥、采集器、测试与 output
├─ exports/chaoxing-force-play/ 主源码同步镜像
├─ dist/                       personal、open 和 latest 安装产物
├─ scripts/                    统一构建、测试、同步、校准与本地发布预检入口
├─ tools/
│  ├─ diagnostics/             项目诊断工具
│  │  └─ userscript/            应用诊断、smoke 与恢复工具
│  ├─ presentations/           演示稿构建工具
│  └─ runtime/node_home/       本地 Node.js 运行环境
├─ docs/                       当前规约、协议、使用和模块说明；releases 保存发布记录
├─ backups/
│  ├─ git/                    Git bundle 备份
│  ├─ patches/                临时补丁备份
│  ├─ layout/2026-10-02/       调整前源码、配置快照与迁移清单
│  ├─ docs/2026-10-03/         文档整理前快照、清单与验收记录
│  ├─ refactor/2026-10-10/     模块拆分前快照、映射与验收记录
│  └─ fixes/2026-10-13/        安全修正前原件与本地验证记录（忽略、不公开）
├─ LICENSE / NOTICE.md         自有代码 MIT 许可及风险建议
├─ SECURITY.md                 凭据、课程数据与安全报告边界
├─ THIRD_PARTY_NOTICES.md       工具链和可选外部库的许可范围
├─ .github/                    CI 与发布配置
└─ 旧文档/                     历史资料、清单和 ZIP
```

## 目录职责

| 目录 | 维护方式 |
|---|---|
| [apps/userscript](../apps/userscript/README.md) | 修改 src，更新构建清单、契约和测试 |
| [services/perception](../services/perception/README.md) | 维护感知脚本、Python 采集与本地桥，采集输出留在服务内部 |
| [exports/chaoxing-force-play](../exports/chaoxing-force-play/README.md) | 从主源码同步，供导出与阅读 |
| [dist](../dist/README.md) | 保存生成的安装文件，修改源码后重新构建 |
| [scripts](../scripts/) | 从项目根执行日常操作 |
| [tools](../tools/) | 保存[诊断工具](../tools/diagnostics/README.md)、[演示生成器](../tools/presentations/README.md)和本地运行环境 |
| [docs](DOC_INDEX.md) | 保存当前说明与契约，内置插件说明在 modules/decision.md |
| [backups](../backups/) | 保存 Git、补丁、目录迁移和文档整理快照 |
| [旧文档](../旧文档/归档说明.md) | 保存历史共享副本及清单；原件仅留本机修正前快照，见 [脱敏说明](../旧文档/脱敏说明.md) |

应用内部的源码、测试和构建关系保持，外部安装产物集中到 dist。tests/fixtures/chaoxing-page.html 和 deepseek-page.html 已改为最小合成验证输入，范围见 [夹具说明](../apps/userscript/tests/fixtures/README.md)；样本存在不等同真实站点当前 DOM 已经回归通过。

## 开发与运行

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build.ps1
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
powershell -ExecutionPolicy Bypass -File scripts/sync-copy.ps1
```

构建支持 -Variant personal、-Variant open、-Fast。测试入口运行本地默认测试与契约门禁；浏览器场景见 [CI](../.github/workflows/ci.yml)。Python 服务准备与启动见 [cx_crawler](../services/perception/cx_crawler/README.md)。

当前说明从 [DOC_INDEX.md](DOC_INDEX.md)进入。调整前文件位置见 backups/layout/2026-10-02 中的迁移清单；旧文档清单描述此前归档时的路径。

主源码为 108 个 JavaScript 文件，106 项构建清单及两个入口。4.20.3 新增 `takeover/foundation/storage/credentials.js` 私有凭据模块；2026-10-10 的 4.20.2 曾有 107 份源码、105 项清单，14 个超限模块拆分的顺序与原闭包关系见 [历史拆分记录](../backups/refactor/2026-10-10/module-split/拆分说明.md)。

现行文档共 31 份，当前基线为 4.20.3；状态机设计见 [CORE_STATE.md](CORE_STATE.md)，时效和待核对项见 [DOCUMENT_STATUS.md](DOCUMENT_STATUS.md)，当前发布来源与验证见 [4.20.3 记录](releases/4.20.3.md)。历史材料见 [2026-10-03 补充归档](../旧文档/07_补充归档/2026-10-03/补充归档说明.md)，当时文档快照见 [backups/docs/2026-10-03](../backups/docs/2026-10-03/)。
