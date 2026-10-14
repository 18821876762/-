'use strict';
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');
const userscriptRoot = path.join(projectRoot, 'apps/userscript');
const sourceRoot = path.join(userscriptRoot, 'src/chaoxing-force-play');
const simRoot = path.join(userscriptRoot, '_sim');
const distRoot = path.join(projectRoot, 'dist');
const bundle = path.join(distRoot, 'chaoxing-force-play.user.js');
const latestBundle = path.join(distRoot, 'chaoxing-force-play-latest.user.js');
const chaoxingFixture = path.join(userscriptRoot, 'tests/fixtures/chaoxing-page.html');
const outputRoot = path.join(__dirname, 'output');

function requireSim(name) {
  return require(require.resolve(name, { paths: [simRoot] }));
}

function browserExecutable(chromium) {
  if (process.env.CX_BROWSER_PATH) return path.resolve(process.env.CX_BROWSER_PATH);
  const installed = chromium.executablePath();
  if (fs.existsSync(installed)) return installed;
  if (process.env.LOCALAPPDATA) {
    const cache = path.join(process.env.LOCALAPPDATA, 'ms-playwright');
    if (fs.existsSync(cache)) {
      const versions = fs.readdirSync(cache).filter(n => /^chromium-\d+$/.test(n))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
      for (const version of versions) {
        const candidate = path.join(cache, version, 'chrome-win64/chrome.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

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

module.exports = { projectRoot, userscriptRoot, sourceRoot, simRoot, distRoot, bundle,
  latestBundle, chaoxingFixture, outputRoot, requireSim, browserExecutable, writableFile };
