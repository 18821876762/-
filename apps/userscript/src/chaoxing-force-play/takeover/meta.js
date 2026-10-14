





// ==UserScript==
// @name         网课强制续播
// @namespace    https://github.com/cx-force-play/chaoxing-force-play
// @version      4.20.3
// @author       anon
// @description  网课强制续播：钻入同源 iframe / Shadow DOM 强制续播，多平台弹窗消干扰与真答题；完整变更日志见 docs/CHANGELOG.md（现行记录至 v4.20.3）
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://*.zhihuishu.com/*
// @match        *://*.xueyinonline.com/*
// @match        *://*.icourse163.org/*
// @match        *://*.icourses.cn/*
// @match        *://*.xuetangx.com/*
// @match        *://*.icve.com.cn/*
// @match        *://*.unipus.cn/*
// @match        *://*.ucampus.cn/*
// @match        *://*.ilab-x.com/*
// @match        *://*.pmphmooc.com/*
// 注：人卫慕课(renwei) 的 @match 已补全，使其真正注入（与其余 rev2 多平台一致；原缺 @match 导致整文件死代码）。
// @match        https://chat.deepseek.com/*
// @run-at       document-idle
// v4.19.50：显式声明全帧注入——学习通新版壳页(顶层)可能不被部分管理器默认注入，导致「顶层脚本=未注入」→
//             子帧各自自起主循环/跨页通道顶层封装缺失（诊断 21:29 实证）。显式声明后顶层壳 + 嵌套 iframe
//             一律注入（多数环境本就默认全帧，此为显式兜底、零行为逆差）。
// @all-frames
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM.getValue
// @grant        GM.setValue
// @compatible   Tampermonkey
// @compatible   Violentmonkey
// @compatible   Greasemonkey 4
// @license      MIT
// ==/UserScript==

/*
MIT License

Copyright (c) 2026 网课强制续播（chaoxing-force-play）contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

