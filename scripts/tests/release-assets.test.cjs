'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sources, provenance, inspect, checkManifest, preflight } = require('../release-assets.cjs');

function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-release-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const license = fs.readFileSync(path.resolve(__dirname, '../../LICENSE'), 'utf8');
  function put(rel, text) { const file = path.join(base, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
  put('LICENSE', license);
  put('NOTICE.md', 'Synthetic notice\n');
  put('THIRD_PARTY_NOTICES.md', 'Synthetic third-party notices\n');
  put('apps/userscript/package.json', JSON.stringify({ version: '1.2.3' }));
  put('apps/userscript/build-manifest.txt', 'domain.js\n');
  put('apps/userscript/src/chaoxing-force-play/takeover/meta.js', '// fixture\n');
  put('apps/userscript/src/chaoxing-force-play/takeover/bootstrap/core.js', '(function(){\n');
  put('apps/userscript/src/chaoxing-force-play/domain.js', 'var value = 1;\n');
  const info = provenance(base);
  const product = '// ==UserScript==\n// @name 网课强制续播\n// @version 1.2.3\n// @license MIT\n// ==/UserScript==\n' +
    '/*\n' + license.trim() + '\n*/\n// Built: commit: ' + info.commit + '  git-state: ' + info.gitState +
    '  source-sha256: ' + info.sourceSha256 + "  minify: off\nvar __CX_VARIANT = 'personal';\n";
  put('dist/chaoxing-force-play.user.js', product);
  put('dist/chaoxing-force-play-latest.user.js', product);
  put('dist/chaoxing-force-play.open.user.js', product.replace('网课强制续播', '网课强制续播（开源版）').replace("'personal'", "'open'"));
  return { base, put, product };
}
test('exact variants and source identity pass; line endings preserve source identity', t => {
  const f = fixture(t), first = inspect(f.base);
  f.put('apps/userscript/src/chaoxing-force-play/domain.js', 'var value = 1;\r\n');
  assert.equal(sources(f.base).sourceSha256, first.sourceSha256);
  assert.equal(inspect(f.base).files.length, 3);
  assert.equal(inspect(f.base).notices.length, 3);
});
test('a changed source cannot be represented by an old product marker', t => {
  const f = fixture(t); f.put('apps/userscript/src/chaoxing-force-play/domain.js', 'var value = 2;\n');
  assert.throws(() => inspect(f.base), /source\/commit identity mismatch/);
});
test('latest mismatch, missing license, wrong version and variant drift fail', t => {
  const f = fixture(t);
  for (const [replacement, reason] of [
    [f.product + '// changed\n', /latest differs/],
    [f.product.replace('Permission is hereby granted', 'removed'), /MIT notice missing/],
    [f.product.replace('@version 1.2.3', '@version 1.2.4'), /version mismatch/],
  ]) { f.put('dist/chaoxing-force-play-latest.user.js', replacement); assert.throws(() => inspect(f.base), reason); }
  f.put('dist/chaoxing-force-play-latest.user.js', f.product);
  f.put('dist/chaoxing-force-play.open.user.js', f.product.replace("'personal'", "'open'") + 'var changed = true;\n');
  assert.throws(() => inspect(f.base), /variant content difference/);
});
test('download manifest pins both bytes and the expected checkout commit', t => {
  const f = fixture(t), file = path.join(f.base, 'manifest.json'), manifest = inspect(f.base);
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(checkManifest(f.base, file).version, '1.2.3');
  assert.throws(() => checkManifest(f.base, file, 'different-commit'), /identity differs/);
  manifest.files[0].sha256 = '0'.repeat(64); fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => checkManifest(f.base, file), /hashes differ/);
});
test('duplicate, missing and traversal manifest entries fail closed', t => {
  const f = fixture(t);
  for (const manifest of ['domain.js\ndomain.js\n', 'absent.js\n', '../escape.js\n']) {
    f.put('apps/userscript/build-manifest.txt', manifest); assert.throws(() => sources(f.base));
  }
});
function committedFixture(t) {
  const f = fixture(t);
  for (const rel of ['apps/userscript/package-lock.json', 'apps/userscript/build-force-play.ps1',
    'apps/userscript/scripts/sample.cjs', 'scripts/build.ps1', 'scripts/release-assets.cjs', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md',
    '.github/workflows/ci.yml']) f.put(rel, 'fixture\n');
  f.put('docs/releases/1.2.3.md', '# Reviewed local release\n');
  const notice = fs.readFileSync(path.join(f.base, 'LICENSE'), 'utf8').trim();
  for (const name of ['chaoxing-media-collector.user.js', 'chaoxing-progress-panel.user.js'])
    f.put('services/perception/' + name, '/*\n' + notice + '\n*/\n');
  function git(...args) {
    const result = spawnSync('git', ['-C', f.base, ...args], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  }
  git('init', '-q'); git('config', 'user.name', 'Release fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.'); git('commit', '-q', '-m', 'synthetic source');
  const sourceCommit = git('rev-parse', 'HEAD');
  const product = f.product.replace('commit: unavailable', 'commit: ' + sourceCommit).replace('git-state: unavailable', 'git-state: clean');
  f.put('dist/chaoxing-force-play.user.js', product); f.put('dist/chaoxing-force-play-latest.user.js', product);
  f.put('dist/chaoxing-force-play.open.user.js', product.replace('网课强制续播', '网课强制续播（开源版）').replace("'personal'", "'open'"));
  git('add', 'dist'); git('commit', '-q', '-m', 'synthetic generated products');
  return { ...f, git, sourceCommit };
}

test('artifact-only commit preserves verified source provenance; uncommitted source cannot pass preflight', t => {
  const f = committedFixture(t), sourceCommit = f.sourceCommit;
  const report = preflight(f.base);
  assert.equal(report.ready, true, JSON.stringify(report.problems));
  assert.equal(report.sourceCommit, sourceCommit); assert.notEqual(report.checkoutCommit, sourceCommit);
  f.put('apps/userscript/src/chaoxing-force-play/domain.js', 'var value = 2;\n');
  assert.throws(() => preflight(f.base), /source\/commit identity mismatch/);
});

test('a clean clone accepts artifact-only commits without misrepresenting checkout identity', t => {
  const f = committedFixture(t), parent = fs.mkdtempSync(path.join(os.tmpdir(), 'cx-release-clone-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const destination = path.join(parent, 'clone');
  const result = spawnSync('git', ['clone', '-q', '--no-hardlinks', f.base, destination], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  const report = preflight(destination);
  assert.equal(report.ready, true, JSON.stringify(report.problems));
  assert.equal(report.sourceCommit, f.sourceCommit);
  assert.equal(report.checkoutCommit, f.git('rev-parse', 'HEAD'));
  assert.notEqual(report.checkoutCommit, report.sourceCommit);
});

test('deleting a tracked input in a later clean commit invalidates ancestor build provenance', t => {
  const f = committedFixture(t);
  // Keep the directory present so this exercises its complete inventory, not ENOENT.
  f.put('apps/userscript/scripts/remaining.cjs', 'fixture\n');
  f.git('add', '.'); f.git('commit', '-q', '-m', 'add second tracked build input');
  const head = f.git('rev-parse', 'HEAD');
  const product = f.product.replace('commit: unavailable', 'commit: ' + head).replace('git-state: unavailable', 'git-state: clean');
  f.put('dist/chaoxing-force-play.user.js', product); f.put('dist/chaoxing-force-play-latest.user.js', product);
  f.put('dist/chaoxing-force-play.open.user.js', product.replace('网课强制续播', '网课强制续播（开源版）').replace("'personal'", "'open'"));
  f.git('add', 'dist'); f.git('commit', '-q', '-m', 'record products for second input set');
  assert.equal(preflight(f.base).ready, true);
  f.git('rm', 'apps/userscript/scripts/sample.cjs'); f.git('commit', '-q', '-m', 'remove tracked input');
  assert.throws(() => preflight(f.base), /input inventory differs/);
});

test('adding a tracked build input or changing its executable mode invalidates ancestor provenance', t => {
  for (const change of ['add', 'mode']) {
    const f = committedFixture(t);
    if (change === 'add') { f.put('apps/userscript/scripts/new.cjs', 'fixture\n'); f.git('add', '.'); }
    else f.git('update-index', '--chmod=+x', 'apps/userscript/scripts/sample.cjs');
    f.git('commit', '-q', '-m', 'change input ' + change);
    assert.throws(() => preflight(f.base), change === 'add' ? /input inventory differs/ : /input mode differs/);
  }
});

test('every downloaded license and notice must exist and match both checkout and gate bytes', t => {
  const f = fixture(t), download = path.join(f.base, 'download'), file = path.join(f.base, 'manifest.json');
  fs.mkdirSync(download);
  const names = ['LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md'];
  for (const name of names) fs.copyFileSync(path.join(f.base, name), path.join(download, name));
  const manifest = inspect(f.base); fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(checkManifest(f.base, file, undefined, download).version, '1.2.3');
  for (const name of names) {
    const target = path.join(download, name), bytes = fs.readFileSync(target);
    fs.unlinkSync(target); assert.throws(() => checkManifest(f.base, file, undefined, download), /ENOENT/);
    fs.writeFileSync(target, Buffer.concat([bytes, Buffer.from('tampered')]));
    assert.throws(() => checkManifest(f.base, file, undefined, download), /Downloaded notice differs/);
    fs.writeFileSync(target, bytes);
  }
  manifest.notices[1].sha256 = '0'.repeat(64); fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => checkManifest(f.base, file, undefined, download), /notice hashes differ/);
  delete manifest.notices; fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => checkManifest(f.base, file, undefined, download), /notice hashes differ/);
});

test('an external dist manifest cannot skip notice validation by omitting artifact-dir', t => {
  const f = fixture(t), download = path.join(f.base, 'download'), manifestDir = path.join(download, 'dist');
  fs.mkdirSync(manifestDir, { recursive: true });
  const file = path.join(manifestDir, 'release-manifest.json'); fs.writeFileSync(file, JSON.stringify(inspect(f.base)));
  assert.throws(() => checkManifest(f.base, file), /ENOENT/);
  for (const name of ['LICENSE', 'NOTICE.md', 'THIRD_PARTY_NOTICES.md']) fs.copyFileSync(path.join(f.base, name), path.join(download, name));
  assert.equal(checkManifest(f.base, file).version, '1.2.3');
});
