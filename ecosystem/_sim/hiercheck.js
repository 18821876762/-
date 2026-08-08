const fs = require('fs');
const p = process.argv[2];
const src = fs.readFileSync(p, 'utf8');
const start = src.indexOf('function buildPanelHTML(');
const ret = src.indexOf('return (', start);
const end = src.indexOf('\n  });', ret);
const region = src.slice(ret, end > 0 ? end : src.indexOf('\n  }', ret));

const tokens = [];
const re = /<div(\s+id="([^"]+)")?[^>]*>|<\/div>/g;
let m;
while ((m = re.exec(region))) {
  if (m[0] === '</div>') tokens.push({ close: true });
  else tokens.push({ close: false, id: m[2] || null });
}

const root = { id: '__cxPanelRoot', children: [] };
const stack = [root];
for (const t of tokens) {
  if (!t.close) {
    const node = { id: t.id, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  } else {
    if (stack.length > 1) stack.pop();
  }
}

function find(node, id) {
  if (node.id === id) return node;
  for (const c of node.children) { const r = find(c, id); if (r) return r; }
  return null;
}
function ancestors(node, id, path) {
  const n = find(node, id);
  if (!n) return null;
  return path;
}

const quiz = find(root, '__cxZoneQuiz');
const control = find(root, '__cxTab_control');
function isAncestor(anc, desc) {
  if (!anc || !desc) return false;
  if (anc === desc) return true;
  return anc.children.some(c => isAncestor(c, desc));
}

console.log('__cxZoneQuiz found      =', !!quiz);
console.log('__cxTab_control found   =', !!control);
console.log('quiz INSIDE control tab =', !!(quiz && control && isAncestor(control, quiz)));
console.log('quiz at panel root level=', !!(quiz && isAncestor(root, quiz) && !(control && isAncestor(control, quiz))));
