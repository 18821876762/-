// 提取器：学习通章节页下钻同源 iframe(#iframe) 提取内部 DOM（复制到控制台运行）
// 脚本本身已注入该同源 iframe（core.js 不 return 同源 iframe），但本工具用于"抓取真实 HTML 校准选择器"
// 注意：本文件是浏览器控制台工具，不参与 chaoxing-force-play 构建
(function () {
  const f = document.getElementById('iframe');
  if (!f) { console.log('本页无 #iframe（可能不是章节页外壳）'); return; }
  let doc;
  try { doc = f.contentDocument; } catch (e) { console.log('跨域无法读取(应同源):', e.message); return; }
  if (!doc || !doc.documentElement) { console.log('iframe 尚未加载或跨域'); return; }
  const html = doc.documentElement.outerHTML;
  navigator.clipboard.writeText(html).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = html; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  });
  console.log('iframe 内部 DOM 已复制(' + html.length + ' 字符)。');
  console.log('视频容器数:', doc.querySelectorAll('.ans-attach-ct, .video-container, video').length);
  console.log('题目容器数:', doc.querySelectorAll('.questionLi, .topic-item, .questionBox, .qItem').length);
  console.log('选项数:', doc.querySelectorAll('.answerBg, .answerOption, .option, .choice, .select-item').length);
})();
