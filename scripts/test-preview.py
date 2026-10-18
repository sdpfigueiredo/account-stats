"""Browser simulation of real mod hooks/SVGs. No Claude Desktop host is available."""
import asyncio,json,re,subprocess,os,shutil
from pathlib import Path
from playwright.async_api import async_playwright
BASE=Path(__file__).resolve().parent.parent
AUDIT=r'''() => {
 const out=[];
 for(const img of document.querySelectorAll('#panel img')){
  const div=document.createElement('div');div.innerHTML=decodeURIComponent(img.src.split(',')[1]);
  div.style.cssText='position:absolute;top:-10000px';document.body.append(div);
  const svg=div.querySelector('svg'),w=svg.viewBox.baseVal.width,h=svg.viewBox.baseVal.height;
  const nodes=[...div.querySelectorAll('text')].map(t=>({text:t.textContent,b:t.getBBox()}));
  for(const n of nodes)if(n.b.x<-.2||n.b.x+n.b.width>w+.2||n.b.y<-.2||n.b.y+n.b.height>h+.2)
   out.push({type:'overflow',card:img.alt.slice(0,50),text:n.text,x:n.b.x,width:n.b.width});
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){
   const a=nodes[i].b,b=nodes[j].b;
   if(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)>.5&&Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)>.5)
    out.push({type:'overlap',card:img.alt.slice(0,40),a:nodes[i].text,b:nodes[j].text});
  }div.remove();
 }
 return out;
}'''
async def main():
 checks=0;errors=[];requests=[];audits=[];spacing=[]
 def check(value,message):
  nonlocal checks
  assert value,message
  checks+=1
 async with async_playwright() as p:
  executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
  launch={'args':['--no-sandbox']} if hasattr(os,'geteuid') and os.geteuid()==0 else {}
  if executable: launch['executable_path']=executable
  browser=await p.chromium.launch(**launch)
  page=await browser.new_page(viewport={'width':650,'height':950})
  page.on('pageerror',lambda error:errors.append(str(error)))
  page.on('request',lambda request:requests.append(request.url) if request.url.startswith(('http:','https:')) else None)
  async def settle(): await page.wait_for_timeout(110)
  async def click(key):
   await page.locator(f'button[data-key="{key}"]').click();await settle()
  async def choose(key,value):
   await page.locator(f'select[data-key="{key}"]').select_option(value);await settle()
  async def state():return await page.evaluate('window.__accountStatsPreview')
  async def audit(label):
   found=await page.evaluate(AUDIT);audits.extend([{'case':label,**item}for item in found]);check(not found,label+': '+json.dumps(found,ensure_ascii=False))
   gaps=await page.evaluate('''()=>{const nodes=[...document.querySelector('#panel>.box').children];return nodes.slice(1).flatMap((n,i)=>{
    const gap=n.getBoundingClientRect().top-nodes[i].getBoundingClientRect().bottom;return gap<15.5?[{section:i+1,gap}]:[];});}''')
   spacing.extend(gaps);check(not gaps,'Lost native section margins')
   check(not await page.evaluate('document.documentElement.scrollWidth>innerWidth'),'Horizontal overflow')
  async def quota_check():
   current=await state();labels=current['labels'];metrics=['read','write','input','output'];selection=current['selection']
   check(sum(selection[k]for k in metrics)>0,'Demo selection unexpectedly empty')
   texts=await page.evaluate('''()=>[...document.querySelectorAll('#panel img')].map(img=>({alt:img.alt,
     texts:[...new DOMParser().parseFromString(decodeURIComponent(img.src.split(',')[1]),'image/svg+xml').querySelectorAll('text')].map(t=>t.textContent)}))''')
   cards=[c for c in texts if labels['currentQuota']in c['texts']or labels['selectedQuota']in c['texts']]
   check(len(cards)==1,'Expected exactly one selected-week card')
   for key in metrics:check(cards[0]['texts'].count(labels[key])==1,'Missing visible quota metric '+key)
   check(sum(bool('USD'in c['texts'])for c in texts)==2,'Expected period and interval USD cards')
  await page.set_content((BASE/'preview/index.html').read_text(),wait_until='load')
  await page.wait_for_selector('select[data-key="week"]');await settle()
  check((await state())['locale']=='en-US','Initial English language')
  check(await page.locator('button[data-key="settings"]').inner_text()=='Settings','English controls')
  check(await page.locator('select[data-key="week"] option').count()>10,'All-time weekly history')
  await quota_check();await audit('English initial')
  await page.screenshot(path=str(BASE/'preview/preview-english.png'),full_page=True)
  # Live language events, both themes, both monetary and token charts.
  for language,locale in [('english','en-US'),('en-GB','en-GB'),('pt-PT','pt-PT'),('pt-BR','pt-BR'),('es-ES','es-ES'),('fr-FR','fr-FR'),('de-DE','de-DE'),('it-IT','it-IT')]:
   before=await state();await page.locator('#preview-language').select_option(language);await settle();after=await state()
   check(after['locale']==locale,'Wrong resolved language: '+language)
   check(after['totals']==before['totals']and after['selection']==before['selection'],'Translation mutated tokens/costs')
   check(after['preferences']==before['preferences'],'Translation changed preferences')
   check(await page.locator('html').get_attribute('lang')==locale,'HTML lang does not match simulated host')
   for theme in ['dark','light']:
    if await page.locator('body').get_attribute('data-theme')!=theme:await click('theme')
    for metric in ['total','cost']:
     await choose('metric',metric);await audit(locale+'/'+theme+'/'+metric)
     await quota_check()
    # Speed filters run entirely against the indexed data in every language/theme.
    all_speeds=(await state())['totals']
    for speed in ['fast','standard','unknown']:
     await choose('speed',speed);filtered=await state()
     check(filtered['preferences']['speed']==speed,'Speed filter not retained')
     for k in ['read','write','input','output','requests']:
      check(filtered['totals'][k]==all_speeds['speeds'][speed][k],'Speed subtotal mismatch: '+k)
     check(filtered['totals']['cost']==all_speeds['speeds'][speed]['cost'],'Speed cost mismatch')
     for other in ['fast','standard','unknown']:
      if other!=speed:check(filtered['totals']['speeds'][other]['requests']==0,'Other mode leaked into filter')
     await audit(locale+'/'+theme+'/speed-'+speed)
    await choose('speed','all')
    check((await state())['totals']==all_speeds,'All speeds failed to restore totals')
   if locale=='de-DE':await page.screenshot(path=str(BASE/'preview/preview-german-light.png'),full_page=True)
  # Existing navigation, ranges, all four counters and cost selection.
  await page.locator('#preview-language').select_option('english');await settle()
  await choose('metric','total');await click('range-quota');await quota_check()
  check(await page.locator('select[data-key="week"] option').count()==1,'Current quota must have one interval')
  check('8:00 PM'in await page.locator('select[data-key="week"]').inner_text(),'Reset display not in US hour cycle')
  await click('group-day');check(await page.locator('select[data-key="day"] option').count()==2,'Current quota demo spans 2 calendar dates')
  for key,n in [('range-7d',7),('range-30d',30),('range-all',45)]:
   await click(key);check(await page.locator('select[data-key="day"] option').count()==n,key);await audit(key)
  await click('older');check(await page.locator('button[data-key="newer"]').count()==1,'Missing newer page button')
  await click('range-7d');await click('group-week')
  check(await page.locator('select[data-key="week"] option').count()==2,'7 days must intersect two quota periods')
  values=await page.locator('select[data-key="week"] option').evaluate_all('(xs)=>xs.map(x=>x.value)')
  await choose('week',values[-1]);check((await state())['selection']['clipped'],'Older weekly quota should be partial')
  check('Partial in filter'in await page.locator('select[data-key="week"]').inner_text(),'Missing clipped-week label')
  await choose('model','claude-sonnet-5-5')
  for metric in ['cache','read','write','input','output','total','cost']:
   before=(await state())['selection'];await choose('metric',metric);await quota_check()
   check((await state())['selection']==before,'Chart metric changed selected quota totals');await audit('mode/'+metric)
  # Authored validation notices retranslate; machine reset values never do.
  await click('settings');check(await page.locator('select[data-key="reset-day"]').input_value()=='4','Default reset day changed')
  check(await page.locator('input[data-key="reset-time"]').input_value()=='20:00','Default reset time changed')
  await choose('reset-day','1');await page.locator('input[data-key="reset-time"]').fill('08:15')
  await page.locator('input[data-key="reset-time"]').press('Enter');await settle()
  check((await state())['preferences']['resetTime']=='08:15','Reset not saved')
  await page.locator('input[data-key="reset-time"]').fill('25:78');await page.locator('input[data-key="reset-time"]').press('Enter');await settle()
  check('Invalid reset time'in await page.locator('#panel').inner_text(),'English validation error missing')
  await page.locator('#preview-language').select_option('pt-PT');await settle()
  check('Hora de reset inválida'in await page.locator('#panel').inner_text(),'Portuguese validation error missing')
  check('Invalid reset time'not in await page.locator('#panel').inner_text(),'Stale language notice')
  check(await page.locator('input[data-key="reset-time"]').input_value()=='08:15','Language changed reset time')
  check('segunda-feira'in await page.locator('#panel').inner_text(),'Weekday not localized')
  await page.locator('#preview-language').select_option('ja-JP');await settle()
  check((await state())['locale']=='en-US','Unsupported-language fallback failed')
  check('No translation for “ja-JP”'in await page.locator('#panel').inner_text(),'Unsupported-language notice missing')
  await page.locator('#preview-language').select_option('');await settle()
  check('no explicit language setting'in await page.locator('#panel').inner_text(),'Unset language notice missing')
  await page.locator('#preview-language').select_option('pt-PT');await settle();await click('settings')
  await click('export');check('CSV guardado em'in await page.locator('#panel').inner_text(),'Localized export feedback missing')
  # Full reset/current-card preview returned to the user's defaults.
  await click('settings');await choose('reset-day','4');await page.locator('input[data-key="reset-time"]').fill('20:00')
  await page.locator('input[data-key="reset-time"]').press('Enter');await settle();await click('settings')
  await choose('model','all');await click('range-quota');await choose('metric','total')
  if await page.locator('body').get_attribute('data-theme')!='dark':await click('theme')
  await audit('PT final');await page.screenshot(path=str(BASE/'preview/preview-portuguese.png'),full_page=True)
  await page.locator('img[alt^="Cota "]').screenshot(path=str(BASE/'preview/preview-quota-portuguese.png'))
  await page.locator('img[alt^="Modo dos pedidos · seleção"]').screenshot(path=str(BASE/'preview/preview-speed-portuguese.png'))
  await page.set_viewport_size({'width':390,'height':844});await settle();await audit('PT 390px')
  await page.screenshot(path=str(BASE/'preview/preview-narrow.png'),full_page=True)
  # Same runtime card with billions of tokens, independent of its chart filter.
  fixture=subprocess.run(['node','--input-type=module','-e',r'''
    import {cycleSvg} from './lib/visuals.js';import {makeView} from './lib/view-model.js';import {demoSnapshot} from './tests/fixtures.mjs';
    const v=makeView(demoSnapshot(),{range:'all',grouping:'week'}),w={...v.day,read:16123456789,write:178123456,input:12345678,output:87654321};
    console.log(JSON.stringify(['en-US','en-GB','pt-PT','pt-BR','es-ES','fr-FR','de-DE','it-IT'].flatMap(locale=>['dark','light'].map(theme=>({locale,theme,...cycleSvg(w,v,theme,locale)})))));
  '''],cwd=BASE,capture_output=True,text=True,check=True)
  for card in json.loads(fixture.stdout):
   await page.locator('#panel').evaluate('''(panel,d)=>{panel.replaceChildren();const box=document.createElement('div');box.className='box';const img=document.createElement('img');img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(d.source);img.alt=d.alt;img.style.cssText='width:100%;max-width:480px';box.append(img);panel.append(box);}''',card)
   await audit('billions/'+card['locale']+'/'+card['theme'])
  check(not errors,'JavaScript errors: '+str(errors));check(not requests,'Preview made external requests')
  await browser.close()
 result={'checks':checks,'pageErrors':errors,'svgBoundsOrOverlapViolations':audits,'nativeSectionSpacingViolations':spacing,'externalRequests':requests,
  'scope':'Chromium browser simulation; real hooks and SVGs, fictitious data. NOT the Claude Desktop runtime. Eight regional formats / seven translation catalogues.'}
 (BASE/'docs/browser-test-results.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps(result,ensure_ascii=False,indent=2))
asyncio.run(main())
