/** Pure presentation-only i18n. No DOM, Node, host, network or mutable locale. */
import { en } from './locales/en.js';
import { ptPT } from './locales/pt-PT.js';
import { ptBR } from './locales/pt-BR.js';
import { es } from './locales/es.js';
import { fr } from './locales/fr.js';
import { de } from './locales/de.js';
import { it } from './locales/it.js';

export const CATALOGUES = Object.freeze({ en, 'pt-PT': ptPT, 'pt-BR': ptBR, es, fr, de, it });
const aliases = {
  'brazilian portuguese':'pt-BR', 'portuguese (brazil)':'pt-BR', 'português (brasil)':'pt-BR',
  'português brasileiro':'pt-BR', 'portugues brasileiro':'pt-BR',
  spanish:'es-ES', español:'es-ES', espanol:'es-ES', espanhol:'es-ES',
  french:'fr-FR', français:'fr-FR', francais:'fr-FR', frances:'fr-FR', francês:'fr-FR',
  german:'de-DE', deutsch:'de-DE', alemão:'de-DE', alemao:'de-DE',
  italian:'it-IT', italiano:'it-IT',
  english: 'en-US', 'english (us)': 'en-US', 'american english': 'en-US',
  'english (uk)': 'en-GB', 'british english': 'en-GB', ingles: 'en-US', inglês: 'en-US',
  portuguese: 'pt-PT', portugues: 'pt-PT', português: 'pt-PT',
  'portuguese (portugal)': 'pt-PT', 'português (portugal)': 'pt-PT', 'european portuguese': 'pt-PT',
  'portugues europeu': 'pt-PT', 'português europeu': 'pt-PT',
};
export function resolveLanguage(raw) {
  const language = typeof raw === 'string' ? raw.trim().slice(0,160) : '';
  if (!language || /^(default|auto|automatic|system)$/i.test(language))
    return { locale:'en-US', catalogue:'en', reason:'default', language };
  const lower = language.toLowerCase();
  const candidate = Object.prototype.hasOwnProperty.call(aliases,lower) ? aliases[lower] : language.replace(/_/g,'-');
  let locale;
  try { locale = Intl.getCanonicalLocales(candidate)[0]; } catch { /* Free-form names are legal in Claude settings. */ }
  if (locale) {
    if (locale === 'en') locale='en-US';
    if (locale === 'pt') locale='pt-PT';
    const base=locale.split('-')[0];
    const catalogue=base==='pt'?(/-BR(?:-|$)/.test(locale)?'pt-BR':'pt-PT'):Object.prototype.hasOwnProperty.call(CATALOGUES,base)?base:null;
    if(catalogue) return {locale,catalogue,reason:'configured',language};
  }
  return {locale:'en-US',catalogue:'en',reason:'unsupported',language};
}
const contexts = new Map();
const cleanSpaces = text => String(text).replace(/[\u00a0\u202f]/g,' ');
const safeCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
export function createI18n(language='en-US') {
  if (language && typeof language === 'object' && typeof language.t === 'function') return language;
  const resolved=resolveLanguage(language), {locale,catalogue}=resolved;
  const cacheKey=locale+'|'+catalogue;
  if(contexts.has(cacheKey)) return contexts.get(cacheKey);
  const messages=CATALOGUES[catalogue] || en, formats=new Map();
  const formatter=(kind,options={})=>{
    const key=kind+JSON.stringify(options);
    if(!formats.has(key)) {
      const Type=kind==='number'?Intl.NumberFormat:Intl.DateTimeFormat;
      formats.set(key,new Type(locale,options));
    }
    return formats.get(key);
  };
  const t=(key,args={})=>String(messages[key] ?? en[key] ?? key).replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g,
    (match,name)=>Object.prototype.hasOwnProperty.call(args,name)?String(args[name]):match);
  const number=(value,options={})=>cleanSpaces(formatter('number',options).format(value));
  const integer=value=>number(safeCount(value),{maximumFractionDigits:0});
  const compact=value=>number(safeCount(value),{notation:'compact',maximumFractionDigits:1});
  const percent=value=>Number.isFinite(value)?number(value,{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}):'—';
  const date=(key,short=false)=>{
    if(typeof key!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(key)) return '—';
    const value=new Date(key+'T12:00:00Z');
    if(!Number.isFinite(+value)) return '—';
    return cleanSpaces(formatter('date',{calendar:'gregory',timeZone:'UTC',day:'2-digit',month:'2-digit',...(short?{}:{year:'numeric'})}).format(value));
  };
  const datetime=(value,timeZone='UTC',includeYear=true)=>{
    const d=new Date(value);
    if(!Number.isFinite(+d)) return '—';
    try { return cleanSpaces(formatter('date',{calendar:'gregory',timeZone,day:'2-digit',month:'2-digit',
      ...(includeYear?{year:'numeric'}:{}),hour:'numeric',minute:'2-digit'}).format(d)); }
    catch { return '—'; }
  };
  const weekday=n=>cleanSpaces(formatter('date',{timeZone:'UTC',weekday:'long'}).format(new Date(Date.UTC(2023,0,1+n,12))));
  const usd=(n,isCompact=false)=>{
    if(!Number.isFinite(n)||n<0) return '—';
    const small=n>0&&n<.0001, value=small?.0001:n;
    const decimals=value>0&&value<.01?4:2;
    const options={style:'currency',currency:'USD',...(isCompact&&value>=1000?
      {notation:'compact',minimumFractionDigits:0,maximumFractionDigits:1}:{minimumFractionDigits:decimals,maximumFractionDigits:decimals})};
    return (small?'<':'')+number(value,options);
  };
  const price=(cost,key='total')=>{
    if(cost.unpricedTokens&&!cost.pricedTokens) return t('unpriced');
    const low=cost[key],high=key==='total'?cost.totalMax:key==='write'?cost.writeMax:low;
    return Math.abs(high-low)>1e-10?usd(low)+' – '+usd(high):usd(low);
  };
  const status=key=>t(({unavailable:'costUnavailable',partial:'costPartial',range:'costRange',estimated:'costEstimated',empty:'costEmpty'})[key]||'costUnavailable');
  const context=Object.freeze({locale,catalogue,t,integer,number,compact,percent,date,datetime,weekday,usd,price,status});
  // Settings can contain arbitrary strings. Bound cached formatters in long sessions.
  if(contexts.size>=32) contexts.delete(contexts.keys().next().value);
  contexts.set(cacheKey,context);return context;
}
