import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeUsage, parseTranscriptRow, mergeRecord, total, zero } from '../lib/usage.js';
import { API_RATES, canonicalModel, priceRecord, costOf, formatCost, formatUsd, costStatus,
  addPriced, PRICING_VERSION, COST_CSV_HEADERS } from '../lib/pricing.js';
import { aggregateRecords, scan, exportCsv } from '../scanner/index.mjs';
import { makeView } from '../lib/view-model.js';
import { costSvg as drawCost, chartSvg, modelsSvg } from '../lib/visuals.js';
import { transcript, demoSnapshot } from './fixtures.mjs';
const costSvg=(value,title,subtitle,theme='dark')=>drawCost(value,title,subtitle,theme,'pt-PT');
const record = (patch={}) => ({id:'id',timestamp:Date.parse('2026-10-16T12:00:00Z'),model:'claude-opus-5-5',read:0,write:0,input:0,output:0,requests:1,...patch});
const aggregate = rows => aggregateRecords([{records:rows}],{timeZone:'Europe/Lisbon',resetDay:4,resetTime:'20:00',includeSubagents:true},Date.parse('2026-10-16T18:00:00Z'));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

for(const [model,expected] of [
 ['claude-opus-5-5',[4,20,.2,5,8]], ['claude-sonnet-5-5',[2,10,.1,2.5,4]],
 ['claude-haiku-5-5',[.1,.5,.01,.125,.2]], ['claude-fable-5-1',[10,50,.25,12.5,20]],
 ['claude-opus-4-1',[15,75,1.5,18.75,30]], ['claude-sonnet-4-6',[3,15,.3,3.75,6]],
 ['claude-haiku-3-5',[.8,4,.08,1,1.6]],
]) test('official USD/MTok snapshot: '+model,()=>{
 const r=API_RATES[model];assert.deepEqual([r.input,r.output,r.read,r.write5m,r.write1h],expected);
});

test('explicit model IDs and known provider wrappers resolve without guessing aliases',()=>{
 for(const id of ['claude-opus-5-5','CLAUDE-OPUS-5-5','claude-opus-5-5-20261001','anthropic.claude-opus-5-5','us.anthropic.claude-opus-5-5-20261001-v1:0','claude-opus-5-5@20261001'])assert.equal(canonicalModel(id),'claude-opus-5-5');
 assert.equal(canonicalModel('claude-3-5-haiku-20241022'),'claude-haiku-3-5');
 for(const id of ['opus','claude-opus-6','claude-opus-5-5-fake','claude-sonnet-demo','unknown','__proto__'])assert.equal(canonicalModel(id),null);
});
test('known 5m cache, new input and output are charged separately, once',()=>{
 const c=priceRecord(record({read:1e6,write:1e6,write5m:1e6,input:1e6,output:1e6}));
 assert.deepEqual([c.read,c.write,c.input,c.output,c.total,c.totalMax],[.2,5,4,20,29.2,29.2]);
 assert.equal(c.pricedTokens,4e6);
});
test('1h cache writes use 2x base input, not 5m cost',()=>{
 const c=priceRecord(record({write:1e6,write1h:1e6}));assert.equal(c.total,8);assert.equal(c.totalMax,8);assert.equal(c.unknownWriteTokens,0);
});
test('mixed TTL details are preserved by normalization and do not double-count writes',()=>{
 const u=normalizeUsage({cache_creation_input_tokens:100,cache_creation:{ephemeral_5m_input_tokens:40,ephemeral_1h_input_tokens:60}});
 assert.equal(total(u),100);assert.equal(u.write5m,40);assert.equal(u.write1h,60);
 near(priceRecord(record(u)).total,(40*5+60*8)/1e6);
});
test('absent TTL returns a 5m-to-1h interval instead of silently choosing a price',()=>{
 const c=priceRecord(record({write:1e6}));assert.equal(c.total,5);assert.equal(c.totalMax,8);
 assert.equal(costStatus(c),'range');assert.equal(formatCost(c),'$5.00 – $8.00');
});
test('partly known TTL leaves only the missing remainder uncertain',()=>{
 const c=priceRecord(record({write:1e6,write5m:2e5,write1h:3e5}));assert.equal(c.unknownWriteTokens,5e5);
 near(c.total,5.9);near(c.totalMax,7.4);
});
test('inconsistent TTL data never inflates tokens or gives negative costs',()=>{
 const c=priceRecord(record({write:100,write5m:100,write1h:100}));assert.equal(c.unknownWriteTokens,100);
 near(c.total,.0005);near(c.totalMax,.0008);
 const m=mergeRecord(record({write:100,write5m:100}),record({write:100,write1h:100}));
 assert.equal(m.write,100);assert.equal(m.write5m,0);assert.equal(m.write1h,0);
});
test('Haiku threshold counts cached input and applies to output as well',()=>{
 const low=priceRecord(record({model:'claude-haiku-5-5',read:90000,write:5000,write1h:5000,input:5000,output:1000}));
 const high=priceRecord(record({model:'claude-haiku-5-5',read:90001,write:5000,write1h:5000,input:5000,output:1000}));
 near(low.output,.0005);near(high.output,.0025);near(low.read,.0009);near(high.read,.00450005);
});
test('the Haiku tier is applied per request, never to the sum or average of a day',()=>{
 const a=record({id:'a',model:'claude-haiku-5-5',input:60000,output:1000});
 const b=record({id:'b',model:'claude-haiku-5-5',input:60000,output:1000});
 const c=record({id:'c',model:'claude-haiku-5-5',input:100001,output:1000});
 const s=aggregate([a,b,c]), m=s.days[0].models[0];
 near(m.cost.input,.006+.006+.0500005);near(m.cost.output,.0005+.0005+.0025);
});
test('unknown models are unavailable, not zero-cost or priced as a different family',()=>{
 const c=priceRecord(record({model:'claude-opus-new-unverified',input:100}));
 assert.equal(c.unpricedTokens,100);assert.equal(c.pricedTokens,0);assert.equal(costStatus(c),'unavailable');assert.equal(formatCost(c),'Sem preço');
});
test('unverified legacy long-context tariffs are explicitly unpriced',()=>{
 const c=priceRecord(record({model:'claude-sonnet-4-5',read:200001}));assert.equal(costStatus(c),'unavailable');
});
test('mixing known and unknown models reports a priced subtotal plus missing coverage',()=>{
 const s=aggregate([record({id:'a',input:1e6}),record({id:'b',model:'unknown',input:100})]);
 const v=makeView(s,{range:'all'}),c=costOf(v.totals);assert.equal(c.total,4);assert.equal(c.unpricedTokens,100);assert.equal(costStatus(c),'partial');
 const drawing=costSvg(v.totals,'Teste','Subtotal');assert.ok(drawing.source.includes('Subtotal com preços conhecidos'));assert.ok(drawing.alt.includes('100 tokens sem preço'));
});
test('a bare aggregate cannot be priced as a single giant request',()=>{
 const t=zero();addPriced(t,{id:'claude-haiku-5-5',read:1e6,write:0,input:0,output:0,requests:100});
 assert.equal(costStatus(costOf(t)),'unavailable');
});
test('deduplication and cumulative response merging happen before cost calculation',()=>{
 const a=record({id:'same',read:1000,output:10}),b=record({id:'same',read:1000,output:30});
 const s=aggregate([a,b]),c=s.days[0].models[0].cost;assert.equal(c.pricedRequests,1);near(c.read,.0002);near(c.output,.0006);
});
test('global day, quota and model costs reconcile without per-request cent rounding',()=>{
 const s=demoSnapshot();
 for(const range of ['all','30d','7d','quota']) {
  const d=makeView(s,{range,grouping:'day'}),w=makeView(s,{range,grouping:'week'});
  assert.deepEqual(costOf(d.totals),costOf(w.totals));
  const sub=d.modelTotals.reduce((a,m)=>{a.min+=costOf(m).total;a.max+=costOf(m).totalMax;return a;},{min:0,max:0});
  near(costOf(d.totals).total,sub.min);near(costOf(d.totals).totalMax,sub.max);
 }
});
test('very small nonzero charges remain visibly nonzero',()=>{
 assert.equal(formatUsd(.001),'$0.0010');assert.equal(formatUsd(.00000001),'<$0.0001');assert.equal(formatUsd(0),'$0.00');
});
test('one million single-token reads are not individually rounded to zero cents',()=>{
 const one=priceRecord(record({read:1}));near(one.total,.0000002);
 const a=zero();for(let i=0;i<1000;i++)addPriced(a,{read:1,write:0,input:0,output:0,requests:1,cost:one});near(a.cost.total,.0002);
});
test('USD chart and detail cards respect model filters and contain no NaN',()=>{
 const s=demoSnapshot();
 for(const grouping of ['day','week']) for(const theme of ['dark','light']) {
  const v=makeView(s,{range:'all',grouping,model:'claude-sonnet-5-5'});
  for(const graphic of [costSvg(v.totals,'Período','Teste',theme),chartSvg(v,'cost',theme),modelsSvg(v.day.models,'Modelos','Teste',theme)]){
   assert.ok(!/NaN|Infinity|undefined/.test(graphic.source));assert.ok(graphic.source.length<131072);
  }
  assert.ok(chartSvg(v,'cost',theme).alt.includes('USD'));
 }
});
test('cost SVG escapes external titles and preserves partial status',()=>{
 const s=costSvg({...zero(),input:100},'<script>&bad','<foreignObject/>');
 assert.ok(!s.source.includes('<script>'));assert.ok(s.source.includes('&lt;script&gt;'));assert.ok(s.source.includes('Sem tarifa confirmada'));
});
test('CSV includes each USD category, range bounds, currency and price date',()=>{
 const s=aggregate([record({id:'known',write:1e6,input:1e6}),record({id:'unknown',model:'unverified',input:100})]);
 for(const grouping of ['day','week']){
  const csv=exportCsv(s,{range:'all',grouping});for(const header of COST_CSV_HEADERS)assert.ok(csv.includes(header));
  assert.ok(csv.includes('"9.000000000","12.000000000"'));assert.ok(csv.includes('"unavailable","USD","2026-10-16","",""'));
 }
});
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'account-stats-pricing-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const root=path.join(dir,'projects');await fs.mkdir(root);return {roots:[root],cacheDir:path.join(dir,'cache'),timeZone:'Europe/Lisbon'};
}
async function writeSource(f){
 const row=transcript('migration');row.message.model='claude-opus-5-5';row.timestamp='2026-10-08T19:30:00Z';
 row.message.usage.cache_creation={ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:100};
 const src=path.join(f.roots[0],'a.jsonl'),bytes=JSON.stringify(row)+'\n';await fs.writeFile(src,bytes);return {src,bytes};
}
async function downgradeCache(f){
 const dir=path.join(f.cacheDir,'records'),file=path.join(dir,(await fs.readdir(dir))[0]);const data=JSON.parse(await fs.readFile(file,'utf8'));
 delete data.detailVersion;for(const r of data.records){delete r.write5m;delete r.write1h;}await fs.writeFile(file,JSON.stringify(data));return file;
}
test('unchanged v1.1.1 source files are automatically enriched with TTL metadata once',async t=>{
 const f=await fixture(t),{src,bytes}=await writeSource(f);const first=await scan(f);const cacheFile=await downgradeCache(f);
 const next=await scan(f);assert.equal(next.diagnostics.updatedFiles,1);assert.equal(next.pricing.version,PRICING_VERSION);
 assert.equal(total(next.days[0].models[0]),total(first.days[0].models[0]));assert.equal(next.days[0].models[0].cost.unknownWriteTokens,0);
 assert.equal(JSON.parse(await fs.readFile(cacheFile,'utf8')).detailVersion,2);assert.equal(await fs.readFile(src,'utf8'),bytes);
 assert.equal((await scan(f)).diagnostics.updatedFiles,0);
});
test('deleted old transcripts retain their counts and use an explicit TTL range',async t=>{
 const f=await fixture(t),{src}=await writeSource(f);const first=await scan(f);await downgradeCache(f);await fs.unlink(src);
 const s=await scan(f);assert.equal(s.diagnostics.archivedFiles,1);assert.equal(total(s.days[0].models[0]),total(first.days[0].models[0]));
 const c=s.days[0].models[0].cost;assert.equal(c.unknownWriteTokens,100);assert.ok(c.totalMax>c.total);
});
test('cost fields are derived and never written into a per-response record cache',async t=>{
 const f=await fixture(t);await writeSource(f);await scan(f);const dir=path.join(f.cacheDir,'records');const raw=await fs.readFile(path.join(dir,(await fs.readdir(dir))[0]),'utf8');
 assert.ok(!raw.includes('PRIVATE_TEXT_DO_NOT_STORE'));assert.ok(!raw.includes('"cost"'));assert.ok(raw.includes('write1h'));
});
test('a busy old price snapshot cannot be mistaken for the current tariff snapshot',async t=>{
 const f=await fixture(t);await writeSource(f);await scan(f);const snap=path.join(f.cacheDir,'snapshot.json'),s=JSON.parse(await fs.readFile(snap,'utf8'));delete s.pricing;await fs.writeFile(snap,JSON.stringify(s));
 const lock=path.join(f.cacheDir,'scan.lock');await fs.mkdir(lock);await fs.writeFile(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid,token:'test'}));
 const busy=await scan(f);assert.equal(busy.busy,true);assert.equal(busy.initialScan,true);
});
