import {createRequire} from 'node:module';
import {AppError} from './domain.mjs';
const require=createRequire(import.meta.url);
const {loadSchema,validateSchema}=require('./contract-policy-schema/sample/schema-validator.cjs');
const schema=loadSchema('projection-event.v2.schema.json');
const insist=(v,msg)=>{if(!v)throw new AppError(msg,409,'gateway_binding_invalid');};
// This adapter is called by trusted integration code, never with a browser binding.
// Central registration, policy and allocation revisions remain central authority.
export function serviceLimitProjection(event,binding){
 insist(event?.eventType==='contract.service-limits.signed'&&event.schemaVersion==='1.0.0','رویداد محدودیت پشتیبانی نمی‌شود.');
 insist(binding?.localTenantId===event.localTenantId&&binding.contractId===event.contractId&&binding.serviceKey===event.terms.serviceKey,'نگاشت مرکزی با قرارداد / تننت / سرویس تطابق ندارد.');
 insist(typeof binding.registryReference==='string'&&binding.registryReference.length>0,'مرجع ثبت مرکزی لازم است.');
 const p=structuredClone(binding.projection),t=event.terms;
 insist(p?.schemaVersion==='2.0.0'&&p.productId===t.productKey&&p.limits?.scope?.environments?.includes(t.environment)&&p.limits?.scope?.operationGroups?.includes(t.operationGroup),'محدوده محصول یا محیط در نگاشت معتبر نیست.');
 const configRevision=binding.allocationRevisions?.[event.eventId];
 insist(Number.isSafeInteger(configRevision)&&configRevision>0,'نسخه مستقل تخصیص باید از مرجع مرکزی برای این رویداد دریافت شود.');
 insist(p.limits.scope.consumerTenantId===p.consumerTenantId&&p.limits.scope.productIds.includes(p.productId),'محدوده تخصیص ناسازگار است.');
 const list=k=>{const a=p.limits.scope[k];insist(Array.isArray(a)&&new Set(a).size===a.length,'محدوده تخصیص تکراری یا نامعتبر است.');return [...a].sort().join(',');};
 const canonical=`tenant=${p.consumerTenantId};products=${list('productIds')};environments=${list('environments')};groups=${list('operationGroups')}`;
 insist(canonical===p.limits.canonicalScope,'محدوده تخصیص باید canonical و ثابت باشد.');
 p.contractVersion=event.aggregateVersion;p.status='Active';p.effectiveAt=t.effectiveAt;
 p.validFrom=t.validFrom>p.validFrom?t.validFrom:p.validFrom;p.validTo=t.validTo<p.validTo?t.validTo:p.validTo;
 insist(p.validFrom<p.validTo&&p.effectiveAt<p.validTo,'بازه قرارداد با عرضه مرکزی اشتراک ندارد.');
 const ceiling=binding.hardCeilings;
 for(const [name,value] of Object.entries(ceiling||{}))insist(['requestsPerSecond','burstCapacity','monthlyRequests'].includes(name)&&Number.isFinite(value)&&value>=0,'سقف سخت مرکزی نامعتبر است.');
 const cap=(name,value)=>ceiling?.[name]===undefined?value:Math.min(value,ceiling[name]);
 p.limits.rate={algorithm:'token-bucket',requestsPerSecond:cap('requestsPerSecond',t.requestsPerSecond),burstCapacity:cap('burstCapacity',t.burstCapacity)};
 p.limits.quota={algorithm:'fixed-calendar-utc',period:'month',requests:cap('monthlyRequests',t.monthlyRequests)};p.limits.configRevision=configRevision;
 const projected={schemaVersion:'2.0.0',eventId:event.eventId,producer:'fanasa-contracts',aggregateVersion:p.contractVersion,occurredAt:event.occurredAt,correlationId:event.correlationId,projection:p};
 insist(validateSchema(schema,projected).length===0,'رویداد با schema نسخه ۲ مالک سیاست سازگار نیست.');return projected;
}
