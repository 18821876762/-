// 历史 PPT 复制助手：显式指定源文件与目标文件，保留源文件。
const fs = require('fs');
const path = require('path');
const projectPaths = require('./project-paths.cjs');
if (!process.argv[2] || !process.argv[3]) {
  console.error('用法：node tools/presentations/copy.js <源PPTX> <目标PPTX>');
  process.exit(2);
}
const src = path.resolve(process.argv[2]);
const target = path.resolve(process.argv[3]);
if (src.toLowerCase() === target.toLowerCase()) throw new Error('目标必须与源文件不同');
fs.copyFileSync(src, projectPaths.writableFile(target), fs.constants.COPYFILE_EXCL);
console.log('copied:', src, '->', target, fs.statSync(target).size);
