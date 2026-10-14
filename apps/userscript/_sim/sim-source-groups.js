'use strict';

// Exercise the source reader with deliberately incomplete fragments. Fixtures
// combine lexical scope, executable behavior and source ownership; they do not
// depend on current module names or generated distributions.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const sourceGroups = require('../scripts/source-groups.cjs');

const temporaryRoot = fs.realpathSync(os.tmpdir());
const sandbox = fs.mkdtempSync(path.join(temporaryRoot, 'cx-source-groups-'));
let assertions = 0, failures = 0;
function check(name, verify) {
  assertions++;
  try { verify(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + ': ' + error.message); }
}
function fixture(name, files, manifest) {
  const app = path.join(sandbox, name);
  const root = path.join(app, 'src', 'chaoxing-force-play');
  for (const [relative, code] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, code, 'utf8');
  }
  if (manifest !== undefined) fs.writeFileSync(path.join(app, 'build-manifest.txt'), manifest, 'utf8');
  return { app, root };
}
function collect(root) {
  return sourceGroups.collect(root, { builtins: new Set(['window']), parseAnnotations: () => ({}) });
}
function moduleOf(result, name) {
  const entry = result.modules.find(module => module.file === name);
  assert.ok(entry, 'missing module ' + name);
  return entry;
}
function names(values) { return [...values].sort(); }

try {
  const shared = fixture('cross-function', {
    '01-state.js': '// @source-group: 01-state.js\nvar BASE = 7;\nfunction combine(input) {\n  var balance = input + BASE;\n',
    '02-state-tail.js': '// @source-group: 01-state.js\n  var adjust = function (extra) { return balance + extra + BASE; };\n  return adjust(2);\n}\n',
    '03-consumer.js': 'window.result = combine(BASE);\n'
  });
  const inferred = collect(shared.root);
  check('function local spanning fragments is not a provider', () => assert.equal(inferred.allProvides.has('balance'), false));
  check('nested helper spanning fragments is not a provider', () => assert.equal(inferred.allProvides.has('adjust'), false));
  check('function parameter is not a provider', () => assert.equal(inferred.allProvides.has('input'), false));
  check('cross-fragment function local is not a required global', () => assert.equal(moduleOf(inferred, '02-state-tail.js').requires.has('balance'), false));
  check('cross-fragment parameter is not a required global', () => assert.equal(moduleOf(inferred, '01-state.js').requires.has('input'), false));
  check('shared variable belongs to its declaration fragment', () => assert.deepEqual(inferred.allProvides.get('BASE'), ['01-state.js']));
  check('shared function belongs to its declaration fragment', () => assert.deepEqual(inferred.allProvides.get('combine'), ['01-state.js']));
  check('tail attributes its actual outer dependency', () => assert.deepEqual(names(moduleOf(inferred, '02-state-tail.js').requires), ['BASE']));
  check('consumer attributes both outer dependencies', () => assert.deepEqual(names(moduleOf(inferred, '03-consumer.js').requires), ['BASE', 'combine']));
  check('logical source reader includes both function fragments', () => assert.deepEqual(sourceGroups.groupFiles(shared.root, '01-state.js'), ['01-state.js', '02-state-tail.js']));
  const complete = sourceGroups.readSource(shared.root, '01-state.js');
  check('logical source reader retains closing fragment', () => assert.match(complete, /return adjust\(2\);\s*\}/));
  check('logical source remains independently executable', () => assert.equal(vm.runInNewContext(complete + '\ncombine(3);'), 19));
  check('unrelated source read excludes group members', () => assert.equal(sourceGroups.readSource(shared.root, '03-consumer.js'), 'window.result = combine(BASE);\n'));

  const nested = fixture('nested-addon', {
    '01-shared.js': 'var OUTER = 11;\n',
    'plugins/addons/01-addon.js': '// @source-group: plugins/addons/01-addon.js\n(function () {\n  var CFG = { offset: 4 };\n  function bootstrap(value) { return value + CFG.offset + OUTER; }\n',
    'plugins/addons/02-addon-tail.js': '// @source-group: plugins/addons/01-addon.js\n  window.addonResult = bootstrap(CFG.offset);\n})();\n',
    'plugins/addons/03-other-addon.js': '(function () { var CFG = { offset: 9 }; function bootstrap() { return CFG.offset; } window.otherResult = bootstrap(); })();\n'
  });
  const addon = collect(nested.root);
  check('addon IIFE config does not leak to shared providers', () => assert.equal(addon.allProvides.has('CFG'), false));
  check('addon IIFE bootstrap does not leak to shared providers', () => assert.equal(addon.allProvides.has('bootstrap'), false));
  check('addon tail resolves config in the original IIFE', () => assert.equal(moduleOf(addon, 'plugins/addons/02-addon-tail.js').requires.has('CFG'), false));
  check('addon tail resolves bootstrap in the original IIFE', () => assert.equal(moduleOf(addon, 'plugins/addons/02-addon-tail.js').requires.has('bootstrap'), false));
  check('nested function retains real outer dependency', () => assert.deepEqual(names(moduleOf(addon, 'plugins/addons/01-addon.js').requires), ['OUTER']));
  check('other addon same-name locals remain private', () => assert.deepEqual(names(moduleOf(addon, 'plugins/addons/03-other-addon.js').requires), []));
  check('assembled nested IIFEs preserve both behaviors', () => {
    const context = { window: {} };
    vm.runInNewContext(sourceGroups.analyzeSources(nested.root).code, context);
    assert.deepEqual(context.window, { addonResult: 19, otherResult: 9 });
  });

  const manifestFiles = {
    'takeover/meta.js': '// fixture metadata\n',
    'takeover/bootstrap/core.js': '(function () {\n',
    'sites/z-start.js': '// @source-group: sites/z-start.js\nvar FIRST = 3;\nfunction fromFirst() {\n',
    'sites/a-end.js': '// @source-group: sites/z-start.js\nreturn FIRST;\n}\n',
    'sites/m-consumer.js': 'window.result = fromFirst();\n'
  };
  const manifest = '\uFEFF# ordered fixture\r\nsites/z-start.js\r\nsites/a-end.js\r\nsites/m-consumer.js\r\n';
  const ordered = fixture('manifest-order', manifestFiles, manifest);
  check('core fixture follows manifest rather than filename order', () => assert.deepEqual(sourceGroups.orderedSources(ordered.root).ordered, ['takeover/meta.js', 'takeover/bootstrap/core.js', 'sites/z-start.js', 'sites/a-end.js', 'sites/m-consumer.js']));
  check('core fixture does not add a second wrapper', () => assert.equal(sourceGroups.orderedSources(ordered.root).wrapped, false));
  check('logical group follows actual manifest order', () => assert.deepEqual(sourceGroups.groupFiles(ordered.root, 'sites/z-start.js'), ['sites/z-start.js', 'sites/a-end.js']));
  const analysis = sourceGroups.analyzeSources(ordered.root);
  check('AST owner maps declaration to its actual fragment', () => {
    const variable = analysis.outer.variables.find(variable => variable.name === 'FIRST');
    assert.equal(analysis.owner(variable.identifiers[0].range[0]), 'sites/z-start.js');
  });
  check('AST owner maps function-tail read to its actual fragment', () => {
    const reference = analysis.scopes.scopes.flatMap(scope => scope.references).find(reference => reference.identifier.name === 'FIRST' && reference.isRead());
    assert.equal(analysis.owner(reference.identifier.range[0]), 'sites/a-end.js');
  });
  check('ordered group retains runnable logical function', () => assert.equal(vm.runInNewContext(sourceGroups.readSource(ordered.root, 'sites/z-start.js') + '\nfromFirst();'), 3));
  check('core assembly closes and runs the original wrapper', () => {
    const context = { window: {} };
    vm.runInNewContext(analysis.code, context);
    assert.equal(context.window.result, 3);
  });
  check('offset beyond source segments has no source owner', () => assert.equal(analysis.owner(analysis.code.length + 1), null));

  const missing = fixture('manifest-missing', manifestFiles, 'sites/z-start.js\nsites/a-end.js\n');
  check('manifest omission is rejected before source analysis', () => assert.throws(() => sourceGroups.analyzeSources(missing.root), /manifest\/file inventory differs/));
  const repeated = fixture('manifest-repeated', manifestFiles, 'sites/z-start.js\nsites/a-end.js\nsites/m-consumer.js\nsites/a-end.js\n');
  check('manifest duplicate is rejected', () => assert.throws(() => sourceGroups.orderedSources(repeated.root), /manifest\/file inventory differs/));
  const unknown = fixture('manifest-unknown', manifestFiles, 'sites/z-start.js\nsites/a-end.js\nsites/absent.js\n');
  check('manifest unknown entry is rejected', () => assert.throws(() => sourceGroups.orderedSources(unknown.root), /manifest\/file inventory differs/));
  const unlisted = fixture('manifest-unlisted', { ...manifestFiles, 'sites/unlisted.js': 'var EXTRA = 1;\n' }, manifest);
  check('source file absent from manifest is rejected', () => assert.throws(() => sourceGroups.orderedSources(unlisted.root), /manifest\/file inventory differs/));
  const missingCoreFiles = { ...manifestFiles };
  delete missingCoreFiles['takeover/bootstrap/core.js'];
  const missingCore = fixture('manifest-core-missing', missingCoreFiles, manifest);
  check('a real manifest with missing core cannot fall back to filename ordering', () => assert.throws(() => sourceGroups.orderedSources(missingCore.root), /manifest\/file inventory differs/));
  check('assembly rejects a real manifest whose core file is missing', () => assert.throws(() => sourceGroups.analyzeSources(missingCore.root), /manifest\/file inventory differs/));
  const separated = fixture('group-separated', manifestFiles, 'sites/z-start.js\nsites/m-consumer.js\nsites/a-end.js\n');
  check('non-contiguous source group is rejected', () => assert.throws(() => sourceGroups.readSource(separated.root, 'sites/z-start.js'), /group must be contiguous/));
  check('assembly rejects an interloper between valid function fragments', () => assert.throws(() => sourceGroups.analyzeSources(separated.root), /source group/i));
  check('contract collection rejects an interloper between valid function fragments', () => assert.throws(() => collect(separated.root), /source group/i));
  const noAnchor = fixture('group-anchor-missing', {
    ...manifestFiles,
    'sites/z-start.js': manifestFiles['sites/z-start.js'].replace('sites/z-start.js', 'sites/missing-anchor.js'),
    'sites/a-end.js': manifestFiles['sites/a-end.js'].replace('sites/z-start.js', 'sites/missing-anchor.js')
  }, manifest);
  check('assembly rejects a source group with no actual anchor file', () => assert.throws(() => sourceGroups.analyzeSources(noAnchor.root), /source group/i));
  check('contract collection rejects a source group with no actual anchor file', () => assert.throws(() => collect(noAnchor.root), /source group/i));
  const misplacedAnchor = fixture('group-anchor-after-member', {
    'takeover/meta.js': '// fixture metadata\n',
    'takeover/bootstrap/core.js': '(function () {\n',
    'sites/a-member.js': '// @source-group: sites/z-anchor.js\nvar MEMBER = 2;\n',
    'sites/z-anchor.js': '// @source-group: sites/z-anchor.js\nvar ANCHOR = MEMBER + 1;\n'
  }, 'sites/a-member.js\nsites/z-anchor.js\n');
  check('assembly rejects a contiguous group whose anchor is not its first member', () => assert.throws(() => sourceGroups.analyzeSources(misplacedAnchor.root), /source group/i));
  check('contract collection rejects a contiguous group whose anchor is not its first member', () => assert.throws(() => collect(misplacedAnchor.root), /source group/i));
  const broken = fixture('broken-syntax', { 'part.js': 'function broken( {\n' });
  check('syntax damage is rejected during assembly analysis', () => assert.throws(() => sourceGroups.analyzeSources(broken.root), SyntaxError));
  check('syntax damage cannot produce a partial contract result', () => assert.throws(() => collect(broken.root), SyntaxError));
} finally {
  // Delete only this run's mkdtemp child, after verifying its resolved parent.
  const resolved = fs.realpathSync(sandbox);
  if (path.dirname(resolved) !== temporaryRoot || !path.basename(resolved).startsWith('cx-source-groups-')) {
    throw new Error('Refusing temporary fixture cleanup outside the assigned directory');
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

console.log('source groups: ' + assertions + ' assertions, ' + failures + ' failures');
process.exitCode = failures ? 1 : 0;
