const fs = require('fs');
const p = process.argv[2];
const src = fs.readFileSync(p, 'utf8');
const start = src.indexOf('function buildPanelHTML(');
if (start < 0) { console.log('buildPanelHTML not found'); process.exit(1); }
// 找 return ( ... );
const ret = src.indexOf('return (', start);
const end = src.indexOf('\n  });', ret); // buildPanelHTML 以 2 空格缩进的 }); 结束
const region = src.slice(ret, end > 0 ? end : src.indexOf('\n  }', ret));
const opens = (region.match(/<div/g) || []).length;
const closes = (region.match(/<\/div>/g) || []).length;
console.log('buildPanelHTML div open  =', opens);
console.log('buildPanelHTML div close =', closes);
console.log(opens === closes ? 'BALANCED' : 'IMBALANCED by ' + (opens - closes));
