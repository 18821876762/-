// 探针：jsdom 窗口 top 覆盖 + 同窗口 postMessage 派发支持性
const { JSDOM } = require('jsdom');

const parent = new JSDOM('<html><body></body></html>', {
  url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
parent.window.addEventListener('message', (e) => {
  console.log('PARENT GOT:', JSON.stringify(e.data), 'sameOrigin=' + (e.origin === parent.window.location.origin));
});

const child = new JSDOM('<html><body><div id="q">题</div></body></html>', {
  url: 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=1&workId=2',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});

try {
  Object.defineProperty(child.window, 'top', { value: parent.window, configurable: true });
  console.log('top override OK, child.top===parent?', child.window.top === parent.window, 'self===top?', child.window.self === child.window.top);
} catch (e) {
  console.log('top override FAILED:', String(e));
  process.exit(2);
}

// 同窗口 postMessage 自派发验证（jsdom 顶层窗口自身 postMessage）
try {
  parent.window.postMessage({ ping: 1 }, parent.window.location.origin);
  console.log('postMessage call OK');
} catch (e) {
  console.log('postMessage FAILED:', String(e));
}

setTimeout(() => { process.exit(0); }, 300);
