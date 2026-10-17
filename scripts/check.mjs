/** Local structural checks, intentionally not named Claude plugin validation. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function walk(dir){const out=[];for(const e of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory()&&!['node_modules','.git','__pycache__'].includes(e.name))out.push(...await walk(p));else if(e.isFile())out.push(p);}return out;}
const files=await walk(root);
for(const file of files.filter(p=>/\.(mjs|js)$/.test(p))) {
 const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
}
const manifest=JSON.parse(await fs.readFile(path.join(root,'.claude-plugin/plugin.json'),'utf8'));
const marketplace=JSON.parse(await fs.readFile(path.join(root,'.claude-plugin/marketplace.json'),'utf8'));
const hooks=JSON.parse(await fs.readFile(path.join(root,'hooks/hooks.json'),'utf8'));
assert.equal(manifest.name,'account-stats');assert.equal(marketplace.plugins[0].name,manifest.name);assert.equal(marketplace.plugins[0].source,'./');
assert.deepEqual(hooks.modules,['./register.js']);
for(const [name,field]of Object.entries(manifest.userConfig)){assert.ok(field.title&&field.description,name);assert.ok(['string','boolean','number','directory','file'].includes(field.type));}
const hook=await fs.readFile(path.join(root,'hooks/register.js'),'utf8');
assert.ok(!/\$\.(model|prompt|tool|http|telemetry)\./.test(hook),'Unexpected model/network/tool/prompt call');
assert.ok(!/\$\.session\.(authorize|messages|append|compact)/.test(hook),'Unexpected conversation/authorization call');
assert.ok(!/\bimport\s*\(/.test(hook),'Dynamic import not allowed');
for(const file of files.filter(p=>p.includes(path.sep+'lib'+path.sep)||p.includes(path.sep+'hooks'+path.sep))) {
 const s=await fs.readFile(file,'utf8');assert.ok(!/from\s+['"]node:/.test(s),'Node import in hook dependency');
}
await import('./check-repository.mjs');
console.log(`Local structure and syntax checks passed (${files.length} files).`);
console.log('These checks do not execute the Claude loader. Run: claude plugin validate --strict <plugin directory>');
