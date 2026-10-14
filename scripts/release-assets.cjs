'use strict';

// Offline release identity and preflight. This script never commits or uploads.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const products = ['chaoxing-force-play.user.js', 'chaoxing-force-play.open.user.js', 'chaoxing-force-play-latest.user.js'];
const notices = ['LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md'];
const inputs = ['apps/userscript/src/chaoxing-force-play', 'apps/userscript/build-manifest.txt',
  'apps/userscript/package.json', 'apps/userscript/package-lock.json', 'apps/userscript/build-force-play.ps1',
  'apps/userscript/scripts', 'scripts/build.ps1', 'scripts/release-assets.cjs', 'LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md'];
const normalize = text => text.replace(/\r\n?/g, '\n').split('\n').map(line => line.trimEnd()).join('\n');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function read(base, rel) { return fs.readFileSync(path.join(base, rel), 'utf8'); }
function git(base, args) {
  const result = spawnSync('git', ['-C', base, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('Git metadata unavailable');
  return result.stdout.trimEnd();
}
function sources(base, srcDir) {
  const sourceRoot = srcDir || path.join(base, 'apps/userscript/src/chaoxing-force-play');
  const manifest = read(base, 'apps/userscript/build-manifest.txt').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const order = ['takeover/meta.js', 'takeover/bootstrap/core.js', ...manifest];
  if (new Set(order).size !== order.length) throw new Error('Duplicate source in manifest');
  for (const rel of order) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error('Invalid source path');
  }
  const discovered = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Source links are not release inputs');
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) discovered.push(path.relative(sourceRoot, full).replace(/\\/g, '/'));
    }
  }
  walk(sourceRoot);
  if (discovered.length !== order.length || discovered.some(rel => !order.includes(rel))) throw new Error('Manifest inventory mismatch');
  const digest = crypto.createHash('sha256');
  for (const rel of order) digest.update(rel + '\0').update(normalize(fs.readFileSync(path.join(sourceRoot, rel), 'utf8'))).update('\0');
  return { sourceRoot, order, sourceSha256: digest.digest('hex') };
}
function provenance(base, srcDir) {
  const source = sources(base, srcDir);
  let commit = 'unavailable', gitState = 'unavailable';
  try {
    commit = git(base, ['rev-parse', 'HEAD']);
    gitState = git(base, ['status', '--porcelain=v1', '--untracked-files=normal', '--', ...inputs]) ? 'dirty' : 'clean';
    if (path.resolve(source.sourceRoot) !== path.join(base, 'apps/userscript/src/chaoxing-force-play')) gitState = 'alternate-source';
  } catch (_) { /* Source digest remains usable outside a Git checkout. */ }
  return { commit, gitState, sourceSha256: source.sourceSha256 };
}
function inputFiles(base) {
  const files = [];
  function walk(rel) {
    const full = path.join(base, rel), stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error('Build inputs cannot be links: ' + rel);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full)) walk(rel + '/' + name);
    } else if (stat.isFile()) files.push(rel);
    else throw new Error('Build inputs must be regular files: ' + rel);
  }
  for (const rel of inputs) walk(rel);
  return files;
}
function inputTree(base, commit) {
  const tree = new Map();
  for (const entry of git(base, ['ls-tree', '-rz', '--full-tree', commit, '--', ...inputs]).split('\0').filter(Boolean)) {
    const match = /^(\d+) (\S+) ([a-f0-9]{40,64})\t([\s\S]+)$/.exec(entry);
    if (!match || match[2] !== 'blob' || !['100644', '100755'].includes(match[1])) throw new Error('Build source commit contains non-file input');
    tree.set(match[4], match[1]);
  }
  return tree;
}
function verifySourceCommit(base, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Build source commit is not a complete Git commit');
  git(base, ['cat-file', '-e', commit + '^{commit}']);
  git(base, ['merge-base', '--is-ancestor', commit, 'HEAD']);
  const current = inputFiles(base), historicalTree = inputTree(base, commit), checkoutTree = inputTree(base, 'HEAD');
  if (current.length !== historicalTree.size || current.some(rel => !historicalTree.has(rel))) throw new Error('Build source commit input inventory differs from current inputs');
  if (current.length !== checkoutTree.size || current.some(rel => !checkoutTree.has(rel))) throw new Error('Checkout input inventory differs from current inputs');
  for (const rel of current) {
    if (historicalTree.get(rel) !== checkoutTree.get(rel)) throw new Error('Build source commit input mode differs from checkout: ' + rel);
    let historical;
    try { historical = git(base, ['show', commit + ':' + rel]); }
    catch (_) { throw new Error('Build source commit does not contain input: ' + rel); }
    if (normalize(historical).trimEnd() !== normalize(read(base, rel)).trimEnd()) throw new Error('Build source commit differs from current input: ' + rel);
  }
}
function inspect(base) {
  const info = provenance(base);
  const version = JSON.parse(read(base, 'apps/userscript/package.json')).version;
  const license = normalize(read(base, 'LICENSE')).trim();
  if (!license.startsWith('MIT License\n') || license.includes('Compliance and risk notice')) throw new Error('Expected unmodified MIT license');
  const texts = {}, files = [];
  let sourceCommit, buildState;
  for (const name of products) {
    const bytes = fs.readFileSync(path.join(base, 'dist', name));
    const text = normalize(bytes.toString('utf8'));
    const declared = /\/\/\s*@version\s+(\S+)/.exec(text);
    if (!declared || declared[1] !== version) throw new Error(name + ': version mismatch');
    if (!text.includes('/*\n' + license + '\n*/')) throw new Error(name + ': full MIT notice missing');
    const marker = /Built:.*?commit: (\S+)\s+git-state: (\S+)\s+source-sha256: ([a-f0-9]{64})\s+minify: (on|off)/.exec(text);
    if (!marker || marker[3] !== info.sourceSha256) throw new Error(name + ': source/commit identity mismatch');
    if (sourceCommit && (sourceCommit !== marker[1] || buildState !== marker[2])) throw new Error('Variants have different build provenance');
    sourceCommit = marker[1]; buildState = marker[2];
    texts[name] = text;
    files.push({ name, bytes: bytes.length, sha256: hash(bytes), buildGitState: marker[2], minify: marker[4] });
  }
  if (!fs.readFileSync(path.join(base, 'dist', products[0])).equals(fs.readFileSync(path.join(base, 'dist', products[2])))) throw new Error('latest differs from personal');
  const open = texts[products[1]].replace('网课强制续播（开源版）', '网课强制续播')
    .replace("var __CX_VARIANT = 'open';", "var __CX_VARIANT = 'personal';");
  if (open !== texts[products[0]]) throw new Error('Unexpected variant content difference');
  // An artifact-only commit may follow its source commit. Verify the source
  // content, rather than requiring the marker to equal the current HEAD.
  if (buildState === 'clean') verifySourceCommit(base, sourceCommit);
  else if (sourceCommit !== info.commit) throw new Error('Uncommitted build cannot claim another source commit');
  const noticeFiles = notices.map(name => {
    const bytes = fs.readFileSync(path.join(base, name));
    return { name, bytes: bytes.length, sha256: hash(bytes) };
  });
  return { schemaVersion: 2, version, checkoutCommit: info.commit, sourceCommit,
    gitState: info.gitState, sourceSha256: info.sourceSha256, files, notices: noticeFiles };
}
function checkManifest(base, file, expectedCommit, artifactRoot) {
  const manifestDir = path.dirname(path.resolve(file));
  artifactRoot = artifactRoot || (path.basename(manifestDir) === 'dist' ? path.dirname(manifestDir) : manifestDir);
  const recorded = JSON.parse(fs.readFileSync(file, 'utf8'));
  const current = inspect(base);
  if (recorded.schemaVersion !== 2 || recorded.version !== current.version || recorded.sourceSha256 !== current.sourceSha256 ||
      recorded.checkoutCommit !== current.checkoutCommit || recorded.sourceCommit !== current.sourceCommit ||
      (expectedCommit && (recorded.checkoutCommit !== expectedCommit || recorded.sourceCommit !== expectedCommit))) throw new Error('Downloaded artifact identity differs from checkout');
  if (JSON.stringify(recorded.files) !== JSON.stringify(current.files)) throw new Error('Downloaded artifact hashes differ from gate manifest');
  if (JSON.stringify(recorded.notices) !== JSON.stringify(current.notices)) throw new Error('Downloaded notice hashes differ from checkout or gate manifest');
  for (const notice of current.notices) {
    const bytes = fs.readFileSync(path.join(artifactRoot, notice.name));
    if (bytes.length !== notice.bytes || hash(bytes) !== notice.sha256) throw new Error('Downloaded notice differs from checkout or gate manifest: ' + notice.name);
  }
  return current;
}
function gitProblems(base, info) {
  const problems = [];
  if (info.gitState !== 'clean') problems.push('Source/build inputs have uncommitted changes: ' + info.gitState);
  const paths = inputFiles(base);
  paths.push('docs/releases/' + info.version + '.md',
    'services/perception/chaoxing-media-collector.user.js', 'services/perception/chaoxing-progress-panel.user.js', '.github/workflows/ci.yml');
  for (const rel of paths) {
    try {
      if (normalize(git(base, ['show', 'HEAD:' + rel])).trimEnd() !== normalize(read(base, rel)).trimEnd()) problems.push('Working file differs from HEAD: ' + rel);
    } catch (_) { problems.push('Not available in HEAD: ' + rel); }
  }
  if (info.files.some(file => file.buildGitState !== 'clean')) problems.push('Products were built from uncommitted inputs; rebuild after committing');
  return problems;
}
function preflight(base) {
  const info = inspect(base), problems = gitProblems(base, info);
  const notePath = 'docs/releases/' + info.version + '.md';
  const notes = read(base, notePath);
  if (/\[待填写\]|PENDING|TODO/.test(notes)) problems.push('Release notes contain pending validation fields');
  for (const rel of ['services/perception/chaoxing-media-collector.user.js', 'services/perception/chaoxing-progress-panel.user.js']) {
    if (!normalize(read(base, rel)).includes('/*\n' + normalize(read(base, 'LICENSE')).trim() + '\n*/')) problems.push('Standalone script lacks full license: ' + rel);
  }
  return { ...info, ready: problems.length === 0, problems };
}
function prepare(base, destination, draft) {
  const report = preflight(base);
  if (!report.ready && !draft) throw new Error('Release blocked:\n' + report.problems.slice(0, 12).join('\n'));
  if (fs.existsSync(destination)) throw new Error('Release destination already exists; choose a new path');
  fs.mkdirSync(destination, { recursive: true });
  for (const name of products) fs.copyFileSync(path.join(base, 'dist', name), path.join(destination, name));
  for (const name of ['LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(base, name), path.join(destination, name));
  fs.copyFileSync(path.join(base, 'docs/releases', report.version + '.md'), path.join(destination, 'RELEASE_NOTES.md'));
  for (const name of ['chaoxing-media-collector.user.js', 'chaoxing-progress-panel.user.js']) fs.copyFileSync(path.join(base, 'services/perception', name), path.join(destination, name));
  fs.writeFileSync(path.join(destination, 'release-preflight.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'REVIEW_STATUS.txt'), report.ready ? 'READY: local preflight passed. No upload performed.\n' :
    'DRAFT: NOT READY FOR PUBLICATION.\n' + report.problems.join('\n') + '\n');
  fs.writeFileSync(path.join(destination, 'SHA256SUMS.txt'), fs.readdirSync(destination).filter(name => name !== 'SHA256SUMS.txt')
    .sort().map(name => hash(fs.readFileSync(path.join(destination, name))) + '  ' + name).join('\n') + '\n');
  return report;
}
if (require.main === module) {
  const args = process.argv.slice(2), mode = args[0];
  const value = key => args.includes(key) ? args[args.indexOf(key) + 1] : undefined;
  try {
    let result;
    if (mode === 'provenance') result = provenance(root, value('--src'));
    else if (mode === 'manifest') {
      result = inspect(root);
      fs.writeFileSync(value('--out') || path.join(root, 'dist/release-manifest.json'), JSON.stringify(result, null, 2) + '\n');
    } else if (mode === 'check') {
      result = value('--manifest') ? checkManifest(root, value('--manifest'), value('--commit'), value('--artifact-dir') && path.resolve(value('--artifact-dir'))) : (args.includes('--git') ? preflight(root) : inspect(root));
      if (args.includes('--git') && !result.ready) { console.log(JSON.stringify(result, null, 2)); process.exitCode = 1; }
    } else if (mode === 'prepare') {
      const destination = value('--out');
      if (!destination) throw new Error('prepare requires --out');
      result = prepare(root, path.resolve(destination), args.includes('--draft'));
    } else throw new Error('Usage: release-assets.cjs provenance|manifest|check|prepare [--src path] [--out path] [--manifest path] [--artifact-dir path] [--commit sha] [--git] [--draft]');
    if (!process.exitCode) console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error('RELEASE CHECK FAILED: ' + error.message); process.exitCode = 1; }
}
module.exports = { normalize, hash, sources, provenance, inspect, checkManifest, preflight, prepare };
