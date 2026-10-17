/** Engine-contract simulation; NOT a substitute for claude plugin validate/test. */
import assert from 'node:assert/strict';
import {register} from '../hooks/register.js';
import {demoSnapshot,demoLimits,withDemoQuota} from './fixtures.mjs';
const allowed = {
 Box:['key','flexDirection','flexGrow','flexShrink','flexWrap','alignItems','alignSelf','justifyContent','gap','columnGap','rowGap','width','height','minWidth','minHeight','margin','marginX','marginY','marginTop','marginBottom','marginLeft','marginRight','padding','paddingX','paddingY','paddingTop','paddingBottom','paddingLeft','paddingRight','borderStyle','borderColor','borderDimColor','backgroundColor','overflow','display','position','top','left','right','bottom','hover','children'],
 Text:['key','children','color','backgroundColor','bold','italic','underline','strikethrough','dimColor','inverse','wrap'],
 Button:['key','label','children','hotkey','action','plain','dimColor','autoFocus','hover','onPress'],
 Select:['key','label','value','options','onSelect','autoFocus'],
 Input:['key','label','placeholder','value','submitLabel','onSubmit','onInput','autoFocus'],
 Svg:['source','alt','width','height'],
};
function element(type,props) {
 for(const key of Object.keys(props)) assert.ok(allowed[type].includes(key),`Undocumented ${type} prop: ${key}`);
 if(['Input','Button','Select'].includes(type)&&'autoFocus'in props)assert.equal(props.autoFocus,true);
 if(type==='Svg'){assert.equal(typeof props.source,'string');assert.ok(props.source.length<131072);assert.ok(props.width>0&&props.height>0);}
 const node={type,props};
 // The traversal convenience must not serialize children twice at every depth.
 Object.defineProperty(node,'children',{value:props.children||[],enumerable:false});
 return node;
}
export function walk(tree,fn) { if(!tree||typeof tree!=='object')return;fn(tree);for(const ch of tree.children||[])walk(ch,fn); }
export function harness({nodeMissing=false,scannerError=false,options={},language='pt-PT',settingsFailure=false}={}) {
 const hooks=[],timers=[],calls=[],store=new Map(),draws=[];const data=demoSnapshot();
 const settingsState={language,fail:settingsFailure};
 const $={plugin:{root:'C:/TEST PLUGIN/account-stats',name:'account-stats'},
 ui:{resolve:()=>Object.fromEntries(Object.keys(allowed).map(name=>[name,props=>element(name,props)])),invalidate:()=>draws.push(1),
 open:async p=>{for(const k of ['focus','closeOnEscape','holdToasts'])if(k in p)assert.equal(p[k],true);calls.push(['open',p]);return {isPlaced:true};},close:async p=>calls.push(['close',p])},
 settings:{read:async()=>{if(settingsState.fail)throw new Error('Unavailable');return {language:settingsState.language,env:{PRIVATE_SENTINEL:'NEVER-LEAVE-SETTINGS'}};}},
 command:{register:async p=>calls.push(['command.register',p])},
 store:{get:async k=>store.get(k),set:async(k,v)=>{store.set(k,v);}},
 env:{get:async name=>{assert.equal(name,'ProgramFiles');return 'C:\\Program Files';}},
 clock:{now:async()=>Date.parse('2026-10-16T16:00:00Z'),every:(ms,fn)=>{const t={ms,fn,repeat:true,cancel(){this.cancelled=true;}};timers.push(t);return t;},after:(ms,fn)=>{const t={ms,fn,repeat:false,cancel(){this.cancelled=true;}};timers.push(t);return t;}},
 session:{usage:async()=>({rateLimits:demoLimits})},
 process:{run:async(argv,init)=>{
  calls.push(['process.run',argv,init]);
  if(nodeMissing)throw new Error('ENOENT');
  if(argv[1]==='--version')return{exitCode:0,stdout:'v22.16.0\n',stderr:''};
  assert.ok(argv[1].endsWith('/scanner/index.mjs'));assert.equal(typeof init.stdin,'string');
  if(scannerError)return{exitCode:1,stdout:JSON.stringify({error:'Import failed'}),stderr:''};
  const config=JSON.parse(init.stdin);return{exitCode:0,stdout:JSON.stringify({...withDemoQuota(data,config),...(config.action==='export'?{exportPath:'C:/cache/exports/demo.csv'}:{})}),stderr:''};
 }}};
 function on(name,matcher,fn){if(typeof matcher==='function'){fn=matcher;matcher={};}hooks.push({name,matcher,fn});return{catch(){return this;}};}
 register(on,options);
 async function fire(name,event={},next=async e=>({passed:true,event:e})){const hook=hooks.find(h=>h.name===name&&Object.entries(h.matcher).every(([k,v])=>event[k]===v));assert.ok(hook,`Missing ${name}`);return hook.fn($,event,next);}
 async function flush(){for(const timer of timers.filter(t=>!t.repeat&&!t.ran&&!t.cancelled)){timer.ran=true;await timer.fn();}}
 async function render(surface='desktop',columns=64){return fire('ui.render',{component:'Pane',requestId:'account-stats',surface,props:{bodyColumns:columns}});}
 function find(tree,key){let found;walk(tree,n=>{if(n.props.key===key)found=n;});assert.ok(found,`Missing control ${key}`);return found;}
 async function start(){await fire('session.start');await fire('command.run',{command:'account-stats',args:''});await flush();}
 return {fire,flush,render,find,start,calls,timers,store,data,settingsState,$,hooks,draws};
}

