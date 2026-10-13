import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAmendmentDraftStore,amendmentPayload} from '../public/amendment-draft.js';
const fields={title:' عنوان ',reason:' علت ',body:'<script>متن پیشنهادی</script>',pricingPlanId:''};
const reference={id:'model',revision:2,basis:'a'.repeat(64)};
const key='01234567-1234-1234-1234-012345678901';
function fixture(){
 const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
 let scope={tenantId:'tenant-one',actorId:'user-one'};
 const create=()=>createAmendmentDraftStore({storage:()=>storage,scope:()=>scope,now:()=> '2026-10-13T09:00:00Z'});
 return {values,storage,create,setScope:value=>scope=value};
}
test('browser amendment work survives a new instance and stays within user, tenant and contract',()=>{
 const f=fixture(),store=f.create();assert.equal(store.save('contract-one',{fields}).ok,true);
 assert.deepEqual(f.create().load('contract-one').draft.fields,fields);
 assert.equal(store.load('contract-two').draft,null);
 f.setScope({tenantId:'tenant-two',actorId:'user-one'});assert.equal(store.load('contract-one').draft,null);
 f.setScope({tenantId:'tenant-one',actorId:'user-two'});assert.equal(store.load('contract-one').draft,null);
 f.setScope({tenantId:'tenant-one',actorId:'user-one'});assert.equal(store.remove('contract-one'),true);assert.equal(f.create().load('contract-one').draft,null);
});
test('exact financial revision and retry content survive reload; mismatched attempts are rejected',()=>{
 const f=fixture(),store=f.create(),financialFields={...fields,pricingPlanId:reference.id},content=JSON.stringify(amendmentPayload(financialFields,reference));
 assert.equal(store.save('c',{fields:financialFields,reference,attempt:{key,content}}).ok,true);
 assert.deepEqual(f.create().load('c').draft.reference,reference);assert.equal(f.create().load('c').draft.attempt.content,content);
 assert.equal(store.save('c',{fields:{...financialFields,body:'متن دیگر'},reference,attempt:{key,content}}).ok,false);
 assert.equal(store.save('c',{fields:financialFields,reference:{...reference,revision:3},attempt:{key,content}}).ok,false);
 assert.equal(store.save('c',{fields:financialFields,reference:null}).ok,false);
});
test('malformed and cross-scope saved data are never restored',()=>{
 const f=fixture(),store=f.create();store.save('c',{fields});const storageKey=[...f.values.keys()][0];
 for(const value of ['{broken',JSON.stringify({version:1}),JSON.stringify({...store.load('c').draft,tenantId:'other'}),JSON.stringify({...store.load('c').draft,fields:{...fields,body:'x'.repeat(20001)}})]){
  f.values.set(storageKey,value);assert.deepEqual(store.load('c'),{draft:null,ok:false});
 }
});
test('unavailable storage reports failure and preserves only in-memory work; removal does not claim success',()=>{
 const store=createAmendmentDraftStore({scope:()=>({tenantId:'t',actorId:'u'}),storage:()=>{throw Error('denied');}});
 const saved=store.save('c',{fields});assert.equal(saved.ok,false);assert.deepEqual(store.load('c').draft.fields,fields);assert.equal(store.load('c').ok,false);assert.equal(store.remove('c'),false);
 const unavailable=createAmendmentDraftStore({scope:()=>({tenantId:'t',actorId:''}),storage:()=>({})});assert.equal(unavailable.save('c',{fields}).ok,false);
});
test('a failed overwrite retains the newer work in memory and keeps its warning when reopening',()=>{
 const f=fixture(),store=f.create();store.save('c',{fields});
 f.storage.setItem=()=>{throw Error('quota');};
 const newer={...fields,body:'متن جدید'};assert.equal(store.save('c',{fields:newer}).ok,false);
 assert.deepEqual(store.load('c').draft.fields,newer);assert.equal(store.load('c').ok,false);
 assert.deepEqual(f.create().load('c').draft.fields,fields);
});
