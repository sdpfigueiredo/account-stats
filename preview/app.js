// Browser-only host simulation. Fictitious data. Never loaded by Claude Code.
const sample = demoSnapshot();
const registrations = [], timeouts = new Set();
let redrawQueued = false, lastTree = null;
let previewLanguage=new URLSearchParams(location.search).get('lang')??'english';
const stage = document.getElementById('panel');
const callsToDraw = () => { if(redrawQueued)return;redrawQueued=true;queueMicrotask(async()=>{redrawQueued=false;await drawPreview();}); };
const host = {
 plugin:{root:'/DEMO/account-stats',name:'account-stats'},
 settings:{read:async()=>({language:previewLanguage})},
 command:{register:async()=>{}},store:{get:async()=>null,set:async()=>{}},env:{get:async()=>undefined},
 clock:{now:async()=>Date.parse(sample.generatedAt),every:()=>({cancel(){}}),after:(ms,fn)=>{const id=setTimeout(fn,Math.min(ms,40));timeouts.add(id);return {cancel(){clearTimeout(id);}};}},
 ui:{resolve:()=>Object.fromEntries(['Box','Text','Button','Select','Input','Svg'].map(type=>[type,props=>({type,props})])),
 invalidate:callsToDraw,open:async()=>({isPlaced:true}),close:async()=>{}},
 session:{usage:async()=>({rateLimits:demoLimits})},
 process:{run:async(argv,init)=>{
  if(argv[1]==='--version')return{exitCode:0,stdout:'v22.16.0'};
  const config=JSON.parse(init.stdin);
  const configured=withDemoQuota(sample,config);
  if(config.action==='export')return{exitCode:0,stdout:JSON.stringify({...configured,exportPath:uiLanguage.t('previewNoFile')})};
  return{exitCode:0,stdout:JSON.stringify(configured)};
 }}
};
function registerHook(name,matcher,fn){if(typeof matcher==='function'){fn=matcher;matcher={};}registrations.push({name,matcher,fn});return{catch(){return this;}};}
async function dispatch(name,event={}){const hook=registrations.find(h=>h.name===name&&Object.entries(h.matcher).every(([k,v])=>event[k]===v));return hook?.fn(host,event,async()=>({}));}
function renderElement(node) {
 if(typeof node==='string'||typeof node==='number')return document.createTextNode(String(node));
 const p=node.props;let el;
 if(node.type==='Box'){
  el=document.createElement('div');el.className='box';el.style.display='flex';el.style.flexDirection=p.flexDirection||'column';
  if(p.flexWrap)el.style.flexWrap=p.flexWrap;if(p.backgroundColor)el.style.backgroundColor=p.backgroundColor;
  if(p.paddingX)el.style.paddingInline=p.paddingX*7.5+'px';if(p.columnGap)el.style.columnGap=p.columnGap*8+'px';
  if(p.width)el.style.width=p.width;
  if(p.flexShrink!==undefined)el.style.flexShrink=p.flexShrink;
  if(p.marginTop!==undefined)el.style.marginTop=p.marginTop*16+'px';
  if(p.marginBottom!==undefined)el.style.marginBottom=p.marginBottom*16+'px';
  if(p.paddingBottom)el.style.paddingBottom=p.paddingBottom*16+'px';
  if(p.gap)el.style.gap=p.gap*16+'px';
  if(p.rowGap)el.style.rowGap=p.rowGap*16+'px';
  for(const child of p.children||[])el.append(renderElement(child));
 }else if(node.type==='Svg'){
  el=document.createElement('img');el.className='custom-svg';el.alt=p.alt;el.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(p.source);
  el.style.width=p.width+'px';el.style.maxWidth='100%';el.style.height='auto';
 }else if(node.type==='Text'){
  el=document.createElement('div');el.className='host-text';el.textContent=(p.children||[]).join('');if(p.color)el.style.color=p.color;
 }else if(node.type==='Button'){
  el=document.createElement('button');el.textContent=p.label;el.type='button';el.dataset.key=p.key;
  if(p.dimColor)el.classList.add('dim');el.onclick=async()=>{await p.onPress();};
 }else if(node.type==='Select'){
  el=document.createElement('label');el.className='picker';const span=document.createElement('span');span.textContent=p.label;el.append(span);
  const input=document.createElement('select');input.dataset.key=p.key;input.setAttribute('aria-label',p.label);
  for(const option of p.options){const opt=document.createElement('option');opt.value=option.value;opt.textContent=option.label;input.append(opt);}
  input.value=p.value;input.onchange=()=>p.onSelect(input.value);el.append(input);
 }else if(node.type==='Input'){
  el=document.createElement('label');el.className='picker';const span=document.createElement('span');span.textContent=p.label;el.append(span);
  const input=document.createElement('input');input.dataset.key=p.key;input.value=p.value;input.placeholder=p.placeholder||'';input.onkeydown=e=>{if(e.key==='Enter')p.onSubmit(input.value);};el.append(input);
 }else throw new Error('Unknown element '+node.type);
 if(p.key)el.dataset.key=p.key;return el;
}
async function drawPreview(){
 const width=Math.min(540,stage.getBoundingClientRect().width);
 const tree=await dispatch('ui.render',{component:'Pane',requestId:'account-stats',surface:'desktop',props:{bodyColumns:width/7.5}});
 if(!tree)return;
 const language=createI18n(uiLanguage.locale);document.documentElement.lang=language.locale;document.title=language.t('previewTitle');
 for(const [id,key]of [['preview-banner','previewBanner'],['preview-help','previewHelp'],['preview-frame','previewFrame'],['preview-language-label','previewLanguage']])document.getElementById(id).textContent=language.t(key);
 document.getElementById('preview-language').setAttribute('aria-label',language.t('previewLanguage'));
 lastTree=tree;document.body.dataset.theme=tree.props.backgroundColor==='#f4f5fa'?'light':'dark';
 const focus=document.activeElement?.dataset.key;
 stage.replaceChildren(renderElement(tree));
 if(focus)stage.querySelector(`[data-key="${focus}"]`)?.focus({preventScroll:true});
 window.__accountStatsPreview={locale:uiLanguage.locale,language:languageResolution,preferences:{...prefs},totals:JSON.parse(JSON.stringify(viewNow().totals)),selection:JSON.parse(JSON.stringify(viewNow().day)),labels:Object.fromEntries(Object.keys(CATALOGUES.en).map(k=>[k,uiLanguage.t(k)])),range:stage.querySelector('[data-key="day"] select')?.options.length,svgCount:stage.querySelectorAll('img').length};
}
// This selector simulates the host setting; it is not a preference in the mod.
const languagePicker=document.getElementById('preview-language');
languagePicker.value=previewLanguage;
languagePicker.onchange=async()=>{previewLanguage=languagePicker.value;await dispatch('classic.ConfigChange',{source:'user_settings'});await drawPreview();};
register(registerHook);
await dispatch('session.start');
await dispatch('command.run',{command:'account-stats',args:'weeks'});
window.addEventListener('resize',callsToDraw);
await drawPreview();
