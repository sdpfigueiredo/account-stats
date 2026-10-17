import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeUsage,parseTranscriptRow,mergeRecord,total,dayKey,moveDay,escapeXml,count} from '../lib/usage.js';
import {makeView} from '../lib/view-model.js';
import {overviewSvg,chartSvg,modelsSvg,quotaSvg,headerSvg} from '../lib/visuals.js';
import {transcript,demoSnapshot,demoLimits} from './fixtures.mjs';

test('four token categories are disjoint and add correctly',()=>{
 const r=parseTranscriptRow(transcript());assert.deepEqual([r.read,r.write,r.input,r.output],[1000,100,20,30]);assert.equal(total(r),1150);
});
test('cache 5m/1h details are NOT added to top-level creation count',()=>{
 const r=normalizeUsage({cache_creation_input_tokens:100,cache_creation:{ephemeral_5m_input_tokens:40,ephemeral_1h_input_tokens:60}});assert.equal(r.write,100);
});
test('cache sub-buckets provide a fallback only when total is absent',()=>{
 assert.equal(normalizeUsage({cache_creation:{ephemeral_5m_input_tokens:40,ephemeral_1h_input_tokens:60}}).write,100);
});
test('unknown and invalid counters never create negative or NaN bars',()=>{
 for(const n of [NaN,Infinity,-1,1.4,'100',Number.MAX_SAFE_INTEGER+1]) assert.equal(count(n),0);
 assert.equal(normalizeUsage({input_tokens:-5,output_tokens:5}).input,0);
});
test('synthetic, nonassistant, error, missing-usage rows do not count',()=>{
 assert.equal(parseTranscriptRow({type:'user'}),null);assert.equal(parseTranscriptRow(transcript('a',{isApiErrorMessage:true})),null);
 const a=transcript();a.message.model='<synthetic>';assert.equal(parseTranscriptRow(a),null);
 delete a.message.usage;assert.equal(parseTranscriptRow(a),null);
});
test('missing identity is skipped, UUID fallback is explicit',()=>{
 const a=transcript();delete a.message.id;assert.equal(parseTranscriptRow(a).weakIdentity,true);delete a.uuid;assert.equal(parseTranscriptRow(a),null);
});
test('same response blocks merge cumulative usage with max, not sum',()=>{
 const a=parseTranscriptRow(transcript());const b={...a,output:70,read:800};const c=mergeRecord(a,b);assert.equal(c.output,70);assert.equal(c.read,1000);
});
test('copied main response stays main even inside subagent transcript',()=>{
 const main=parseTranscriptRow(transcript());const agent=parseTranscriptRow(transcript(),'/tmp/a/subagents/agent-1.jsonl');assert.equal(agent.agent,true);assert.equal(mergeRecord(agent,main).agent,false);
});
test('Lisbon local calendar differs from UTC at summer midnight',()=>{
 assert.equal(dayKey(Date.parse('2026-10-15T23:30:00Z'),'Europe/Lisbon'),'2026-10-16');assert.equal(dayKey(Date.parse('2026-12-15T23:30:00Z'),'Europe/Lisbon'),'2026-12-15');
});
test('calendar stepping across DST is independent of elapsed hours',()=>{
 assert.equal(moveDay('2026-03-29',-1),'2026-03-28');assert.equal(moveDay('2026-10-25',1),'2026-10-26');
});
test('7d includes today and fills zero-usage days',()=>{
 const v=makeView({days:[],today:'2026-10-16'},{range:'7d'});assert.equal(v.chartDays.length,7);assert.equal(v.start,'2026-10-10');assert.ok(v.chartDays.every(d=>total(d)===0));
});
test('30d includes exactly thirty calendar bars',()=>{
 const v=makeView(demoSnapshot(),{range:'30d'});assert.equal(v.chartDays.length,30);assert.equal(v.start,'2026-09-17');
});
test('all time pagination covers every day once, and period totals stay fixed',()=>{
 const data=demoSnapshot();const first=makeView(data,{range:'all'});let dates=[];
 for(let page=0;page<first.pageCount;page++){const v=makeView(data,{range:'all',page});assert.deepEqual(v.totals,first.totals);dates.push(...v.chartDays.map(d=>d.date));}
 assert.equal(dates.length,first.dayCount);assert.equal(new Set(dates).size,first.dayCount);assert.equal(dates.sort()[0],first.start);
});
test('model filter changes totals and daily details, retaining full IDs',()=>{
 const data=demoSnapshot(), id='claude-sonnet-5-5';const v=makeView(data,{range:'7d',model:id});assert.deepEqual(v.modelTotals.map(m=>m.id),[id]);assert.ok(v.chartDays.every(d=>d.models.every(m=>m.id===id)));
});
test('day selection outside a new page falls back to its most recent day',()=>{
 const v=makeView(demoSnapshot(),{range:'all',page:1,day:'2026-10-16'});assert.equal(v.day.date,v.pageEnd);
});
test('SVG uses escaped external text, no scripts, links or event handlers',()=>{
 const drawing=modelsSvg([{id:'<script>&"',read:1,write:2,input:3,output:4}],'<bad>','subtitle');
 assert.ok(drawing.source.includes('&lt;script&gt;'));assert.ok(!drawing.source.includes('<script>'));assert.equal(escapeXml('<&>'),'&lt;&amp;&gt;');
});
test('all SVG states fit the documented single-SVG bound in both themes',()=>{
 const v=makeView(demoSnapshot(),{range:'all'});
 for(const theme of ['dark','light']) for(const drawing of [headerSvg(theme),overviewSvg(v,theme),chartSvg(v,'total',theme),modelsSvg(v.day.models,'Modelos','Dia',theme),quotaSvg(demoLimits,theme)]) {
 assert.ok(drawing.source.length<131072);assert.ok(!/NaN|Infinity/.test(drawing.source));assert.ok(drawing.alt.length>3);
 }
});
test('empty limits do not invent a zero percent allowance',()=>{
 const s=quotaSvg([],'dark','pt-PT').source;assert.ok(s.includes('Indisponíveis'));assert.ok(!s.includes('0.0%'));
});
