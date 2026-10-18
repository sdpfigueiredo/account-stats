import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['lib/locales/en.js','lib/locales/pt-PT.js','lib/locales/pt-BR.js','lib/locales/es.js','lib/locales/fr.js','lib/locales/de.js','lib/locales/it.js','lib/speed-i18n.js','lib/i18n.js','lib/speed.js','lib/usage.js','lib/pricing.js','lib/quota.js','lib/view-model.js','lib/visuals.js','hooks/register.js','tests/fixtures.mjs','preview/app.js'];
const parts=['const x = escapeXml;'];
for(const file of files){let source=await fs.readFile(path.join(root,file),'utf8');if(['lib/view-model.js','tests/fixtures.mjs'].includes(file))source=source.replace(/(?<!\.)\badd\(/g,'addPriced(');parts.push('// '+file+'\n'+source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,''));}
const html=`<!doctype html><html lang="en-US"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account Stats — preview</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0b0d13;color:#f0f1fa;font:13px/1.5 'Segoe UI',Arial,sans-serif}body[data-theme=light]{background:#e8ebf3;color:#20263b}
.banner{position:sticky;top:0;z-index:5;background:#20212ded;backdrop-filter:blur(10px);padding:12px 22px;text-align:center;color:#ccc5ff;border-bottom:1px solid #39394b;font-size:12px}
.preview-language{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;margin-top:10px}.preview-language select{flex:0 1 230px}.banner strong{font-weight:650} .shell{width:min(100%,572px);margin:28px auto 60px;border:1px solid #2a3042;border-radius:22px;overflow:hidden;box-shadow:0 24px 90px #0006}
.frame{display:flex;justify-content:space-between;align-items:center;padding:12px 20px;background:#181b26;color:#b8c0d4;border-bottom:1px solid #2a3042;font-size:12px}.frame small{opacity:.65}
#panel{padding:16px 8px;background:#10121a}.custom-svg{display:block;flex-shrink:0;align-self:center}button{font:inherit;font-size:12px;border:1px solid #373b50;border-radius:9px;background:#252936;color:#eff0fc;padding:6px 10px;margin:0;cursor:pointer;white-space:nowrap;transition:border-color .15s,background .15s}
button:hover{background:#333747;border-color:#a397ff}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #a397ff;outline-offset:2px}.dim{color:#959eb5;background:transparent;border-color:transparent} .picker{display:flex;align-items:center;gap:12px;margin:0;color:#9ca6be;font-size:11px}.picker>span{min-width:44px;max-width:155px}
select,input{font:inherit;font-size:12px;padding:9px 10px;border:1px solid #30364a;background:#181b26;color:#e7e8f5;border-radius:9px;min-width:0;max-width:100%;flex:1}select{cursor:pointer}.host-text{font-size:10px;line-height:1.6;margin:0;overflow-wrap:anywhere}.box{min-width:0}
body[data-theme=light] #panel{background:#f4f5fa}body[data-theme=light] button,body[data-theme=light] select,body[data-theme=light] input{background:#fff;color:#303b53;border-color:#d4daea}body[data-theme=light] .dim{color:#748099;background:transparent;border-color:transparent}
body[data-theme=light] .frame{background:#fff;color:#47516a;border-color:#dce1ed}body[data-theme=light] .shell{border-color:#dce1ed;box-shadow:0 24px 70px #24334d15}
@media(max-width:600px){.shell{margin:0 auto;border:0;border-radius:0}.banner{font-size:10px;padding:9px}#panel{padding:10px 0}.frame{padding:10px 14px}button{padding:6px 7px;font-size:11px}}
</style><body data-theme="dark"><div class="banner"><strong id="preview-banner">DEMO · FICTITIOUS DATA</strong><br><span id="preview-help">Real mod SVG. Simulated controls, not a Claude Desktop screenshot.</span><label class="preview-language"><span id="preview-language-label">Simulated Claude Code language</span><select id="preview-language" aria-label="Simulated Claude Code language"><option value="english">English (US)</option><option value="en-GB">English (UK)</option><option value="pt-PT">Português (Portugal)</option><option value="pt-BR">Português (Brasil)</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option><option value="it-IT">Italiano</option><option value="">Not configured → English</option><option value="ja-JP">日本語 → English fallback</option></select></label></div>
<main class="shell"><header class="frame"><span>▥ &nbsp; Account Stats</span><small id="preview-frame">Interactive preview</small></header><div id="panel"></div></main>
<script type="module">${parts.join('\n\n').replace(/<\/script/gi,'<\\/script')}</script></body></html>`;
await fs.writeFile(path.join(root,'preview','index.html'),html);
console.log('Built preview/index.html (standalone; fictitious data)');
