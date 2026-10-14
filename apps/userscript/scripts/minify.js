'use strict';
/*
 * esbuild 压缩封装（被 build-force-play.ps1 的 -Minify 调用）。
 *
 * 仅压缩「域模块体」；调用方负责保留 userscript 元数据头与 IIFE 尾。
 * 不开启 tree-shaking：本工程跨模块引用多经字符串契约间接调用
 * （__cxRegisterAddon / window.__CX_FORCE_PLAY.* 等），激进摇树会误删被动态调用的函数。
 *
 * 用法: node scripts/minify.js <in.js> <out.js>
 *   成功 : 写入 out.js，stdout 打印字节数；exit 0
 *   参数错: exit 2
 *   esbuild 未安装: exit 3（调用方回退到朴素空白行压缩）
 */
const fs = require('fs');

let esbuild = null;
try {
  esbuild = require('esbuild');
} catch (e) {
  esbuild = null;
}

function minifyCode(code) {
  return esbuild.transformSync(code, {
    minify: true,
    loader: 'js',
    legalComments: 'inline',
    drop: ['debugger'],
    target: ['es2017'],
  }).code;
}

if (require.main === module) {
  const [, , inFile, outFile] = process.argv;
  if (!inFile || !outFile) {
    console.error('usage: node scripts/minify.js <in.js> <out.js>');
    process.exit(2);
  }
  if (!esbuild) {
    console.error('[minify] esbuild not installed (run: npm install esbuild)');
    process.exit(3);
  }
  const code = fs.readFileSync(inFile, 'utf8');
  const out = minifyCode(code);
  fs.writeFileSync(outFile, out);
  console.log('minified ' + out.length + ' bytes');
}

module.exports = { minifyCode };
