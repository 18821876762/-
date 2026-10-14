const fs = require("fs");
const path = require('path');
const projectPaths = require('./project-paths.cjs');
const input = process.argv[2] ? path.resolve(process.argv[2]) : projectPaths.outputRoot;
const files = fs.statSync(input).isFile() ? [input] : fs.readdirSync(input)
  .filter(f => f.toLowerCase().endsWith('.pptx')).sort().map(f => path.join(input, f));
if (!files.length) { console.log("no pptx found"); process.exit(1); }
const fn = files[0];
const buf = fs.readFileSync(fn);
const str = buf.toString("latin1");
const m = str.match(/ppt\/slides\/slide\d+\.xml/g) || [];
const set = new Set(m);
const count = set.size;
console.log("file:", fn);
console.log("size:", buf.length);
console.log("slide count:", count);
const missing = [];
for (let i = 1; i <= count; i++) if (!set.has("ppt/slides/slide" + i + ".xml")) missing.push(i);
console.log("sequence missing:", missing.length ? missing : "none");
