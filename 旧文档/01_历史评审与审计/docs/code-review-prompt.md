# 本仓库定制的代码检查提示词

> 产出依据：2026-08-09 全量审查（见 `docs/code-review-2026-08-09.md`）。
> 该次审查中，通用提示词漏掉了唯一的严重缺陷，而机械校验一秒就抓到了。本文把「有效的做法」固化为可复制的提示词。

---

## 一、为什么通用提示词在本仓库会失效

| 仓库特征 | 通用审查的失效方式 | 提示词必须强制的动作 |
|---|---|---|
| ~100 个源文件由 `ecosystem/build-force-play.ps1` 按顺序拼进**同一个 IIFE**，无模块系统 | 逐文件看代码时，跨文件调用全是「未定义」→ 满屏误报，审查者被迫忽略 `no-undef`，真的未定义也一起漏掉 | 必须在**拼接产物**上做静态扫描，源码只用来定位 |
| 跨文件共享靠**函数声明提升**，无 import/export | 改名后调用点不同步，编辑器与 lint 都不报错 | 必须逐个 grep 校验「调用点 ↔ 定义」契约 |
| 全局 `try{}catch(swallow)`（产物中 719 try / 446 swallow / 163 空 catch） | 缺陷不表现为报错，而是**功能静默不生效**；读代码看着"很稳" | 必须问「这个 catch 吞掉后，功能是否已经死了」 |
| 站点选择器是 **best-effort 并集**，真实 DOM 未校准 | 无法从代码判定对错，容易写出大量无价值的"选择器可能不准" | 只报**结构性**缺陷（过宽误伤、无判空、顺序错），选择器准确性统一归入"待真机校准"一节 |
| `ecosystem/_sim/` 35 个纯 Node 沙箱用例，长期全绿 | 「测试全过」被当作质量证据 | 必须审**测试没覆盖什么**，而不是测试是否通过 |
| 源码 `src/` 与产物 `.user.js` 双份并存 | 审源码得出的结论可能与用户实际运行的产物不符 | 开场先比对时间戳，不同步则先重建 |
| `perception/` 是独立 Python 层，与 JS 无调用关系 | 混在一起审会稀释重点 | 单独一轮，重点只看超时/裸 except/编码/敏感数据落盘 |

---

## 二、主提示词（整体审查，可直接复制）

```text
对本工作区做一次全量代码审查。这是一个 Tampermonkey UserScript 项目，
ecosystem/src/chaoxing-force-play/ 下约 100 个 js 由 ecosystem/build-force-play.ps1
按固定顺序拼接进【同一个 IIFE】产出 ecosystem/chaoxing-force-play.user.js，
没有模块系统，跨文件共享全靠函数声明提升。

【第 0 步 · 前置校验，必须先做，不许跳过】
1. 比对 ecosystem/chaoxing-force-play.user.js 与 ecosystem/src 下最新文件的
   LastWriteTime；产物旧于源码，先说明并以源码为准。
2. node --check 产物，确认语法。
3. 用仓库自带 ESLint 对【产物】跑一遍（配置：ecosystem/_audit.eslintrc.json）：
   cd ecosystem; $env:ESLINT_USE_FLAT_CONFIG='false';
   node node_modules\eslint\bin\eslint.js --no-eslintrc -c _audit.eslintrc.json -f compact chaoxing-force-play.user.js
   把每条命中反查回 src 的源文件与行号。
   【禁止】对 src/ 逐文件跑 no-undef，那会产生 1600+ 条跨文件误报。

【第 1 步 · 契约校验，本仓库最高优先级】
因为没有模块系统，"改名后调用点不同步"是本仓库最容易出、也最难发现的缺陷。
请对下列每一类跨文件引用，用 grep 确认「引用数」与「定义数」：
  - takeover/bootstrap/main-loop.js 里调用的每一个函数名
  - sites/*.js 对外暴露的接口名 vs presentation/、bootstrap/ 里的调用点
  - window.__CX_FORCE_PLAY.* 上挂载的成员 vs 读取处
  - plugins/addons/* 对核心脚本能力的探测（typeof xxx === 'function' 这类）
列出所有「有引用、零定义」和「有定义、零引用」的符号。
对每一个"能力探测"表达式，回答：它现在恒为 true 还是恒为 false？

【第 2 步 · 分域逐行审查】
按域切分（见下方分域子提示词），每域独立通读，不许抽样。

【第 3 步 · 错误吞没审查】
本项目大量使用 try/catch + swallow()。对每一处 catch，回答：
  - 异常被吞后，这个功能是【降级】还是【彻底失效】？
  - 是否存在「抛错点在 try 之外」的写法（如 defineProperty 的 getter/setter 内部抛错）？
  - 卸载/还原路径里的 swallow 是否会导致宿主页面状态回不去？
只报"吞掉后功能已死"的，不要罗列所有 catch。

【第 4 步 · 测试盲区审查】
ecosystem/_sim/ 下 35 个沙箱用例长期全绿。请不要把"全绿"当质量证据，而要回答：
  - 你在第 1~3 步发现的每个缺陷，为什么现有用例没抓到？
  - 哪些用例只测纯函数、没有构造真实触发路径（如没有给 window 赋值、没触发 setter）？
  - 是否存在提前 process.exit 导致后续断言不执行的用例？
  - 核心状态机（主循环、卸载还原、自动交卷、弹窗处理）各自被哪个用例覆盖？没有的直接指出。

【输出要求】
每条问题一个块，必须包含：
  【文件相对路径:行号】【严重/中等/轻微】【问题类型】
  【原文摘录 ≤3 行】【触发条件】【后果】【修复建议】
禁止出现没有行号的泛泛之谈。
禁止把"选择器可能不匹配真实站点"当成缺陷逐条列出——统一收进末尾"待真机校准"清单。
最后给出：功能完整性 / 健壮性 / 工程实践规范性 三项评价，
每项必须引用前文的具体条目编号作为依据，不许只给形容词。
```

---

## 三、分域子提示词

> 用法：每域派一个只读子代理并行跑，域内文件**全部读完**。

### 3.1 基础层 + 引擎层 `takeover/foundation/`、`takeover/engine/`

```text
只读审查。注意这些文件最终拼进同一个 IIFE，靠函数提升共享作用域。
重点：
1. 同一 IIFE 内的【重复声明】——不同文件里同名的 function/const 会互相覆盖或直接报错，
   请给出所有同名符号清单及最终生效的那个。
2. defineProperty / prototype 改写：getter/setter 内部抛错是否在 try 之外？
   卸载时是否能真正还原（delete 后重新赋值是否也在同一个 try 里被吞掉）？
3. 主循环每 tick 的开销：全量 querySelectorAll、遍历 iframe、循环内重复编译正则。
4. 无上限增长的 Set/Map/数组（指纹集、去重键、统计数组）。
5. 去重键设计：失败的操作是否被永久记入指纹从而再也不重试？
```

### 3.2 主循环与生命周期 `takeover/bootstrap/`、`takeover/dom/`

```text
只读审查。main-loop.js 是调度器，lifecycle.js 负责卸载还原。
重点：
1. 用 grep 逐个确认 main-loop.js 中调用的每一个函数名都有定义，列出找不到的。
2. lifecycle.js 的卸载清单：注释里承诺还原 N 项，实际代码是否逐项还原？
   哪些还原动作会被 swallow 吞掉从而永久不还原？
3. MutationObserver 是否节流？它把 2s 主循环放大到了多少频率？放大后每次的开销是什么？
4. 定时器/监听器的收支：addEventListener 与 removeEventListener 数量差在哪里。
5. await 期间 DOM 已变、video 元素被移除后仍访问的竞态。
```

### 3.3 站点域 `sites/`

```text
只读审查全部站点文件。站点隔离靠 detectSite() 判断。
重点：
1. 站点隔离：每个模块是否都做了 detectSite() 守卫？有无在其他平台误触发的路径？
2. 选择器【过宽】导致误伤宿主页面正常元素（尤其 [class*="..."] 这类模糊匹配 +
   随后执行 remove()/click() 的组合）——这是真缺陷，必须报。
3. 幂等性：同一元素被重复处理 / 处理失败后被永久拉黑 / 状态位只在失败路径复位。
4. 状态机漏态：submitting、handled 这类标志位，成功路径是否也复位？
   漏传 handled 会不会导致翻页永不发生？
5. DOM 移除与提交的【顺序】：先移除再提交会导致平台判定未作答并重新渲染。
6. 重复代码：多个站点文件是否高度雷同、可否抽公共骨架。
【不要】逐条罗列"选择器可能不准"，统一归到末尾"待真机校准"。
```

### 3.4 呈现域 `presentation/`

```text
只读审查。面板 HTML 由模板字符串拼接。
重点：
1. 逐个核查每一处 innerHTML / insertAdjacentHTML 赋值点：
   拼进去的动态内容（视频 src、题目文本、站点标题、用户输入）是否转义？
   给出完整清单，每行标注"已转义/未转义/常量安全"。
2. DOM 空引用：不同站点用不同面板模板，某些元素不存在。
   找出所有 querySelector 结果未判空就 .addEventListener/.value/.textContent 的地方。
3. localStorage 键名总表：键名 -> 读位置 -> 写位置 -> 真值判断方式。
   重点标出【同一键在不同处用了不同真值判断】('1' / 'true' / 布尔) 和【默认值不一致】。
4. 重复 ensurePanel 是否造成重复绑定；面板刷新是否每次重建整棵 DOM。
5. 拖拽事件是否用 rAF / passive。
```

### 3.5 插件域 `plugins/`

```text
只读审查 registry.js 与 addons/*。
重点：
1. 每个 addon 的站点隔离守卫是否正确翻译了它原本的 @match。
2. 对核心脚本能力的探测表达式（如 typeof window.__CX_FORCE_PLAY.toast === 'function'）：
   逐个确认被探测的成员【确实挂载在那个路径上】。
   探测恒假 = 共享实现从未被复用，回退分支长期在跑——这是真缺陷。
3. 每个 addon 是否用嵌套 IIFE 隔离，有无泄漏局部变量污染核心作用域。
4. addon 注册后是否可卸载。
```

### 3.6 感知层 `perception/`（Python + 两个独立 user.js）

```text
只读审查。这一层与 JS 核心脚本无调用关系，独立成轮。
重点：
1. requests 调用是否全部设置 timeout；重试是否有上限。
2. 裸 except / except Exception 后是否 pass 掉了关键失败。
3. 文件读写是否显式指定 encoding='utf-8'。
4. 是否存在硬编码绝对路径（C:\ 开头）、写死的 Cookie/凭据。
5. cookie、dump、个人学习数据是否写入了仓库路径且未被 .gitignore 覆盖——
   请用 git ls-files 实际确认有没有被跟踪。
```

---

## 四、机械校验命令清单（提示词里直接引用，无需现编）

```powershell
# 0. 产物与源码是否同步
cd c:\Users\24033_1dhcyji\CodeBuddy\20260723173246\ecosystem
(Get-Item chaoxing-force-play.user.js).LastWriteTime
(Get-ChildItem src -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime

# 1. 产物语法
node --check chaoxing-force-play.user.js

# 2. 真实作用域静态扫描（唯一可信的 no-undef 口径）
$env:ESLINT_USE_FLAT_CONFIG='false'
node node_modules\eslint\bin\eslint.js --no-eslintrc -c _audit.eslintrc.json -f compact chaoxing-force-play.user.js

# 3. 契约核验：把 SYMBOL 换成待查符号，比较引用数与定义数
rg -n "SYMBOL" src --glob "*.js"

# 4. 量化体检（错误吞没 / DOM 查询 / 监听器收支）
node -e "const fs=require('fs');const t=fs.readFileSync('chaoxing-force-play.user.js','utf8');const c=r=>(t.match(r)||[]).length;console.log('try',c(/\btry\s*\{/g),'swallow',c(/swallow\(/g),'emptyCatch',c(/catch\s*\([a-z0-9_]+\)\s*\{\s*\}/g));console.log('addEL',c(/addEventListener\(/g),'rmEL',c(/removeEventListener\(/g));console.log('qsa',c(/querySelectorAll\(/g),'innerHTML',c(/innerHTML/g));"

# 5. 跑回归（沙箱用例需要 process.exit 才有退出码）
Get-ChildItem _sim\sim-*.js | ForEach-Object { "=== $($_.Name) ==="; node $_.FullName 2>&1 | Select-Object -Last 3 }

# 6. 敏感数据是否被跟踪
cd ..; git --no-pager ls-files | Select-String -Pattern 'cookie|dump|\.pyc|node_modules'
```

---

## 五、输出格式契约

```text
每条问题：
【src/xxx/yyy.js:123】【严重】【契约断裂】
  原文：xxxxxx
  触发：什么条件下会走到这里
  后果：用户实际看到的现象（不是"可能出错"，而是"X 功能不生效"）
  建议：具体到改成什么

分档标准（本仓库口径）：
  严重 = 核心功能静默失效 / 宿主页面状态被永久破坏 / 数据泄漏
  中等 = 特定路径下功能不可用、需刷新页面恢复、可观测性失真
  轻微 = 可维护性、死代码、命名、性能微优化

末尾固定三节：
  A. 待真机校准清单（选择器类，不计入缺陷数）
  B. 测试盲区（每个缺陷 → 为什么现有用例没抓到 → 应补什么用例）
  C. 三项评价，每项引用前文条目编号
```

---

## 六、禁止事项（写进提示词，防止低质量输出）

1. **禁止**对 `src/` 逐文件跑 `no-undef` 并把结果当缺陷 —— 1600+ 条全是误报。
2. **禁止**输出没有行号和原文摘录的结论。
3. **禁止**把 best-effort 选择器的准确性逐条当缺陷列出。
4. **禁止**把「35 个 sim 全绿」当作质量结论 —— 必须反过来审测试盲区。
5. **禁止**只读注释就相信实现（本仓库注释质量高，但存在注释承诺 11 项还原、实际会被 swallow 吞掉的情况）。
6. **禁止**在只读审查任务中修改任何文件；临时 lint 配置等产物需在结束时清理或明确告知。

---

## 七、审查者交卷前必答的 5 个问题

1. 我是在**产物**上验证的，还是只读了源码？
2. 我发现的每个「未定义/契约断裂」，是否用 grep 确认过定义数为 0？
3. 我发现的每个缺陷，**为什么 35 个测试没抓到**？
4. 我报的严重问题，能说出用户**实际看到的现象**吗？说不出就降级。
5. 我是否给出了**能一秒复现该问题的命令**？
