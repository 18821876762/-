// 验证 jsdom 服务端的 DOM 操作与 HTML 解析能力
// 运行: node scripts/dom-check.js
const { JSDOM } = require('jsdom');

const html = `
<!DOCTYPE html>
<html>
  <head><title>demo</title></head>
  <body>
    <ul id="list">
      <li class="item">a</li>
      <li class="item">b</li>
    </ul>
  </body>
</html>
`;

const dom = new JSDOM(html, { url: 'https://example.com/' });
const { document } = dom.window;

// 1) HTML 解析
const items = document.querySelectorAll('.item');
console.log('解析到 .item 数量:', items.length); // 期望 2

// 2) DOM 操作：新增节点
const li = document.createElement('li');
li.className = 'item';
li.textContent = 'c';
document.getElementById('list').appendChild(li);
console.log('追加后 .item 数量:', document.querySelectorAll('.item').length); // 期望 3

// 3) 文本/选择器
console.log('title 文本:', document.querySelector('title').textContent); // demo
console.log('第三个 item 文本:', document.querySelectorAll('.item')[2].textContent); // c

console.log('jsdom 引入与 DOM 操作验证成功 (jsdom', require('jsdom/package.json').version + ')');
