# 超星（学习通）自动化套件 · 使用文档

本仓库包含两部分：

1. **爬虫（`perception/cx_crawler/`，Python）**：读取优先、绝不提交/修改平台数据；产物落盘到 `perception/cx_crawler/output/`。
2. **浏览器用户脚本（`*.user.js`，Tampermonkey）**：在学习通网页内运行，负责强制续播、自动下一章等。

两者通过**本地桥（方案 A）**衔接：爬虫把逐章清单写到本地文件，再由 `bridge.py` 以只读 HTTP（`127.0.0.1`）暴露，浏览器脚本用 `fetch` 拉取。

> 不启动桥 / 桥不在线时，所有用户脚本**自动回退**到原有的纯 DOM 启发式行为，不会失效。

---

## 1. 环境准备

- Python 3.8+，并 `pip install -r perception/cx_crawler/requirements.txt`。
- 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)（或同类管理器）。
- （可选）若需爬虫回填任务点 `objectid`/`jobid`（让白名单更精确），需 `pip install playwright && playwright install msedge`，并把 `config.py` 的 `RENDER_JOBS` 设为 `True`。

---

## 2. 桥（bridge.py）启动

### 2.1 先生成清单

```bash
cd perception/cx_crawler
python dump.py
```

产物：`output/playlist_{cid}.json`（每课程逐章：knowledgeId / completed / unfinishedCount / hasTaskPoints / objectids / jobids）+ 汇总 `output/playlist_index.json`（原子写）。

> `objectids` 预填依赖 `RENDER_JOBS=True`（渲染任务点页面）。**`RENDER_JOBS=False`（默认）时 `objectids` 恒为空**，桥的「精确任务点清单」增强整体失效：浏览器端退而读取网页内的 `window.attachments` DOM 启发式，定向续播精度下降（可能回退到全量续播），但主流程不受影响。

### 2.2 启动只读桥服务

```bash
cd perception/cx_crawler
python bridge.py                 # 默认 127.0.0.1:7531，前台常驻，Ctrl+C 退出
```

验证：浏览器打开 `http://127.0.0.1:7531/ping` 应返回 `{"ok": true, ...}`。

接口一览：

| 接口 | 说明 |
|------|------|
| `GET /ping` | 健康检查（脚本据此自动探测端口） |
| `GET /playlist/index` | 汇总清单 |
| `GET /playlist/{courseid}` | 某课程逐章清单 |

### 2.3 端口可配置化（优先级：高 → 低）

1. 命令行（最高）：`python bridge.py --host 0.0.0.0 --port 7532` ；或 `--config bridge_config.json`
2. 环境变量：`CX_BRIDGE_HOST` / `CX_BRIDGE_PORT`
3. 同目录配置文件 `perception/cx_crawler/bridge_config.json`：`{"host":"127.0.0.1","port":7531}`（模板见 `bridge_config.example.json`）
4. 默认值：`127.0.0.1:7531`

> **保持本机地址 `127.0.0.1`**：`127.0.0.1` 属 potentially-trustworthy origin，https 页面可直接 `fetch`，无混合内容拦截。对外暴露 `0.0.0.0` 仅在你明确需要跨设备访问时设置。

脚本侧如何对齐端口见 §4.3。

---

## 3. 浏览器脚本安装与开关

2026-07-30 架构重组：**主脚本 + 副脚本**。主脚本 `force-play` 提供悬浮主控面板（按 `P` 呼出），副脚本把各自的开关挂入主面板「副脚本」区统一管理；不能适配或功能已被主脚本覆盖的脚本全部弃置（默认自禁用）。

**主脚本（必装）**

| 脚本 | 作用 | 关键开关 |
|------|------|----------|
| `chaoxing-force-play.user.js`（v4.5） | 强制续播 / 防暂停 / 定向任务点 / 抗重建重播 / 用户暂停开关 / **主控面板**（自身控制 + 副脚本注册区 + 诊断 + 一键复制反馈 + 精简模式 + 播放速率 0.5~2x） | `DEBUG`、`RESCAN_INTERVAL`、`PAUSE_HOTKEY`、`AUTO_STOP_MIN`、`RESUME_AFTER_MIN`、`USER_RATE` |

**副脚本（按需装，开关都在主面板「副脚本」区）**

| 脚本 | 作用 | 面板开关 |
|------|------|----------|
| `chaoxing-auto-next.user.js`（v3.0） | 播完自动进答题入口 / 跳下一未完成章节（桥优先，DOM 兜底）；插播题遮罩自动暂停 | 「自动下一课」，即时生效（`localStorage.cx_an_on`） |
| `chaoxing-progress-panel.user.js`（v3.6） | 只读进度面板（课程/章节任务点完成状态） | 内嵌为「副面板」；fetch 失败分级提示；CSS 图表；**本地估算**（课程卡片展示「本机已看 Xmin · 效率≈Y%/min」，数据来自 force-play 按课程聚合的本地已看时长，非平台同步） |


**其他用途（独立脚本，与学习通无关）**

- `chaoxing-media-collector.user.js`：常驻后台的媒体采集器（捕获视频/音频源地址、时长等元信息，本地存储、不联网），`@match` 默认仅学习通域与本地文件（隐私收敛，修复#15；采集其它网站媒体需手动在脚本头部追加对应 `@match` 行）。它与本套超星脚本**无依赖、不接入主控面板**，是独立用途工具，按需单独启用，不随本套架构更新。

> 副脚本注册机制：副脚本向 `window.__cxAddonQueue` 推入 `{id,type,label,get,set,onClick,render}` 并调用 `window.__cxRegisterAddon()`，主脚本面板建成后渲染，**加载顺序无关**。`type` 支持 `toggle`(开关)/`button`(按钮)/`subpanel`(内嵌副面板：`render(container)` 把内容渲染进主控面板「副面板」可折叠区，标题栏点击展开/折叠)。调试常量均位于脚本顶部，改完保存即生效。

### 3.1 force-play 开关

```js
var DEBUG = false;          // 设为 true 开详细日志（控制台 [CX-FORCE] 前缀）
var CONFIG = {
  RESCAN_INTERVAL: 2000,    // 轮询间隔(ms)，越小越即时、越耗资源
  PAUSE_HOTKEY: 'p',        // 手动暂停切换键：非输入框聚焦时按此键切换当前播放视频的暂停/续播；空串 '' 禁用
  AUTO_STOP_MIN: 0,         // 自动停止计时器：累计观看满 N 分钟自动暂停且不再续播；0=禁用
  RESUME_AFTER_MIN: 0       // 暂停后自动恢复：N 分钟后自动续播；0=保持暂停直到手动恢复（即"暂停后是否开启"开关）
};
```
> 用户暂停开关（v3.23）：按 `PAUSE_HOTKEY` 暂停当前视频后，脚本不再强制续播，右下角有 `[CX] 已暂停续播` 提示；再按一次恢复。
> `AUTO_STOP_MIN=30` 表示看满 30 分钟自动停；`RESUME_AFTER_MIN=5` 表示暂停 5 分钟后自动恢复（设 0 则一直停到你手动恢复）。

行为要点：

- **定向续播**：仅对 `window.attachments` / 桥 `objectids` 命中的任务点视频强制续播；未命中的广告/插播视频**正常可暂停**，不会误伤。
- **已完成章避让**：桥判定当前章 `completed` 且无未完成任务点时，自动禁用强制续播。
- **抗暂停**：原型级拦截 `HTMLMediaElement.prototype.pause` 与 `playbackRate=0` 伪暂停；auto-next 的 hold 暂停通过原生备份绕过、不受影响。
- **抗重建重播**：已结束任务的视频被平台重建时，按 iframe 签名/视频指纹锁死不自动重播。
- `window.attachments` 延迟到达时通过 setter 钩子即时重建白名单；永不出现时由桥 `objectids` 兜底。

### 3.2 auto-next 开关

```js
var DEBUG = false;          // 设为 true 开详细日志（控制台 [CX-AUTO] 前缀）
var CONFIG = {
  BRIDGE_BASE: 'http://127.0.0.1:7531',   // 桥地址默认值（可被 ?cxbridge= / localStorage 覆盖）
  NAV_LOCK_TIMEOUT: 8000,                 // 导航锁超时兜底(ms)，防卡死
  NAV_MAX_RETRIES: 6,                     // 单章最大导航尝试次数
  // ...
};
```

---

## 4. DEBUG 调试

### 4.1 浏览器脚本

把对应脚本顶部的 `var DEBUG = false;` 改为 `true`，刷新学习通播放页，按 F12 → Console：

- force-play：`[CX-FORCE] ...`（轮询命中、桥命中、重建锁、防暂停拦截等）
- auto-next：`[CX-AUTO] ...`（桥清单加载、跳章目标、导航锁状态等）

调试结束记得改回 `false`。

### 4.2 爬虫

```bash
CX_DEBUG=1 python dump.py       # 开启详细结构化日志（含 trace_id）
```

### 4.3 让脚本连上非默认端口的桥

若 `bridge.py` 用了非 `7531` 端口，二选一即可（脚本也会自动探测候选端口 `[7531,7532,7533,8543,9090]`）：

- 播放页 URL 追加参数：`...&cxbridge=7532`（支持 `7532` / `127.0.0.1:7532` / 完整 `http://...:7532`）
- 或在控制台执行一次后永久生效：
  ```js
  localStorage.setItem('cx_bridge_base', 'http://127.0.0.1:7532')
  ```

---

## 5. 常见排错

| 现象 | 可能原因 | 处理 |
|------|----------|------|
| 脚本没反应 / 不续播 | 脚本未启用或 `@match` 不匹配当前域名 | 确认 Tampermonkey 中脚本已启用；确认当前页在脚本 `@match` 范围内 |
| 控制台报 `blocked by CORS` | 桥未开 CORS 或端口不匹配 | 确认 `bridge.py` 在运行；§4.3 对齐端口；检查 `/ping` 是否可达 |
| `/ping` 打不开 | 桥服务没起 / 端口被占用 | 重跑 `python bridge.py`；换端口（§2.3）；`netstat -ano \| findstr 7531` 看占用 |
| 强制续播没生效（视频仍暂停） | 当前章被桥判定为已完成 | 检查 `playlist_index.json` 该章 `completed`；或临时关桥验证 |
| 广告/插播被误续播 | 白名单过宽 | 正常不应发生（非任务点视频不置 `__cxForcePaused`）；开 `DEBUG` 看命中日志 |
| 已播完的任务点反复重播 | 重建去重未命中 | 开 `DEBUG` 看 `ENDED_SRCS` 注册与 `isRebuildFinished`；确认 iframe 签名含任务 id |
| 切后台后停播 | 主脚本未启用（visibility-resume 已删除） | 确认 `chaoxing-force-play.user.js`(v4.0) 已启用，其轮询 play() 覆盖切后台续播 |
| 想彻底静默（无日志） | — | 所有脚本 `DEBUG=false`；爬虫不设置 `CX_DEBUG` |
| 桥数据陈旧 | `dump.py` 很久没跑 | 重新 `python dump.py` 再重启 `bridge.py` |

---

## 6. 典型工作流

```bash
# 1) 爬虫：抓课程 + 生成清单（必要时开 RENDER_JOBS 回填 objectids）
cd perception/cx_crawler
CX_DEBUG=1 python dump.py

# 2) 常驻桥（可用 --port 自定义）
python bridge.py --port 7531

# 3) 浏览器：Tampermonkey 启用 force-play + auto-next（必要时按 §4.3 对齐端口）
#    打开学习通播放页，脚本自动续播并跳章。
```

> 安全红线：限速优先于对抗（单域最小请求间隔见 `config.py` 的 `MIN_INTERVAL`），且爬虫只读不写，避免触发风控。

> **凭证安全（修复#26）**：`session.save_cookies` 会把登录态**明文**写入 `perception/cx_crawler/cookies.json`。请务必：① 不要将该文件提交到 git 或任何公开位置；② 在共享/公共电脑上使用后及时删除；③ 脚本已对 `cookies.json` 施加 `0o600` 权限（类 Unix 下仅属主可读写，Windows 尽力而为）作为额外防护，但这不能替代前两条习惯。
