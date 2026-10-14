// 探针：jsdom srcdoc iframe + postMessage 支持性验证（跨帧信号灯 e2e 前置）
const { JSDOM } = require('jsdom');

const top = new JSDOM(`<!DOCTYPE html><html><body><div id="t"></div></body></html>`, {
  url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
top.window.addEventListener('message', (e) => {
  console.log('TOP GOT:', JSON.stringify(e.data), 'origin=' + e.origin, 'sameOrigin=' + (e.origin === top.window.location.origin));
});

const ifr = top.window.document.createElement('iframe');
ifr.setAttribute('srcdoc', `<!DOCTYPE html><html><body><script>
  window.parent.postMessage({ hello: 'from-child', myUrl: location.href, base: document.baseURI }, '*');
  try { window.parent.postMessage({ hello: 'from-child-targeted', myUrl: location.href }, window.parent.location.origin); } catch (e) { window.parent.postMessage({ hello: 'targeted-failed', err: String(e) }, '*'); }
<\/script></body></html>`);
top.window.document.body.appendChild(ifr);

setTimeout(() => {
  const cw = ifr.contentWindow;
  console.log('childWindow:', !!cw, 'cw.top===top?', !!(cw && cw.top === top.window), 'cw.parent===top?', !!(cw && cw.parent === top.window));
  process.exit(0);
}, 500);
