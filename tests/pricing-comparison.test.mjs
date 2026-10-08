import test from 'node:test';
import assert from 'node:assert/strict';
import {comparePricing} from '../public/pricing-comparison.js';
import {PricingError} from '../public/pricing.js';

const fixture=()=>({name:'مدل',bases:[{id:'compute',name:'پردازش',unit:'هسته‌ساعت',amount:1000,source:'استعلام اول'},{id:'storage',name:'ذخیره‌سازی',unit:'گیگابایت‌ماه',amount:200}],items:[{id:'a',title:'بسته اول',quantity:2,components:[{baseId:'compute',coefficient:3},{baseId:'storage',coefficient:5}]},{id:'b',title:'بسته دوم',quantity:4,components:[{baseId:'compute',coefficient:1}]}]});

test('shared rate change identifies all affected items using recalculated totals without mutating inputs',()=>{
 const before=fixture(),after=fixture();after.bases[0].amount=2000;after.total=1;after.items[0].amount=1;
 const original=structuredClone({before,after}),diff=comparePricing(before,after);
 assert.equal(diff.beforeTotal,12000);assert.equal(diff.afterTotal,22000);assert.equal(diff.delta,10000);
 assert.deepEqual(diff.bases.map(r=>r.id),['compute']);assert.deepEqual(diff.items.map(r=>r.delta),[6000,4000]);
 assert.deepEqual({before,after},original);
});

test('stable IDs distinguish additions, removals and offsetting changes even when totals match',()=>{
 const before=fixture(),after=fixture();after.items[0].id='new-item';after.items[1].title='عنوان تازه';
 const diff=comparePricing(before,after);assert.equal(diff.delta,0);
 assert.deepEqual(diff.items.map(r=>[r.id,r.status,r.delta]),[['new-item','added',8000],['b','changed',0],['a','removed',-8000]]);
 assert.deepEqual(diff.items[1].changedFields,['title']);
});

test('base unit/source and model name changes remain visible with no monetary change',()=>{
 const before=fixture(),after=fixture();after.name='نام تازه';after.bases[0].unit='واحد تازه';after.bases[0].source='استعلام تازه';
 const diff=comparePricing(before,after);assert.equal(diff.nameChanged,true);assert.equal(diff.delta,0);
 assert.deepEqual(diff.bases[0].changedFields,['unit','source']);assert.deepEqual(diff.items,[]);
});

test('input array order and equivalent Persian numbers cannot fabricate a price change',()=>{
 const before=fixture(),after=fixture();after.bases.reverse();after.items.reverse();after.items[1].components.reverse();after.items[0].quantity='۴';after.bases[1].amount='۱٬۰۰۰';
 const diff=comparePricing(before,after);assert.equal(diff.delta,0);assert.deepEqual(diff.items,[]);assert.deepEqual(diff.bases,[]);
});

test('component dependency and quantity changes are detected independently of rounded totals',()=>{
 const before=fixture(),after=fixture();before.items=[{id:'a',title:'جزئی',quantity:'0.000001',components:[{baseId:'compute',coefficient:1}]}];after.items=structuredClone(before.items);after.items[0].quantity='0.000002';after.items[0].components[0].baseId='storage';
 const diff=comparePricing(before,after);assert.equal(diff.delta,0);assert.equal(diff.items.length,1);
 assert.ok(diff.items[0].changedFields.includes('components'));assert.ok(diff.items[0].changedFields.includes('quantity'));
});

test('zero totals, added/removed unused rates and large safe integer decreases compare exactly',()=>{
 const before=fixture(),after=fixture();before.bases.forEach(b=>b.amount=0);after.bases.forEach(b=>b.amount=0);after.bases.push({id:'unused',name:'آزمایشی',unit:'واحد',amount:123});
 assert.equal(comparePricing(before,after).delta,0);assert.equal(comparePricing(before,after).bases[0].status,'added');
 assert.equal(comparePricing(after,before).bases[0].delta,-123);
 const high={name:'مدل',bases:[{id:'x',name:'نرخ',unit:'واحد',amount:Number.MAX_SAFE_INTEGER}],items:[{id:'x',title:'آیتم',quantity:1,components:[{baseId:'x',coefficient:1}]}]};
 const low=structuredClone(high);low.bases[0].amount=0;
 assert.equal(comparePricing(high,low).delta,-Number.MAX_SAFE_INTEGER);
});

test('invalid current or historical models never produce a misleading comparison',()=>{
 const bad=fixture();bad.items[0].quantity='';assert.throws(()=>comparePricing(fixture(),bad),PricingError);
 assert.throws(()=>comparePricing(bad,fixture()),PricingError);
});
