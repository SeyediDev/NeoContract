import test from 'node:test';
import assert from 'node:assert/strict';
import {builtInParameters,extractContractParameters} from '../public/contract-parameter-model.js';
const extract=(text,definitions=builtInParameters)=>extractContractParameters(text,definitions).candidates;
const numeric=builtInParameters.find(d=>d.key==='unit-price');

test('alternatives, expressions, conditions and malformed groups never suggest the first amount',()=>{
 for(const raw of ['۱۰ یا ۲۰ ریال','10 or 20','۱۰ / ۲۰','۱۰ + ۲۰','۱۰–۲۰','۱۰ تا ۲۰','۱۰ الی ۲۰','۱۰ ریال اگر تأیید شود','۱۰ ریال مشروط به تأیید','10 = 20','۱۲٬۳۴ ریال','1,23 ریال','10 000 ریال','1e999','1e-999','9007199254740993']){
  const [c]=extract('قیمت واحد: '+raw);assert.equal(c.status,'ambiguous',raw);assert.equal(c.value,null,raw);assert.equal(c.quote,'قیمت واحد: '+raw);
 }
});

test('zero, signed custom values, grouping and small decimals preserve their amount',()=>{
 for(const [raw,value] of [['۰ ریال',0],['۱٬۲۳۴٬۵۶۷ ریال',1234567],['1,234.5 ریال',1234.5],['۰٫۰۰۰۰۰۰۱ ریال',0.0000001],['1e-7 ریال',1e-7]]){
  const [c]=extract('قیمت واحد: '+raw);assert.equal(c.status,'needs-review',raw);assert.equal(c.value,value,raw);
 }
 const [negative]=extract('تعدیل: -۲٫۵ واحد',[{...numeric,key:'adjustment',label:'تعدیل',aliases:[],min:-10,unit:'واحد'}]);assert.equal(negative.value,-2.5);
});

test('candidates respect definition bounds and safe integer semantics',()=>{
 for(const text of ['حداکثر کاربران فعال: ۱٫۵','حداکثر کاربران فعال: ۱۰۰۰۰۰۱','قیمت واحد: -۱ ریال','دسترس‌پذیری SLA: ۱۰۱٪'])assert.equal(extract(text)[0].status,'ambiguous',text);
});

test('all semicolon separated occurrences participate in conflict detection',()=>{
 const text='حداکثر کاربران فعال: ۱۰؛ حداکثر کاربران فعال: ۲۰';const rows=extract(text);assert.equal(rows.length,2);assert.ok(rows.every(c=>c.status==='ambiguous'&&c.line===1&&c.quote===text));
 const mixed=extract('قیمت واحد: ۱۰ ریال\nقیمت واحد: ۱۰ یا ۲۰ ریال');assert.ok(mixed.every(c=>c.status==='ambiguous'));
 const same=extract('قیمت واحد: ۱۰ ریال; قیمت واحد: 10 ریال');assert.equal(same.length,2);assert.ok(same.every(c=>c.status==='needs-review'));
});

test('aliases match whole names and archived definitions never extract',()=>{
 assert.deepEqual(extract('not-seats: 10\nmyseats: 10\nظرفیتseats: 10'),[]);
 assert.equal(extract('seats: ۱۰')[0].value,10);
 assert.deepEqual(extract('قیمت واحد: ۱۰',[{...numeric,archived:true}]),[]);
});

test('literal text and list identifiers retain Persian digits and grouping symbols',()=>{
 assert.equal(extract('محل نگهداری داده: منطقه۱')[0].value,'منطقه۱');
 assert.deepEqual(extract('امکانات مجاز: سرویس۱، سرویس۲')[0].value,['سرویس۱','سرویس۲']);
 assert.equal(extract('شرط اختصاصی: شناسه ۱٬۲۳۴')[0].value,'شناسه ۱٬۲۳۴');
 assert.equal(extract('تمدید خودکار: خیر')[0].value,false);
 assert.equal(extract('روز اجرا: ۲۰۲۶-۱۰-۲۳',[{...numeric,type:'date',key:'execution-day',label:'روز اجرا',aliases:[]}])[0].value,'2026-10-23');
});

test('extraction remains advisory and does not mutate definitions',()=>{
 const definitions=structuredClone(builtInParameters),before=structuredClone(definitions);const result=extractContractParameters('قیمت واحد: ۱۰ یا ۲۰ ریال',definitions);assert.equal(result.automaticPublication,false);assert.deepEqual(definitions,before);
});
