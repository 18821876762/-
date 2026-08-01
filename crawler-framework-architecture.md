# 通用反爬对抗爬虫框架 — 架构设计文档

> 目标：一套可复用的、具备反爬对抗能力的通用爬虫框架（Python）。
> 优先级来源：请求签名[高] · TLS/JA3 指纹[高] · 代理池/IP 轮换[高] · 验证码链路[中] · 数据存储[中] · 分布式调度[低]。
> 合规前提（贯穿全文）：仅采集**公开数据**；遵循目标站 `robots.txt` 与 ToS；强制限速与失败退避；不抓个人隐私、不绕过付费/登录鉴权墙、不对目标站造成 DoS 级压力。

---

## 0. 设计原则

1. **传输层与业务层解耦**：签名、指纹、代理都是「请求如何发出去」的问题，统一收敛到 Transport 层；解析/存储只关心响应。
2. **失败可降级**：任一对抗组件失效时，请求应降级到「能发就发」而非崩溃（如指纹库为空则回退原生）。
3. **一切可观测**：每个请求带 `trace_id`，记录指纹/代理/IP/耗时/状态码，便于复盘封禁原因。
4. **限速优先于对抗**：绝大多数封禁来自「请求太猛」而非「特征太假」。默认全局 QPS 闸门 + 单域名令牌桶。
5. **幂等与可重放**：任务用 `(domain, biz_key, step)` 做幂等键，失败可重投，避免重复写入。

---

## 1. 整体架构（分层）

```
┌─────────────────────────── 控制面 (Control Plane) ───────────────────────────┐
│  Scheduler 调度中心   · 规则/配置中心 (Config & Rule Store)                   │
│  - 任务分片 / 优先级队列 / 分布式锁 (Redis)   - 限速闸门 (Token Bucket)         │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │ 下发 Task
                                     ▼
┌─────────────────────────── 数据面 (Data Plane) ──────────────────────────────┐
│  Task ─▶ Fetcher(Transport 层)                                               │
│      ├─ [Signer]      注入 sign/hmac/x-timestamp 等签名参数                   │
│      ├─ [TLS Fingerprint]  curl_cffi impersonate（Chrome 各版本/JA3 轮换）     │
│      ├─ [Proxy Router] 按域名/指纹选代理，绑定 IP 信誉                         │
│      └─ [Rate Limiter] 全局/单域限速                                          │
│      │                                                                        │
│      ▼  Response                                                              │
│  Parser ─▶ [Captcha Gateway?] ─(需验证)─▶ 打码/模型/人工 ─▶ 重试或放弃        │
│      │                                                                        │
│      ▼  结构化数据                                                            │
│  Pipeline ─▶ Storage Adapter (MySQL/Mongo/ES/对象存储，按场景选)              │
└──────────────────────────────────────────────────────────────────────────────┘
                                     │ 状态/指标回写
                                     ▼
┌─────────────────────────── 支撑面 (Support Plane) ───────────────────────────┐
│  Proxy Pool + IP Reputation   ·  Fingerprint Store   ·  Captcha Provider Hub   │
│  Observability (日志/指标/告警)                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

数据流向：**控制面**产出任务 → **数据面**经 Transport 层对抗后抓取 → 解析后过验证码网关 → 经 Pipeline 落 **存储**；支撑面为 Transport 层与验证码网关提供代理、指纹、打码三类资源。

---

## 2. 模块详解（按优先级）

### 2.1 请求签名逆向 ★★★ 高

**目标**：还原目标 API 的 `sign`/`hmac`/`x-sign`/`signature` 等参数的生成算法，使服务端把它当作「合法客户端」的请求。

**方法论（标准逆向流程）**：
1. 抓包：浏览器 DevTools / mitmproxy 录制真实请求，定位签名参数及其出现位置（query、header、body）。
2. 定位算法：在打包后的前端 JS 中搜索签名盐值/拼接规则关键字（`sign`、`hmac`、`md5`、`encrypt`、`timestamp`、`nonce`、`appKey`）。
3. 还原拼接顺序：常见模式 `sign = hash(secret + sorted(params) + ts + nonce)`，或 AES/RSA 非对称。
4. 移植 or 借力：
   - **方案 A（推荐，稳）**：把算法移植成 Python 纯函数（避免每次请求都起浏览器）。
   - **方案 B（兜底，快）**：用 headless 浏览器（Playwright）注入页面上下文，直接调用原站 `window.sign(params)` 取结果——适合算法频繁变、逆向成本高的场景。

**Signer 抽象接口（框架核心）**：
```python
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class SignRequest:
    method: str
    url: str
    params: dict
    headers: dict
    body: bytes | None = None
    ts: int | None = None

@dataclass
class SignResult:
    params: dict        # 追加/覆盖到 query
    headers: dict       # 追加/覆盖到 header

class Signer(ABC):
    @abstractmethod
    def sign(self, req: SignRequest) -> SignResult: ...

# 注册表：不同域名挂不同 Signer 实现，运行时按 host 路由
class SignerRegistry:
    def __init__(self): self._m = {}
    def register(self, host: str, s: Signer): self._m[host] = s
    def get(self, host: str) -> Signer | None: return self._m.get(host)
```

**坑**：
- 盐值/密钥可能动态下发（先请求一次拿 token 再签名），需把「握手」建模成任务的前置步骤。
- 时间戳/随机数需与服务端时钟对齐，漂移过大会被拒——框架统一维护 `clock_skew` 校准。
- 算法混淆（如把 `md5` 改名、加无用运算）用 AST 还原比硬读快。

---

### 2.2 TLS/JA3 指纹管理 ★★★ 高

**目标**：让 Python 发出的 TLS 握手特征（JA3/JA4）与真实浏览器一致，避免被服务端按握手特征识别为脚本。

**为什么原生 `requests` 裸奔会被封**：CPython 的 `ssl` 模块握手顺序固定、扩展集固定，生成的 JA3 与 Chrome 明显不同；服务端在 TLS 层即可标记，根本不用看 HTTP 头。

**方案（Python 唯一正解：`curl_cffi`）**：
`curl_cffi` 用 libcurl + 浏览器同源的 TLS 栈，支持 `impersonate="chrome131"` 等预设，直接复刻对应 Chrome 版本的 JA3/JA4、ALPN、扩展顺序。

```python
from curl_cffi.requests import Session, BrowserType

session = Session(impersonate=BrowserType.chrome131)
# 或轮换：从指纹库随机取一个，绑定到该 session 生命周期
```

**指纹轮换策略**：
- 维护 `FingerprintStore`：一组 `{impersonate, user_agent, sec_ch_ua}` 三元组，按「与代理 IP 绑定」原则分配（同一 IP 长期固定同一浏览器指纹，避免抖动）。
- 指纹失效检测：连续 N 次 4xx/挑战页 → 标记该指纹-IP 组合降级。

**坑**：
- `curl_cffi` 与 `requests`/`httpx` 的 API 相似但不完全一致，框架应把 Transport 抽象成统一 `Transport` 接口，业务层不感知底层实现。
- HTTP/2 指纹（Akamai/NetScaler）比 JA3 更细，必要时开 `http2=True` 并校准 `sec-ch-ua` 等客户端提示头。

---

### 2.3 代理池 + IP 信誉轮换 ★★★ 高

**目标**：解耦「请求来源 IP」与「本机 IP」，并按信誉动态淘汰劣质代理——爬虫瓶颈在 IP 不在 JS。

**池结构**：
```
ProxyPool
 ├─ 来源接入：供应商 API / 独享拨号 / 自建隧道
 ├─ 校验器 (HealthChecker)：定时探测可达性 + 匿名度 + 目标站可达
 ├─ 信誉评分 (Reputation)：成功+1 / 触发验证码-2 / 封禁-5；低于阈值剔除
 └─ 路由策略 (Router)：按域名、按指纹绑定、按权重随机
```

**IP 信誉模型**：
```python
@dataclass
class ProxyEntry:
    url: str                 # socks5://... / http://...
    score: float = 100.0
    consecutive_fail: int = 0
    last_used: float = 0.0
    bound_fp: str | None = None   # 建议与指纹绑定

def on_success(p): p.score = min(100, p.score + 1); p.consecutive_fail = 0
def on_blocked(p): p.score -= 5; p.consecutive_fail += 1
def is_alive(p):   return p.score > 20 and p.consecutive_fail < 5
```

**与指纹绑定**：优质做法是「指纹 ↔ 代理 IP」长期配对，模拟「同一台真机」。框架在 `Transport` 层把 `session.impersonate` 与选中的 `proxy` 绑定到同一 `FetchContext`。

**坑**：
- 免费代理基本不可用（速度/匿名度/稳定性），生产用付费住宅/机房代理。
- 目标站若按「账号+IP」风控，仅换 IP 不够，需配合账号池（本文档不展开账号体系）。
- 代理本身也要限速，避免把代理供应商打挂。

---

### 2.4 验证码处理链路 ★★ 中

**目标**：当响应是验证码页（滑块/点选/图文/短信），自动走「识别→回填→重试」链路，失败则降级人工/放弃。

**网关设计（与业务解耦）**：
```
Response
  └─ 风控判定 (ChallengeDetector): 状态码/关键字/埋点判定是否需要验证
        ├─ 否 → 正常解析
        └─ 是 → CaptchaGateway.dispatch(challenge)
                  ├─ 类型识别 (slider / click / ocr / sms)
                  ├─ Provider 路由 (打码平台 API / 自训模型 / 人工队列)
                  ├─ 回填并提交
                  └─ 成功 → 以新 cookie/session 重投原 Task
                     失败 → 重试(上限) → 上报 + 放弃(标记 need_human)
```

**Provider 抽象**：
```python
class CaptchaProvider(ABC):
    @abstractmethod
    def solve(self, challenge) -> SolveResult: ...   # 返回 token/坐标/文本
```
- 打码平台：接标准 HTTP API（提交图/轨迹，轮询拿结果）。
- 自训模型：轨迹类滑块用强化学习/视觉模型本地推理，避免外发敏感截图。
- 人工兜底：放入人工队列，运营在后台处理，结果回写。

**坑**：
- 滑块的「轨迹」需拟人（加抖动、加减速），纯直线会被判机器。
- 验证码本质是「对抗」，应设单任务验证码重试上限，避免无限烧钱。
- 截图/轨迹可能含敏感信息，外发打码平台前做脱敏。

---

### 2.5 数据存储选型 ★★ 中

本项目当前无持久化，框架需「按场景选存储」而非一刀切。对比：

| 存储 | 适用 | 不适用 | 说明 |
|---|---|---|---|
| **MySQL/PostgreSQL** | 结构化、强一致、需事务（订单/关系数据） | 半结构化、海量日志 | 默认关系型首选 |
| **MongoDB** | 半结构化、schema 易变（抓取字段不稳定） | 复杂联表事务 | 爬虫字段常变，落地友好 |
| **Elasticsearch** | 全文检索、聚合分析（内容库/舆情） | 事务、主存储 | 检索场景叠加 |
| **对象存储/文件** | 原始 HTML/图片/大文本（防改、可重放） | 随机查询 | 建议「原始落对象 + 结构化落库」双写 |
| **ClickHouse** | 海量行为日志、分析型 | 事务写入 | 后期分析扩展 |

**推荐默认组合**：**MongoDB（结构化结果）+ 对象存储（原始响应，带 `trace_id` 便于重放）**。需要检索时再接 ES，需要事务时换关系型。统一经 `StorageAdapter` 接口，业务层不绑定具体引擎。

```python
class StorageAdapter(ABC):
    @abstractmethod
    def save(self, collection: str, doc: dict, idem_key: str): ...
```

---

### 2.6 分布式调度 ★ 低

**目标**：单机起步即可，但架构上预留水平扩展口子，避免后期重构。

**单机起步**：进程内队列 + 单进程 Fetcher 池（asyncio / 线程池）。限速闸门与任务去重都在本机内存。

**预留的扩展口子**：
- **任务队列可插拔**：默认内存队列，生产切 Redis / RabbitMQ / Kafka（实现同一 `TaskQueue` 接口）。
- **调度分片**：任务按 `hash(biz_key) % N` 分片，多 worker 各认领一片；用 Redis 原子锁做 rebalance。
- **幂等键**：`(domain, biz_key, step)` 全局唯一，保证多 worker 不重复处理。
- **状态外置**：任务状态/进度存 Redis，worker 无状态，可随时扩缩容。

**坑**：分布式下「限速」要改成中心化令牌桶（Redis `INCR` + 过期），否则各 worker 各自限速会叠加超发。

---

## 3. 技术栈汇总（Python）

| 层 | 选型 | 说明 |
|---|---|---|
| 运行时 | Python 3.11+ | 异步 + 类型注解 |
| Transport | **curl_cffi**（指纹） | 唯一能 impersonate 浏览器的 Python 库 |
| 异步 HTTP | asyncio + curl_cffi async / aiohttp（非指纹场景） | |
| 浏览器兜底 | Playwright（签名方案 B、验证码） | 重、按需起 |
| 队列/锁 | Redis（rq / arq / 原生） | 调度 + 限速 + 指纹/代理状态 |
| 配置/规则 | pydantic + YAML | 类型安全配置 |
| 日志/观测 | structlog + Prometheus | trace_id 贯穿 |
| 存储 | MongoDB + 对象存储(S3 兼容) | 按 2.5 选 |
| 测试 | pytest + 录制回放（vcrpy） | 签名/解析单测 |

---

## 4. 实施路线（按优先级排序）

- **Phase 1 — 稳定抓取底座（高）**：Transport 层 = `curl_cffi` 指纹 + 代理池 + 限速闸门。先做到「能稳定、不被秒封地发出请求」。这是一切的前提。
- **Phase 2 — 签名逆向（高）**：建 `Signer` 抽象 + 注册表，逐个目标站点移植/借力生成签名。
- **Phase 3 — 验证码链路（中）**：`ChallengeDetector` + `CaptchaGateway` + Provider 接入，先接打码平台跑通，再考虑自训。
- **Phase 4 — 存储 + 调度（中/低）**：`StorageAdapter` 落地；调度先单机，预留 Redis/分片口子。
- **贯穿**：Observability（每个请求 trace_id + 指纹/代理/IP/状态），没有它前面所有对抗都是黑盒。

---

## 5. 风控与合规红线（务必遵守）

- ✅ 只抓公开数据；尊重 `robots.txt` 与站点 ToS。
- ✅ 限速优先：默认保守 QPS，配合目标站承受能力动态调整。
- ✅ 失败退避：4xx/5xx/挑战页触发指数退避，不暴力重试。
- ✅ 不抓 PII（手机号/身份证/密码/聊天记录等），不绕过登录/付费鉴权。
- ❌ 不对目标站造成 DoS 级压力（无限并发、击穿）。
- ❌ 不将能力用于欺诈、刷量、未授权入侵等违法用途。

> 框架是工具，合规使用由调用方负责。建议上线前对目标站做「采集影响评估」。
