/** Offline repository-distribution checks, NOT the Claude plugin loader. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJSON = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const manifest = await readJSON('.claude-plugin/plugin.json');
const market = await readJSON('.claude-plugin/marketplace.json');
const pkg = await readJSON('package.json');
const hooks = await readJSON('hooks/hooks.json');
assert.equal(market.name, 'account-stats-marketplace');
assert.ok(market.owner?.name, 'The marketplace must have an owner');
assert.equal(market.plugins.length, 1);
const entry = market.plugins[0];
assert.equal(entry.name, manifest.name);
assert.equal(manifest.name, 'account-stats');
assert.equal(entry.source, './', 'Single-plugin repository source must resolve to its root');
assert.equal(path.resolve(root, entry.source), root);
assert.equal(entry.version, undefined, 'Keep the Claude version only in plugin.json');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version, 'package and plugin versions must agree');
assert.equal(pkg.type, 'module');
assert.ok(!pkg.dependencies && !pkg.devDependencies, 'Runtime must not require npm installation');
for (const key of ['preinstall', 'install', 'postinstall', 'prepare']) {
  assert.equal(pkg.scripts?.[key], undefined, `Unexpected npm lifecycle script: ${key}`);
}
assert.deepEqual(hooks.modules, ['./register.js']);
const required = ['hooks/register.js', 'scanner/index.mjs', 'lib/i18n.js', 'lib/pricing.js',
  'lib/quota.js', 'lib/usage.js', 'lib/view-model.js', 'lib/visuals.js', 'README.md',
  'LICENSE', 'docs/PUBLISHING.md', '.github/workflows/ci.yml'];
for (const file of required) assert.ok((await fs.stat(path.join(root, file))).isFile(), file);

// A marketplace installation copies this root to an unrelated cache path.
// Every relative module import must remain inside that copied root.
async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', '__pycache__'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}
for (const dir of ['hooks', 'lib', 'scanner']) {
  for (const file of (await walk(path.join(root, dir))).filter(p => /\.(mjs|js)$/.test(p))) {
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(/(?:\bfrom\s+|\bimport\s*)['"]([^'"]+)['"]/g)) {
      const spec = match[1];
      if (!spec.startsWith('.')) {
        assert.ok(dir === 'scanner' && spec.startsWith('node:'), `Unbundled dependency: ${spec}`);
        continue;
      }
      const resolved = path.resolve(path.dirname(file), spec);
      const relative = path.relative(root, resolved);
      assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative), `Import escapes root: ${spec}`);
      assert.ok((await fs.stat(resolved)).isFile(), `Missing import: ${spec}`);
    }
  }
}
const hook = await fs.readFile(path.join(root, 'hooks/register.js'), 'utf8');
assert.ok(hook.includes('$.plugin.root'), 'Child scanner path must follow the installed plugin root');
assert.ok(!hook.includes('account-stats-github'), 'No author-machine repository path in the runtime');
assert.equal(manifest.hooks, undefined, 'Default hooks/hooks.json is discovered without a duplicate declaration');
console.log('Repository checks passed: manifests, version, root-relative imports and scanner relocation.');
