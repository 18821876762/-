# 真实站点校准指南（best-effort → 精准命中）

> 代码侧所有功能已实现，但部分**选择器/平台特征**是按常见结构"猜"的（best-effort），
> 必须在**真实目标网页**用 DevTools 校准才能精准命中。本指南给出：
> 1. 待校准项清单（文件/行/当前值）
> 2. 一键采集脚本用法
> 3. 反馈格式
>
> 这些只能由你在浏览器实测完成——AI 无法访问你的登录态与真实页面。
>
> **全量需求清单**：本指南对应的每条采集目标都已固化为结构化「爬虫需求」，
> 见 [`docs/CRAWLER_REQUIREMENTS.md`](CRAWLER_REQUIREMENTS.md)（RQ-01..RQ-11，含采集站点/时机/内容/验收）。
> 反馈时请注明对应 RQ 编号，便于开发方精确定位替换点。

---

## 一、待校准项清单

### A. 超星学习通·上课互动弹窗（`ecosystem/src/chaoxing-force-play/takeover/engine/quiz.js`）
| 变量 | 行 | 当前值（best-effort） | 需校准为 |
|---|---|---|---|
| `POPUP_BOX_SELS` | 29 | 含 `[class*="dialog"]`/`[class*="popup"]` 等并集 | 真实弹窗容器 class |
| `POPUP_CLOSE_SELS` | 30 | 含 `[class*="close"]`/`button[aria-label*="关闭"]` | 真实关闭按钮选择器 |
| 题目容器/选项/提交 | 见 `CHAOXING_EXAM`（sites/chaoxing-exam.js） | `.questionLi`/`.choice` 等并集 | 真实题目页 class |

> 校准后行为：弹窗作答一次→真正关闭→不再重弹（"删→弹"循环已修复，选择器精准后效果最佳）。

### B. DeepSeek 应答端（`takeover/engine/vision-deepseek-web.js` `DEEPSEEK` 对象 行15–30）
| 字段 | 行 | 状态 |
|---|---|---|
| `loginBtnSel` | 17 | 回退（含 `a:contains` 非标准选择器，需校准） |
| `avatarSel` | 18 | 回退 |
| `inputSel` | 20 | ✅ 已校准 `textarea[placeholder^="给 DeepSeek 发送消息"]`，保留回退 |
| `fileInputSel` | 22 | 回退 `input[type=file]` |
| `sendBtnSel` | 24 | 回退 `button[aria-label*="发送"]` |
| `msgListSel` | 26 | 回退 `[role="list"]`/`.chat-messages` |
| `lastReplySel` | 28 | 回退同上 |
| `generatingSel` | 30 | 回退 `[class*="loading"]` 等 |

### C. 多平台播放器容器（`takeover/foundation/site/site-router.js` `SITES` 行46–95）
| 站点 | 行 | 当前值 |
|---|---|---|
| `zhihuishu` | 61 | `.video-container, .player, #video, .tk-container` |
| `icourse163` | 69 | `.course-content, .video-wrap, ...` |
| `xuetangx` | 73 | `.video-container, #video-box, ...` |
| `icve` | 77 | `.video-box, #player, ...` |
| `renwei` | 81 | `.video-wrap, #video, ...` |
| `unipus` | 85 | `.video-container, #video, ...` |
| `ucampus` | 89 | `.video-box, #video, ...` |
| `ilabx` | 93 | `.video-wrap, #video, ...` |

> 这些 `taskContainerSel` 均为 best-effort 猜测，续播兜底已能工作（全量+原型级 pause 中性化），
> 校准后可让"定向续播"更稳。

### D. 智慧树作业/考试页（`sites/zhihuishu-exam.js` `CFG` 行32–43，RQ-05）
| 字段 | 行 | 当前值（best-effort） | 需校准为 |
|---|---|---|---|
| `URL_RE` | 35 | `/(^|\/)(dohomework\|webExamList\|stuExamWeb\|doExam\|examList\|onlineExam\|exam\|homework\|doHomeWork)(?!\[a-z0-9\])/i` | 复核真实作业页 URL 命中 |
| `questionSels` | 36–38 | `.question-item`/`.topic-item`/`[class*="question-box"]` 等并集 | 真实题目容器 class |
| `optionSels` | 39–40 | `.option-item`/`.choice-item`/`label` 等并集 | 真实选项 class |
| `nextSels` | 41 | `.next-page`/`.next`/`a[title*="下一"]` 等并集 | 真实翻页按钮 |
| `submitSels` | 42 | `.submit-btn`/`.btn-submit` 等并集 | 真实提交按钮 |

### E. 多平台真答题（`sites/quiz-selectors.js` `createQuizSelectors` 行5–12，RQ-07）
| 字段 | 当前值 | 需校准为 |
|---|---|---|
| `questionSels[2]` | 四站各不同（第三项由调用方传入） | 各站真实题目容器 |
| `stemSels` | `.stem`/`.question-title` 等 | 各站真实题干 |
| `optionSels` | `.option-item`/`li[class*="option"]` 等 | 各站真实选项 |
| `submitSels` | `.submit-btn`/`.answer-btn` 等 | 各站真实提交按钮 |

### F. edu.cn 高校镜像识别（`takeover/foundation/site/site-router.js` `isChaoxingEduCn` 行47–55，RQ-10）
| 特征 | 当前值 | 需校准为 |
|---|---|---|
| 主机子域 | `/(^|[-.])(mooc\|learn\|course\|study\|class\|kczy\|sxk\|mycourse\|visit\|space)\./i` | 真实镜像主机是否命中 |
| 路径前缀 | `/learn\|/mooc\|/course\|/mycourse\|/visit\|/knowledge\|/work\|/exam\|/space\|/study\|/portal\|/mooc-ans` | 真实镜像路径是否命中 |
| 运行时全局 | `window.ananas` 就绪 / `window.attachments` 为数组 | 真实镜像是否有这两个全局 |

> RQ-01/02/04/08/09 见上文 A/B 及弹窗区；RQ-11（视觉识别端点）为后端契约，见 `docs/CRAWLER_REQUIREMENTS.md`。

---

## 二、一键采集脚本

文件：`scripts/calibrate-dump.js`（也可在 `docs/` 同目录找到）。

**脚本已按站点自动分发**：在同一站点页面运行一次即可采集该站全部相关项——
- 超星（`*.chaoxing.com` / `*.xueyinonline.com` / `*.edu.cn` 镜像）→ 弹窗区 + 作业页区 + 播放器容器
- 智慧树（`*.zhihuishu.com`）→ 随堂弹窗区 + 作业页区 + 播放器容器
- 多平台（`icourse163.org` / `xuetangx.com` / `icve.com.cn` 等）→ 弹窗区 + 真答题区 + 播放器容器
- DeepSeek（`chat.deepseek.com`）→ 应答端选择器
- 任意 `*.edu.cn` → 镜像特征（RQ-10）

**步骤**（以超星弹窗为例，DeepSeek/多平台同理）：
1. 浏览器打开目标页面（超星：进入有上课互动弹窗的课程，并**等弹窗弹出**；DeepSeek：进入对话页发过一条消息后）。
2. `F12` → **Console** 面板。
3. 把 `scripts/calibrate-dump.js` **全部内容粘贴**进控制台，回车。
4. 控制台会打印：
   ```
   ==== CALIBRATION DUMP ====
   PAGE_HOST = ...
   POPUP_BOX = div.xxx-dialog ...
   POPUP_CLOSE = button.close-btn [aria-label="关闭"]
   ...
   ==== END ====
   ```
5. **复制 `==== CALIBRATION DUMP ====` 到 `==== END ====` 之间的全部内容**发回即可。

脚本只读 DOM、不修改页面、不发网络请求，安全。脚本会尝试自动写入剪贴板。

---

## 三、反馈格式

把采集到的 dump 文本发回，并注明**对应平台/页面**，例如：

```
【超星学习通·上课互动弹窗】
==== CALIBRATION DUMP ====
PAGE_HOST = mooc1.chaoxing.com
POPUP_BOX = div.qz-dialog-mask
POPUP_CLOSE = button.dialog-close-btn [aria-label="关闭"]
QUESTION_EL = div.topic-item
OPTION_EL = li.answer-option
SUBMIT_BTN = button.btn-submit
==== END ====
```

收到后我会：用真实 class 替换对应的 `POPUP_BOX_SELS`/`POPUP_CLOSE_SELS`/`DEEPSEEK.*`/`SITES.*`，
重建产物，并补一条针对该平台的回归断言（若有可用 fixture）。

---

## 四、常见问题

- **采集时弹窗没出现？** 超星弹窗需"老师发起互动题 + 你进入答题页"才渲染，脚本只在弹窗可见时才能拿到真实 class；可让脚本在弹窗弹出瞬间再跑一次。
- **DeepSeek 登录态判断不准？** 多半是 `loginBtnSel`/`avatarSel` 不命中，用采集脚本拿真实值后替换即可。
- **替换后还需重装吗？** 是——改完需重新**覆盖安装** `ecosystem/chaoxing-force-play.user.js`（油猴/暴力猴里更新文件）。
