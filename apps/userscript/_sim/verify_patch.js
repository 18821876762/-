const s = require('fs').readFileSync(require('../scripts/project-paths.cjs').personalProduct, 'utf8');
const tests = {
  fileFallback: s.includes('input[type=file]'),
  pasteFallback: s.includes('ClipboardEvent'),
  listedExclusion: s.includes('listed <= 1'),
  weakModeSingleLetter: s.includes('[A-D])'),
  dispatchChange: s.includes("'change'"),
};
let ok = true;
for (const k in tests) { if (!tests[k]) ok = false; }
console.log(JSON.stringify(tests, null, 2));
console.log(ok ? 'ALL_PATCH_OK' : 'PATCH_MISSING');
