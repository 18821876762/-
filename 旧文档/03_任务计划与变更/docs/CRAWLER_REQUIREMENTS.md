# 爬虫需求（真实运行环境采集规格）

> 本文档把项目内**所有需要真实运行环境**（真机浏览器 / 登录态 / 真实 DOM）才能验证或校准的项，
> 全部固化为结构化「爬虫需求」。每条需求回答四个问题：
> 1. 去哪个站点 / 哪个页面采集？
> 2. 什么时机采集？
> 3. 采集什么（DOM 结构 / 选择器候选 / 特征）？
> 4. 采到的数据用于校准哪个源码符号？
>
> 采集载体：
> - `scripts/calibrate-dump.js` —— 粘贴到浏览器 DevTools Console 的半自动采集（只读 DOM、安全、零依赖）。
> - 输出格式：`键 = 值` 文本（`==== CALIBRATION DUMP ====` 到 `==== END ====`），一条需求一行。
>
> 现状图例：`[已校准]` / `[部分校准]` / `[best-effort 待校准]` / `[契约待联调]`

---

## 总览

| RQ | 目标 | 源码校准目标 | 现状 |
|---|---|---|---|
| RQ-01 | 超星·上课互动弹窗 | `quiz.js` `POPUP_BOX_SELS`/`POPUP_CLOSE_SELS` | [部分校准] |
| RQ-02 | 超星·作业/考试页真答题 | `chaoxing-exam.js` `CHAOXING_EXAM` | [部分校准] `.Zy_ulTop` |
| RQ-03 | 智慧树·播放器容器 | `site-router.js` `SITES.zhihuishu.taskContainerSel` | [best-effort] |
| RQ-04 | 智慧树·上课随堂弹窗 | `popup-quiz.js` `POPUP_QUIZ`/`POPUP_BASE` | [best-effort] |
| RQ-05 | 智慧树·作业/考试页 | `zhihuishu-exam.js` `CFG` | [best-effort] |
| RQ-06 | 多平台·播放器容器(8站) | `site-router.js` `SITES.*.taskContainerSel` | [best-effort] |
| RQ-07 | 多平台·真答题(renwei/unipus/ucampus/ilabx) | `quiz-selectors.js` `createQuizSelectors` | [best-effort] |
| RQ-08 | 多平台·弹窗随机作答 | `popup-quiz.js` `POPUP_QUIZ` | [best-effort] |
| RQ-09 | DeepSeek·应答端 | `vision-deepseek-web.js` `DEEPSEEK` | [已校准] `inputSel`/`msgListSel`/`lastReplySel`/`sendBtnSel`/`generatingSel` 已用 ds- 稳定前缀实证；`avatarSel` 真实页无稳定头像(改靠输入框判定)；另修复应答轮询容器 bug |
| RQ-10 | edu.cn·高校镜像识别 | `site-router.js` `isChaoxingEduCn` | [best-effort] |
| RQ-11 | 视觉识别层·多模态端点契约 | `quiz-vision.js` `QUIZ_VISION_ENDPOINT` | [契约待联调] |

---

## RQ-01 · 超星学习通·上课互动弹窗

- **目标站点**：`*.chaoxing.com`（含学银在线 `*.xueyinonline.com`）
- **目标页面**：上课/随堂互动题弹出时所在页（课程视频页或互动页），**先让弹窗出现再采集**
- **采集时机**：弹窗可见、题目与选项已渲染时
- **采集内容**：
  - 弹窗容器 class（校准 `POPUP_BOX_SELS`：`.dialog,.modal,.popup,[class*="dialog"]...`）
  - 关闭按钮 class / aria-label（校准 `POPUP_CLOSE_SELS`）
  - 题目容器 class（校准 `CHAOXING_EXAM.questionSels`）
  - 选项容器 class（校准 `CHAOXING_EXAM.optionSels`）
  - 提交按钮 class（校准 `CHAOXING_EXAM.submitSels`）
- **采集脚本**：`calibrate-dump.js` → 超星弹窗校准区
- **验收**：`POPUP_BOX`/`POPUP_CLOSE`/`QUESTION_EL`/`OPTION_EL`/`SUBMIT_BTN` 五项全部非"未命中"。

## RQ-02 · 超星作业/考试页真答题

- **目标站点**：`*.chaoxing.com`（作业/考试 URL 含 `doHomeWorkNew` 等）
- **目标页面**：作业/考试答题页（非弹窗）
- **采集时机**：题目渲染完成后
- **采集内容**：
  - 单题容器 class（校准 `CHAOXING_EXAM.questionSels`，`.Zy_ulTop` 已校准为选项列表）
  - **题干容器 class**（校准 `CHAOXING_EXAM.stemSels` —— 目前 best-effort，bank/ai 精答依赖，需真实结构补）
  - 选项 li class / 选中态标记（校准 `optionSels`）
  - 提交/交卷按钮 class（校准 `submitSels`）
- **采集脚本**：`calibrate-dump.js` → 超星作业页校准区
- **验收**：`STEM_EL`/`OPTION_EL`/`SUBMIT_BTN` 非"未命中"；`OPTION_CHECKED_ATTR` 给出真实选中态属性（如 `aria-checked`）。

## RQ-03 · 智慧树播放器容器

- **目标站点**：`*.zhihuishu.com`
- **目标页面**：视频学习页
- **采集时机**：视频已加载（有 `<video>` 元素）后
- **采集内容**：
  - 视频容器 class（校准 `SITES.zhihuishu.taskContainerSel`：`.video-container, .player, #video, .tk-container`）
  - 真实 `<video>` 元素 class / 包裹层级
- **采集脚本**：`calibrate-dump.js` → 多平台播放器容器校准区（按 host 分发）
- **验收**：`VIDEO_CT_TRY` 非"未命中"，且指向真实播放器容器。

## RQ-04 · 智慧树上课随堂弹窗

- **目标站点**：`*.zhihuishu.com`
- **目标页面**：上课/随堂题弹窗出现时所在页，**先让弹窗出现再采集**
- **采集时机**：弹窗可见、选项渲染后
- **采集内容**：
  - 弹窗容器 class（校准 `POPUP_QUIZ.dialogSels` / `POPUP_BASE.dialogSels`）
  - 选项 class（校准 `optionSels`）
  - 作答/提交/跳过按钮 class（校准 `answerBtnSels`）
- **采集脚本**：`calibrate-dump.js` → 智慧树弹窗校准区（新增）
- **验收**：`POPUP_BOX`/`OPTION_EL`/`ANSWER_BTN` 非"未命中"。

## RQ-05 · 智慧树作业/考试页

- **目标站点**：`*.zhihuishu.com`
- **目标页面**：作业/考试答题页（URL 命中 `CFG.URL_RE`：`dohomework|webExamList|stuExamWeb|doExam|examList|onlineExam|exam|homework|doHomeWork`）
- **采集时机**：题目渲染完成后
- **采集内容**：
  - 题目容器 class（校准 `CFG.questionSels`）
  - 选项 class（校准 `CFG.optionSels`）
  - 翻页/下一题按钮 class（校准 `CFG.nextSels`）
  - 提交按钮 class（校准 `CFG.submitSels`）
  - 页面 URL 片段（复核 `CFG.URL_RE` 命中）
- **采集脚本**：`calibrate-dump.js` → 智慧树作业页校准区（新增）
- **验收**：`QUESTION_EL`/`OPTION_EL`/`NEXT_BTN`/`SUBMIT_BTN` 非"未命中"。

## RQ-06 · 多平台播放器容器（8 站）

- **目标站点**：`icourse163.org` / `icourses.cn` / `xuetangx.com` / `icve.com.cn` / `renwei.*`/`pmphmooc.com` / `unipus.cn` / `ucampus.cn` / `ilab-x.com`
- **目标页面**：各站视频学习页
- **采集时机**：视频已加载后
- **采集内容**：视频容器 class（逐站校准 `SITES.*.taskContainerSel`）
- **采集脚本**：`calibrate-dump.js` → 多平台播放器容器校准区（按 host 分发，已存在）
- **验收**：每站 `VIDEO_CT_TRY` 非"未命中"。

## RQ-07 · 多平台真答题（renwei / unipus / ucampus / ilabx）

- **目标站点**：`pmphmooc.com`/`*.renwei.*` / `unipus.cn` / `ucampus.cn` / `ilab-x.com`
- **目标页面**：作业/章节测验题页
- **采集时机**：题目渲染完成后
- **采集内容**：
  - 题目容器 class（校准 `createQuizSelectors` 的 `questionSels`，第三项各站不同）
  - 题干 class（校准 `stemSels`）
  - 选项 class（校准 `optionSels`）
  - 提交按钮 class（校准 `submitSels`）
- **采集脚本**：`calibrate-dump.js` → 多平台真答题校准区（新增）
- **验收**：`QUESTION_EL`/`STEM_EL`/`OPTION_EL`/`SUBMIT_BTN` 非"未命中"。

## RQ-08 · 多平台弹窗随机作答（icourse163 / xuetangx / icve）

- **目标站点**：`icourse163.org` / `icourses.cn` / `xuetangx.com` / `icve.com.cn`
- **目标页面**：上课/随堂弹窗出现时所在页，**先让弹窗出现再采集**
- **采集时机**：弹窗可见、选项渲染后
- **采集内容**：弹窗容器 / 选项 / 作答按钮 class（校准 `POPUP_QUIZ`）
- **采集脚本**：`calibrate-dump.js` → 智慧树弹窗校准区共用（站点无关骨架）
- **验收**：`POPUP_BOX`/`OPTION_EL`/`ANSWER_BTN` 非"未命中"。

## RQ-09 · DeepSeek 应答端

- **目标站点**：`chat.deepseek.com`
- **目标页面**：已登录的对话页，**发过至少一条消息后**采集
- **采集时机**：AI 回复完成后（非生成中）
- **采集内容**（逐项校准 `DEEPSEEK` 对象，状态以 `✅已校准 / ⏳待采` 标注）：
  - 登录按钮（`loginBtnSel`）：✅ best-effort（实测 LOGIN_BTN 未命中=已登录，逻辑正确）
  - 账户头像（`avatarSel`）：⏳ 实测真实页未暴露稳定头像 img（AVATAR_CANDIDATES 仅命中 `site_logo` 站点 logo），保留 best-effort；登录态改靠输入框存在判定（`_dsIsLoggedIn` 第82行），不阻塞可用性
  - 输入框（`inputSel`）：✅ `textarea.ds-scroll-area`（实测 `INPUT_STABLE = ds-scroll-area...`）
  - 文件上传（`fileInputSel`）：✅ best-effort（回退 `input[type=file]`）
  - 发送按钮（`sendBtnSel`）：✅ `div.ds-button--iconLabelPrimary`（实测新 UI 无 `<button>`/无文本；`_dsFindSendBtn` 按 composer 容器/屏幕最靠下消歧 3 个候选）
  - 消息列表（`msgListSel`）：✅ `.ds-virtual-list`（实测对话虚拟列表根，单条 `.ds-message`）
  - 末条回复元素（`lastReplySel`）：✅ `.ds-markdown.ds-assistant-message-main-content`（实测最新助手消息内的回复块）
  - 生成中指示器（`generatingSel`）：✅ `div.site_logo_loading.site_logo_fallback`（实测生成中 logo 动画，位于最新助手消息内）+ loading/thinking/generating 兜底
- **附带修复**：旧版把 `lastReplySel` 同时当"回复块"与"列表容器"，`querySelector` 命中回复块本身导致 `_dsLatestReply` 永远查不到消息、应答轮询失效；已拆为 `msgListSel`(容器) + `lastReplySel`(回复块)。
- **采集脚本**：`calibrate-dump.js` → DeepSeek 校准区（已存在，SEND_CANDIDATES/AVATAR_CANDIDATES 枚举已就位）
- **验收**：`MSG_LIST=div.ds-message`、`LAST_MSG_EL=div.ds-markdown.ds-assistant-message-main-content`、`GENERATING=div.site_logo_loading` 均已实证；responder 重建后跑 `_sim` 全量回归。

## RQ-10 · edu.cn 高校镜像识别

- **目标站点**：`*.edu.cn` 高校镜像（超星承建课程平台）
- **目标页面**：视频学习页
- **采集时机**：页面加载后
- **采集内容**（逐项校准 `isChaoxingEduCn` 三个特征）：
  - 主机名子域特征（`mooc|learn|course|study|class|kczy|sxk|mycourse|visit|space` 等超星典型前缀是否命中）
  - 路径特征（`/learn|/mooc|/course|/mycourse|/visit|/knowledge|/work|/exam|/space|/study|/portal|/mooc-ans`）
  - 运行时全局特征（`window.ananas` 是否存在、`window.attachments` 是否数组）
- **采集脚本**：`calibrate-dump.js` → edu.cn 特征校准区（新增）
- **验收**：`HOST_FEAT`/`PATH_FEAT`/`GLOBALS` 如实反映真实镜像特征，据此收紧 `isChaoxingEduCn`。

## RQ-11 · 视觉识别层·多模态端点契约

- **性质**：非 DOM 采集，属**后端联调契约**（`quiz-vision.js` 视觉层把题目区域截图发给多模态 AI，返回 `{text, answer}`）。
- **需求内容**：
  1. `CONFIG.QUIZ_VISION_ENDPOINT` 指向可用的多模态 AI 服务；
  2. 请求体携带截图（base64 或 URL）与题目区域文本；
  3. 响应体契约：`{ text: string, answer: string|number }`（需与真实端点联调确认字段名/格式）；
  4. 隐私确认开关（用户授权后才上传截图）。
- **验收**：在真实页面对一道真实题目发起视觉识别，返回字段与契约一致且答案可回填。

---

## 采集脚本现状与升级对照

| RQ | `calibrate-dump.js` 现状 | 本次升级 |
|---|---|---|
| RQ-01 | ✅ 超星弹窗校准区 | 保持 |
| RQ-02 | ❌ 未覆盖 | **新增** 超星作业页校准区（题干容器） |
| RQ-03 | ✅ 多平台播放器容器区（含 zhihuishu） | 保持 |
| RQ-04 | ❌ 未覆盖智慧树弹窗 | **新增** 智慧树弹窗校准区（与超星弹窗合并为通用弹窗区，按站点分发） |
| RQ-05 | ❌ 未覆盖 | **新增** 智慧树作业页校准区 |
| RQ-06 | ✅ 多平台播放器容器区 | 保持 |
| RQ-07 | ❌ 未覆盖 | **新增** 多平台真答题校准区 |
| RQ-08 | ❌ 未覆盖（与 RQ-04 共用骨架） | **新增**（合并进通用弹窗区） |
| RQ-09 | ✅ DeepSeek 校准区 | 保持 |
| RQ-10 | ❌ 未覆盖 | **新增** edu.cn 特征校准区 |
| RQ-11 | —（后端契约，非 DOM） | 在本文档登记，不落 Console 脚本 |

## 反馈与校准流程

1. 打开目标站点/页面，按 RQ 指定的「采集时机」准备好页面状态；
2. 粘贴 `scripts/calibrate-dump.js` 到 DevTools Console 运行；
3. 复制 `==== CALIBRATION DUMP ====` 到 `==== END ====` 的内容发回，并注明 RQ 编号 / 站点 / 页面；
4. 收到后：用真实 class 替换对应源码符号 → 重建产物 → 补回归断言（若可用 fixture）。

## 安全承诺

- 采集脚本只读 DOM：不修改页面、不触发点击、不发网络请求、不上传任何数据。
- 视觉识别层（RQ-11）上传截图前必须显式授权（默认关闭）。
