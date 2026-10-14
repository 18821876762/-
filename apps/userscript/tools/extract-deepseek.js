// 提取器：DeepSeek 对话页校准（复制到控制台运行）
// 输出校准 vision-deepseek-web.js 所需的 4 块结构：输入框 / 发送按钮 / 消息容器 / 生成中节点
// 注意：本文件是浏览器控制台工具，不参与 chaoxing-force-play 构建（不在 build-force-play.ps1 的 $domainRel 内）
(function () {
  const out = {};
  const ta = document.querySelector('textarea[placeholder^="给 DeepSeek 发送消息"]');
  out.input = ta ? ta.outerHTML.slice(0, 300) : '未找到输入框';

  const box = ta ? (ta.closest('form') || ta.parentElement) : null;
  const btns = box ? [...box.querySelectorAll('button')] : [];
  out.sendBtn = btns.length ? btns[btns.length - 1].outerHTML.slice(0, 200) : '未找到发送按钮';

  // 文件上传 input（图片作答用）
  const fileInputs = [...document.querySelectorAll('input[type=file]')];
  out.fileInputs = fileInputs.length
    ? fileInputs.map(f => (f.className || '') + ' accept=' + (f.accept || '')).slice(0, 3)
    : '未找到 file input';

  // 消息容器：取包含最多文本的滚动区
  const cand = [...document.querySelectorAll('div')].filter(d => (d.innerText || '').length > 200);
  cand.sort((a, b) => b.innerText.length - a.innerText.length);
  out.msgBox = cand[0]
    ? ('class=' + (cand[0].className || '') + ' id=' + (cand[0].id || '') + '\n' + cand[0].outerHTML.slice(0, 400))
    : '未找到';

  // 生成中节点（停止轮询的判据）
  const gen = [...document.querySelectorAll('*')].find(e =>
    /生成中|正在思考|思考中|正在生成|typing/i.test(e.innerText || '') && (e.innerText || '').length < 40);
  out.generatingHint = gen ? ('class=' + (gen.className || '') + ' text=' + gen.innerText) : '未检测到明显的生成中节点';

  console.log(JSON.stringify(out, null, 2));
})();
