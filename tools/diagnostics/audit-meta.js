const projectPaths = require('./project-paths.cjs');
const fs = require("fs");
const p = process.argv[2] || projectPaths.bundle;
const c = fs.readFileSync(p, "utf8");
const lines = c.split("\n").slice(0, 20);
lines.forEach((l, i) => {
  if (/@name|@description|@version|@author|@namespace/i.test(l)) {
    console.log((i + 1) + ": " + JSON.stringify(l));
  }
});
// detect mojibake: replacement char or typical GBK-in-UTF8 patterns
const mojibake = /[缃鐢睘]/; // common garbled leads seen in meta.js
let found = false;
c.split("\n").forEach((l, i) => {
  if (mojibake.test(l)) { console.log("MOJIBAKE at line " + (i + 1) + ": " + JSON.stringify(l.slice(0, 80))); found = true; }
});
if (!found) console.log("no obvious mojibake detected in product head");
