# 生态层 (Ecosystem)

集成中枢，使感知层与决策层协同。

- `chaoxing-force-play.user.js` — 主控面板：强制续播 / 防暂停 / 速率 / 循环 / 自动停止；
  提供副脚本注册 `window.__cxRegisterAddon`、命令注册 `window.__cxRegisterCommand`、
  跨进程桥（127.0.0.1:7531）与 `postMessage` 协议，聚合所有层。

## 跨层合约
- 感知层 → 生态层：`postMessage` 上报（如媒体采集）、`__cxRegisterAddon` 注册副面板/副脚本。
- 决策层 → 生态层：`__cxRegisterAddon` 注册行为插件，由主控统一开关。
- 生态层 ⇄ 感知层(爬虫)：本地 HTTP 桥 `GET /playlist/{cid}` 拉取权威章节清单。
