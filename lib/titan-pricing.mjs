import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {TITAN_TENANT_ID} from './database.mjs';
import {AppError} from './domain.mjs';
import {calculatePricing, PricingError} from '../public/pricing.js';
import {titanProposal} from '../public/titan-pricing.js';

const json=JSON.stringify,hash=s=>createHash('sha256').update(s).digest('hex');
const stableId=key=>{const h=hash('neocontract:titan-pricing:v1:'+key);return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;};
let manifest;
async function sources(){return manifest??=JSON.parse(await readFile(new URL('../planning/titan-revisions-v2.json',import.meta.url),'utf8'));}
export async function titanPricingSource(intakeId){return (await sources()).rows.find(r=>r.id===intakeId);}

export function titanPricingModel(source){
  const fixed=source.id!=='titan-04';
  if(fixed){
    const total=source.quotedAmountIRR,hours={'titan-01':160,'titan-02':240,'titan-03':160,'titan-05':120}[source.id];
    const note='تفکیک پیشنهاد مذاکره نسخه ۲؛ مبلغ توافق‌شده نیست. '+source.sourceWordName;
    return calculatePricing({name:source.title+' — مدل پویا',currency:'IRR',bases:[
      {id:'implementation',name:'طراحی و استقرار',unit:'بسته مصوب',amount:total*0.4,source:note},
      {id:'knowledge',name:'انتقال دانش و آموزش',unit:'ساعت تدریس و کارگاه',amount:total*0.2/hours,source:note+'؛ ساعت دوره، بدون ضرب در تعداد فراگیران'},
      {id:'configuration',name:'پیکربندی و ابزار اختصاصی',unit:'بسته مصوب',amount:total*0.25,source:note},
      {id:'support',name:'همراهی و پشتیبانی',unit:'ماه پشتیبانی غیرمقیم',amount:total*0.15/12,source:note}
    ],items:[
      {id:'design',title:'طراحی و تثبیت خط مبنا',quantity:1,components:[{baseId:'implementation',coefficient:0.3}]},
      {id:'deployment',title:'استقرار و تحویل بسته',quantity:1,components:[{baseId:'implementation',coefficient:0.7}]},
      {id:'training',title:'انتقال دانش فنی و آموزش',quantity:hours,components:[{baseId:'knowledge',coefficient:1}]},
      {id:'configuration',title:'پیکربندی و ابزار اختصاصی',quantity:1,components:[{baseId:'configuration',coefficient:1}]},
      {id:'support',title:'همراهی و پشتیبانی',quantity:12,components:[{baseId:'support',coefficient:1}]}
    ]});
  }
  const note='نرخ تاریخی پیشنهاد ۳۰ سپتامبر ۲۰۲۶؛ ایران Basic؛ بدون مالیات. https://www.arvancloud.ir/fa/pricing/cloud-server ؛ استعلام جدید نیست.';
  const rates=[['cpu','پردازنده Basic','vCore‌ماه',2100000,4],['ram','حافظه Basic','گیگابایت RAM‌ماه',1635000,16],['ssd','دیسک SSD','گیگابایت‌ماه',150000,200],['ipv4','نشانی IPv4 نخست','نشانی‌ماه',1950000,1],['backup','بکاپ','گیگابایت‌ماه',144000,200],['ingress','ترافیک دریافت مازاد','گیگابایت مازاد',18000,774]];
  return calculatePricing({name:'زودکس — مصرف ابر عمومی',currency:'IRR',bases:rates.map(([id,name,unit,amount])=>({id,name,unit,amount,source:note})),items:rates.map(([id,title,,,quantity])=>({id,title,quantity,components:[{baseId:id,coefficient:1}]}))});
}

export async function pricingLinks(tx,tenantId,planId){
  return (await tx.query(`SELECT c.id,c.contract_no AS number,c.title,c.status,c.metadata->>'intakeId' AS "intakeId",
    (c.status IN ('draft','in_process') AND NOT EXISTS(SELECT 1 FROM contracts.contract_process_steps s JOIN contracts.contract_processes p ON p.tenant_id=s.tenant_id AND p.id=s.process_id WHERE p.tenant_id=c.tenant_id AND p.contract_id=c.id AND s.status='completed')) AS editable
    FROM contracts.contracts c WHERE c.tenant_id=$1 AND c.metadata->>'dynamicPricingPlanId'=$2 ORDER BY c.id`,[tenantId,planId])).rows;
}

export async function syncTitanPricing(tx,tenantId,planId,model,revision,actor){
  if(tenantId!==TITAN_TENANT_ID)return [];
  // Use the same contract lock as workflow advancement, then re-read eligibility.
  await tx.query("SELECT id FROM contracts.contracts WHERE tenant_id=$1 AND metadata->>'dynamicPricingPlanId'=$2 ORDER BY id FOR UPDATE",[tenantId,planId]);
  const links=await pricingLinks(tx,tenantId,planId);
  for(const link of links){
    if(!link.editable)continue;
    const source=await titanPricingSource(link.intakeId);
    if(!source)throw new AppError('منبع پیشنهاد متصل یافت نشد.',409);
    let q;try{q=titanProposal(source,model);}catch(e){if(e instanceof PricingError)throw new AppError(e.message,400,'pricing_validation');throw e;}
    const previous=(await tx.query("SELECT COALESCE(MAX(version_no),2)::int AS n FROM contracts.contract_documents WHERE tenant_id=$1 AND contract_id=$2",[tenantId,link.id])).rows[0].n;
    const version=previous+1,pricing={...q.pricing,sourcePlan:{id:planId,revision}};
    const metadata={revisionNumber:version,status:'proposal-not-approved',title:source.title,priceSummary:q.priceSummary,pricingType:source.pricingType,quotedAmountIRR:q.usage?null:q.pricing.total,exampleMonthlyIRR:q.usage?q.pricing.total:null,sourceWordName:source.sourceWordName,sourceWordSha256:source.sourceWordSha256,pricing,body:q.body};
    await tx.query('INSERT INTO contracts.contract_documents(tenant_id,contract_id,document_type,file_name,storage_key,mime_type,byte_size,sha256,version_no,metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[tenantId,link.id,'proposal_revision',`${link.number}-v${version}.md`,`database:${link.id}:proposal:${version}`,'text/markdown; charset=utf-8',Buffer.byteLength(q.body),hash(q.body),version,json(metadata)]);
    await tx.query("INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,actor_label,payload) VALUES($1,$2,'dynamic_pricing_proposal_saved',$3,$4)",[tenantId,link.id,actor,json({revisionNumber:version,pricingPlanId:planId,pricingPlanRevision:revision,proposedTotal:q.pricing.total,message:'پیشنهاد قیمت و اقساط از مدل پویا محاسبه شد؛ نسخه‌های قبلی محفوظ‌اند.'})]);
  }
  return links;
}

/** One atomic, repeatable upgrade of the five demo proposals; existing plan edits survive restarts. */
export async function provisionTitanPricing(db){
  return db.transaction(async tx=>{
    await tx.query('SELECT id FROM contracts.tenants WHERE id=$1 FOR UPDATE',[TITAN_TENANT_ID]);
    const done=(await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='titan-pricing-v1'",[TITAN_TENANT_ID])).rows[0];
    if(done)return done.value;
    const board=(await tx.query("SELECT value FROM contracts.app_settings WHERE tenant_id=$1 AND key='titan-board-v2'",[TITAN_TENANT_ID])).rows[0]?.value;
    if(!board)throw new Error('Titan revisions must be provisioned before pricing.');
    const rows=[];
    for(const source of (await sources()).rows){
      const link=board.rows.find(r=>r.id===source.id),planId=stableId(source.id),model=titanPricingModel(source);
      if(!link?.contractId)throw new Error('Missing Titan proposal '+source.id);
      await tx.query('INSERT INTO contracts.pricing_plans(id,tenant_id,name,model,total) VALUES($1,$2,$3,$4,$5)',[planId,TITAN_TENANT_ID,model.name,json(model),model.total]);
      await tx.query('INSERT INTO contracts.pricing_plan_versions(tenant_id,plan_id,revision,model,actor) VALUES($1,$2,1,$3,$4)',[TITAN_TENANT_ID,planId,json(model),'تجهیز پنج پیشنهاد دمو به قیمت‌گذاری پویا']);
      await tx.query('UPDATE contracts.contracts SET metadata=metadata || $3::jsonb WHERE tenant_id=$1 AND id=$2',[TITAN_TENANT_ID,link.contractId,json({dynamicPricingPlanId:planId})]);
      await syncTitanPricing(tx,TITAN_TENANT_ID,planId,model,1,'تجهیز پنج پیشنهاد دمو به قیمت‌گذاری پویا');
      rows.push({intakeId:source.id,contractId:link.contractId,planId});
    }
    const value={version:1,rows};
    await tx.query("INSERT INTO contracts.app_settings(tenant_id,key,value) VALUES($1,'titan-pricing-v1',$2)",[TITAN_TENANT_ID,json(value)]);
    return value;
  });
}
