// 测试 fixture：还原 sim-dump-elements.js 所需的真实站点结构模拟 HTML。
// 注意：本文件为 synthetic 还原（原始 DOM dump 已不可恢复），仅保证各断言的 selector 命中预期成立，
// 用于「选择器能正确命中」的校准回归。真机校准仍需用真实 dump 替换。
// 对应断言：sim-dump-elements.js A1–A4 / B1–B4。
module.exports = {
  // 学习通课程/视频页（含 id=iframe 容器 + 任务点列表）。
  // 结构：5 个 li[onclick]；其中「第一章/第二章 章节测验」2 个候选；
  // 一个 li.active（视频任务点）位于第一章之后、第二章之前，供 active 锚定测试。
  chaoxingStudyHtml: function () {
    return [
      '<html><body>',
      '<iframe id="iframe" src="about:blank"></iframe>',
      '<ul id="task-list">',
      '  <li onclick="go(1)" title="第一章 章节测验">第一章 章节测验</li>',
      '  <li onclick="go(2)" title="视频任务点 1.1" class="active">视频任务点</li>',
      '  <li onclick="go(3)" title="第二章 章节测验">第二章 章节测验</li>',
      '  <li onclick="go(4)" title="单元作业">单元作业</li>',
      '  <li onclick="go(5)" title="课程讨论">课程讨论</li>',
      '</ul>',
      '</body></html>'
    ].join('\n');
  },

  // 嵌套 iframe 播放器内容（jsdom 多数版本 contentDocument 为 null → sim 走 SKIP 分支，
  // 这里仍提供完整结构以备跨 frame 支持）。
  chaoxingPlayerIframeHtml: function () {
    return [
      '<html><body>',
      '  <video id="video_html5_api" objectid="abc123objectid" class="vjs-tech"></video>',
      '  <button class="vjs-big-play-button" type="button"></button>',
      '  <iframe objectid="abc123objectid" src="about:blank"></iframe>',
      '</body></html>'
    ].join('\n');
  },

  // 平铺版播放器（专测选择器命中，不依赖跨 frame）。
  chaoxingFlatPlayerHtml: function () {
    return [
      '<html><body>',
      '  <video id="video_html5_api" objectid="abc123objectid" class="vjs-tech"></video>',
      '  <button class="vjs-big-play-button" type="button"></button>',
      '</body></html>'
    ].join('\n');
  },

  // 注入 window.attachments 的脚本（targeting.js 定向白名单依赖）。
  chaoxingAttachmentsScript: function () {
    return [
      'window.attachments = [',
      '  { property: { objectid: "abc123objectid", type: "video" } },',
      '  { property: { objectid: "doc-other", type: "doc" } }',
      '];'
    ].join('\n');
  },

  // DeepSeek SPA 外壳（静态 dump 真实样子：#root 空壳，无运行时聊天 DOM）。
  deepseekShellHtml: function () {
    return [
      '<html><head><script src="/static/js/app.js"></script></head><body>',
      '<div id="root"></div>',
      '</body></html>'
    ].join('\n');
  },

  // DeepSeek 运行时聊天 DOM（按 [RQ-09] 真实 chat.deepseek.com dump 校准结构模拟）→ responder 命中逻辑。
  // 实测结构：列表容器 .ds-virtual-list > 单条 .ds-message；助手回复块 .ds-markdown.ds-assistant-message-main-content；
  // 输入框 textarea.ds-scroll-area；发送按钮 div.ds-button--iconLabelPrimary（新 UI 无 <button>/无文本）。
  deepseekChatHtml: function () {
    return [
      '<html><body><div id="root">',
      '  <div class="ds-virtual-list">',
      '    <div class="ds-message">用户的问题</div>',
      '    <div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content">AI 的回复内容</div></div>',
      '  </div>',
      '  <textarea class="ds-scroll-area" placeholder="给 DeepSeek 发送消息"></textarea>',
      '  <div class="ds-button ds-button--iconLabelPrimary" role="button">发送</div>',
      '</div></body></html>'
    ].join('\n');
  },

  // DeepSeek 生成中状态：末条助手消息内含 site_logo_loading 生成中 logo 动画（[RQ-09] 实测）。
  deepseekChatGeneratingHtml: function () {
    return [
      '<html><body><div id="root">',
      '  <div class="ds-virtual-list">',
      '    <div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content">已回复内容</div></div>',
      '    <div class="ds-message"><div class="ds-markdown ds-assistant-message-main-content"><div class="site_logo_loading">思考中…</div></div></div>',
      '  </div>',
      '</div></body></html>'
    ].join('\n');
  }
};
