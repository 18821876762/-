// 构建产物体积门禁（来自 code review 的"自动化体积检查"建议）
// 构建后的单文件 user.js 体积超过软阈值则警告，超过硬阈值则失败（退出码 1）。
// 阈值随功能集演进调整：早期脚本仅接管播放（~212KB），后续评审整改新增温和/礼貌模式、视觉识别
// （quiz-vision/vision-deepseek-web）、DeepSeek 应答端控制台、智慧树作业/考试助手、跨平台站点路由等，
// 产物增长至 ~382KB。软限/硬限据此上调并预留余量，硬限仅用于拦截"意外膨胀"（如误引入大依赖）。
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'chaoxing-force-play.user.js');
const WARN = 400 * 1024; // 400 KB（实测 ~382KB，临近时提示裁剪）
const HARD = 450 * 1024; // 450 KB（硬限，仅拦截意外膨胀）

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
