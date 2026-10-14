# 元素 dump 研究结论

研究对象：`学习通视频元素.txt`（超星学生学习页）、`deep seek元素.txt`（DeepSeek 网页版）。
目的：对照现有 `chaoxing-force-play` 代码选择器，校准视频续播与 DeepSeek 应答端。

## 1. 学习通视频元素.txt（超星学生学习页）

### 1.1 真实 DOM 结构
- 卡片容器 iframe：`<iframe id="iframe" info="card" src="/mooc-ans/knowledge/cards?...">`（第1963行）
- 嵌套视频 iframe：`#iframe` 内部的 `iframe[objectid][jobid][mid]`（视频播放器宿主，第1161-1171行）
- 视频元素：`video#video_html5_api`（video.js 生成的底层 `<video>`，第3390、4621行）
- 播放器：video.js，大播放按钮 `.vjs-big-play-button`（第1171、3379、4620行），播放 API `videojs("video")`

即层级：`#iframe` → 嵌套 `iframe[objectid][jobid][mid]` → `video#video_html5_api` + `.vjs-big-play-button`。

### 1.2 与现有代码对照（无需改动）
- `dom.js` 的 `walkVideos`：用 `getElementsByTagName('video')` 快照遍历（第272行），并递归下钻所有 `iframe`（`querySelectorAll('iframe')` → `contentDocument` → `walkVideos`，第294-310行）。该机制能找到嵌套 iframe 内的 `video#video_html5_api`，对每个 video 调 `onVideo` → `overrideVideo`（`safePlay` + `pause` no-op 接管）。
- 主视频 iframe 同域（mooc1.chaoxing.com），`contentDocument` 可访问，非 `sandbox` 跨域隔离。
- 结论：**现有超星视频续播机制可正确接管该真实结构，选择器无需修改。**

## 2. deep seek元素.txt（DeepSeek 网页版）

### 2.1 诊断：静态外壳，无运行时 DOM
- 含 `#root`，但搜索 `contenteditable` → **0 命中**；输入框/发送按钮/回复气泡在静态 HTML 中均不存在。
- 该文件是 React SPA 的**初始 HTML 外壳**（head 内大量 SDK：volcengine apmPlus、dataFinder、SRI 校验脚本、main 包懒加载）。聊天界面由 JS 运行时渲染进 `#root`。
- 结论：**此 dump 不含运行时 DOM，无法用于校准 responder 选择器，必须在 DeepSeek 真实页面运行时抓取。**

### 2.2 现有 responder 选择器状态（`vision-deepseek-web.js`）
| 选择器 | 当前值 | 状态 |
|---|---|---|
| `inputSel` | `textarea[placeholder^="给 DeepSeek 发送消息"]` | 已校准，带回退 `textarea,[contenteditable=true]` |
| `sendBtnSel` | `TODO` | 待校准，回退 `button[aria-label*=发送]:last-of-type` |
| `fileInputSel` | `TODO` | 待校准，回退 `input[type=file]` |
| `msgListSel` | `TODO` | 待校准 |
| `lastReplySel` | `TODO` | 待校准 |
| `generatingSel` | `TODO` | 待校准 |
| `avatarSel` / `loginBtnSel` | `TODO` | 待校准（登录态用"存在输入框=已登录"启发式判定） |

## 3. 下一步：校准 DeepSeek responder（需要运行时抓取）

请在 DeepSeek 聊天页（已登录、输入框可见）的开发者工具控制台运行下面片段，把输出发回，我据此替换上述 `TODO`：

```js
function sel(el){ if(!el) return null; let p=el, a=[];
  while(p && p.nodeType===1){ const cls=[...p.classList].map(c=>'.'+c).join('');
    a.unshift(p.tagName.toLowerCase()+cls+(p.id?'#'+p.id:'')); p=p.parentElement; }
  return a.join(' > '); }
const input = document.querySelector('textarea, [contenteditable="true"]');
const sendBtn = [...document.querySelectorAll('button')].find(b=>(b.textContent||b.getAttribute('aria-label')||'').match(/发送|send/i));
const allMsg = document.querySelectorAll('[role=list] > *, [class*=message]');
console.log('INPUT:', sel(input));
console.log('SEND:', sel(sendBtn));
console.log('LAST_REPLY:', sel(allMsg[allMsg.length-1]));
```

## 4. 结论
- 学习通视频 dump：验证现有嵌套 iframe + video.js 续播机制正确，无需改代码。该文件同时印证了此前 `auto-next` 任务点 `li[onclick][title=章节测验]` 的校准方向。
- DeepSeek dump：为空壳初始 HTML，无法校准；responder 的发送/回复/生成中/头像/登录按钮选择器中多数仍为 `TODO`，须运行时抓取后校准。
