// 构建产物体积门禁（来自 code review 的"自动化体积检查"建议）
// 构建后的单文件 user.js 体积超过软阈值则警告，超过硬阈值则失败（退出码 1）。
// 阈值按经验设定：单文件油猴脚本通常在 50–150KB；200KB 软限给重构留余量，300KB 硬限防意外膨胀。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'chaoxing-force-play.user.js');
const WARN = 250 * 1024; // 250 KB（未压缩单文件含完整面板 UI，实测 ~212KB，留余量）
const HARD = 300 * 1024; // 300 KB

if (!fs.existsSync(FILE)) {
  console.error('FAIL: build artifact missing: ' + FILE + ' (run build-force-play.ps1 first)');
  process.exit(1);
}
const size = fs.statSync(FILE).size;
const kb = (size / 1024).toFixed(1);
console.log('build artifact size: ' + kb + ' KB');

if (size > HARD) {
  console.error('FAIL: exceeds hard limit ' + (HARD / 1024) + ' KB — investigate unexpected bloat');
  process.exit(1);
}
if (size > WARN) {
  console.warn('WARN: exceeds soft limit ' + (WARN / 1024) + ' KB — consider trimming before next release');
}
console.log('PASS: build artifact within size budget');
