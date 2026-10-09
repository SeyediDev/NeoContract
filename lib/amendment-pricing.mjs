import {createHash} from 'node:crypto';
import {AppError,requireValue} from './domain.mjs';
import {calculatePricing,PricingError} from '../public/pricing.js';
import {comparePricing} from '../public/pricing-comparison.js';

function quote(model){try{return calculatePricing(model);}catch(error){if(error instanceof PricingError)throw new AppError(error.message,400,'pricing_validation');throw error;}}
export function amendmentPricingBasis(row,proposalDoc){
 const snap=row.template_snapshot||{},proposal=proposalDoc?.metadata||snap.intake?.proposalPricing;
 const pricing=proposal?.pricing?quote(proposal.pricing):snap.pricing?quote(snap.pricing):null;
 const kind=proposal?.pricing?'proposal':pricing?'contract_pricing':row.total_value!=null?'contract_amount':'unknown';
 const amount=pricing?.total??(row.total_value==null?null:Number(row.total_value));
 const value={kind,amount,pricing,documentId:proposalDoc?.id||null};
 return {...value,token:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}
export function amendmentPricingReference(input){
 requireValue(input&&typeof input==='object'&&!Array.isArray(input),'اطلاعات پیوست مالی معتبر نیست.');
 if(input.pricingPlanId===undefined&&input.pricingPlanRevision===undefined)return null;
 requireValue(typeof input.pricingPlanId==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(input.pricingPlanId),'شناسه مدل قیمت‌گذاری معتبر نیست.');
 requireValue(Number.isSafeInteger(input.pricingPlanRevision)&&input.pricingPlanRevision>0,'نسخه مدل قیمت‌گذاری معتبر نیست.');
 requireValue(typeof input.expectedPricingBasis==='string'&&/^[a-f0-9]{64}$/.test(input.expectedPricingBasis),'مبنای مالی پرونده را دوباره دریافت کنید.',409);
 return {id:input.pricingPlanId.toLowerCase(),revision:input.pricingPlanRevision};
}
export async function amendmentFinancial(tx,tenantId,row,reference,expectedBasis){
 const proposal=(await tx.query("SELECT id,metadata FROM contracts.contract_documents WHERE tenant_id=$1 AND contract_id=$2 AND document_type='proposal_revision' ORDER BY version_no DESC,uploaded_at DESC LIMIT 1",[tenantId,row.id])).rows[0];
 const basis=amendmentPricingBasis(row,proposal);
 requireValue(expectedBasis===basis.token,'مبنای مالی پرونده تغییر کرده است؛ آخرین جزئیات را بازبینی کنید.',409);
 requireValue(basis.amount===null||Number.isSafeInteger(basis.amount),'مبلغ مبنا برای مقایسه دقیق ریالی معتبر نیست.',409);
 // Versions are immutable. Reading one needs no plan lock, so a price update
 // holding the plan lock and waiting for the contract cannot deadlock this draft.
 const version=(await tx.query('SELECT model FROM contracts.pricing_plan_versions WHERE tenant_id=$1 AND plan_id=$2 AND revision=$3',[tenantId,reference.id,reference.revision])).rows[0];
 requireValue(version,'نسخه مدل قیمت‌گذاری در این فضای کاری یافت نشد.',404);
 const after=quote(version.model);
 const comparison=basis.pricing?comparePricing(basis.pricing,after):basis.amount===null?null:{beforeTotal:basis.amount,afterTotal:after.total,delta:after.total-basis.amount,bases:[],items:[]};
 return {sourcePlan:reference,basis,after,comparison};
}
