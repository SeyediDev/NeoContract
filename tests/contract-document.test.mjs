import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {documentHtml} from '../lib/domain.mjs';
import {calculatePricing} from '../public/pricing.js';
import {createDatabase,TITAN_TENANT_ID,DEMO_TENANT_ID} from '../lib/database.mjs';
import {createStore} from '../lib/store.mjs';
import {createApi} from '../lib/http-api.mjs';
const model=amount=>({name:'نرخ ثابت نسخه',bases:[{id:'base',name:'واحد',unit:'عدد',amount,source:'استعلام نمونه'}],items:[{id:'one',title:'خدمت',quantity:10,components:[{baseId:'base',coefficient:1}]}]});
const malicious='<script>bad()</script><img src=x onerror=bad()> &';
test('export separates original/proposal, preserves source text and embeds official assets',()=>{
 const c={number:'NC-TEST',title:malicious,customerName:malicious,document:'پیشنهاد تازه '+malicious,originalDocument:'متن اولیه '+malicious,proposalRevision:{revisionNumber:3},snapshot:{services:[{centerId:'rayan'}]},amendments:[]};
 const html=documentHtml(c);assert.match(html,/data-export-original/);assert.match(html,/data-export-proposal/);assert.match(html,/متن اولیه/);assert.match(html,/آخرین پیشنهاد ثبت‌شده/);assert.ok(!html.includes('<script>bad()'));assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);assert.equal((html.match(/data:font\/woff2;base64,/g)||[]).length,3);assert.ok(!html.includes('url(./'));assert.match(html,/aria-label="فن‌آسا"/);assert.match(html,/مراکز خدمات قرارداد/);assert.equal(c.document,'پیشنهاد تازه '+malicious);
});
test('standalone amendment contains frozen pricing, statuses and review audit without receipts',()=>{
 const after=calculatePricing(model(200)),before=calculatePricing(model(100)),a={id:'amendment',number:1,title:malicious,body:malicious,reason:malicious,createdAt:'2026-10-09T12:00:00Z',status:'approved',actor:{name:malicious},financial:{sourcePlan:{name:malicious,revision:1},basis:{kind:'contract_pricing',amount:1000,pricing:before},after,comparison:{delta:1000}},workflow:{stage:null,decisions:[{action:'approve',stage:'legal',at:'2026-10-09T12:00:00Z',comment:malicious,actor:{name:malicious},key:'PRIVATE_RECEIPT',hash:'PRIVATE_HASH'}]}};
 const c={number:'NC-TEST',title:'قرارداد',document:'ORIGINAL_SENTINEL',amendments:[a]};
 const html=documentHtml(c,{amendment:a});assert.ok(!html.includes('ORIGINAL_SENTINEL'));assert.match(html,/تأیید داخلی/);assert.match(html,/پیوست مالی ثابت/);assert.match(html,/۲٬۰۰۰ ریال/);assert.match(html,/۱٬۰۰۰ ریال/);assert.match(html,/استعلام نمونه/);assert.match(html,/سابقه بررسی داخلی/);assert.ok(!html.includes('PRIVATE_RECEIPT'));assert.ok(!html.includes('PRIVATE_HASH'));assert.ok(!html.includes('<script>bad()'));
 for(const [status,label] of [['draft','پیش‌نویس'],['in_review','در بررسی داخلی'],['rejected','ردشده'],['cancelled','لغوشده']])assert.ok(documentHtml(c,{amendment:{...a,status}}).includes(label));
 const unknown=documentHtml(c,{amendment:{...a,financial:{...a.financial,basis:{kind:'unknown',amount:null},comparison:null}}});assert.match(unknown,/مبنای مالی ثبت نشده/);assert.match(unknown,/قابل محاسبه نیست/);
 const plain=documentHtml(c,{amendment:{...a,financial:null,workflow:null}});assert.ok(!plain.includes('data-export-financial'));assert.match(plain,/تصمیمی در سابقه بررسی ثبت نشده/);
});
async function get(api,url,subject='demo-viewer'){
 let status,body,headers;await api.handler({url,method:'GET',headers:{host:'localhost','x-auth-request-sub':subject},socket:{remoteAddress:'127.0.0.1'}},{writeHead(s,h){status=s;headers=h;},end(b){body=b;}});return {status,body,headers};
}
test('read-only amendment export uses saved revisions, tenant boundary and viewer membership',{timeout:240000},async t=>{
 const prev=process.env.NEOCONTRACT_TRUST_PROXY_AUTH;process.env.NEOCONTRACT_TRUST_PROXY_AUTH='true';
 const db=await createDatabase({dataDir:'memory://'}),store=createStore(db,TITAN_TENANT_ID),api=await createApi({database:db,authMode:'oidc-proxy'});
 try{
  await db.query("UPDATE contracts.app_users SET status='active' WHERE tenant_id=$1",[TITAN_TENANT_ID]);
  const data=await store.bootstrap(),template=data.templates.find(x=>x.currentPublishedVersion),c=await store.createContract({templateId:template.id,customerId:data.customers[0].id,title:'سند الحاقیه',owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]});
  const p=await store.pricing.save({model:model(200)});let saved=await store.amend(c.id,{title:'پیوست ثابت',reason:'بازبینی',body:malicious,pricingPlanId:p.id,pricingPlanRevision:1,expectedPricingBasis:c.amendmentPricingBasis.token});const a=saved.amendments[0],path=`/api/contracts/${c.id}/amendments/${a.id}/document`;
  await t.test('viewer can download printable HTML and package contains attachment with unchanged snapshot',async()=>{
   const doc=await get(api,path);assert.equal(doc.status,200);assert.match(doc.headers['Content-Type'],/text\/html/);assert.equal(doc.headers['Cache-Control'],'no-store');assert.equal(doc.headers['Content-Disposition'],`inline; filename="${c.number}-amendment-1.html"`);assert.match(doc.body,/پیش‌نویس/);assert.match(doc.body,/۲٬۰۰۰ ریال/);assert.ok(!doc.body.includes('<script>bad()'));
   const pkg=await get(api,`/api/contracts/${c.id}/document`);assert.equal(pkg.status,200);assert.match(pkg.body,/data-export-original/);assert.match(pkg.body,/data-export-financial/);assert.deepEqual(await store.contract(c.id),saved);
   assert.equal((await get(api,path.replace(a.id,a.id.toUpperCase()))).status,200);
  });
  await t.test('editing a pricing plan cannot change captured amendment export',async()=>{
   const before=(await get(api,path)).body;await store.pricing.save({model:model(300),revision:1},p.id);assert.equal((await get(api,path)).body,before);
  });
  await t.test('latest review status/history appears while fixed text and totals remain',async()=>{
   saved=await store.reviewAmendment(c.id,a.id,{action:'submit',expectedStatus:'draft',expectedRevision:0,idempotencyKey:randomUUID(),comment:'برای حقوقی'});
   const doc=await get(api,path);assert.match(doc.body,/در بررسی داخلی/);assert.match(doc.body,/بررسی حقوقی/);assert.match(doc.body,/برای حقوقی/);assert.match(doc.body,/۲٬۰۰۰ ریال/);assert.deepEqual(await store.contract(c.id),saved);
  });
  await t.test('foreign records, unknown IDs, invalid suffix and disabled users cannot export',async()=>{
   const foreign=createStore(db,DEMO_TENANT_ID),fd=await foreign.bootstrap(),fc=await foreign.createContract({templateId:fd.templates.find(x=>x.currentPublishedVersion).id,customerId:fd.customers[0].id,title:'دیگر',owner:'آزمون',amount:100,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]});const fa=(await foreign.amend(fc.id,{title:'دیگر',reason:'دیگر',body:'دیگر'})).amendments[0];
   for(const url of [`/api/contracts/${fc.id}/amendments/${fa.id}/document`,path.replace(a.id,fa.id),path.replace(a.id,randomUUID()),path+'/extra'])assert.equal((await get(api,url)).status,404);
   await db.query("UPDATE contracts.app_users SET status='disabled' WHERE tenant_id=$1 AND subject='demo-viewer'",[TITAN_TENANT_ID]);assert.equal((await get(api,path)).status,403);assert.deepEqual(await store.contract(c.id),saved);
  });
 }finally{await api.close();if(prev===undefined)delete process.env.NEOCONTRACT_TRUST_PROXY_AUTH;else process.env.NEOCONTRACT_TRUST_PROXY_AUTH=prev;}
});