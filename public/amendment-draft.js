// Browser work is scoped to the authenticated application user, tenant and contract.
// Only the API can register an amendment or validate a pinned financial reference.
const string=(value,max)=>typeof value==='string'&&value.length<=max;
const referenceValid=r=>r===null||(r&&string(r.id,120)&&r.id.length>0&&Number.isSafeInteger(r.revision)&&r.revision>0&&typeof r.basis==='string'&&/^[a-f0-9]{64}$/.test(r.basis));
export function amendmentPayload(fields,reference){
 const payload={title:fields.title.trim(),reason:fields.reason.trim(),body:fields.body.trim()};
 if(fields.pricingPlanId&&reference?.id===fields.pricingPlanId)Object.assign(payload,{pricingPlanId:reference.id,pricingPlanRevision:reference.revision,expectedPricingBasis:reference.basis});
 return payload;
}
export function validAmendmentDraft(value,scope,contractId){
 if(!value||value.version!==1||value.tenantId!==scope.tenantId||value.actorId!==scope.actorId||value.contractId!==contractId||!string(value.savedAt,40)||!Number.isFinite(Date.parse(value.savedAt)))return false;
 const f=value.fields;
 if(!f||!string(f.title,200)||!string(f.reason,500)||!string(f.body,20000)||!string(f.pricingPlanId,120)||!referenceValid(value.reference))return false;
 if(f.pricingPlanId?(value.reference?.id!==f.pricingPlanId):value.reference!==null)return false;
 if(value.attempt!==null){
  if(!value.attempt||typeof value.attempt.key!=='string'||!/^[a-f0-9-]{36}$/i.test(value.attempt.key)||value.attempt.content!==JSON.stringify(amendmentPayload(f,value.reference)))return false;
 }
 return true;
}
export function createAmendmentDraftStore({storage,scope,now=()=>new Date().toISOString()}){
 const memory=new Map();
 const context=contractId=>{
  const s=scope();
  if(!s?.tenantId||!s?.actorId||!contractId)throw new Error('Draft scope unavailable');
  return {s,key:'neocontract-amendment-draft:'+JSON.stringify([s.tenantId,s.actorId,contractId])};
 };
 return {
  load(contractId){
   try{
    const {s,key}=context(contractId),pending=memory.get(key);let raw;
    if(pending?.persisted===false)return {draft:pending.draft,ok:false};
    try{raw=storage().getItem(key);}catch{return {draft:pending?.draft||null,ok:false};}
    if(raw===null)return {draft:null,ok:true};
    const value=JSON.parse(raw);if(!validAmendmentDraft(value,s,contractId))return {draft:null,ok:false};
    memory.set(key,{draft:value,persisted:true});return {draft:value,ok:true};
   }catch{return {draft:null,ok:false};}
  },
  save(contractId,{fields,reference=null,attempt=null}){
   try{
    const {s,key}=context(contractId);
    const value={version:1,...s,contractId,savedAt:now(),fields:{...fields},reference:reference?{...reference}:null,attempt:attempt?{...attempt}:null};
    if(!validAmendmentDraft(value,s,contractId))return {ok:false,draft:null};
    memory.set(key,{draft:value,persisted:false});
    try{storage().setItem(key,JSON.stringify(value));memory.set(key,{draft:value,persisted:true});return {ok:true,draft:value};}catch{return {ok:false,draft:value};}
   }catch{return {ok:false,draft:null};}
  },
  remove(contractId){
   try{const {key}=context(contractId);storage().removeItem(key);memory.delete(key);return true;}catch{return false;}
  }
 };
}
