'use strict';
// Read source fragments in their actual build order. The same source group may
// span a function or nested IIFE; lexical bindings belong to the assembled AST.
const fs = require('fs');
const path = require('path');
const espree = require('espree');
const eslintScope = require('eslint-scope');

function sourceFiles(root) {
  const out = [];
  function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.js')) out.push(path.relative(root, file).replace(/\\/g, '/'));
    }
  }
  walk(root);
  return out.sort();
}

function orderedSources(root) {
  const files = sourceFiles(root);
  const core = 'takeover/bootstrap/core.js', meta = 'takeover/meta.js';
  const localManifest = path.resolve(root, '../..', 'build-manifest.txt');
  if (!files.includes(core) && !fs.existsSync(localManifest)) return { files, ordered: files, wrapped: true };
  const manifest = fs.existsSync(localManifest) ? localManifest : path.join(__dirname, '../build-manifest.txt');
  const modules = fs.readFileSync(manifest, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const ordered = [meta, core].concat(modules);
  if (new Set(ordered).size !== ordered.length || ordered.length !== files.length ||
      ordered.some(file => !files.includes(file))) throw new Error('Source manifest/file inventory differs: ' + root);
  return { files, ordered, wrapped: false };
}

function groupFiles(root, relative) {
  const { ordered } = orderedSources(root);
  const requested = fs.readFileSync(path.join(root, relative), 'utf8');
  const declared = (requested.match(/^\/\/\s*@source-group:\s*(\S+)/m) || [])[1];
  if (!declared || declared !== relative) return [relative];
  const members = ordered.filter(file => {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    return (text.match(/^\/\/\s*@source-group:\s*(\S+)/m) || [])[1] === declared;
  });
  const first = ordered.indexOf(members[0]);
  if (!members.length || members.some((file, index) => ordered[first + index] !== file)) {
    throw new Error('Source group must be contiguous: ' + declared);
  }
  return members;
}

function readSource(root, relative) {
  return groupFiles(root, relative).map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
}

function validateSourceGroups(segments) {
  const groups = new Map();
  segments.forEach((entry, index) => {
    const declared = (entry.text.match(/^\/\/\s*@source-group:\s*(\S+)/m) || [])[1];
    if (!declared) return;
    if (!groups.has(declared)) groups.set(declared, []);
    groups.get(declared).push({ file: entry.file, index });
  });
  for (const [name, members] of groups) {
    if (members[0].file !== name) throw new Error('Source group must start with its canonical file: ' + name);
    if (members.some((member, index) => member.index !== members[0].index + index)) {
      throw new Error('Source group must be contiguous: ' + name);
    }
  }
}

function analyzeSources(root) {
  const inventory = orderedSources(root), segments = [];
  let code = inventory.wrapped ? '(function () {\n' : '';
  for (const file of inventory.ordered) {
    const text = fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
    const start = code.length;
    code += text + '\n';
    segments.push({ file, text, start, end: code.length });
  }
  validateSourceGroups(segments);
  code += '\n})();';
  const ast = espree.parse(code, { ecmaVersion: 2022, sourceType: 'script', range: true });
  const scopes = eslintScope.analyze(ast, { ecmaVersion: 2022, sourceType: 'script', optimistic: true, ignoreEval: true });
  const outer = scopes.scopes.find(scope => scope.type === 'function' && scope.upper.type === 'global');
  if (!outer) throw new Error('Assembled source has no outer IIFE');
  function owner(offset) {
    let lo = 0, hi = segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, entry = segments[mid];
      if (offset < entry.start) hi = mid - 1;
      else if (offset >= entry.end) lo = mid + 1;
      else return entry.file;
    }
    return null;
  }
  return { code, ast, scopes, outer, segments, owner, files: inventory.files };
}

function collect(root, options) {
  const analysis = analyzeSources(root);
  const modules = analysis.segments.map(entry => ({ file: entry.file, provides: new Set(),
    requires: new Set(), anno: options.parseAnnotations(entry.text) })).sort((a, b) => a.file.localeCompare(b.file));
  const byFile = new Map(modules.map(entry => [entry.file, entry])), allProvides = new Map();
  for (const variable of analysis.outer.variables) {
    const owners = new Set(variable.identifiers.map(id => analysis.owner(id.range[0])).filter(Boolean));
    for (const file of owners) byFile.get(file).provides.add(variable.name);
    if (owners.size) allProvides.set(variable.name, [...owners].sort());
  }
  for (const scope of analysis.scopes.scopes) {
    for (const reference of scope.references) {
      const name = reference.identifier.name, file = analysis.owner(reference.identifier.range[0]);
      if (!file || options.builtins.has(name)) continue;
      if (reference.resolved && reference.resolved.scope !== analysis.outer) continue;
      if (byFile.get(file).provides.has(name)) continue;
      byFile.get(file).requires.add(name);
    }
  }
  return { modules, allProvides };
}

module.exports = { sourceFiles, orderedSources, groupFiles, readSource, analyzeSources, collect };
