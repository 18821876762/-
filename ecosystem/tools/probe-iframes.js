// 探测器：列出本页所有 iframe 的真实地址与可访问性（复制到控制台运行）
// 目的：定位"播放器/题目"所在 iframe 的真实域名，用于把该域补进 chaoxing-force-play.user.js 的 @match，
//       让脚本真正"侵入"跨域 iframe 完成续播/答题（解决"智慧树侵入性不够"）。
(function () {
  const frames = [...document.querySelectorAll('iframe')];
  console.log('%c[iframe 清单]', 'color:#09f;font-weight:bold', '共 ' + frames.length + ' 个');
  const cross = [];
  frames.forEach((f, i) => {
    let accessible = false, url = '(跨域无法读取地址)', cnt = '-';
    try {
      const d = f.contentDocument;
      if (d) { accessible = true; url = (f.contentDocument.location && f.contentDocument.location.href) || f.src || '(同域动态写入)'; cnt = d.getElementsByTagName('*').length; }
    } catch (e) { accessible = false; if (f.src) url = f.src; }
    if (!accessible && f.src) url = f.src;
    console.log('#' + i + ' 可访问=' + accessible + ' 元素数=' + cnt);
    console.log('   src:', f.src || '(无 src, 同域动态写入)');
    console.log('   实际URL:', url);
    if (!accessible) cross.push(url);
  });
  if (cross.length) {
    console.log('%c[跨域 iframe] 需把下列域名补进 @match 才能让脚本侵入:', 'color:#f90;font-weight:bold');
    cross.forEach(c => { try { console.log('   ' + new URL(c).host); } catch (e) { console.log('   ' + c); } });
  } else {
    console.log('无跨域 iframe，本页 iframe 均可读（同源），脚本已正常注入。');
  }
})();
