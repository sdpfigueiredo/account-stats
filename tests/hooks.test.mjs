/** Engine-contract simulation; NOT a substitute for Claude Desktop. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {harness,walk} from './harness.mjs';
import {withDemoQuota} from './fixtures.mjs';
test('startup registers immediate command but no scan until pane is opened',async()=>{
 const h=harness();await h.fire('session.start');assert.equal(h.calls.filter(c=>c[0]==='process.run').length,0);assert.equal(h.calls[0][1].immediate,true);
});
test('desktop opens a pane and uses only documented element props',async()=>{
 const h=harness();await h.start();const tree=await h.render();let svgCount=0;walk(tree,n=>{if(n.type==='Svg')svgCount++;});assert.ok(svgCount>=5);assert.ok(JSON.stringify(tree).length<100000);
});
test('all three range controls redraw correct SVG bar counts',async()=>{
 const h=harness();await h.start();for(const [range,bars] of [['7d',7],['30d',30],['all',45]]){let tree=await h.render();await h.find(tree,'range-'+range).props.onPress();tree=await h.render();let chart;walk(tree,n=>{if(n.type==='Svg'&&n.props.alt.startsWith('Gráfico diário'))chart=n;});assert.ok(chart.props.source.includes(bars+' DIAS'));}
});
test('model and day dropdowns update details without a scanner call',async()=>{
 const h=harness();await h.start();const before=h.calls.length;let t=await h.render();await h.find(t,'model').props.onSelect('claude-sonnet-5-5');t=await h.render();const day=h.find(t,'day').props.options[1].value;await h.find(t,'day').props.onSelect(day);t=await h.render();assert.equal(h.find(t,'day').props.value,day);assert.equal(h.calls.length,before);
});
test('all-time page navigation does not collapse daily data into months',async()=>{
 const h=harness();await h.start();let t=await h.render();await h.find(t,'range-all').props.onPress();t=await h.render();await h.find(t,'older').props.onPress();t=await h.render();assert.ok(h.find(t,'newer'));assert.notEqual(h.find(t,'day').props.value,'2026-10-16');
});
test('light theme is persisted and changing theme does not reread logs',async()=>{
 const h=harness();await h.start();let t=await h.render(),n=h.calls.length;await h.find(t,'theme').props.onPress();t=await h.render();assert.equal(h.store.get('preferences-v1').theme,'light');assert.equal(h.calls.length,n);assert.equal(t.props.backgroundColor,'#f4f5fa');
});
test('closing stops periodic scans, while clear/resume do not destroy future refresh',async()=>{
 const h=harness();await h.start();await h.fire('session.end',{reason:'clear'});const timer=h.timers.find(t=>t.repeat);const before=h.calls.length;await timer.fn();assert.ok(h.calls.length>before);
 await h.fire('ui.close',{id:'account-stats'});const after=h.calls.length;await timer.fn();assert.equal(h.calls.length,after);
});
test('no Node means explicit error and no invented usage summary',async()=>{
 const h=harness({nodeMissing:true});await h.start();const t=await h.render(),text=JSON.stringify(t);assert.ok(text.includes('Node.js 20+'));assert.ok(!text.includes('ÚLTIMOS 30 DIAS'));
});
test('scanner error does not masquerade as zero usage',async()=>{
 const h=harness({scannerError:true});await h.start();const t=await h.render();assert.ok(JSON.stringify(t).includes('O indexador terminou com erro'));assert.ok(!JSON.stringify(t).includes('ÚLTIMOS 30 DIAS'));
});
test('CSV button passes the selected period and exact model to child',async()=>{
 const h=harness();await h.start();let t=await h.render();await h.find(t,'range-7d').props.onPress();t=await h.render();await h.find(t,'model').props.onSelect('claude-haiku-5-5');t=await h.render();await h.find(t,'export').props.onPress();
 const call=h.calls.filter(c=>c[0]==='process.run'&&c[2]?.stdin).at(-1);const config=JSON.parse(call[2].stdin);assert.equal(config.action,'export');assert.equal(config.selection.start,'2026-10-10');assert.equal(config.selection.model,'claude-haiku-5-5');assert.ok(JSON.stringify(await h.render()).includes('CSV guardado em'));
});
test('terminal fallback is readable text, never unsupported SVG',async()=>{
 const h=harness();await h.start();const t=await h.render('terminal');walk(t,n=>assert.notEqual(n.type,'Svg'));assert.ok(JSON.stringify(t).includes('cache read'));
});
test('other panes and lifecycle events pass through unchanged',async()=>{
 const h=harness();const e={component:'Pane',requestId:'other'};const r=await h.fire('ui.render',e);assert.equal(r.passed,true);assert.equal(r.event,e);const t={agentId:'a'};assert.equal((await h.fire('turn.complete',t)).event,t);
});
test('plugin scanner path with spaces stays a single argv argument',async()=>{
 const h=harness();await h.start();const call=h.calls.find(c=>c[0]==='process.run'&&c[2]?.stdin);assert.equal(call[1].length,2);assert.equal(call[1][1],'C:/TEST PLUGIN/account-stats/scanner/index.mjs');assert.ok(!('shell' in call[2]));
});
test('invalid timezone input is rejected instead of silently falling back',async()=>{
 const h=harness();await h.start();let t=await h.render();await h.find(t,'settings').props.onPress();t=await h.render();await h.find(t,'time-zone').props.onSubmit('Invalid/TimeZone');assert.ok(JSON.stringify(await h.render()).includes('Fuso horário inválido'));
});

test('this-quota control switches to weekly grouping and exact reset interval',async()=>{
 const h=harness();await h.start();let t=await h.render();await h.find(t,'range-quota').props.onPress();t=await h.render();
 assert.ok(h.find(t,'week'));assert.ok(JSON.stringify(t).includes('15/10, 20:00'));
 assert.equal(h.store.get('preferences-v1').grouping,'week');assert.equal(h.store.get('preferences-v1').range,'quota');
});
test('weekly and daily grouping can be toggled without a disk scan',async()=>{
 const h=harness();await h.start();const before=h.calls.length;let t=await h.render();await h.find(t,'group-week').props.onPress();t=await h.render();
 let chart;walk(t,n=>{if(n.type==='Svg'&&n.props.alt.startsWith('Gráfico por cota'))chart=n;});assert.ok(chart);
 const weeks=h.find(t,'week').props.options;await h.find(t,'week').props.onSelect(weeks[weeks.length-1].value);
 t=await h.render();assert.equal(h.find(t,'week').props.value,weeks.at(-1).value);
 await h.find(t,'group-day').props.onPress();t=await h.render();assert.ok(h.find(t,'day'));assert.equal(h.calls.length,before);
});
test('reset day/time are persisted and passed to the scanner immediately after saving',async()=>{
 const h=harness();await h.start();let t=await h.render();await h.find(t,'settings').props.onPress();t=await h.render();
 assert.equal(h.find(t,'reset-day').props.value,'4');assert.equal(h.find(t,'reset-time').props.value,'20:00');
 await h.find(t,'reset-day').props.onSelect('1');await h.flush();t=await h.render();
 await h.find(t,'reset-time').props.onSubmit('08:15');await h.flush();
 const call=h.calls.filter(c=>c[0]==='process.run'&&c[2]?.stdin).at(-1),config=JSON.parse(call[2].stdin);
 assert.equal(config.resetDay,1);assert.equal(config.resetTime,'08:15');assert.equal(config.timeZone,'Europe/Lisbon');
 assert.equal(h.store.get('preferences-v1').resetDay,1);assert.equal(h.store.get('preferences-v1').resetTime,'08:15');
 t=await h.render();await h.find(t,'range-quota').props.onPress();assert.ok(h.find(await h.render(),'week'));
});
test('invalid reset time keeps the previous valid configuration and does not scan',async()=>{
 const h=harness();await h.start();let t=await h.render();await h.find(t,'settings').props.onPress();t=await h.render();const before=h.calls.length;
 await h.find(t,'reset-time').props.onSubmit('24:61');t=await h.render();assert.equal(h.find(t,'reset-time').props.value,'20:00');assert.ok(JSON.stringify(t).includes('Hora de reset inválida'));assert.equal(h.calls.length,before);
});
test('new reset settings respect manifest defaults and legacy saved preferences',async()=>{
 const h=harness({options:{reset_day:6,reset_time:'09:45'}});
 h.store.set('preferences-v1',{range:'7d',theme:'light',includeSubagents:false});await h.start();
 let t=await h.render();await h.find(t,'settings').props.onPress();t=await h.render();
 assert.equal(h.find(t,'reset-day').props.value,'6');assert.equal(h.find(t,'reset-time').props.value,'09:45');assert.equal(t.props.backgroundColor,'#f4f5fa');
});
test('invalid persisted reset falls back explicitly instead of crashing render',async()=>{
 const h=harness();h.store.set('preferences-v1',{resetDay:12,resetTime:'bad'});await h.start();assert.ok(JSON.stringify(await h.render()).includes('Configuração de reset inválida'));
});
test('weekly command, export and both themes remain within the host tree bound',async()=>{
 const h=harness();await h.start();await h.fire('command.run',{command:'account-stats',args:'weeks'});await h.flush();
 for(const surface of ['desktop','vscode','terminal']){
  let t=await h.render(surface);assert.ok(JSON.stringify(t).length<100000);assert.ok(h.find(t,'week'));
 }
 let t=await h.render();await h.find(t,'export').props.onPress();
 const config=JSON.parse(h.calls.filter(c=>c[0]==='process.run'&&c[2]?.stdin).at(-1)[2].stdin);
 assert.equal(config.selection.grouping,'week');assert.equal(config.selection.range,'all');
 t=await h.render();await h.find(t,'theme').props.onPress();assert.ok(JSON.stringify(await h.render()).length<100000);
});
test('settings command opens the configuration controls',async()=>{
 const h=harness();await h.start();await h.fire('command.run',{command:'account-stats',args:'settings'});const t=await h.render();assert.ok(h.find(t,'reset-day'));assert.ok(h.find(t,'reset-time'));
});

function selectedCycle(tree) {
 let result;
 walk(tree, node => { if(node.type === 'Svg' && node.props.alt.startsWith('Cota ')) result = node; });
 assert.ok(result, 'Missing selected-week card');
 return result.props;
}

test('weekly card keeps Input and Output visible for every chart metric', async () => {
 const h = harness(); await h.start();
 await h.fire('command.run', {command:'account-stats', args:'weeks'}); await h.flush();
 const original = selectedCycle(await h.render());
 for(const mode of ['cache','read','write','input','output','total']) {
  const tree = await h.render(); await h.find(tree,'metric').props.onSelect(mode);
  const card = selectedCycle(await h.render());
  assert.equal(card.source, original.source, 'Chart metric must not alter quota counters');
  assert.ok(card.source.includes('>Input novo</text>'));
  assert.ok(card.source.includes('>Output</text>'));
 }
});

test('switching to a closed week and a model updates all four card counters', async () => {
 const h = harness(); await h.start();
 await h.fire('command.run', {command:'account-stats', args:'weeks'}); await h.flush();
 let tree = await h.render();
 const weekId = h.find(tree,'week').props.options[1].value;
 await h.find(tree,'week').props.onSelect(weekId);
 tree = await h.render(); const allModelsCard = selectedCycle(tree);
 await h.find(tree,'model').props.onSelect('claude-sonnet-5-5');
 tree = await h.render(); const modelCard = selectedCycle(tree);
 assert.notEqual(modelCard.alt, allModelsCard.alt);
 assert.equal(h.find(tree,'week').props.value, weekId);
 assert.ok(modelCard.alt.includes('Fechada.'));
 assert.ok(/input novo [\d .,]+, output [\d .,]+\./.test(modelCard.alt));
 const { makeView } = await import('../lib/view-model.js');
 const { cycleSvg } = await import('../lib/visuals.js');
 const view = makeView(withDemoQuota(h.data), {range:'all',grouping:'week',week:weekId,model:'claude-sonnet-5-5'});
 assert.equal(modelCard.source, cycleSvg(view.day,view,'dark','pt-PT').source);
});

test('weekly terminal fallback also includes Input novo and Output', async () => {
 const h = harness(); await h.start();
 await h.fire('command.run', {command:'account-stats',args:'quota'}); await h.flush();
 const tree = await h.render('terminal'); let card;
 walk(tree, node => { if(node.type === 'Text' && node.props.children?.[0]?.startsWith('Cota ')) card = node.props.children[0]; });
 assert.ok(card);
 assert.ok(/input novo [\d .,]+, output [\d .,]+\./.test(card));
 assert.ok(card.includes('Total = cache read + cache write + input novo + output.'));
});

test('native section margins separate every card including below the quota panel',async()=>{
 const h=harness();await h.start();await h.fire('command.run',{command:'account-stats',args:'weeks'});
 const t=await h.render();assert.ok(t.children.length>10);
 for(const [i,section] of t.children.entries()) {
  assert.equal(section.type,'Box');assert.equal(section.props.marginTop,i?1:0);assert.equal(section.props.flexShrink,0);
 }
 const quotaIndex=t.children.findIndex(s=>s.children.some(n=>n.type==='Svg'&&n.props.alt.startsWith('Cota ')));
 assert.ok(quotaIndex>0);assert.ok(t.children[quotaIndex+1].children[0].props.alt.startsWith('API equivalente'));
 for(const s of t.children.slice(quotaIndex+1))assert.equal(s.props.marginTop,1);
});
test('period and selected interval each expose a separate API equivalent card',async()=>{
 const h=harness();await h.start();await h.fire('command.run',{command:'account-stats',args:'weeks'});
 const t=await h.render(),cards=[];walk(t,n=>{if(n.type==='Svg'&&n.props.alt.startsWith('API equivalente'))cards.push(n);});
 assert.equal(cards.length,2);assert.ok(cards[0].props.alt.includes('período'));assert.ok(cards[1].props.alt.includes('esta cota'));
 assert.notEqual(cards[0].props.source,cards[1].props.source);
});
test('USD chart selection is persistent and never initiates an API request',async()=>{
 const h=harness();await h.start();const t=await h.render(),before=h.calls.length;
 assert.ok(h.find(t,'metric').props.options.some(o=>o.value==='cost'));
 await h.find(t,'metric').props.onSelect('cost');const updated=await h.render();
 assert.equal(h.store.get('preferences-v1').mode,'cost');assert.equal(h.calls.length,before);
 let chart;walk(updated,n=>{if(n.type==='Svg'&&n.props.alt.startsWith('Gráfico API'))chart=n;});assert.ok(chart);
});
