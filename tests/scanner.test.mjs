import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {scan,indexFile,aggregateRecords,exportCsv,defaultRoots} from '../scanner/index.mjs';
import {transcript} from './fixtures.mjs';
const rootDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function fixture(t) {
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'account-stats-test-'));t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const roots=[path.join(base,'projects')],cacheDir=path.join(base,'cache');await fs.mkdir(roots[0]);
 return {base,roots,cacheDir,timeZone:'Europe/Lisbon',includeSubagents:true,budgetMs:45000};
}
async function write(f,name,rows) {const p=path.join(f.roots[0],name);await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');return p;}
const one=s=>s.days.flatMap(d=>d.models)[0];
async function descriptor(p){const s=await fs.stat(p);return {path:p,size:s.size,mtime:s.mtimeMs,ino:s.ino,dev:s.dev};}

test('scanner merges repeated streaming blocks and ignores unrelated private text',async t=>{
 const f=await fixture(t),a=transcript(),b=structuredClone(a);b.message.usage.output_tokens=90;
 const p=await write(f,'main.jsonl',[{type:'user',message:{content:'VERY_SECRET_PROMPT'}},a,b]);const before=await fs.readFile(p);
 const s=await scan(f);assert.equal(one(s).requests,1);assert.equal(one(s).output,90);assert.deepEqual(await fs.readFile(p),before);
 const index=JSON.parse(await fs.readFile(path.join(f.cacheDir,'index.json')));for(const key of Object.keys(index.files)){
 const text=await fs.readFile(path.join(f.cacheDir,'records',key+'.json'),'utf8');assert.ok(!text.includes('PRIVATE_TEXT_DO_NOT_STORE'));assert.ok(!text.includes('VERY_SECRET_PROMPT'));assert.ok(!text.includes('msg-a'));
 }
});
test('duplicate response across fork files counts once',async t=>{
 const f=await fixture(t);await write(f,'a.jsonl',[transcript()]);await write(f,'fork.jsonl',[transcript()]);const s=await scan(f);assert.equal(one(s).requests,1);assert.equal(s.diagnostics.duplicateCopies,1);
});
test('subagent-only responses can be excluded without excluding copied main history',async t=>{
 const f=await fixture(t);await write(f,'a.jsonl',[transcript('main')]);await write(f,'s/subagents/agent-x.jsonl',[transcript('main'),transcript('child')]);
 assert.equal(one(await scan(f)).requests,2);assert.equal(one(await scan({...f,includeSubagents:false})).requests,1);
});
test('unchanged files are not re-indexed; appends add only new responses',async t=>{
 const f=await fixture(t);const p=await write(f,'a.jsonl',[transcript('a')]);await scan(f);assert.equal((await scan(f)).diagnostics.updatedFiles,0);
 await fs.appendFile(p,JSON.stringify(transcript('b'))+'\n');const s=await scan(f);assert.equal(one(s).requests,2);assert.equal(s.diagnostics.updatedFiles,1);
});
test('UTF-8 partial final line is completed on the next append without loss',async t=>{
 const f=await fixture(t),p=path.join(f.roots[0],'a.jsonl'),a=transcript('utf8');a.message.content=[{text:'bebé 🌙'}];
 const bytes=Buffer.from(JSON.stringify(a));const cut=bytes.indexOf(Buffer.from('🌙'))+2;
 await fs.writeFile(p,bytes.subarray(0,cut));assert.equal((await scan(f)).days.length,0);
 await fs.appendFile(p,Buffer.concat([bytes.subarray(cut),Buffer.from('\n')]));assert.equal(one(await scan(f)).requests,1);
});
test('valid final JSON without newline is counted and safely deduplicated later',async t=>{
 const f=await fixture(t),p=path.join(f.roots[0],'a.jsonl');await fs.writeFile(p,JSON.stringify(transcript('a')));assert.equal(one(await scan(f)).requests,1);
 await fs.appendFile(p,'\n'+JSON.stringify(transcript('b'))+'\n');assert.equal(one(await scan(f)).requests,2);
});
test('files larger than the mods fs.read limit are streamed',async t=>{
 const f=await fixture(t),p=path.join(f.roots[0],'large.jsonl');const irrelevant=JSON.stringify({type:'user',text:'x'.repeat(8192)})+'\n';
 await fs.writeFile(p,irrelevant.repeat(800)+JSON.stringify(transcript('big'))+'\n');assert.ok((await fs.stat(p)).size>4*1024*1024);assert.equal(one(await scan(f)).requests,1);
});
test('oversized line is skipped with bounded buffers, following row survives',async t=>{
 const f=await fixture(t),p=path.join(f.roots[0],'oversized.jsonl');await fs.writeFile(p,'x'.repeat(33*1024*1024)+'\n'+JSON.stringify(transcript('after-big'))+'\n');
 const cache=await indexFile(await descriptor(p));assert.equal(cache.oversized,1);assert.equal(cache.records.length,1);assert.equal(cache.offset,(await fs.stat(p)).size);
});
test('interrupted index resumes at a committed line boundary',async t=>{
 const f=await fixture(t);const rows=Array.from({length:600},(_,i)=>transcript('m'+i));const p=await write(f,'many.jsonl',rows);
 const d=await descriptor(p),first=await indexFile(d,null,0);assert.equal(first.complete,false);assert.ok(first.offset<d.size);
 const last=await indexFile(d,first);assert.equal(last.complete,true);assert.equal(last.records.length,600);
});
test('malformed usage rows do not abort the import',async t=>{
 const f=await fixture(t),p=path.join(f.roots[0],'a.jsonl');await fs.writeFile(p,'{"usage": broken}\n'+JSON.stringify(transcript())+'\n');const s=await scan(f);assert.equal(one(s).requests,1);assert.equal(s.diagnostics.malformed,1);
});
test('indexed history remains available when original log is pruned',async t=>{
 const f=await fixture(t),p=await write(f,'a.jsonl',[transcript()]);await scan(f);await fs.unlink(p);const s=await scan(f);assert.equal(one(s).requests,1);assert.equal(s.diagnostics.archivedFiles,1);
});
test('truncation or replacement does not lose already indexed history',async t=>{
 const f=await fixture(t),p=await write(f,'a.jsonl',[transcript('a'),transcript('b')]);await scan(f);await fs.writeFile(p,JSON.stringify(transcript('c'))+'\n');assert.equal(one(await scan(f)).requests,3);
});
test('removing a configured root excludes its retained counters',async t=>{
 const f=await fixture(t),extra=path.join(f.base,'extra');await fs.mkdir(extra);await write(f,'a.jsonl',[transcript('a')]);await fs.writeFile(path.join(extra,'b.jsonl'),JSON.stringify(transcript('b'))+'\n');
 assert.equal(one(await scan({...f,roots:[...f.roots,extra]})).requests,2);assert.equal(one(await scan(f)).requests,1);
});
test('missing folders are empty data, invalid zones are explicit errors',async t=>{
 const f=await fixture(t);assert.equal((await scan({...f,roots:[path.join(f.base,'missing')]})).days.length,0);await assert.rejects(scan({...f,timeZone:'No/Such/Zone'}),RangeError);
});
test('symlinks beneath a source root are not traversed',async t=>{
 const f=await fixture(t),outside=path.join(f.base,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.jsonl'),JSON.stringify(transcript())+'\n');
 try {await fs.symlink(outside,path.join(f.roots[0],'linked'),'dir');}catch(e){if(e.code==='EPERM'){t.skip('Host does not permit symlinks');return;}throw e;}
 assert.equal((await scan(f)).days.length,0);
});
test('simultaneous scan returns a busy snapshot rather than racing cache writes',async t=>{
 const f=await fixture(t);await write(f,'a.jsonl',[transcript()]);await scan(f);const lock=path.join(f.cacheDir,'scan.lock');await fs.mkdir(lock);await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,token:'test',created:Date.now()}));
 const s=await scan(f);assert.equal(s.busy,true);assert.equal(one(s).requests,1);
});
test('CSV export respects period/model selection and neutralizes formula IDs',()=>{
 const s={timeZone:'Europe/Lisbon',days:[{date:'2026-10-16',models:[{id:'=CMD()',read:10,write:20,input:30,output:40,requests:1},{id:'other',read:1,write:1,input:1,output:1,requests:1}]}]};
 const csv=exportCsv(s,{start:'2026-10-16',end:'2026-10-16',model:'=CMD()'});assert.ok(csv.includes("'=CMD()"));assert.ok(!csv.includes('other'));assert.ok(csv.includes('"100"'));assert.equal(exportCsv(s,{end:'2026-10-15'}).split('\r\n').length,2);
});
test('export creates a real CSV only inside the plugin cache export directory',async t=>{
 const f=await fixture(t);await write(f,'a.jsonl',[transcript()]);const s=await scan({...f,action:'export'});assert.equal(path.dirname(s.exportPath),path.join(f.cacheDir,'exports'));assert.ok((await fs.readFile(s.exportPath,'utf8')).includes('cache_read_tokens'));
});
test('CLI stdin protocol succeeds without shell or installed dependencies',async t=>{
 const f=await fixture(t);await write(f,'a.jsonl',[transcript()]);const child=spawnSync(process.execPath,[path.join(rootDir,'scanner/index.mjs')],{input:JSON.stringify(f),encoding:'utf8'});assert.equal(child.status,0);assert.equal(one(JSON.parse(child.stdout)).requests,1);
});
test('default roots honor CLAUDE_CONFIG_DIR and never ask for credentials',()=>{
 assert.deepEqual(defaultRoots({CLAUDE_CONFIG_DIR:'/custom'},'/home/user','linux'),['/custom/projects']);assert.ok(defaultRoots({},'/home/user','linux').every(p=>!p.includes('credentials')));
});

test('quota reset changes regroup the retained v1 record cache without re-reading logs',async t=>{
 const f=await fixture(t);const a=transcript('at-reset',{timestamp:'2026-10-08T19:30:00Z'});
 const p=await write(f,'a.jsonl',[a]);const original=await scan(f);
 assert.equal(original.weeks[0].date,'2026-10-08');
 // The existing record-cache version remains supported; only derived snapshots change.
 const recs=await fs.readdir(path.join(f.cacheDir,'records'));
 const bytes=await fs.readFile(path.join(f.cacheDir,'records',recs[0]));
 const changed=await scan({...f,resetTime:'21:00'});
 assert.equal(changed.weeks[0].date,'2026-10-01');assert.equal(changed.diagnostics.updatedFiles,0);assert.deepEqual(changed.days,original.days);
 assert.deepEqual(await fs.readFile(path.join(f.cacheDir,'records',recs[0])),bytes);
 await fs.unlink(p);const archived=await scan({...f,resetDay:1,resetTime:'08:15'});
 assert.equal(archived.weeks[0].date,'2026-10-05');assert.equal(archived.diagnostics.archivedFiles,1);assert.deepEqual(archived.days,original.days);
});
test('busy snapshot from another reset is not reused',async t=>{
 const f=await fixture(t);await write(f,'a.jsonl',[transcript()]);await scan(f);
 const lock=path.join(f.cacheDir,'scan.lock');await fs.mkdir(lock);await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,token:'test'}));
 const s=await scan({...f,resetTime:'08:15'});assert.equal(s.busy,true);assert.equal(s.initialScan,true);assert.equal(s.days.length,0);assert.equal(s.quota,undefined);
});
test('weekly export writes actual model totals and reset metadata',async t=>{
 const f=await fixture(t);await write(f,'a.jsonl',[transcript('a',{timestamp:'2026-10-08T19:30:00Z'})]);
 const s=await scan({...f,resetTime:'21:00',action:'export',selection:{grouping:'week',range:'all'}});
 const csv=await fs.readFile(s.exportPath,'utf8');assert.ok(csv.includes('quota_start_utc'));assert.ok(csv.includes('"2026-10-01T20:00:00.000Z"'));assert.ok(csv.includes('"1000"'));assert.ok(csv.includes('"21:00"'));
});
test('scanner refuses invalid reset fields before creating cache writes',async t=>{
 const f=await fixture(t);await assert.rejects(scan({...f,resetTime:'88:00'}),/Hora de reset inválida/);
 await assert.rejects(scan({...f,resetDay:1.5}),/dia de reset/);
 await assert.rejects(fs.stat(f.cacheDir),{code:'ENOENT'});
});
