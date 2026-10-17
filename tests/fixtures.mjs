import { moveDay, zero, total } from '../lib/usage.js';
import { addPriced as add, zeroCost, addCost, priceRecord, pricingMetadata } from '../lib/pricing.js';
import { createQuotaClock, quotaSignature } from '../lib/quota.js';
export function transcript(id='msg-a', patch={}) {
  return { type:'assistant', uuid:'row-'+id, timestamp:'2026-10-16T12:00:00Z',
    message:{id,role:'assistant',model:'claude-opus-example',content:[{type:'text',text:'PRIVATE_TEXT_DO_NOT_STORE'}],
      usage:{cache_read_input_tokens:1000,cache_creation_input_tokens:100,input_tokens:20,output_tokens:30}}, ...patch };
}
export function demoSnapshot(today='2026-10-16', count=110) {
  // Deliberately fictitious fixture, never imported by the runtime plugin.
  const days=[];
  for(let i=0;i<count;i++) {
    const date=moveDay(today,i-count+1); if(i%13===0) continue;
    const models=['claude-opus-5-5','claude-sonnet-5-5','claude-haiku-5-5'].map((id,j)=>{
      const factor = [1,0.45,0.17][j], wave=0.7+0.3*Math.sin(i*1.7+j)+i/count*.7;
      return {id,read:Math.round(2200000*factor*wave),write:Math.round(410000*factor*wave),input:Math.round(39000*factor*wave),output:Math.round(82000*factor*wave),requests:Math.round(80*factor*wave)};
    });
    days.push({date,models});
  }
  return withDemoQuota({version:1,today,timeZone:'Europe/Lisbon',days,generatedAt:'2026-10-16T16:00:00.000Z',includeSubagents:true,
    diagnostics:{discoveredFiles:64,indexedFiles:64,archivedFiles:0,duplicateCopies:27,pendingFiles:0,warnings:[]},
    roots:['D:/DEMONSTRACAO/.claude/projects'],cacheDir:'D:/DEMONSTRACAO/.claude/account-stats/v1',partial:false,busy:false});
}
export const demoLimits = [{kind:'five_hour',percentUsed:34,resetsAt:'2026-10-16T19:30:00.000Z'},{kind:'seven_day',percentUsed:62,resetsAt:'2026-10-22T19:00:00.000Z'}];

/** Regroup synthetic fixture counters at two explicit timestamps per day. */
export function withDemoQuota(snapshot, options={}) {
  const clock=createQuotaClock({timeZone:options.timeZone||'Europe/Lisbon',resetDay:options.resetDay,resetTime:options.resetTime});
  const weeks=new Map(), byDate=new Map();
  for(const day of snapshot.days) {
    for(const [i,time] of ['08:00:00Z',day.date===snapshot.today?'14:00:00Z':'21:00:00Z'].entries()) {
      const timestamp=Date.parse(day.date+'T'+time), date=clock.dateAt(timestamp);
      const period=clock.periodAt(timestamp,date);
      if(!weeks.has(period.id)) weeks.set(period.id,{...period,byDate:new Map()});
      const wk=weeks.get(period.id);
      if(!wk.byDate.has(date))wk.byDate.set(date,new Map());
      if(!byDate.has(date))byDate.set(date,new Map());
      for(const model of day.models) {
        const values={};
        for(const k of ['read','write','input','output','requests']) values[k]=i===0?Math.floor(model[k]*.65):model[k]-Math.floor(model[k]*.65);
        // Synthetic per-request splits; never price a day as one Haiku prompt.
        values.cost=zeroCost();
        const requests=Math.max(1,values.requests);
        for(let r=0;r<requests;r++) {
          const rec={model:model.id,requests:1};
          for(const k of ['read','write','input','output']) rec[k]=Math.floor(values[k]/requests)+(r<values[k]%requests?1:0);
          // Most demonstration writes use 1h; a few missing TTLs illustrate ranges.
          if(Number(day.date.slice(-2))%11!==0) {rec.write1h=Math.floor(rec.write*.8);rec.write5m=rec.write-rec.write1h;}
          addCost(values.cost,priceRecord(rec));
        }
        for(const map of [wk.byDate.get(date),byDate.get(date)]) {
          if(!map.has(model.id)) map.set(model.id,{id:model.id,...zero()});
          add(map.get(model.id),values);
        }
      }
    }
  }
  const toDays=map=>[...map].sort(([a],[b])=>a.localeCompare(b)).map(([date,models])=>({date,models:[...models.values()].sort((a,b)=>total(b)-total(a))}));
  const asOf=Date.parse(snapshot.generatedAt);
  return {...snapshot,pricing:pricingMetadata(),timeZone:clock.settings.timeZone,asOf,today:clock.dateAt(asOf),days:toDays(byDate),
    quota:{...clock.settings,signature:quotaSignature(clock.settings)},
    weeks:[...weeks.values()].sort((a,b)=>a.startMs-b.startMs).map(({byDate,...period})=>({...period,days:toDays(byDate)}))};
}
