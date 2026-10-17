import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createI18n,resolveLanguage,CATALOGUES} from '../lib/i18n.js';
import {quotaIntervalLabel,quotaExportLabel,createQuotaClock} from '../lib/quota.js';
import {costOf,priceRecord} from '../lib/pricing.js';
import {makeView} from '../lib/view-model.js';
import {overviewSvg,cycleSvg,costSvg,chartSvg} from '../lib/visuals.js';
import {exportCsv} from '../scanner/index.mjs';
import {harness,walk} from './harness.mjs';
import {demoSnapshot} from './fixtures.mjs';

for(const [raw,locale,catalogue] of [
 ['english','en-US','en'],['English (UK)','en-GB','en'],['en_GB','en-GB','en'],
 ['Portuguese','pt-PT','pt-PT'],['pt','pt-PT','pt-PT'],['português','pt-PT','pt-PT'],
 ['European Portuguese','pt-PT','pt-PT'],['Português (Portugal)','pt-PT','pt-PT'],
 ['Brazilian Portuguese','pt-BR','pt-BR'],['pt_BR','pt-BR','pt-BR'],
 ['Español','es-ES','es'],['es-MX','es-MX','es'],['français','fr-FR','fr'],
 ['fr-CA','fr-CA','fr'],['Deutsch','de-DE','de'],['italiano','it-IT','it'],
]) test(`language aliases and regional formats: ${raw}`,()=>{
 const r=resolveLanguage(raw);assert.equal(r.locale,locale);assert.equal(r.catalogue,catalogue);assert.equal(r.reason,'configured');
});

test('unset/default language is English, never implicitly Portuguese or OS language',()=>{
 for(const value of [undefined,null,false,{},123,'','  ','auto','system']){
  const r=resolveLanguage(value);assert.equal(r.locale,'en-US');assert.equal(r.reason,'default');
 }
});
test('unknown, malformed and unsupported languages explicitly fall back to English',()=>{
 for(const value of ['ja-JP','zz-ZZ','invented language','../../pt-PT','__proto__','constructor','<script>alert(1)</script>']){
  const r=resolveLanguage(value);assert.equal(r.locale,'en-US');assert.equal(r.reason,'unsupported');
 }
 assert.ok(resolveLanguage('a'.repeat(99999)).language.length<=160);
});
const parameters=value=>[...String(value).matchAll(/\{(\w+)\}/g)].map(x=>x[1]).sort();
for(const [locale,catalogue] of Object.entries(CATALOGUES)) test(`${locale}: catalogue complete and interpolation parameters match English`,()=>{
 assert.deepEqual(Object.keys(catalogue).sort(),Object.keys(CATALOGUES.en).sort());
 for(const key of Object.keys(CATALOGUES.en)){
  assert.equal(typeof catalogue[key],'string',key);assert.ok(catalogue[key].length,key);
  assert.deepEqual(parameters(catalogue[key]),parameters(CATALOGUES.en[key]),key);
 }
});
test('every literal translation key used by rendering and hooks has a translation',async()=>{
 for(const file of ['../hooks/register.js','../lib/visuals.js']){
  const code=await fs.readFile(new URL(file,import.meta.url),'utf8');
  for(const m of code.matchAll(/\b(?:t|message)\('([^']+)'/g)) assert.ok(m[1]in CATALOGUES.en,m[1]);
 }
});
test('regional number, percent and USD formats are distinct with no currency conversion',()=>{
 const en=createI18n('en-US'),pt=createI18n('pt-PT'),br=createI18n('pt-BR'),de=createI18n('de-DE');
 assert.equal(en.integer(1234567),'1,234,567');assert.equal(pt.integer(1234567),'1 234 567');
 assert.equal(br.integer(1234567),'1.234.567');assert.equal(de.integer(1234567),'1.234.567');
 assert.equal(en.usd(1234.56),'$1,234.56');assert.equal(pt.usd(1234.56),'1234,56 US$');
 assert.equal(br.usd(1234.56),'US$ 1.234,56');
 assert.equal(en.percent(.831),'83.1%');assert.equal(de.percent(.831),'83,1 %');
 assert.ok(en.usd(.00000001).startsWith('<$'));assert.equal(en.usd(0),'$0.00');
 assert.equal(pt.integer(-1),'0');assert.equal(en.usd(NaN),'—');
});
test('regional dates, local reset intervals and weekday names follow selected language',()=>{
 const timestamp=Date.parse('2026-10-15T19:00:00Z');
 const us=createI18n('en-US'),gb=createI18n('en-GB'),pt=createI18n('pt-PT');
 assert.equal(us.date('2026-10-15'),'10/15/2026');assert.equal(gb.date('2026-10-15'),'15/10/2026');
 assert.ok(us.datetime(timestamp,'Europe/Lisbon').endsWith('8:00 PM'));
 assert.ok(pt.datetime(timestamp,'Europe/Lisbon').endsWith('20:00'));
 assert.equal(pt.weekday(4),'quinta-feira');assert.equal(us.weekday(4),'Thursday');
 assert.equal(us.datetime('bad','Invalid/Zone'),'—');assert.equal(us.date('bad'),'—');
});
test('cost ranges, missing tariffs and all four categories are localized without re-pricing',()=>{
 const value=priceRecord({model:'claude-opus-5-5',input:1000,output:2000,read:3000,write:4000});
 const before=JSON.stringify(value);assert.ok(createI18n('en-US').price(value).includes(' – '));
 for(const locale of Object.keys(CATALOGUES)){
  const l=createI18n(locale),s=costSvg({...value,cost:value},l.t('costPeriod'),'', 'dark',l);
  assert.ok(s.source.includes('USD'));assert.equal(JSON.stringify(value),before);
  assert.equal(l.price({pricedTokens:0,unpricedTokens:1}),l.t('unpriced'));
 }
});
test('independent formatter contexts do not contaminate another session language',()=>{
 const en=createI18n('english'),pt=createI18n('pt-PT');
 assert.equal(en.t('settings'),'Settings');assert.equal(pt.t('settings'),'Configuração');
 createI18n('de-DE');assert.equal(en.t('settings'),'Settings');assert.equal(pt.t('settings'),'Configuração');
 assert.equal(createI18n(pt),pt);assert.ok(Object.isFrozen(en));
});
test('quota calculation and CSV bytes are presentation-language invariant',()=>{
 const sample=demoSnapshot(),v=makeView(sample,{range:'all',grouping:'week'}),before=JSON.stringify(sample);
 const csv=exportCsv(sample,{range:'all',grouping:'week'}),id=v.currentQuota.id;
 for(const locale of Object.keys(CATALOGUES)){
  quotaIntervalLabel(v.currentQuota,v.timeZone,true,locale);cycleSvg(v.day,v,'dark',locale);
  assert.equal(makeView(sample,{range:'all',grouping:'week'}).currentQuota.id,id);
  assert.equal(exportCsv(sample,{range:'all',grouping:'week'}),csv);assert.equal(JSON.stringify(sample),before);
 }
 assert.equal(quotaExportLabel(v.currentQuota.startMs,'Europe/Lisbon'),'15/10/2026 20:00');
 const dst=createQuotaClock({timeZone:'Europe/Lisbon',resetDay:4,resetTime:'20:00'}).periodFromDate('2026-10-22');
 assert.equal((dst.endMs-dst.startMs)/3600000,169);
});

const serialized=h=>h.render().then(t=>JSON.stringify(t));
const scans=h=>h.calls.filter(c=>c[0]==='process.run'&&c[2]?.stdin).length;
async function localeChange(h,language){h.settingsState.language=language;await h.fire('classic.ConfigChange',{source:'user_settings'});await h.flush();}
async function click(h,key){return h.find(await h.render(),key).props.onPress();}
async function showSettings(h){await click(h,'settings');}

test('host English language renders English controls, cards, tooltips and command description',async()=>{
 const h=harness({language:'english'});await h.start();await h.fire('command.run',{command:'account-stats',args:'weeks'});await h.flush();
 const tree=await h.render();assert.equal(h.find(tree,'settings').props.label,'Settings');
 assert.ok(JSON.stringify(tree).includes('API equivalent'));assert.ok(!/Cota selecionada|Input novo|Configuração|A tua utilização/.test(JSON.stringify(tree)));
 assert.equal(h.calls.find(c=>c[0]==='command.register')[1].description,createI18n('en').t('command'));
 const result=await h.fire('command.describe',{command:'account-stats'},async()=>({description:'old',isHidden:true,argumentHint:'weeks'}));
 assert.equal(result.description,createI18n('en').t('command'));assert.equal(result.isHidden,true);assert.equal(result.argumentHint,'weeks');
});
test('language change keeps model, selected week, metric, history and saved preferences unchanged',async()=>{
 const h=harness({language:'pt-PT'});await h.start();await h.fire('command.run',{command:'account-stats',args:'weeks'});await h.flush();
 let tree=await h.render();const week=h.find(tree,'week').props.options[1].value;
 await h.find(tree,'week').props.onSelect(week);await h.find(tree,'model').props.onSelect('claude-sonnet-5-5');
 await h.find(tree,'metric').props.onSelect('cost');
 const before=JSON.stringify([...h.store]),calls=scans(h);await localeChange(h,'english');tree=await h.render();
 assert.equal(h.find(tree,'settings').props.label,'Settings');assert.equal(h.find(tree,'week').props.value,week);
 assert.equal(h.find(tree,'model').props.value,'claude-sonnet-5-5');assert.equal(h.find(tree,'metric').props.value,'cost');
 assert.equal(JSON.stringify([...h.store]),before);assert.equal(scans(h),calls);
});
test('language notifications use the effective setting after next, never the proposed value',async()=>{
 const h=harness({language:'english'});await h.start();const denied={deny:'Policy'};
 assert.equal(await h.fire('config.set',{key:'language',value:'pt-PT'},async()=>denied),denied);
 await h.flush();assert.equal(h.find(await h.render(),'settings').props.label,'Settings');
 const accepted={value:'fr-FR'};
 assert.equal(await h.fire('config.set',{key:'language',value:'fr-FR'},async()=>{h.settingsState.language='fr-FR';return accepted;}),accepted);
 await h.flush();assert.equal(h.find(await h.render(),'settings').props.label,createI18n('fr').t('settings'));
});
test('missing ConfigChange events are caught by the existing visible refresh timer',async()=>{
 const h=harness({language:'english'});await h.start();h.settingsState.language='pt-PT';await h.timers.find(t=>t.repeat).fn();
 assert.equal(h.find(await h.render(),'settings').props.label,'Configuração');
});
test('opening a closed pane re-reads the language even without a settings notification',async()=>{
 const h=harness({language:'english'});await h.start();await h.fire('command.run',{command:'account-stats',args:'close'});
 h.settingsState.language='de-DE';await h.fire('command.run',{command:'account-stats',args:'weeks'});
 assert.equal(h.find(await h.render(),'settings').props.label,createI18n('de').t('settings'));
});
test('unavailable settings preserve the last detected language; first-use fallback is English',async()=>{
 const h=harness({language:'pt-PT'});await h.start();h.settingsState.fail=true;await h.fire('classic.ConfigChange',{source:'policy_settings'});
 assert.equal(h.find(await h.render(),'settings').props.label,'Configuração');await showSettings(h);
 assert.ok((await serialized(h)).includes(createI18n('pt-PT').t('languageUnavailable')));
 const fresh=harness({settingsFailure:true});await fresh.start();assert.equal(fresh.find(await fresh.render(),'settings').props.label,'Settings');
});
test('unsupported language and unset language report an explicit English fallback in settings',async()=>{
 const h=harness({language:'ja-JP'});await h.start();await showSettings(h);
 assert.ok((await serialized(h)).includes('No translation for “ja-JP”'));
 await localeChange(h,null);assert.ok((await serialized(h)).includes('no explicit language setting'));
});
test('stored language fields from another version cannot override the host language',async()=>{
 const h=harness({language:'english'});h.store.set('preferences-v1',{language:'pt-PT',locale:'pt-PT',theme:'light',resetDay:1,resetTime:'08:15'});
 await h.start();await showSettings(h);const t=await h.render();assert.equal(h.find(t,'reset-day').props.value,'1');
 assert.equal(h.find(t,'reset-time').props.value,'08:15');assert.equal(t.props.backgroundColor,'#f4f5fa');
 assert.equal(h.find(t,'reset-day').props.label,createI18n('en').t('resetDay'));
 await h.find(t,'range-7d').props.onPress();assert.equal(h.store.get('preferences-v1').language,undefined);
});
test('language refresh does not pass unrelated settings to scanner, store, UI or diagnostics',async()=>{
 const h=harness({language:'english'});await h.start();await showSettings(h);await click(h,'diagnostics');await click(h,'export');
 assert.ok(!JSON.stringify([h.calls,[...h.store],await h.render()]).includes('NEVER-LEAVE-SETTINGS'));
 assert.ok(!JSON.stringify(h.calls).includes('PRIVATE_SENTINEL'));
});
test('persistent authored notices and errors retranslate immediately',async()=>{
 const h=harness({language:'english'});await h.start();await showSettings(h);
 await h.find(await h.render(),'reset-time').props.onSubmit('25:78');
 assert.ok((await serialized(h)).includes(createI18n('en').t('errorResetTime')));
 await localeChange(h,'pt-PT');assert.ok((await serialized(h)).includes(createI18n('pt-PT').t('errorResetTime')));
 assert.ok(!(await serialized(h)).includes(createI18n('en').t('errorResetTime')));
});
test('scanner error details stay under diagnostics while authored errors are localized',async()=>{
 const h=harness({language:'english',scannerError:true});await h.start();let tree=await h.render();
 assert.ok(JSON.stringify(tree).includes('The indexer failed'));assert.ok(!JSON.stringify(tree).includes('Import failed'));
 await click(h,'diagnostics');assert.ok((await serialized(h)).includes('Import failed'));
 await localeChange(h,'pt-PT');assert.ok((await serialized(h)).includes('O indexador terminou com erro'));
});
test('language detection is usable before Node/scanner startup and before any request is made',async()=>{
 const h=harness({language:'fr-FR',nodeMissing:true});await h.start();const tree=await h.render();
 assert.equal(h.find(tree,'settings').props.label,createI18n('fr').t('settings'));
 assert.ok(JSON.stringify(tree).includes(createI18n('fr').t('errorNode')));
});
for(const locale of ['en-US','en-GB','pt-PT','pt-BR','es-ES','fr-FR','de-DE','it-IT']) test(`${locale}: all surfaces, themes and weekly cards remain within host bounds`,async()=>{
 const h=harness({language:locale});await h.start();await h.fire('command.run',{command:'account-stats',args:'weeks'});await h.flush();
 await showSettings(h);await click(h,'diagnostics');
 for(const theme of ['dark','light']){
  if(theme==='light')await click(h,'theme');
  for(const surface of ['desktop','vscode','terminal']){
   const tree=await h.render(surface);assert.ok(JSON.stringify(tree).length<100000);
   const l=createI18n(locale);assert.equal(h.find(tree,'reset-day').props.options[4].label,l.weekday(4));
   if(surface==='terminal')walk(tree,n=>assert.notEqual(n.type,'Svg'));
   assert.ok(!JSON.stringify(tree).includes('undefined'));
  }
 }
});
