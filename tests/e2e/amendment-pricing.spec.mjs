import {test,expect} from '@playwright/test';
const model=amount=>({name:`مدل الحاقیه ${amount}`,bases:[{id:'base',name:'نرخ پایه',unit:'واحد',amount,source:'آزمون رابط'}],items:[{id:'one',title:'بند اول',quantity:2,components:[{baseId:'base',coefficient:3}]},{id:'two',title:'بند دوم',quantity:4,components:[{baseId:'base',coefficient:1}]}]});
async function fixture(request,title){
 const data=await(await request.get('/api/bootstrap')).json(),template=data.templates.find(t=>t.currentPublishedVersion);
 const p=await(await request.post('/api/pricing-plans',{data:{model:model(100)}})).json();
 const response=await request.post('/api/contracts',{data:{templateId:template.id,customerId:data.customers[0].id,title,owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[],pricingPlan:model(100),pricingPlanId:p.id,pricingPlanRevision:p.revision}});expect(response.status()).toBe(201);const c=await response.json();
 const plan=await(await request.put('/api/pricing-plans/'+p.id,{data:{model:model(200),revision:p.revision}})).json();return {c,plan};
}
async function open(page,c){
 await page.goto('/#view=contracts');await page.locator('[data-search="contracts"]').fill(c.title);await page.locator('button.contract-link').click();
 await page.locator('[data-action="detail-tab"][data-tab="document"]').click();await page.locator('[data-action="new-amendment"]').click();
 await page.locator('#amendmentForm [name="title"]').fill('بازبینی مبلغ');await page.locator('#amendmentForm [name="reason"]').fill('استعلام جدید');await page.locator('#amendmentForm [name="body"]').fill('برای بررسی و توافق طرفین');
}
for(const width of [1440,390])test(`financial amendment previews a fixed revision, saves and exports without changing original terms at ${width}px`,async({page,request},testInfo)=>{
 await page.setViewportSize({width,height:width===390?844:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const {c,plan}=await fixture(request,`پیوست مالی ${width}`);await open(page,c);await page.locator('[data-amendment-plan]').selectOption(plan.id);
 await expect(page.locator('[data-amendment-after]')).toContainText('۲٬۰۰۰');await expect(page.locator('[data-amendment-before]')).toContainText('۱٬۰۰۰');await expect(page.locator('[data-amendment-delta]')).toContainText('افزایش ۱٬۰۰۰');
 await expect(page.locator('#amendmentPricingPreview')).toContainText('۲ آیتم تغییر کرده');
 expect((await(await request.get('/api/contracts/'+c.id)).json()).amendments).toHaveLength(0);
 await page.locator('[data-amendment-financial]').evaluate(el=>{const scroller=el.closest('.modal-body');scroller.scrollTop+=el.getBoundingClientRect().top-scroller.getBoundingClientRect().top-25;});
 await page.screenshot({path:testInfo.outputPath(`financial-preview-${width}.png`)});
 await page.locator('[data-action="save-amendment"]').click();const card=page.locator('[data-amendment-id]');await expect(card).toHaveCount(1);await card.locator('summary').first().click();
 await expect(card.locator('[data-amendment-after]')).toContainText('۲٬۰۰۰');await expect(card).toContainText('پیش‌نویس');
 let stored=await(await request.get('/api/contracts/'+c.id)).json();expect(stored.amendments[0].financial.sourcePlan.revision).toBe(2);expect(stored.snapshot).toEqual(c.snapshot);expect(stored.amount).toBe(c.amount);expect(stored.status).toBe(c.status);
 const [download]=await Promise.all([page.waitForEvent('download'),card.locator('[data-action="download-amendment-pricing"]').click()]);expect(download.suggestedFilename()).toContain('amendment-1-pricing.json');const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual(stored.amendments[0].financial);
 await request.put('/api/pricing-plans/'+plan.id,{data:{model:model(300),revision:plan.revision}});stored=await(await request.get('/api/contracts/'+c.id)).json();expect(stored.amendments[0].financial.after.total).toBe(2000);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
});

test('late financial preview cannot replace a newer selected model',async({page,request})=>{
 const {c,plan}=await fixture(request,'پاسخ دیرهنگام پیوست');const second=await(await request.post('/api/pricing-plans',{data:{model:model(300)}})).json();await open(page,c);
 let release;const held=new Promise(resolve=>release=resolve);let captured;const capture=new Promise(resolve=>captured=resolve);
 await page.route(`**/api/contracts/${c.id}/amendments/preview`,async route=>{
  if(route.request().postDataJSON().pricingPlanId===plan.id){const response=await route.fetch();captured();await held;await route.fulfill({response});}else await route.continue();
 });
 await page.locator('[data-amendment-plan]').selectOption(plan.id);await capture;await expect(page.locator('[data-action="save-amendment"]')).toBeDisabled();
 await page.locator('[data-amendment-plan]').selectOption(second.id);await expect(page.locator('[data-amendment-after]')).toContainText('۳٬۰۰۰');
 const firstResponse=page.waitForResponse(r=>r.url().endsWith('/amendments/preview')&&r.request().postDataJSON().pricingPlanId===plan.id);release();await firstResponse;
 await expect(page.locator('[data-amendment-after]')).toContainText('۳٬۰۰۰');await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('[data-amendment-id]')).toHaveCount(1);
 const stored=await(await request.get('/api/contracts/'+c.id)).json();expect(stored.amendments[0].financial.sourcePlan.id).toBe(second.id);
});

test('stale basis error preserves text and prevents financial save until attachment is removed',async({page,request})=>{
 const {c,plan}=await fixture(request,'تعارض مبنای پیوست');await open(page,c);
 await page.route(`**/api/contracts/${c.id}/amendments/preview`,route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'مبنای مالی پرونده تغییر کرده است؛ آخرین جزئیات را بازبینی کنید.'})}));
 await page.locator('[data-amendment-plan]').selectOption(plan.id);await expect(page.locator('#amendmentPricingPreview [role="alert"]')).toContainText('مبنای مالی پرونده تغییر');await expect(page.locator('[data-action="save-amendment"]')).toBeDisabled();
 await expect(page.locator('#amendmentForm [name="body"]')).toHaveValue('برای بررسی و توافق طرفین');await page.locator('[data-amendment-plan]').selectOption('');await expect(page.locator('[data-action="save-amendment"]')).toBeEnabled();
 await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('[data-amendment-id]')).toHaveCount(1);const stored=await(await request.get('/api/contracts/'+c.id)).json();expect(stored.amendments[0].financial).toBeNull();
});
