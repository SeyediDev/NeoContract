import {calculatePricing} from './pricing.js';

const componentKey = item => JSON.stringify([...item.components].sort((a,b)=>a.baseId.localeCompare(b.baseId)));
function compareRows(before,after,fields){
 const previous=new Map(before.map(row=>[row.id,row]));
 const current=new Map(after.map(row=>[row.id,row]));
 return [...after,...before.filter(row=>!current.has(row.id))].map(row=>{
  const a=previous.get(row.id),b=current.get(row.id);
  const changedFields=a&&b?fields.filter(field=>field==='components'?componentKey(a)!==componentKey(b):a[field]!==b[field]):[];
  return {id:row.id,before:a||null,after:b||null,delta:(b?.amount||0)-(a?.amount||0),
   status:!a?'added':!b?'removed':changedFields.length?'changed':'unchanged',changedFields};
 });
}

/** Compare normalized, recalculated quotes by stable IDs. Stored/client totals
 * and array order cannot change the result. Neither input is modified.
 */
export function comparePricing(before,after){
 const a=calculatePricing(before),b=calculatePricing(after);
 const bases=compareRows(a.bases,b.bases,['name','unit','amount','source']);
 const items=compareRows(a.items,b.items,['title','quantity','serviceCode','components','unitPrice','amount']);
 return {beforeTotal:a.total,afterTotal:b.total,delta:b.total-a.total,nameChanged:a.name!==b.name,
  bases:bases.filter(row=>row.status!=='unchanged'),items:items.filter(row=>row.status!=='unchanged')};
}
