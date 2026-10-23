import {test,expect} from '@playwright/test';
for(const width of [1440,390])test(`ambiguous extraction cannot populate a draft at ${width}px`,async({page,request},info)=>{
 const data=await(await request.get('/api/bootstrap')).json();
 const created=await request.post('/api/contracts',{data:{templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title:'بازبینی ابهام پارامترها '+width,owner:'آزمون',amount:100,start:'2026-10-01',end:'2027-10-01',paymentTerms:'آزمون',services:[]}});expect(created.status()).toBe(201);const c=await created.json();
 const quote='قیمت واحد: ۱۰ یا ۲۰ ریال\nقیمت واحد: ۳۰ ریال\nحداکثر کاربران فعال: ۱٫۵\nمحل نگهداری داده: منطقه۱\nتمدید خودکار: خیر\nظرفیت ذخیره‌سازی: ۰٫۰۰۰۰۰۰۱ GB';
 const response=await request.post(`/api/contracts/${c.id}/amendments`,{data:{title:'منبع استخراج',body:quote,reason:'آزمون ابهام',idempotencyKey:crypto.randomUUID()}});expect(response.status()).toBe(200);let a=(await response.json()).amendments[0];
 for(const action of ['submit','approve']){const reviewed=await request.post(`/api/contracts/${c.id}/amendments/${a.id}/review`,{data:{action,expectedStatus:a.status,expectedRevision:a.workflow.revision,idempotencyKey:crypto.randomUUID(),comment:'بازبینی منبع آزمون'}});expect(reviewed.status()).toBe(200);a=(await reviewed.json()).amendments[0];}
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:1000});await page.goto('/#view=contracts');await page.locator(`.contract-link[data-id="${c.id}"]`).click();await page.locator('[data-action="detail-tab"][data-tab="service-limits"]').click();await page.locator('#contractParameterSource').selectOption(a.id);await page.locator('[data-cp="extract"]').click();
 const buttons=page.locator('[data-cp="candidate"]');await expect(buttons).toHaveCount(6);
 for(const index of [0,1,2])await expect(buttons.nth(index)).toBeDisabled();
 for(const index of [3,4,5]){await expect(buttons.nth(index)).toBeEnabled();await buttons.nth(index).click();}
 await expect(page.locator('.parameter-value-row')).toHaveCount(3);
 expect(await page.locator('.modal').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBeTruthy();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.screenshot({path:info.outputPath(`extraction-${width}.png`)});
 await page.locator('[data-cp="save"]').click();await expect(page.locator('.contract-parameter-version')).toHaveCount(1);
 const saved=await(await request.get(`/api/contracts/${c.id}/parameters`)).json();expect(saved.versions[0].status).toBe('draft');expect(saved.outbox).toEqual([]);const values=saved.versions[0].values;expect(values).toHaveLength(3);expect(values.find(v=>v.key==='data-region').value).toBe('منطقه۱');expect(values.find(v=>v.key==='auto-renew').value).toBe(false);expect(values.find(v=>v.key==='storage-gb').value).toBe(0.0000001);expect(values.every(v=>v.source.clauseQuote&&quote.includes(v.source.clauseQuote))).toBeTruthy();expect(errors).toEqual([]);
});
