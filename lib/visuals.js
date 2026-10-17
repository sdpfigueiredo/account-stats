import { createI18n } from './i18n.js';
import { total, modelName, escapeXml as x } from './usage.js';
import { chartValue } from './view-model.js';
import { quotaIntervalLabel } from './quota.js';
import { costOf, costStatus, PRICING_DATE } from './pricing.js';

export const WIDTH = 480;
export const palettes = {
  dark: { bg: '#10121a', card: '#181b26', elevated: '#202433', stroke: '#2a3042', text: '#f0f1fa', mute: '#9ca6be', subtle: '#737e98', read: '#a397ff', write: '#50d6bd', input: '#79b5ff', output: '#edbd7a', accent: '#b2a7ff' },
  light: { bg: '#f4f5fa', card: '#ffffff', elevated: '#edf0f8', stroke: '#dce1ed', text: '#20263b', mute: '#5a657e', subtle: '#758099', read: '#6856cc', write: '#168472', input: '#326dba', output: '#a76b23', accent: '#6552c6' },
};
export const palette = theme => palettes[theme] || palettes.dark;

function text(xx, y, value, size, color, weight = 400, extra = '', maxWidth) {
  // The mod has no DOM/font metrics. Conservative per-glyph sizing prevents
  // translated labels and region-specific number formats crossing card edges.
  // The complete value remains visible and in the accessible alternative.
  const anchor = /text-anchor="end"/.test(extra)?'end':/text-anchor="middle"/.test(extra)?'middle':'start';
  const available=maxWidth ?? (anchor==='end'?xx-12:anchor==='middle'?2*Math.min(xx-12,WIDTH-12-xx):WIDTH-12-xx);
  const units=[...String(value)].reduce((sum,c)=>sum+(/\s/.test(c)?.33:/[ilI1.,:;!|']/u.test(c)?.32:/[MW@%]/u.test(c)?.94:/[A-Z0-9]/u.test(c)?.67:.58),0);
  const spacing=Number(/letter-spacing="(-?[.\d]+)"/.exec(extra)?.[1]||0);
  const estimate=units*size*1.07+Math.max(0,String(value).length-1)*spacing;
  if(available>0&&estimate>available)size=Math.floor(size*available/estimate*10)/10;
  return `<text x="${xx}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${x(value)}</text>`;
}
function rect(xx, y, w, h, fill, r = 0, stroke = '') {
  return `<rect x="${xx}" y="${y}" width="${Math.max(0,w)}" height="${Math.max(0,h)}" rx="${r}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}/>`;
}
function wrap(height, body, alt) {
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="${x(alt)}"><g font-family="Segoe UI, Inter, Arial, sans-serif">${body}</g></svg>`, width: WIDTH, height, alt };
}
export function headerSvg(theme = 'dark', loading = false, language = 'en-US') {
  const l = createI18n(language), { t } = l;
  const labels = Object.fromEntries(['read','write','input','output'].map(k=>[k,t(k)]));
  const dateLabel = date => l.date(date,true);
  const p = palette(theme);
  let b = rect(0, 0, WIDTH, 78, p.bg);
  b += rect(2, 8, 44, 44, p.elevated, 14, p.stroke);
  [12,23,34].forEach((xx,i) => { b += rect(xx, 37-i*6, 5, 9+i*6, [p.read,p.write,p.input][i], 2); });
  b += text(60, 28, 'Account Stats', 22, p.text, 650);
  b += text(60, 49, t('headerTagline'), 12, p.mute);
  b += rect(377, 13, 101, 26, p.elevated, 13);
  b += `<circle cx="390" cy="26" r="3" fill="${loading ? p.output : p.write}"/>`;
  b += text(400, 30, loading ? t('headerUpdating') : t('localPrivate'), 10, p.mute, 500, '', 68);
  return wrap(78, b, t('headerAlt'));
}
export function overviewSvg(view, theme = 'dark', language = 'en-US') {
  const l = createI18n(language), { t } = l;
  const labels = Object.fromEntries(['read','write','input','output'].map(k=>[k,t(k)]));
  const dateLabel = date => l.date(date,true);
  const p = palette(theme), values = view.totals;
  const range = t(view.range==='quota'?'rangeQuota':view.range==='all'?'rangeAll':view.range==='7d'?'range7':'range30');
  let b = `<defs><linearGradient id="summary" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.elevated}"/><stop offset="1" stop-color="${p.card}"/></linearGradient></defs>`;
  b += rect(1, 1, 478, 129, 'url(#summary)', 18, p.stroke);
  b += text(20, 25, range, 10, p.mute, 600, 'letter-spacing="1.4"');
  b += text(20, 70, l.compact(total(values)), 40, p.text, 650, 'letter-spacing="-1.4"', 258);
  b += text(21, 92, t('tokens',{n:l.integer(total(values))}), 12, p.mute, 400, '', 258);
  b += text(20, 115, view.range==='quota' ? quotaIntervalLabel(view.currentQuota,view.timeZone,false,l) : `${l.date(view.start)}  →  ${l.date(view.end)}`, 10, p.subtle);
  b += rect(293, 20, 1, 86, p.stroke);
  b += text(312, 39, t('cacheReuse'), 9, p.mute, 600, 'letter-spacing=".7"', 148);
  b += text(312, 71, view.cacheHit === null ? '—' : l.percent(view.cacheHit), 27, p.write, 600);
  l.t('activeRequests',{days:l.integer(view.activeDays),requests:l.compact(values.requests)}).split(' · ').forEach((line,i)=>{b += text(312, 92+i*13, line, 10, p.mute,400,'',148);});
  const keys = ['read','write','input','output'];
  keys.forEach((key, i) => {
    const xx = i % 2 === 0 ? 1 : 246, yy = i < 2 ? 144 : 231;
    b += rect(xx, yy, 233, 75, p.card, 14, p.stroke);
    b += rect(xx+14, yy+15, 4, 12, p[key], 2);
    b += text(xx+26, yy+25, labels[key], 11, p.mute, 500);
    b += text(xx+14, yy+51, l.compact(values[key]), 22, p[key], 600);
    b += text(xx+14, yy+67, t('tokens',{n:l.integer(values[key])}), 9, p.subtle);
  });
  return wrap(315, b, t('overviewAlt',{start:l.date(view.start),end:l.date(view.end),total:l.integer(total(values)),read:l.integer(values.read),write:l.integer(values.write),input:l.integer(values.input),output:l.integer(values.output)}));
}
export function chartSvg(view, mode = 'total', theme = 'dark', language = 'en-US') {
  const l = createI18n(language), { t } = l;
  const labels = Object.fromEntries(['read','write','input','output'].map(k=>[k,t(k)]));
  const dateLabel = date => l.date(date,true);
  const p = palette(theme), days = view.chartDays, weekly = view.grouping==='week', money = mode==='cost';
  const keys = mode === 'cache' ? ['read','write'] : ['read','write','input','output'].includes(mode) ? [mode] : ['read','write','input','output'];
  const max = Math.max(money ? .0001 : 1, ...days.map(d => chartValue(d, mode)));
  const ceiling = !money && max <= 10 ? 10 : Math.ceil(max / (10 ** Math.floor(Math.log10(max)) / 2)) * (10 ** Math.floor(Math.log10(max)) / 2);
  const left = money?84:66, top = 67, plotW = 463-left, plotH = 137, base = top+plotH, gap = plotW/days.length;
  const barW = Math.min(days.length <= 7 ? 30 : 12, gap * 0.66);
  let b = rect(1, 1, 478, money?292:268, p.card, 18, p.stroke);
  b += text(20, 27, t(money?(weekly?'chartCostWeek':'chartCostDay'):weekly?'chartWeeks':'chartDays'), 14, p.text, 600,'',335);
  b += text(20, 44, money?t('chartPricing',{date:l.date(PRICING_DATE)}):weekly ? t('chartStarts',{zone:view.timeZone}) : `${dateLabel(view.pageStart)} — ${dateLabel(view.pageEnd)} · ${view.timeZone}`, 10, p.mute);
  b += text(460, 27, t(weekly?(days.length===1?'quotaOne':'quotaCount'):(days.length===1?'dayOne':'dayCount'),{n:l.integer(days.length)}), 9, p.subtle, 600, 'text-anchor="end" letter-spacing="1"');
  [0, .5, 1].forEach(f => {
    const yy = base-plotH*f;
    b += `<line x1="${left}" x2="463" y1="${yy}" y2="${yy}" stroke="${p.stroke}" stroke-dasharray="${f ? '3 5' : '0'}"/>`;
    b += text(left-8, yy+3, money?l.usd(ceiling*f,true):l.compact(Math.round(ceiling*f)), 9, p.subtle, 400, 'text-anchor="end"');
  });
  days.forEach((d,i) => {
    const cx = left + gap*(i+.5), selected = d.date === view.day?.date;
    if (selected) b += rect(cx - Math.max(barW+8, gap*.84)/2, top-5, Math.max(barW+8,gap*.84), plotH+11, p.elevated, 5);
    let running = 0;
    for (const key of keys) {
      const v = money?costOf(d)[key]:d[key], h = v/ceiling*plotH;
      if (v) b += rect(cx-barW/2, base-running-h, barW, h, p[key], 0);
      running += h;
    }
    if (money) {
      const c=costOf(d), uncertain=(c.totalMax-c.total)/ceiling*plotH;
      if (uncertain>0) b += `<g opacity=".35">${rect(cx-barW/2,base-running-uncertain,barW,uncertain,p.write,0)}</g>`;
      if (c.unpricedTokens) b += text(cx,base-running-uncertain-7,'?',10,p.output,600,'text-anchor="middle"');
      running+=uncertain;
    }
    if (!running) b += rect(cx-1.5, base-3, 3, 3, p.subtle, 1.5);
    if (selected) b += `<circle cx="${cx}" cy="${base+10}" r="2" fill="${p.accent}"/>`;
    const labelStep = Math.max(Math.ceil(days.length/6), Math.ceil(36/gap));
    if (days.length <= 7 || i===0 || i===days.length-1 || (i%labelStep===0 && days.length-1-i>=labelStep)) b += text(cx, base+25, dateLabel(d.date)+(weekly&&d.clipped?'*':''), 9, selected?p.text:p.subtle, selected?600:400, 'text-anchor="middle"');
  });
  let lx = 20;
  keys.forEach(key => { b += rect(lx, 246, 6, 6, p[key], 2); b += text(lx+12, 252, labels[key], 10, p.mute,400,'',98); lx += 113; });
  if (money) {
    b+=text(20,278,t('chartUncertainty'),9,p.subtle);
    return wrap(300,b,t('chartCostAlt',{grouping:t(weekly?'groupingWeek':'groupingDay'),values:days.map(d=>l.date(d.date)+': '+l.price(costOf(d))+(costOf(d).unpricedTokens?' ('+t('incompletePrice')+')':'')).join('; ')}));
  }
  return wrap(276,b,t('chartTokenAlt',{grouping:t(weekly?'groupingWeek':'groupingDay'),start:l.date(view.pageStart),end:l.date(view.pageEnd),
    values:days.map(d=>l.date(d.date)+(weekly&&d.current?' ('+t('ongoing')+')':'')+(weekly&&d.clipped?' ('+t('partialFilter')+')':'')+': '+l.integer(chartValue(d,mode))).join('; '),selector:t(weekly?'week':'day')}));
}
export function modelsSvg(models, title, subtitle, theme = 'dark', start = 0, limit = 5, language = 'en-US') {
  const l = createI18n(language), { t } = l;
  const labels = Object.fromEntries(['read','write','input','output'].map(k=>[k,t(k)]));
  const dateLabel = date => l.date(date,true);
  const p = palette(theme), rows = models.slice(start,start+limit), rowHeight = 148;
  const h = 60 + Math.max(1, rows.length)*rowHeight;
  let b = rect(1,1,478,h-3,p.card,18,p.stroke);
  b += text(20,27,title,14,p.text,600);
  b += text(20,44,subtitle,10,p.mute);
  if (!rows.length) b += text(240,103,t('noUsage'),12,p.mute,400,'text-anchor="middle"');
  rows.forEach((m,i) => {
    const y = 66+i*rowHeight, c=costOf(m), status=costStatus(c);
    if (i) b += rect(20,y-8,440,1,p.stroke);
    const name = modelName(m.id);
    b += `<circle cx="25" cy="${y+8}" r="4" fill="${[p.read,p.write,p.input,p.output][(i+start)%4]}"/>`;
    b += text(38,y+12,name.length>30?name.slice(0,28)+'…':name,12,p.text,600,'',260);
    b += text(460,y+12,l.compact(total(m))+' '+t('total'),11,p.mute,500,'text-anchor="end"',142);
    b += text(20,y+32,'API '+l.price(c)+(status==='partial'?' · '+t('partial'):''),11,status==='unavailable'?p.output:p.accent,550);
    [['read',20,52],['write',248,52],['input',20,103],['output',248,103]].forEach(([key,xx,dy]) => {
      b += text(xx,y+dy,labels[key],9,p.mute,500);
      b += text(xx,y+dy+15,l.integer(m[key]),12,p[key],550,'',210);
      b += text(xx,y+dy+29,l.price(c,key),10,p.mute,400,'',210);
    });
  });
  return wrap(h,b,title+'. '+rows.map(m=>t('modelAlt',{model:m.id,read:l.integer(m.read),write:l.integer(m.write),input:l.integer(m.input),output:l.integer(m.output),cost:l.price(costOf(m)),status:l.status(costStatus(costOf(m)))})).join('; '));
}

/** Kept separate from tokens: a quoted API equivalent is NOT quota consumption. */
export function costSvg(value, title, subtitle, theme='dark', language='en-US') {
  const l = createI18n(language), { t } = l;
  const labels = Object.fromEntries(['read','write','input','output'].map(k=>[k,t(k)]));
  const dateLabel = date => l.date(date,true);
  const p=palette(theme), c=costOf(value), status=costStatus(c), h=286;
  let b=rect(1,1,478,h-5,p.card,18,p.stroke);
  b+=rect(20,19,3,18,p.accent,1.5);
  b+=text(32,32,title,12,p.text,600,'',390);
  b+=text(460,31,'USD',10,p.mute,600,'text-anchor="end" letter-spacing="1"');
  b+=text(20,54,subtitle.length>76?subtitle.slice(0,74)+'…':subtitle,9,p.mute);
  const amount=l.price(c);
  b+=text(20,94,amount,Math.min(amount.length>24?24:amount.length>16?28:36,Math.floor(440/(amount.length*.61)*10)/10),p.accent,650,'letter-spacing="-.7"');
  const badge=l.status(status);
  b+=text(20,115,badge,10,status==='partial'||status==='unavailable'?p.output:p.mute);
  b+=rect(20,130,440,1,p.stroke);
  [['read',20,152],['write',248,152],['input',20,199],['output',248,199]].forEach(([key,xx,yy])=>{
    b+=rect(xx,yy-8,4,9,p[key],2);
    b+=text(xx+12,yy,labels[key],10,p.mute,500,'',126);
    const label=l.price(c,key);
    b+=text(xx,yy+21,label,Math.min(label.length>23?11:14,Math.floor(212/(label.length*.61)*10)/10),p[key],600);
  });
  b+=rect(20,239,440,1,p.stroke);
  let note=t('costNote',{date:l.date(PRICING_DATE)});
  if(c.unpricedTokens) note=t('costUnpriced',{tokens:l.compact(c.unpricedTokens)});
  else if(c.unknownWriteTokens) note=t('costUnknownTtl');
  b+=text(20,261,note,9,p.subtle);
  return wrap(h,b,t('costAlt',{title,subtitle,amount,read:l.price(c,'read'),write:l.price(c,'write'),input:l.price(c,'input'),output:l.price(c,'output'),badge,tokens:l.integer(c.unpricedTokens),date:l.date(PRICING_DATE)}));
}

/** Selected quota totals, kept distinct from totals of the entire range.
 * The total already includes all four categories. Keep them all visible here,
 * independently of the metric selected for the chart, including explicit zeros.
 */
export function cycleSvg(week, view, theme='dark', language='en-US') {
  const l = createI18n(language), { t } = l;
  const labels = Object.fromEntries(['read','write','input','output'].map(k=>[k,t(k)]));
  const dateLabel = date => l.date(date,true);
  const p=palette(theme), h=week.clipped?271:253;
  let b=rect(1,1,478,h-5,p.card,18,p.stroke);
  b+=text(20,25,t(week.current?'currentQuota':'selectedQuota'),10,p.mute,600,'letter-spacing="1"');
  b+=rect(379,12,81,23,p.elevated,11);
  b+=text(419,27,t(week.current?'ongoing':'closed'),10,week.current?p.write:p.mute,600,'text-anchor="middle"');
  const interval=quotaIntervalLabel(week,view.timeZone,false,l);
  b+=text(20,55,interval,21,p.text,600,'letter-spacing="-.6"');
  b+=text(20,74,week.date.slice(0,4)+' · '+view.timeZone+' · '+t('boundaries'),10,p.mute);
  b+=rect(20,86,440,1,p.stroke);

  // A prominent total on the left; a compact 2×2 category grid on the right.
  // Reuse the same colors, labels and exact counters as the period/model cards.
  b+=text(20,121,t(week.clipped?'totalFilter':'total'),10,p.mute,500,'',132);
  b+=text(20,155,l.compact(total(week)),30,p.text,600,'letter-spacing="-.6"',132);
  b+=text(20,175,t('tokens',{n:l.integer(total(week))}),9,p.subtle,400,'',132);
  b+=text(20,205,t('fourCategories'),9,p.mute,400,'',132);
  b+=rect(162,103,1,128,p.stroke);
  b+=rect(182,167,278,1,p.stroke);
  [['read',182,106],['write',334,106],['input',182,184],['output',334,184]].forEach(([key,xx,yy])=>{
    b+=text(xx,yy,labels[key],10,p.mute,500,'',126);
    b+=text(xx,yy+28,l.compact(week[key]),24,p[key],600,'',126);
    b+=text(xx,yy+46,t('tokens',{n:l.integer(week[key])}),9,p.subtle,400,'',126);
  });
  if(week.clipped) b+=text(20,254,t('clippedNote'),10,p.output);
  return wrap(h,b,t('cycleAlt',{interval,zone:view.timeZone,state:t(week.current?'ongoing':'closed'),partial:week.clipped?t('partialFilter')+'. ':'',total:l.integer(total(week)),read:l.integer(week.read),write:l.integer(week.write),input:l.integer(week.input),output:l.integer(week.output)}));
}

export function quotaSvg(rateLimits, theme = 'dark', language = 'en-US', timeZone = 'UTC') {
  const l = createI18n(language), { t } = l;
  const labels = Object.fromEntries(['read','write','input','output'].map(k=>[k,t(k)]));
  const dateLabel = date => l.date(date,true);
  const p = palette(theme);
  const rows = (rateLimits || []).filter(r => Number.isFinite(r.percentUsed));
  let b = rect(1,1,478,58+Math.max(1,rows.length)*54,p.card,18,p.stroke);
  b += text(20,27,t('limitsTitle'),14,p.text,600);
  b += text(20,44,t('limitsHelp'),9,p.mute);
  if (!rows.length) b += text(20,84,t('limitsUnavailable'),11,p.mute);
  rows.forEach((r,i) => {
    const y=69+i*54, percent=Math.min(100,Math.max(0,r.percentUsed));
    const names={five_hour:t('fiveHour'),seven_day:t('sevenDay'),seven_day_sonnet:t('sonnet7'),seven_day_opus:t('opus7')};
    b += text(20,y,names[r.kind]||String(r.kind||t('usage')).slice(0,45),11,p.mute,500);
    b += text(460,y,l.percent(r.percentUsed/100),12,percent>=90?p.output:p.text,600,'text-anchor="end"');
    b += rect(20,y+12,440,5,p.elevated,2.5);
    b += rect(20,y+12,440*percent/100,5,percent>=90?p.output:p.accent,2.5);
    if (r.resetsAt) {
      const raw = r.resetsAt;
      const d = new Date(typeof raw === 'number' && raw > 0 && raw < 1e12 ? raw*1000 : raw);
      const label = Number.isFinite(+d) ? l.datetime(d,timeZone,true)+' '+timeZone : t('toConfirm');
      b += text(20,y+32,t('renews',{date:label}),8,p.subtle);
    }
  });
  return wrap(64+Math.max(1,rows.length)*54,b,rows.length?rows.map(r=>`${r.kind}: ${l.percent(r.percentUsed/100)}`).join('; '):t('limitsAlt'));
}
export function statusSvg(title, message, theme='dark', isError=false) {
  const p = palette(theme); let b=rect(1,1,478,101,p.card,16,p.stroke);
  b+=rect(16,20,3,60,isError?p.output:p.accent,1.5);
  b+=text(31,39,title,14,p.text,600);
  // Explicit, bounded wrapping: SVG text is not HTML and cannot auto-wrap.
  const words=String(message).split(/\s+/); const lines=[''];
  for (const word of words) { if ((lines[lines.length-1]+' '+word).length>67) lines.push(word); else lines[lines.length-1]+=(lines[lines.length-1]?' ':'')+word; }
  lines.slice(0,3).forEach((line,i)=>{b+=text(31,59+i*14,line,10,p.mute);});
  return wrap(110,b,title+'. '+message);
}
