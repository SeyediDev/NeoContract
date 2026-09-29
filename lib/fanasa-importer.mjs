import { createHash } from 'node:crypto';

const ORIGIN = 'https://fanasa.net';
const MAX_BYTES = 5_000_000;
const MODELS = { 'اشتراک به‌ازای کاربر':'per_user', 'پرداخت به‌ازای مصرف':'usage', 'هزینه‌ی ثابت':'fixed', 'ترکیبی':'hybrid', 'پروژه‌ای':'project', 'تخصیص سربار':'overhead', 'درون‌ساختاری':'included' };
const DELIVERY = { 'سلف‌سرویس':'self_service', 'مدیریت‌شده':'managed', 'درخواستی':'on_request', 'خودکار':'automatic' };
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const digits = s => String(s ?? '').replace(/[۰-۹٠-٩]/g,c => '۰۱۲۳۴۵۶۷۸۹'.includes(c) ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/٫/g,'.').replace(/[٬,]/g,'');
const number = s => { const m = digits(s).match(/\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };
function decode(s) { return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(_,e) => { if(e[0]==='#'){const n=e[1].toLowerCase()==='x'?parseInt(e.slice(2),16):Number(e.slice(1));return n<=0x10ffff?String.fromCodePoint(n):'';}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[e.toLowerCase()]||_;}); }
function tree(html) {
  // Parse only inert, delivered SSR markup; never evaluate RSC/JavaScript.
  const root={tag:'root',attrs:{},children:[]}; const stack=[root];
  const clean=html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'');
  for(const m of clean.matchAll(/<\/?[a-zA-Z][^>]*>|[^<]+/g)) {
    const token=m[0]; if(token[0]!=='<'){stack.at(-1).children.push(decode(token));continue;}
    const tag=token.match(/^<\/?([^\s/>]+)/)?.[1].toLowerCase(); if(!tag)continue;
    if(token.startsWith('</')) { for(let i=stack.length-1;i>0;i--){if(stack[i].tag===tag){stack.length=i;break;}}continue; }
    const attrs={}; for(const a of token.slice(tag.length+1).matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[a[1].toLowerCase()]=decode(a[2]??a[3]??a[4]??'');
    const node={tag,attrs,children:[]}; stack.at(-1).children.push(node); if(!VOID.has(tag)&&!token.endsWith('/>'))stack.push(node);
  }
  return root;
}
const text = node => typeof node==='string'?node:node?.children.map(text).join(' ').replace(/\s+/g,' ').trim()||'';
function nodes(node,predicate){const out=[];function visit(n){if(typeof n==='string')return;if(predicate(n))out.push(n);for(const c of n.children)visit(c);}if(node)visit(node);return out;}
const tag = (n,t) => nodes(n,x=>x.tag===t);
const id = (n,v) => nodes(n,x=>x.attrs.id===v)[0];
const pairs = n => tag(n,'dt').map(dt => { const parent=nodes(n,x=>x.children.includes(dt))[0];return {label:text(dt),value:text(parent?.children.find(x=>typeof x!=='string'&&x.tag==='dd'))}; });
const value = (n,key) => pairs(n).find(x=>x.label===key)?.value ?? null;
const insist = (ok,message) => {if(!ok)throw new Error(`Fanasa source validation: ${message}`);};
const duration = raw => ({value:number(raw),unit:/روز کاری/.test(raw)?'business_day':/دقیقه/.test(raw)?'minute':/ساعت/.test(raw)?'hour':null,raw});
const hash = html => createHash('sha256').update(html).digest('hex');
function officialUrl(path) { const u=new URL(path,ORIGIN);insist(u.origin===ORIGIN&&!u.username&&!u.password,'only the official HTTPS origin is permitted');return u.href; }
function enumCode(labels,label){const normalized=String(label||'').replace(/\s+/g,' ').trim();return labels[normalized]??null;}
function money(raw) {if(!raw||!raw.includes('ریال')||raw.includes(' تا '))return null;const n=number(raw);return n===null?null:Math.round(n*(raw.includes('میلیارد')?1e9:raw.includes('میلیون')?1e6:1));}

export function parseCatalogPage(html,sourceUrl=ORIGIN+'/fa/products') {
  const doc=tree(html), main=tag(doc,'main')[0]; insist(main,'catalog main element missing');
  const summary=tag(main,'p').map(text).find(t=>/سرویس در.*مرکز قابلیت/.test(t));
  const counts=digits(summary).match(/(\d+) سرویس در (\d+) مرکز قابلیت و (\d+) پهنه/);
  insist(counts,'published catalog totals missing');
  const expected={services:Number(counts[1]),centers:Number(counts[2]),zones:Number(counts[3])};
  const centers=[],services=[];
  for(const section of nodes(main,n=>n.tag==='section'&&/^center-/.test(n.attrs['aria-labelledby']||''))) {
    const centerId=section.attrs['aria-labelledby'].slice(7),h=tag(section,'h2')[0];const spans=tag(h,'span');
    const name=text(spans[0]),zone=text(spans[1]);insist(name&&zone,`missing name/zone for ${centerId}`);
    const centerServices=[];
    for(const li of tag(section,'li')){
      const a=tag(li,'a').find(x=>/^\/fa\/products\/[A-Z]+-\d{2}$/.test(x.attrs.href||''));if(!a)continue;
      const code=a.attrs.href.split('/').at(-1),spanTexts=tag(li,'span').map(text);
      const tier=spanTexts.find(t=>/^T[123] ·/.test(t))?.slice(0,2);
      const delivery=spanTexts.map(t=>enumCode(DELIVERY,t)).find(Boolean);
      const priceDisplay=text(tag(li,'strong')[0])||spanTexts.find(t=>t==='در هزینه‌ی پایه')||null;
      insist(tier&&delivery,`missing list SLA/delivery for ${code}`);
      const service={code,name:text(a),description:text(tag(li,'p')[0]),centerId,centerName:name,zone,tier,delivery,priceDisplay,sourceUrl:officialUrl(a.attrs.href)};
      services.push(service);centerServices.push(code);
    }
    centers.push({id:centerId,name,zone,serviceCount:centerServices.length,serviceCodes:centerServices,sourceUrl:officialUrl(`/fa/centers/${centerId}`)});
  }
  insist(new Set(services.map(s=>s.code)).size===services.length,'duplicate service codes');
  insist(services.length===expected.services&&centers.length===expected.centers&&new Set(centers.map(c=>c.zone)).size===expected.zones,'catalog totals do not match extracted records');
  insist(services.length>0,'empty catalog');return {centers,services,expected,sourceUrl};
}

export function parseServicePage(html,listed) {
  const doc=tree(html),overview=id(doc,'overview'),pricing=id(doc,'pricing'),slaNode=id(doc,'sla');
  insist(overview&&pricing&&slaNode,`${listed.code}: detail sections missing`);
  const serviceCode=value(overview,'کد سرویس')?.match(/^[A-Z]+-\d{2}/)?.[0];
  insist(serviceCode===listed.code,`${listed.code}: detail code mismatch`);
  const tier=value(overview,'سطح خدمت')?.match(/^T[123]/)?.[0];
  const delivery=enumCode(DELIVERY,value(overview,'شیوه‌ی ارائه'));
  const revenueModel=enumCode(MODELS,value(overview,'مدل قیمت'));
  insist(tier===listed.tier&&delivery===listed.delivery,`${listed.code}: list/detail SLA or delivery disagreement`);
  insist(revenueModel,`${listed.code}: unknown price model`);
  let structured=null;
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)){
    let parsed;try{parsed=JSON.parse(m[1]);}catch{throw new Error(`Fanasa source validation: ${listed.code}: malformed JSON-LD`);}
    if(parsed['@type']==='Service'&&parsed.identifier===listed.code)structured=parsed;
  }
  insist(structured,`${listed.code}: matching Service JSON-LD missing`);
  const rows=tag(pricing,'table').flatMap(t=>{const headers=tag(t,'th').map(text);return tag(t,'tbody').flatMap(body=>tag(body,'tr').map(tr=>{const cells=tag(tr,'td').map(text);const at=k=>cells[headers.indexOf(k)]??null;const amountText=at('قیمت');return {label:at('مورد'),unit:at('واحد'),amountText,amountIrr:money(amountText),amountPrecision:'display-rounded',cells};}));});
  const priceTerms=pairs(pricing).filter(p=>!['واحد','قیمت'].includes(p.label));
  const specification=structured.offers?.priceSpecification;
  const headlineAmount=typeof specification?.price==='number'?specification.price:null;
  const availabilityPercent=number(value(slaNode,'دسترس‌پذیری'));
  const response=duration(value(slaNode,'زمان پاسخ')),resolution=duration(value(slaNode,'زمان رفع'));
  insist(availabilityPercent!==null&&response.value!==null&&response.unit&&resolution.value!==null&&resolution.unit,`${listed.code}: SLA metrics incomplete`);
  const priceEffect=tag(slaNode,'p').map(text).find(t=>t.startsWith('اثر بر قیمت'))?.replace(/^اثر بر قیمت\s*:\s*/,'')??null;
  const unit=value(overview,'واحد محاسبه');
  return {...listed,description:structured.description??listed.description,model:revenueModel,revenueModel,unit,
    price:{currency:specification?.priceCurrency??structured.offers?.priceCurrency??'IRR',headlineAmount,headlineUnit:specification?.unitText??null,headlinePrecision:headlineAmount===null?null:'json-ld',rows,terms:priceTerms,rawText:text(pricing),sourceUrl:listed.sourceUrl+'#pricing'},
    sla:{availabilityPercent,response,resolution,coverage:value(slaNode,'ساعات پوشش'),priceEffect,sourceUrl:listed.sourceUrl+'#sla'},
    sourceMetadataUrl:structured.url??null};
}

export function parseSupportPage(html) {
  const doc=tree(html),main=tag(doc,'main')[0];const profiles=[];
  for(const a of tag(main,'article')){
    const code=tag(a,'span').map(text).find(t=>/^T[123]$/.test(t));if(!code)continue;
    const p=tag(a,'p').map(text),responseStructured=duration(value(a,'زمان پاسخ')),resolutionStructured=duration(value(a,'هدف رفع مشکل'));
    const availabilityPercent=number(p.find(t=>/^[۰-۹\d٫.]+٪$/.test(t))),name=text(tag(a,'h3')[0]);
    const serviceCount=number(tag(a,'span').map(text).find(t=>t.includes('سرویس در این سطح')));
    insist(availabilityPercent!==null&&responseStructured.unit&&resolutionStructured.unit&&serviceCount!==null,`${code}: support terms incomplete`);
    profiles.push({code,name,label:name,availabilityPercent,availabilityPct:availabilityPercent,responseValue:responseStructured.value,responseUnit:responseStructured.unit,response:responseStructured.raw,responseStructured,resolutionValue:resolutionStructured.value,resolutionUnit:resolutionStructured.unit,resolution:resolutionStructured.raw,resolutionStructured,coverage:value(a,'ساعات پوشش'),priceEffect:p[p.indexOf('اثر بر قیمت')+1]??null,serviceCount,sourceUrl:ORIGIN+'/fa/pricing/support'});
  }
  insist(profiles.length===3&&new Set(profiles.map(p=>p.code)).size===3,'three distinct support tiers required');
  return {profiles,rules:tag(id(main,'rules'),'p').map(text),rawRules:text(id(main,'rules'))};
}

export function parsePricingPage(html) {
  const doc=tree(html),main=tag(doc,'main')[0];const models=[];
  for(const table of tag(main,'table')){
    if(!text(tag(table,'caption')[0]).includes('مدل‌های قیمت‌گذاری'))continue;
    for(const tr of tag(table,'tr')){
      const cells=tag(tr,'td');if(!cells.length)continue;
      const a=tag(tr,'a').find(a=>/\?model=/.test(a.attrs.href||''));if(!a)continue;
      const code=new URL(a.attrs.href,ORIGIN).searchParams.get('model');
      insist(Object.values(MODELS).includes(code),'unknown published price model');
      models.push({code,name:text(cells[0]),label:text(cells[0]),description:text(cells[1]),serviceCount:number(text(cells.at(-1))),sourceUrl:ORIGIN+'/fa/pricing'});
    }
  }
  insist(models.length===7&&new Set(models.map(m=>m.code)).size===7,'seven distinct price models required');
  const sections=['content','base-fee','save','offers','sizes'].map(sectionId=>{const n=id(main,sectionId);return n?{id:sectionId,text:text(n),terms:pairs(n),tables:tag(n,'table').map(t=>({caption:text(tag(t,'caption')[0]),rows:tag(t,'tr').map(r=>r.children.filter(c=>typeof c!=='string'&&['th','td'].includes(c.tag)).map(text))}))}:null;}).filter(Boolean);
  return {models,terms:sections};
}

export async function fetchFanasaCatalog({fetchImpl=fetch,baseUrl=ORIGIN,timeoutMs=30000}={}) {
  insist(baseUrl===ORIGIN||baseUrl===ORIGIN+'/','custom source origins are not permitted');
  insist(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=120000,'invalid timeout');
  const sources=[],warnings=[];
  async function get(path){
    const url=officialUrl(path);let target=url;const started=new Date().toISOString();const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try {
      let response;
      for(let redirects=0;redirects<=3;redirects++){
        response=await fetchImpl(target,{signal:controller.signal,redirect:'manual',headers:{accept:'text/html'}});
        if(response.status>=300&&response.status<400){insist(redirects<3,'too many redirects');const loc=response.headers.get('location');insist(loc,'redirect location missing');target=officialUrl(new URL(loc,target).href);continue;}break;
      }
      insist(response.status===200,`${url}: HTTP ${response.status}`);
      if(response.url)insist(new URL(response.url).origin===ORIGIN,`${url}: unsafe response origin`);
      insist((response.headers.get('content-type')||'').includes('text/html'),`${url}: expected HTML`);
      const advertised=Number(response.headers.get('content-length'));insist(!advertised||advertised<=MAX_BYTES,`${url}: oversized source`);
      const chunks=[];let size=0;
      if(response.body?.getReader){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;insist(size<=MAX_BYTES,`${url}: oversized source`);chunks.push(Buffer.from(value));}}catch(e){await reader.cancel().catch(()=>{});throw e;}}
      else {const html=await response.text();const chunk=Buffer.from(html);insist(chunk.length<=MAX_BYTES,`${url}: oversized source`);chunks.push(chunk);}
      const html=Buffer.concat(chunks).toString('utf8');const evidence={url,status:response.status,sha256:hash(html),fetchedAt:started,finalUrl:target,method:'https-ssr'};sources.push(evidence);return {html,evidence};
    }finally{clearTimeout(timer);}
  }
  const [list,pricePage,supportPage]=await Promise.all([get('/fa/products'),get('/fa/pricing'),get('/fa/pricing/support')]);
  const listing=parseCatalogPage(list.html),pricing=parsePricingPage(pricePage.html),support=parseSupportPage(supportPage.html);
  const services=new Array(listing.services.length);let cursor=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<listing.services.length){const index=cursor++;const listed=listing.services[index];const detail=await get(listed.sourceUrl);const service=parseServicePage(detail.html,listed);service.sourceHash=detail.evidence.sha256;service.observedAt=detail.evidence.fetchedAt;service.verificationStatus='http-observed-unverified';services[index]=service;}}));
  for(const profile of support.profiles){const assigned=services.filter(s=>s.tier===profile.code);insist(assigned.length===profile.serviceCount,`${profile.code}: source count mismatch`);for(const s of assigned)insist(s.sla.availabilityPercent===profile.availabilityPercent&&s.sla.response.value===profile.responseValue&&s.sla.response.unit===profile.responseUnit&&s.sla.resolution.value===profile.resolutionValue&&s.sla.resolution.unit===profile.resolutionUnit,`${s.code}: detail/support SLA disagreement`);}
  for(const model of pricing.models)insist(services.filter(s=>s.revenueModel===model.code).length===model.serviceCount,`${model.code}: source count mismatch`);
  const badMetadata=services.filter(s=>s.sourceMetadataUrl&&!s.sourceMetadataUrl.startsWith(ORIGIN+'/')).map(s=>s.code);
  if(badMetadata.length)warnings.push({code:'noncanonical-jsonld-url',message:'JSON-LD contains noncanonical URLs; ignored for navigation and source identity.',serviceCodes:badMetadata});
  warnings.push({code:'display-rounded-prices',message:'Rendered prices may be rounded. headlineAmount is exact only where official JSON-LD supplies it; retain price rows, minimums and terms when calculating a quote.'});
  const observedAt=new Date().toISOString();
  return {catalog:{centers:listing.centers,services,slaProfiles:support.profiles,revenueModels:pricing.models,pricingTerms:pricing.terms,slaRules:support.rules,source:ORIGIN+'/fa/products',observedAt,verificationStatus:'http-observed-unverified',totals:listing.expected},sources:sources.sort((a,b)=>a.url.localeCompare(b.url)),warnings};
}
