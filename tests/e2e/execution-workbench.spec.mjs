import {test,expect} from '@playwright/test';
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const offset=d=>new Date(+new Date(today+'T12:00:00Z')+d*86400000).toISOString().slice(0,10);
async function fixture(request,direction,title){
 const data=await(await request.get('/api/bootstrap')).json();
 let c=await(await request.post('/api/contracts',{data:{templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title,owner:'آزمون',amount:10000,start:offset(-60),end:offset(60),paymentTerms:'مدرک آزمون',services:[]}})).json();
 while(c.status!=='active'){const r=await request.post(`/api/contracts/${c.id}/advance`,{data:{expectedStatus:c.status,expectedStepId:c.stages.find(s=>s.status==='active')?.stepId||null}});expect(r.status()).toBe(200);c=await r.json();}
 let s;const cmd=async(action,payload)=>{const r=await request.post(`/api/contracts/${c.id}/execution/commands`,{data:{action,payload,expectedRevision:s?.revision||0,idempotencyKey:crypto.randomUUID()}});expect(r.status()).toBe(200);s=await r.json();};
 await cmd('start',{reference:'SIGNED-WORKBENCH-TEST',counterparties:'طرفین آزمایشی',confirmSigned:true,signedDate:today,startDate:offset(-60),endDate:offset(60),amount:10000,advanceLimit:0,direction});
 await cmd('milestone',{title:'مرحله',gross:10000,dueDate:offset(1),condition:'پذیرش'});
 await cmd('item',{milestoneId:s.milestones[0].id,title:'تحویل <img src=x onerror=bad()>',quantity:2,unit:'بسته',unitPrice:5000,dueDate:offset(-1),owner:'مجری',criteria:'پذیرش'});
 await cmd('delivery',{itemId:s.items[0].id,quantity:1,deliveredAt:offset(-1),reference:'DEL'});
 await cmd('accept',{id:s.deliveries[0].id,reference:'ACCEPT',comment:'پذیرش'});
 await cmd('invoice',{kind:'progress',number:'INV-'+direction,milestoneId:s.milestones[0].id,lines:[{itemId:s.items[0].id,quantity:1}],tax:0,retention:500,withholding:100,insurance:100,penalty:0,advanceRecovery:0,dueDate:offset(1),reference:'INV',basis:'مقادیر آزمون'});
 await cmd('invoice-approve',{id:s.invoices[0].id,reference:'FIN',comment:'تأیید'});
 await cmd('payment',{invoiceId:s.invoices[0].id,amount:1000,paidAt:today,reference:'PAY',method:'آزمون'});
 await cmd('obligation',{title:'تعهد امروز',owner:'مسئول',dueDate:today,condition:'صورتجلسه'});
 return {c,s};
}
for(const [width,role] of [[1440,'contract_admin'],[390,'viewer']])test(`execution workbench separates balances, filters and opens the right dossier section at ${width}px`,async({page,request},testInfo)=>{
 const a=await fixture(request,'receivable','میزکار دریافت '+width),b=await fixture(request,'payable','میزکار پرداخت '+width);
 const before=await(await request.get('/api/contracts/'+a.c.id)).json(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/')&&['POST','PUT','PATCH','DELETE'].includes(r.method()))writes.push(r.method());});
 if(role==='viewer')await page.route('**/api/bootstrap',async route=>{const response=await route.fetch(),data=await response.json();await route.fulfill({response,json:{...data,access:{...data.access,identity:{...data.access.identity,roles:['viewer']}}}});});
 await page.setViewportSize({width,height:width===390?844:1000});await page.goto('/#view=execution');
 const panel=page.locator('#executionWorkbench');await expect(panel).toBeVisible();
 await panel.locator('[data-workbench-filter="contract"]').selectOption(a.c.id);
 await expect(panel.locator('[data-workbench-total="receivable"]')).toHaveText('۳٬۳۰۰ ریال');await expect(panel.locator('[data-workbench-total="payable"]')).toHaveText('۰ ریال');
 await panel.locator('[data-workbench-filter="contract"]').selectOption(b.c.id);
 await expect(panel.locator('[data-workbench-total="receivable"]')).toHaveText('۰ ریال');await expect(panel.locator('[data-workbench-total="payable"]')).toHaveText('۳٬۳۰۰ ریال');
 await panel.locator('[data-workbench-filter="contract"]').selectOption(a.c.id);await panel.locator('[data-workbench-filter="urgency"]').selectOption('overdue');
 await expect(panel.locator('.workbench-record')).toHaveCount(1);await expect(panel.locator('.workbench-record')).toContainText('<img src=x onerror=bad()>');await expect(panel.locator('img')).toHaveCount(0);
 await panel.locator('[data-workbench-filter="query"]').fill('ناموجود');await expect(panel.locator('.workbench-record')).toHaveCount(0);await expect(panel.locator('.empty-state')).toContainText('موردی با این فیلتر');
 await expect(panel.locator('[data-workbench-filter="query"]')).toBeFocused();await panel.locator('[data-workbench-reset]').click();
 await panel.locator('[data-workbench-filter="contract"]').selectOption(a.c.id);await panel.locator('[data-workbench-filter="category"]').selectOption('finance');
 const row=panel.locator(`[data-workbench-key="invoice-payment:${a.s.invoices[0].id}"]`);await row.locator('[data-workbench-open]').focus();await page.keyboard.press('Enter');
 await expect(page.locator('.execution-sections [data-section="finance"]')).toHaveAttribute('aria-pressed','true');await expect(page.locator('[data-execution-invoice]')).toContainText('INV-receivable');
 if(role==='viewer')await expect(page.locator('[data-exec="payment"]')).toBeDisabled();
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(panel.locator('[data-workbench-filter="contract"]')).toHaveValue(a.c.id);
 if(width===1440){
  await page.route('**/api/bootstrap',route=>route.abort());await panel.locator('[data-workbench-refresh]').click();
  await expect(panel.getByRole('alert')).toContainText('داده قبلی نمایش داده می‌شود');await expect(panel.locator('[data-workbench-filter="contract"]')).toHaveValue(a.c.id);
  await page.unroute('**/api/bootstrap');const fresh=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/bootstrap');await panel.locator('[data-workbench-refresh]').click();expect((await fresh).status()).toBe(200);await expect(panel.locator('[data-workbench-refresh]')).toBeEnabled();await expect(panel.getByRole('alert')).toHaveCount(0);await expect(panel.locator('[data-workbench-total="receivable"]')).toHaveText('۳٬۳۰۰ ریال');
 }
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.evaluate(e=>e.scrollIntoView({block:'start'}));await page.screenshot({path:testInfo.outputPath(`execution-workbench-${width}.png`)});
 expect(await(await request.get('/api/contracts/'+a.c.id,{maxRetries:2})).json()).toEqual(before);expect(errors).toEqual([]);expect(writes).toEqual([]);
});

test('workbench paginates 30 browser records and resets the page on normalized search without fetching',async({page})=>{
 let closed=false;
 await page.route('**/api/bootstrap',async route=>{
  const response=await route.fetch(),data=await response.json();
  const s={status:'running',basis:{direction:'receivable'},endDate:offset(60),items:[],deliveries:[],invoices:[],payments:[],reversals:[],deductionSettlements:[],deductionReversals:[],guarantees:[],issues:[],summary:{itemProgress:[],outstanding:0,retentionHeld:0,advanceOutstanding:0},obligations:Array.from({length:30},(_,i)=>({id:String(i).padStart(2,'0'),status:'open',title:'تعهد '+i,dueDate:today,owner:'مسئول',condition:'مدرک آزمون'}))};
  if(closed)s.status='closed';
  await route.fulfill({response,json:{...data,contracts:[{id:'workbench-browser-fixture',number:'WB-TEST',title:'نمونه مستقل پیگیری اجرا',status:'active',execution:s}]}});
 });
 await page.goto('/#view=execution');const panel=page.locator('#executionWorkbench');await expect(panel.locator('.workbench-record')).toHaveCount(25);
 let requests=0;page.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests++;});
 await panel.locator('[data-workbench-navigation="next"]').click();await expect(panel.locator('.workbench-record')).toHaveCount(5);await expect(panel.locator('.workbench-record').first()).toContainText('تعهد 25');await expect(panel.locator('[data-workbench-navigation="next"]')).toBeDisabled();
 await panel.locator('[data-workbench-filter="query"]').fill('تعهد ۲۹');await expect(panel.locator('.workbench-record')).toHaveCount(1);await expect(panel.locator('.workbench-result')).toContainText('صفحه ۱ از ۱');await expect(panel.locator('[data-workbench-filter="query"]')).toBeFocused();expect(requests).toBe(0);
 const contract=await panel.locator('[data-workbench-filter="contract"] option').nth(1).getAttribute('value');await panel.locator('[data-workbench-filter="contract"]').selectOption(contract);closed=true;
 const fresh=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/bootstrap');await panel.locator('[data-workbench-refresh]').click();expect((await fresh).status()).toBe(200);await expect(panel.locator('[data-workbench-refresh]')).toBeEnabled();
 await expect(panel.locator('[data-workbench-filter="contract"]')).toHaveValue(contract);await expect(panel.locator('[data-workbench-filter="contract"] option:checked')).toContainText('دیگر اجرای باز ندارد');await expect(panel.locator('.workbench-record')).toHaveCount(0);
});

test('workbench filters are isolated between tenants and retained on SPA navigation',async({page,request})=>{
 const tenants=(await(await request.get('/api/tenants')).json()).tenants;expect(tenants.length).toBeGreaterThan(1);
 await page.goto('/#view=execution');await expect(page.locator('#tenantSelect')).toBeEnabled();await expect(page.locator('#executionWorkbench')).toBeVisible();const first=await page.locator('#tenantSelect').inputValue(),other=tenants.find(t=>t.id!==first).id;
 await page.locator('[data-workbench-filter="query"]').fill('فیلتر تننت اول');await page.locator('[data-workbench-filter="category"]').selectOption('finance');
 await page.locator('#sidebar [data-view="contracts"]').click();await page.locator('#sidebar [data-view="execution"]').click();await expect(page.locator('[data-workbench-filter="query"]')).toHaveValue('فیلتر تننت اول');
 await page.locator('#tenantSelect').selectOption(other);await expect(page.locator('[data-workbench-filter="query"]')).toHaveValue('');await expect(page.locator('[data-workbench-filter="category"]')).toHaveValue('all');await expect(page.locator('#tenantSelect')).toBeEnabled();
 await page.locator('[data-workbench-filter="query"]').fill('فیلتر تننت دوم');await page.locator('#tenantSelect').selectOption(first);await expect(page.locator('[data-workbench-filter="query"]')).toHaveValue('فیلتر تننت اول');await expect(page.locator('[data-workbench-filter="category"]')).toHaveValue('finance');
});
