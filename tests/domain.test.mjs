import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, prepareContract, validateTemplate } from '../lib/domain.mjs';

const template={id:'template',templateVersionId:'version',title:'الگوی آزمون',category:'آزمون',status:'published',body:'قرارداد {{title}}',stages:[{id:'legal',name:'بررسی حقوقی',role:'legal',slaDays:1,required:true,enabled:true}]};
const context={templates:[template],customers:[{id:'customer',name:'مشتری آزمون',status:'active',managerId:'manager',unit:'واحد آزمون'}],managers:[{id:'manager',name:'مدیر آزمون',status:'active'}],catalog:{services:[],slaProfiles:[],revenueModels:[],source:'fixture'}};
const input={templateId:'template',templateVersionId:'version',customerId:'customer',title:'عنوان آزمون',party:'طرف آزمون',amount:0,start:'2026-10-01',end:'2027-09-30',owner:'مالک آزمون',paymentTerms:'پرداخت ماهانه',services:[]};
const isValidationError=error=>error instanceof AppError && error.status===400;

const invalidBodies=[
 '{{unknown}}','{{taxRate}}','{{constructor}}','{{toString}}','{{hasOwnProperty}}','{{__proto__}}',
 '{{amount2}}','{{contract_number}}','{{title.name}}','{{}}','{{ title','title }}','{{title}',
 '{title}}','{{{title}}}','{{title}}}','{{title} }}','{{title {{party}}}}',
 '{{ti\ntle}}','{{\ntitle}}','{{title\r\n}}','{{title\u2028}}','{{title\u2029}}',
];

test('template saving and both preview body sources reject unknown or malformed placeholders',()=>{
 for(const body of invalidBodies){
  assert.throws(()=>validateTemplate({...template,body}),isValidationError,`template ${JSON.stringify(body)}`);
  assert.throws(()=>prepareContract({...input,body},context),isValidationError,`custom body ${JSON.stringify(body)}`);
  assert.throws(()=>prepareContract(input,{...context,templates:[{...template,body}]}),isValidationError,`selected template ${JSON.stringify(body)}`);
 }
});

test('supported placeholders preserve spaces and tabs and resolve repeated and adjacent tokens',()=>{
 const body='{{title}} | {{ title }} | {{\ttitle\t}} | {{\u00a0title\u00a0}}\n{{party}}{{amount}}';
 assert.equal(validateTemplate({...template,body}).body,body);
 const result=prepareContract({...input,body},context);
 assert.ok(result.document.startsWith('عنوان آزمون | عنوان آزمون | عنوان آزمون | عنوان آزمون\nطرف آزمون0'));
 assert.ok(!result.document.includes('{{'));assert.ok(!result.document.includes('}}'));
 assert.equal(result.snapshot.document,result.document);
});

test('all supported names render through the shared parser while ordinary multiline prose remains valid',()=>{
 const names=['title','party','customerName','managerName','amount','start','end','services','sla','paymentTerms','unit','contractNumber','owner'];
 const body='متن آغاز\n'+names.map(name=>'{{ '+name+' }}').join('\n')+'\nمتن پایان';
 assert.equal(validateTemplate({...template,body}).body,body);
 const result=prepareContract({...input,body},context,{contractNumber:'NC-TEST'});
 for(const value of ['عنوان آزمون','طرف آزمون','مشتری آزمون','مدیر آزمون','2026-10-01','2027-09-30','پرداخت ماهانه','واحد آزمون','NC-TEST','مالک آزمون'])assert.ok(result.document.includes(value),value);
 assert.ok(!result.document.includes('{{'));assert.ok(!result.document.includes('}}'));assert.ok(result.document.includes('متن آغاز\n'));
});

test('service document renders negotiated delivery and availability units without changing reference terms',()=>{
 const source={code:'ABR-01',name:'سرویس آزمون',centerId:'center',centerName:'مرکز آزمون',model:'per_user',delivery:'self_service',tier:'T1',unit:'کاربر در ماه',price:{rawText:'نرخ مرجع بدون تغییر'},sourceUrl:'https://example.invalid/ABR-01'};
 const chosen={code:source.code,slaTier:'T1',delivery:'managed',quantity:2,unitPrice:100};
 const cases=[
  {profile:{availabilityPct:99.9},expected:'99.9%'},
  {profile:{availabilityPercent:99.9},expected:'99.9%'},
  {profile:{availability:'99.90%'},expected:'99.90%'},
  {profile:{availability:'۹۹٫۹٪'},expected:'۹۹٫۹٪'},
  {profile:{availability:'99.9 درصد'},expected:'99.9 درصد'},
 ];
 for(const example of cases){
  const catalog={...context.catalog,services:[source],slaProfiles:[{code:'T1',response:'۱۵ دقیقه',resolution:'۴ ساعت',coverage:'۲۴×۷',...example.profile}],revenueModels:[{code:'per_user'}]};
  const result=prepareContract({...input,body:'{{services}}\n{{sla}}',services:[chosen]},{...context,catalog});
  assert.ok(result.document.includes('روش ارائه: مدیریت‌شده'));assert.ok(!result.document.includes('روش ارائه: سلف‌سرویس'));
  assert.ok(result.document.includes(`T1؛ ${example.expected}؛ پاسخ`),result.document);assert.ok(!result.document.includes('%%'));
  assert.equal(result.services[0].delivery,'managed');assert.deepEqual(result.services[0].sourceSnapshot,source);assert.equal(result.services[0].sourceSnapshot.delivery,'self_service');
  assert.ok(result.document.includes('شرایط نرخ‌نامه مرجع'));assert.ok(result.document.includes(source.price.rawText));
 }
});
