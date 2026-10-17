import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaClock, quotaSettings, quotaSignature, quotaIntervalLabel } from '../lib/quota.js';
import { total } from '../lib/usage.js';
import { makeView, PAGE_WEEKS } from '../lib/view-model.js';
import { aggregateRecords, exportCsv } from '../scanner/index.mjs';
import { demoSnapshot } from './fixtures.mjs';
import { cycleSvg, chartSvg } from '../lib/visuals.js';
const ts=value=>Date.parse(value);
const NOW=ts('2026-10-16T16:00:00Z');
const record=(id,timestamp,read=10,extra={})=>({id,timestamp:ts(timestamp),read,write:2,input:3,output:5,model:'claude-test',...extra});
const data=(records,options={},now=NOW)=>aggregateRecords([{records}],{timeZone:'Europe/Lisbon',includeSubagents:true,...options},now);
const chosenTotal=s=>makeView(s,{range:'quota',grouping:'week'}).totals;

test('default reset is Thursday 20:00 in Europe/Lisbon',()=>{
 assert.deepEqual(quotaSettings(),{timeZone:'Europe/Lisbon',resetDay:4,resetTime:'20:00'});
});
test('reject malformed hours, minute overflow, fractional weekdays and invalid zones',()=>{
 for(const resetTime of ['8pm','24:00','20:60','-1:00','20','20:00:01',' 20:00','8:00'])assert.throws(()=>quotaSettings({resetTime}));
 for(const resetDay of [-1,7,2.5,'4',NaN])assert.throws(()=>quotaSettings({resetDay}));
 assert.throws(()=>quotaSettings({timeZone:'No/Such/Zone'}));
 for(const resetTime of ['00:00','08:01','20:00','23:59'])assert.doesNotThrow(()=>quotaSettings({resetTime}));
});
test('one millisecond before, exactly at, and after reset have half-open ownership',()=>{
 const c=createQuotaClock();
 const before=c.periodAt(ts('2026-10-15T18:59:59.999Z'));
 const at=c.periodAt(ts('2026-10-15T19:00:00.000Z'));
 const after=c.periodAt(ts('2026-10-15T19:00:00.001Z'));
 assert.equal(before.start,'2026-10-08T19:00:00.000Z');
 assert.equal(at.start,'2026-10-15T19:00:00.000Z');assert.equal(at.id,after.id);assert.equal(before.end,at.start);
 assert.equal(c.periodAt(at.endMs).start,at.end);
});
test('Lisbon summer and winter use the same configured wall-clock hour',()=>{
 const c=createQuotaClock();
 assert.equal(c.periodAt(ts('2026-07-16T22:00:00Z')).start,'2026-07-16T19:00:00.000Z');
 assert.equal(c.periodAt(ts('2026-12-17T22:00:00Z')).start,'2026-12-17T20:00:00.000Z');
});
test('spring quota lasts 167 hours, autumn quota 169, not fixed 168',()=>{
 const c=createQuotaClock();
 const spring=c.periodFromDate('2026-03-26'),autumn=c.periodFromDate('2026-10-22');
 assert.equal((spring.endMs-spring.startMs)/3600000,167);
 assert.equal((autumn.endMs-autumn.startMs)/3600000,169);
 assert.equal(c.periodFromDate('2026-04-02').start,spring.end);
 assert.equal(c.periodFromDate('2026-10-29').start,autumn.end);
});
test('UTC setting produces fixed 168-hour cycles and keeps configured hour',()=>{
 const c=createQuotaClock({timeZone:'UTC'}),w=c.periodFromDate('2026-10-22');
 assert.equal(w.start,'2026-10-22T20:00:00.000Z');assert.equal(w.endMs-w.startMs,168*3600000);
});
test('reset weekday and minute are configurable and support non-hour timezone offsets',()=>{
 const c=createQuotaClock({resetDay:1,resetTime:'08:15'});
 assert.equal(c.periodAt(ts('2026-10-12T07:15:00Z')).start,'2026-10-12T07:15:00.000Z');
 assert.equal(c.periodAt(ts('2026-10-12T07:14:59Z')).date,'2026-10-05');
 const nepal=createQuotaClock({timeZone:'Asia/Kathmandu'});
 assert.equal(nepal.periodFromDate('2026-10-15').start,'2026-10-15T14:15:00.000Z');
});
test('Sunday midnight, leap day and year boundary stay on the configured weekday',()=>{
 const sunday=createQuotaClock({timeZone:'UTC',resetDay:0,resetTime:'00:00'});
 assert.equal(sunday.periodAt(ts('2026-10-18T00:00:00Z')).date,'2026-10-18');
 const thursday=createQuotaClock({timeZone:'UTC'});
 assert.equal(thursday.periodFromDate('2026-12-31').end,'2027-01-07T20:00:00.000Z');
 assert.equal(thursday.periodFromDate('2024-02-29').end,'2024-03-07T20:00:00.000Z');
});
test('nonexistent DST reset time shifts forward by the gap',()=>{
 const c=createQuotaClock({timeZone:'America/New_York',resetDay:0,resetTime:'02:30'});
 const w=c.periodFromDate('2026-03-08');
 assert.equal(w.start,'2026-03-08T07:30:00.000Z');
 assert.equal(c.periodAt(w.startMs-1).end,w.start);assert.equal(c.periodAt(w.startMs).id,w.id);
});
test('ambiguous DST reset uses first occurrence, never a second reset in repeated hour',()=>{
 const c=createQuotaClock({timeZone:'Europe/Lisbon',resetDay:0,resetTime:'01:30'});
 const w=c.periodFromDate('2026-10-25');assert.equal(w.start,'2026-10-25T00:30:00.000Z');
 assert.equal(c.periodAt(ts('2026-10-25T01:15:00Z')).id,w.id);
 assert.equal(c.periodAt(ts('2026-10-25T01:30:00Z')).id,w.id);
});
test('half-hour DST transitions resolve correctly (Australia/Lord_Howe)',()=>{
 const c=createQuotaClock({timeZone:'Australia/Lord_Howe',resetDay:0,resetTime:'02:15'});
 const w=c.periodFromDate('2026-10-04');
 assert.equal(w.start,'2026-10-03T15:45:00.000Z');
});
test('quota calculation is independent of the process default timezone',()=>{
 const before=process.env.TZ;
 try {
  process.env.TZ='Pacific/Honolulu';const a=createQuotaClock().periodAt(NOW);
  process.env.TZ='Asia/Tokyo';const b=createQuotaClock().periodAt(NOW);
  assert.deepEqual(a,b);
 } finally {if(before===undefined)delete process.env.TZ;else process.env.TZ=before;}
});
test('several years of weekly boundaries form a contiguous partition',()=>{
 const c=createQuotaClock();let w=c.periodFromDate('2024-01-04');
 for(let i=0;i<170;i++) {
  for(const t of [w.startMs,w.startMs+1,w.endMs-1])assert.equal(c.periodAt(t).id,w.id);
  const next=c.periodAt(w.endMs);assert.equal(next.start,w.end);assert.ok(next.endMs>next.startMs);w=next;
 }
});
test('Thursday before/after 20:00 is split by timestamps, not all assigned to one date',()=>{
 const s=data([record('before','2026-10-15T18:59:59Z',100),record('at','2026-10-15T19:00:00Z',200),record('after','2026-10-15T20:00:00Z',300)]);
 assert.equal(s.days.length,1);assert.equal(s.weeks.length,2);
 assert.equal(s.weeks[0].days[0].models[0].read,100);assert.equal(s.weeks[1].days[0].models[0].read,500);
 assert.equal(chosenTotal(s).read,500);assert.equal(chosenTotal(s).requests,2);
});
test('daily view for this quota excludes pre-reset usage on its first calendar day',()=>{
 const s=data([record('before','2026-10-15T18:59:59Z',100),record('after','2026-10-15T19:00:00Z',200)]);
 const v=makeView(s,{range:'quota',grouping:'day'});assert.equal(v.totals.read,200);assert.equal(v.chartDays[0].read,200);assert.equal(v.chartDays.length,2);
});
test('streaming duplicates crossing reset remain one response in the earliest timestamp cycle',()=>{
 const a=record('same','2026-10-15T18:59:59Z',50),b=record('same','2026-10-15T19:00:10Z',50,{output:10});
 const s=aggregateRecords([{records:[a]},{records:[b]}],{timeZone:'Europe/Lisbon',includeSubagents:true},NOW);
 assert.equal(s.weeks.length,1);assert.equal(s.weeks[0].date,'2026-10-08');assert.equal(s.weeks[0].days[0].models[0].requests,1);assert.equal(s.weeks[0].days[0].models[0].output,10);
});
test('weekly and daily totals reconcile exactly in all, 30d, 7d and this quota',()=>{
 const s=demoSnapshot();
 for(const range of ['all','30d','7d','quota'])for(const model of ['all','claude-sonnet-5-5']){
  const daily=makeView(s,{range,grouping:'day',model}),weekly=makeView(s,{range,grouping:'week',model});
  assert.deepEqual(weekly.totals,daily.totals,range+' '+model);
  assert.deepEqual(weekly.modelTotals,daily.modelTotals);
 }
});
test('weekly totals separate models and respect subagent exclusion',()=>{
 const s=data([record('a','2026-10-16T10:00:00Z',12,{model:'A'}),record('b','2026-10-16T11:00:00Z',45,{model:'B',agent:true})],{includeSubagents:false});
 assert.equal(chosenTotal(s).read,12);
 const all=data([record('a','2026-10-16T10:00:00Z',12,{model:'A'}),record('b','2026-10-16T11:00:00Z',45,{model:'B'})]);
 const v=makeView(all,{range:'quota',grouping:'week',model:'B'});assert.equal(v.totals.read,45);assert.equal(v.day.models.length,1);
});
test('7d clips first overlapping quota without quietly adding earlier days',()=>{
 const s=data([record('old','2026-10-09T20:00:00Z',100),record('included','2026-10-09T23:00:00Z',200),record('new','2026-10-16T12:00:00Z',300)]);
 const v=makeView(s,{range:'7d',grouping:'week'});assert.equal(v.totals.read,500);assert.equal(v.buckets[0].clipped,true);
 assert.equal(v.buckets[0].observedStartMs,ts('2026-10-09T23:00:00Z'));assert.equal(v.clippedWeeks,1);
});
test('all time never clips a cycle and zero-usage cycles are represented',()=>{
 const s=data([record('a','2026-09-01T10:00:00Z'),record('b','2026-10-16T12:00:00Z')]);
 const v=makeView(s,{range:'all',grouping:'week'});assert.ok(v.buckets.length>6);assert.equal(v.clippedWeeks,0);assert.ok(v.buckets.some(w=>w.requests===0));
});
test('weekly all-time pagination includes every cycle exactly once, totals stay constant',()=>{
 const s=demoSnapshot('2026-10-16',400),first=makeView(s,{range:'all',grouping:'week'});let ids=[];
 assert.equal(first.chartDays.length,PAGE_WEEKS);
 for(let page=0;page<first.pageCount;page++){
  const v=makeView(s,{range:'all',grouping:'week',page});ids.push(...v.chartDays.map(w=>w.id));assert.deepEqual(v.totals,first.totals);
 }
 assert.equal(ids.length,first.weekCount);assert.equal(new Set(ids).size,ids.length);
});
test('an old cycle can be selected independently from overview totals',()=>{
 const s=demoSnapshot(),v=makeView(s,{range:'all',grouping:'week'});
 const selection=makeView(s,{range:'all',grouping:'week',week:v.chartDays[0].id});
 assert.equal(selection.day.id,v.chartDays[0].id);assert.deepEqual(selection.totals,v.totals);assert.equal(selection.day.current,false);
});
test('empty current quota is explicit zero with the actual reset boundaries',()=>{
 const s=data([]),v=makeView(s,{range:'quota',grouping:'week'});
 assert.equal(v.day.start,'2026-10-15T19:00:00.000Z');assert.equal(v.day.end,'2026-10-22T19:00:00.000Z');assert.equal(total(v.totals),0);assert.equal(v.day.current,true);
});
test('reset rollover changes this-quota totals instead of carrying the old cycle forward',()=>{
 const records=[record('before','2026-10-15T18:59:59Z',10),record('at','2026-10-15T19:00:00Z',20)];
 const before=data(records,{},ts('2026-10-15T18:59:59.999Z')),after=data(records,{},ts('2026-10-15T19:00:00Z'));
 assert.equal(chosenTotal(before).read,10);assert.equal(chosenTotal(after).read,20);
 assert.notEqual(makeView(before,{range:'quota'}).currentQuota.id,makeView(after,{range:'quota'}).currentQuota.id);
});
test('records even one millisecond in the future wait for a later scan',()=>{
 const s=data([record('future','2026-10-15T19:00:00.001Z')],{},ts('2026-10-15T19:00:00Z'));
 assert.equal(s.days.length,0);assert.equal(s.weeks.length,0);assert.equal(s.diagnostics.futureRecords,1);
});
test('a changed reset reassigns historical requests while preserving grand totals',()=>{
 const records=[record('x','2026-10-15T19:30:00Z')];
 const a=data(records),b=data(records,{resetTime:'21:00'});
 assert.equal(a.weeks[0].date,'2026-10-15');assert.equal(b.weeks[0].date,'2026-10-08');
 assert.deepEqual(a.days,b.days);assert.notEqual(a.quota.signature,b.quota.signature);
});
test('stale snapshot built for another reset is not quota-ready',()=>{
 const s=demoSnapshot();assert.equal(makeView(s,{grouping:'week',resetTime:'21:00'}).quotaReady,false);
 assert.equal(makeView({days:[],today:'2026-10-16'},{grouping:'week'}).quotaReady,false);
 assert.equal(s.quota.signature,quotaSignature({}));
});
test('weekly CSV includes exact boundaries, models and explicit current/partial status',()=>{
 const s=demoSnapshot();const csv=exportCsv(s,{grouping:'week',range:'7d',model:'claude-sonnet-5-5'});
 assert.ok(csv.includes('quota_end_utc_exclusive'));assert.ok(csv.includes('"2026-10-15T19:00:00.000Z"'));
 assert.ok(csv.includes('"in_progress"'));assert.ok(csv.includes('"yes"'));assert.ok(csv.includes('"claude-sonnet-5-5"'));assert.ok(!csv.includes('claude-opus-5-5'));
 const rows=csv.trim().split('\r\n').slice(1).map(line=>line.split(',').map(x=>JSON.parse(x)));
 assert.equal(rows.reduce((n,r)=>n+Number(r[12]),0),makeView(s,{grouping:'week',range:'7d',model:'claude-sonnet-5-5'}).totals.read);
});
test('daily this-quota export does not leak pre-reset Thursday counters',()=>{
 const s=data([record('before','2026-10-15T18:00:00Z',100),record('after','2026-10-15T20:00:00Z',200)]);
 const csv=exportCsv(s,{grouping:'day',range:'quota'});assert.ok(csv.includes('"200"'));assert.ok(!csv.includes('"300"'));
});
test('weekly CSV covers all pages and neutralizes formula model IDs',()=>{
 const s=demoSnapshot('2026-10-16',400),v=makeView(s,{range:'all',grouping:'week'});
 assert.equal(exportCsv(s,{grouping:'week',range:'all'}).trim().split('\r\n').length,1+v.buckets.reduce((n,w)=>n+Math.max(1,w.models.length),0));
 const malicious=data([record('x','2026-10-16T10:00:00Z',20,{model:'=CMD()'})]);assert.ok(exportCsv(malicious,{grouping:'week'}).includes("'=CMD()"));
});
test('weekly SVGs and exact labels are finite and bounded in both themes',()=>{
 const v=makeView(demoSnapshot(),{range:'30d',grouping:'week'});
 for(const theme of ['dark','light'])for(const d of [chartSvg(v,'total',theme),cycleSvg(v.day,v,theme),cycleSvg(v.buckets[0],v,theme)]){
  assert.ok(d.source.length<131072);assert.ok(!/NaN|Infinity/.test(d.source));assert.ok(d.alt.length>10);
 }
 assert.equal(quotaIntervalLabel(v.currentQuota,v.timeZone,false,'pt-PT'),'15/10, 20:00 → 22/10, 20:00');
});

test('all time starts at the earliest recorded quota, not a phantom previous Thursday',()=>{
 const s=data([record('first','2026-10-15T19:00:00Z')]);
 const v=makeView(s,{range:'all',grouping:'week'});assert.equal(v.buckets.length,1);assert.equal(v.buckets[0].date,'2026-10-15');
});
