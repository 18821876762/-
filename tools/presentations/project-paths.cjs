'use strict';
const fs = require('fs');
const path = require('path');
const projectRoot = path.resolve(__dirname, '../..');
const outputRoot = path.join(projectRoot, 'dist/presentations');

function writableFile(file) {
  const resolved = path.resolve(file);
  const archive = path.join(projectRoot, '旧文档');
  const relative = path.relative(archive, resolved);
  if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep))) {
    throw new Error('输出不能写入旧文档归档目录：' + resolved);
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return resolved;
}

module.exports = { projectRoot, outputRoot, writableFile };
