import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { SPEEDS, normalizeSpeed, speedOf, speedFilter, mergeSpeed } from '../lib/speed.js';
import { normalizeUsage, parseTranscriptRow, mergeRecord, total, zero, METRICS } from '../lib/usage.js';
import { FAST_API_RATES, priceRecord, costOf, addPriced, speedTotals, costStatus,
  COST_CSV_HEADERS, SPEED_CSV_HEADERS } from '../lib/pricing.js';
import { makeView } from '../lib/view-model.js';
import { aggregateRecords, scan, exportCsv } from '../scanner/index.mjs';
import { speedSvg, costSvg } from '../lib/visuals.js';
import { createI18n, CATALOGUES } from '../lib/i18n.js';
import { transcript, demoSnapshot } from './fixtures.mjs';
import { harness, walk } from './harness.mjs';

const now=Date.parse('2026-10-16T18:00:00Z');
const options={timeZone:'Europe/Lisbon',resetDay:4,resetTime:'20:00',includeSubagents:true};
const request=(id,speed,patch={})=>({id,speed,model:'claude-opus-5-5',timestamp:now-1000,
  read:1000,write:100,write5m:60,write1h:40,input:20,output:30,requests:1,...patch});
const aggregate=records=>aggregateRecords([{records}],options,now);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);

for(const raw of ['fast','standard',undefined,null,'FAST','priority','normal','__proto__',true,0,{}]) {
  test(`normalize response speed without guessing: ${JSON.stringify(raw)}`,()=>{
    const expected=raw==='fast'||raw==='standard'?raw:'unknown';
    assert.equal(normalizeSpeed(raw),expected);
    assert.equal(normalizeUsage({input_tokens:1,speed:raw}).speed,expected);
  });
}
test('only response usage.speed is evidence; request flags, service tier and latency are ignored',()=>{
  const row=transcript();Object.assign(row,{isFastMode:true,speed:'fast',durationMs:1});
  row.message.usage.service_tier='priority';row.message.speed='fast';
  assert.equal(parseTranscriptRow(row).speed,'unknown');
  row.message.usage.speed='standard';assert.equal(parseTranscriptRow(row).speed,'standard');
  row.message.usage.speed='fast';assert.equal(parseTranscriptRow(row).speed,'fast');
});
test('speed metadata without token usage is not fabricated into a request',()=>{
  assert.equal(normalizeUsage({speed:'fast'}),null);
});
test('absent speed does not make an old cached request Standard',()=>{
  const old=request('old',undefined);assert.equal(speedOf(old),'unknown');
  const model=aggregate([old]).days[0].models[0];
  assert.equal(model.speeds.unknown.requests,1);assert.equal(model.speeds.standard.requests,0);
});
test('duplicate metadata enriches cumulative responses without double-counting',()=>{
  const first=request('one',undefined,{output:2}),last=request('one','fast',{output:50});
  for(const records of [[first,last],[last,first]]) {
    const m=aggregate(records).days[0].models[0];
    assert.equal(m.requests,1);assert.equal(m.output,50);assert.equal(m.speeds.fast.requests,1);
    assert.equal(m.cost.assumedStandardRequests,0);
    near(m.cost.total,priceRecord({...last,output:50}).total);
  }
});
test('contradictory response evidence is a sticky, order-independent Unknown',()=>{
  const a=request('one','fast'),b=request('one','standard'),c=request('one',undefined);
  for(const rows of [[a,b,c],[b,a,c],[c,b,a],[c,a,b],[a,c,b],[b,c,a]]) {
    const merged=rows.reduce((state,r)=>mergeRecord(state,r),null);
    assert.equal(merged.speed,'unknown');assert.equal(merged.speedConflict,true);
    assert.equal(mergeSpeed(merged,a).speedConflict,true);
    const m=aggregate(rows).days[0].models[0];assert.equal(m.requests,1);assert.equal(m.speeds.unknown.requests,1);
  }
});
test('invalid saved filters safely use all speeds',()=>{
  for(const v of [undefined,'ALL','',null,'__proto__',{}])assert.equal(speedFilter(v),'all');
  for(const speed of SPEEDS)assert.equal(speedFilter(speed),speed);
});
for(const [model,input,output,read] of [
  ['claude-opus-5-5',8,40,.4],['claude-opus-5',10,50,1],['claude-opus-4-8',10,50,1],
]) test(`verified Fast pricing includes input, output, cache read and both TTLs: ${model}`,()=>{
  const rec=request('one','fast',{model,read:1e6,write:1e6,write5m:5e5,write1h:5e5,input:1e6,output:1e6});
  const c=priceRecord(rec);
  assert.deepEqual(FAST_API_RATES[model],{input,output,read,write5m:input*1.25,write1h:input*2});
  assert.equal(c.input,input);assert.equal(c.output,output);assert.equal(c.read,read);
  assert.equal(c.write,input*1.625);assert.equal(c.total,c.totalMax);
  assert.equal(c.pricedTokens,4e6);assert.equal(c.assumedStandardTokens,0);
  near(c.total,priceRecord({...rec,speed:'standard'}).total*2);
});
test('Fast unknown cache TTL yields Fast 5m-to-1h range, not standard prices',()=>{
  const c=priceRecord(request('x','fast',{read:0,input:0,output:0,write:1e6,write5m:0,write1h:0}));
  assert.equal(c.total,10);assert.equal(c.totalMax,16);assert.equal(c.unknownWriteTokens,1e6);
});
test('unsupported and historical Fast model tariffs stay explicitly unpriced',()=>{
  for(const model of ['unknown','claude-sonnet-5-5','claude-opus-4-6','claude-opus-4-7']) {
    const c=priceRecord(request('x','fast',{model}));
    assert.equal(costStatus(c),'unavailable');assert.equal(c.unpricedTokens,1150);
  }
});
test('unknown speed retains an explicitly labelled standard-equivalent assumption',()=>{
  const r=request('x',undefined),c=priceRecord(r),standard=priceRecord({...r,speed:'standard'});
  assert.equal(c.total,standard.total);assert.equal(c.assumedStandardTokens,total(r));assert.equal(c.assumedStandardRequests,1);
  const draw=costSvg({...r,cost:c},'Test','Selection');
  assert.ok(draw.alt.includes('unknown speed'));assert.ok(draw.source.includes('standard rates'));
  assert.equal(standard.assumedStandardTokens,0);
});
test('known standard fallbacks use Standard rates even with Fast intent elsewhere',()=>{
  const row=transcript();row.message.model='claude-opus-5-5';row.speed='fast';row.isFastMode=true;
  row.message.usage.speed='standard';
  const r=parseTranscriptRow(row);assert.equal(r.speed,'standard');assert.equal(priceRecord(r).input,20*4/1e6);
});

function assertReconciles(value) {
  for(const key of [...METRICS,'requests']) assert.equal(SPEEDS.reduce((n,s)=>n+speedTotals(value,s)[key],0),value[key]);
  for(const key of Object.keys(costOf(value)))near(SPEEDS.reduce((n,s)=>n+speedTotals(value,s).cost[key],0),costOf(value)[key]);
}
test('mixed modes preserve request counts, model identity, four token categories and all costs',()=>{
  const snapshot=aggregate(SPEEDS.map((speed,i)=>request(String(i),speed)));
  const m=snapshot.days[0].models[0];assert.equal(m.requests,3);assertReconciles(m);
  const t=zero();addPriced(t,m);addPriced(t,m);assertReconciles(t);assert.equal(t.speeds.fast.requests,2);
  for(const speed of SPEEDS)assert.equal(m.speeds[speed].requests,1); // Not mutated by aggregation.
});
test('all-zero token requests remain counted by speed',()=>{
  const m=aggregate([request('x','fast',{read:0,write:0,input:0,output:0,write5m:0,write1h:0})]).days[0].models[0];
  assert.equal(m.requests,1);assert.equal(m.speeds.fast.requests,1);assert.equal(total(m),0);
});
for(const range of ['all','30d','7d','quota'])for(const speed of ['all',...SPEEDS]) {
  test(`daily/weekly totals, selections, costs and model filters reconcile: ${range} / ${speed}`,()=>{
    const s=demoSnapshot();
    for(const model of ['all','claude-opus-5-5']) {
      const a=makeView(s,{range,speed,model,grouping:'day'}),b=makeView(s,{range,speed,model,grouping:'week'});
      assert.deepEqual(a.totals,b.totals);assertReconciles(a.totals);
      for(const v of [a,b]) {
        assert.equal(v.speed,speed);assertReconciles(v.day);
        for(const m of v.modelTotals) {assertReconciles(m);if(model!=='all')assert.equal(m.id,model);}
        if(speed!=='all')for(const other of SPEEDS.filter(s=>s!==speed))assert.equal(speedTotals(v.totals,other).requests,0);
      }
    }
  });
}
test('speed filter uses exact weekly reset timestamps, not whole calendar days',()=>{
  const s=aggregate([
    request('before','fast',{timestamp:Date.parse('2026-10-15T18:59:59Z')}),
    request('after','standard',{timestamp:Date.parse('2026-10-15T19:00:00Z')})
  ]);
  assert.equal(makeView(s,{range:'quota',speed:'fast'}).totals.requests,0);
  assert.equal(makeView(s,{range:'quota',speed:'standard'}).totals.requests,1);
});
test('speed filtering does not collapse All time pagination or hide empty days',()=>{
  const s=demoSnapshot(),v=makeView(s,{range:'all',speed:'fast'});
  for(let page=0;page<v.pageCount;page++)assert.deepEqual(makeView(s,{range:'all',speed:'fast',page}).totals,v.totals);
  const empty=makeView(s,{range:'7d',model:'claude-sonnet-5-5',speed:'fast'});
  assert.equal(empty.chartDays.length,7);assert.equal(empty.totals.requests,0);
});
function csvRows(csv) {
  const lines=csv.trim().replace(/^\uFEFF/,'').split('\r\n'),keys=lines.shift().split(',');
  return lines.map(line=>Object.fromEntries([...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((m,i)=>[keys[i],m[1].replace(/""/g,'"')])));
}
test('daily and weekly CSV carry speed breakdowns, costs and assumptions without altering old columns',()=>{
  const s=aggregate(SPEEDS.map((speed,i)=>request(String(i),speed)));
  for(const grouping of ['day','week']) {
    const csv=exportCsv(s,{range:'all',grouping});
    for(const header of [...COST_CSV_HEADERS,...SPEED_CSV_HEADERS])assert.ok(csv.includes(header));
    const row=csvRows(csv).find(r=>r.model==='claude-opus-5-5');
    assert.equal(row.requests,'3');assert.equal(row.fast_requests,'1');assert.equal(row.standard_requests,'1');assert.equal(row.unknown_requests,'1');
    assert.equal(row.api_standard_assumed_tokens,'1150');
    const filtered=csvRows(exportCsv(s,{range:'all',grouping,speed:'fast'})).find(r=>r.model==='claude-opus-5-5');
    assert.equal(filtered.requests,'1');assert.equal(filtered.fast_requests,'1');assert.equal(filtered.standard_requests,'0');assert.equal(filtered.unknown_requests,'0');
    near(Number(filtered.api_equivalent_usd_min),priceRecord(request('f','fast')).total);
  }
});
test('old snapshot without breakdown is only selectable as Unknown, not Standard',()=>{
  const old={today:'2026-10-16',timeZone:'Europe/Lisbon',days:[{date:'2026-10-16',models:[{id:'legacy',...zero(),input:1,requests:1}]}]};
  assert.equal(makeView(old,{speed:'unknown'}).totals.requests,1);
  assert.equal(makeView(old,{speed:'standard'}).totals.requests,0);
});

async function localFixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stats-speed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const root=path.join(dir,'projects');await fs.mkdir(root);
  const source=path.join(root,'session.jsonl'),row=transcript('speed-migration');
  row.message.model='claude-opus-5-5';row.message.usage.speed='fast';row.message.usage.cache_creation={ephemeral_5m_input_tokens:60,ephemeral_1h_input_tokens:40};
  const bytes=JSON.stringify(row)+'\n';await fs.writeFile(source,bytes);
  const opts={...options,roots:[root],cacheDir:path.join(dir,'cache')};
  return {source,bytes,opts,root};
}
async function downgrade(f) {
  const folder=path.join(f.opts.cacheDir,'records');const file=path.join(folder,(await fs.readdir(folder))[0]);
  const cache=JSON.parse(await fs.readFile(file,'utf8'));cache.detailVersion=2;
  for(const r of cache.records){delete r.speed;delete r.speedConflict;}
  await fs.writeFile(file,JSON.stringify(cache));return file;
}
test('v1.3.1 unchanged transcripts recover speed once without modifying logs or losing TTL/tokens',async t=>{
  const f=await localFixture(t),before=await scan(f.opts);const cacheFile=await downgrade(f);
  const after=await scan(f.opts),m=after.days[0].models[0];
  assert.equal(after.diagnostics.updatedFiles,1);assert.equal(total(m),total(before.days[0].models[0]));
  assert.equal(m.speeds.fast.requests,1);assert.equal(m.cost.assumedStandardTokens,0);assert.equal(m.cost.unknownWriteTokens,0);
  const cache=JSON.parse(await fs.readFile(cacheFile,'utf8'));assert.equal(cache.detailVersion,3);assert.equal(cache.records[0].speed,'fast');
  assert.equal(await fs.readFile(f.source,'utf8'),f.bytes);assert.equal((await scan(f.opts)).diagnostics.updatedFiles,0);
  const raw=JSON.stringify(cache);assert.ok(!raw.includes('PRIVATE_TEXT_DO_NOT_STORE'));assert.ok(!raw.includes('"content"'));assert.ok(!raw.includes('"cost"'));
});
test('deleted old transcripts keep totals and explicitly become Unknown',async t=>{
  const f=await localFixture(t),before=await scan(f.opts);await downgrade(f);await fs.unlink(f.source);
  const s=await scan(f.opts),m=s.days[0].models[0];assert.equal(s.diagnostics.archivedFiles,1);
  assert.equal(total(m),total(before.days[0].models[0]));assert.equal(m.speeds.unknown.requests,1);assert.equal(m.cost.assumedStandardTokens,total(m));
});
test('appended cumulative rows enrich speed without recounting the response',async t=>{
  const f=await localFixture(t),row=JSON.parse(f.bytes);delete row.message.usage.speed;
  await fs.writeFile(f.source,JSON.stringify(row)+'\n');await scan(f.opts);
  row.message.usage.speed='fast';row.message.usage.output_tokens=60;await fs.appendFile(f.source,JSON.stringify(row)+'\n');
  const s=await scan(f.opts),m=s.days[0].models[0];assert.equal(m.requests,1);assert.equal(m.output,60);assert.equal(m.speeds.fast.requests,1);
});
test('subagent inclusion remains orthogonal to speed and global deduplication',()=>{
  const main=request('main','fast'),agent=request('agent','fast',{agent:true});
  const s=aggregateRecords([{records:[main,agent,{...main,agent:true}]}],{...options,includeSubagents:false},now);
  assert.equal(s.days[0].models[0].speeds.fast.requests,1);assert.equal(s.diagnostics.duplicateCopies,1);
});

for(const locale of Object.keys(CATALOGUES))for(const theme of ['dark','light']) {
  test(`${locale} / ${theme}: speed card translated, bounded, escaped and accessible`,()=>{
    const l=createI18n(locale),v=makeView(demoSnapshot(),{range:'quota'}),d=speedSvg(v.totals,'<Title>',theme,l);
    for(const speed of SPEEDS)assert.ok(d.alt.includes(l.t(`speed_${speed}`)));
    assert.ok(d.source.includes('&lt;Title&gt;'));assert.ok(!d.source.includes('<Title>'));
    assert.ok(!/NaN|undefined|Infinity|<script|foreignObject/.test(d.source));assert.ok(d.source.length<131072);
    assert.ok(d.alt.includes(l.t('speedUnknownHelp')));
  });
}
test('native speed filter persists, changes totals immediately and is sent to CSV export',async()=>{
  const h=harness({language:'en-US'});await h.start();let tree=await h.render();
  const before=h.calls.filter(c=>c[0]==='process.run').length;
  await h.find(tree,'speed').props.onSelect('fast');tree=await h.render();
  assert.equal(h.store.get('preferences-v1').speed,'fast');
  assert.equal(h.calls.filter(c=>c[0]==='process.run').length,before); // No rescan/model request to filter.
  const cards=[];walk(tree,n=>{if(n.type==='Svg')cards.push(n.props.alt);});
  assert.ok(cards.some(s=>s.startsWith('Request speed · period')));
  assert.ok(cards.some(s=>s.startsWith('Request speed · selection')));
  await h.find(tree,'export').props.onPress();
  const call=h.calls.filter(c=>c[0]==='process.run'&&c[2]?.stdin).at(-1);
  assert.equal(JSON.parse(call[2].stdin).selection.speed,'fast');
});
test('speed statistics do not change after language/theme switches or weekly regrouping',async()=>{
  const h=harness();await h.start();let tree=await h.render();await h.find(tree,'speed').props.onSelect('fast');
  await h.fire('command.run',{command:'account-stats',args:'weeks'});await h.flush();
  h.settingsState.language='de-DE';await h.fire('config.set',{key:'language'});tree=await h.render();
  assert.equal(h.find(tree,'speed').props.value,'fast');assert.equal(h.find(tree,'speed').props.label,createI18n('de-DE').t('speedFilter'));
  await h.find(tree,'theme').props.onPress();tree=await h.render();assert.equal(h.find(tree,'speed').props.value,'fast');
});
