import {test,expect} from '@playwright/test';
const price=amount=>({name:'نرخ الحاقیه قابل ادامه',bases:[{id:'base',name:'نرخ',unit:'واحد',amount,source:'آزمون'}],items:[{id:'item',title:'سرویس',quantity:2,components:[{baseId:'base',coefficient:1}]}]});
async function fixture(request,title){
 const bootstrap=await(await request.get('/api/bootstrap')).json(),template=bootstrap.templates.find(t=>t.currentPublishedVersion);
 const response=await request.post('/api/contracts',{data:{templateId:template.id,customerId:bootstrap.customers[0].id,title,owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]}});
 expect(response.status()).toBe(201);return response.json();
}
async function dossier(page,c){
 await page.goto('/#view=contracts');await page.locator('[data-search="contracts"]').fill(c.title);await page.locator(`button.contract-link[data-id="${c.id}"]`).click();await page.locator('[data-tab="document"]').click();
}
async function fill(page){
 await page.locator('#amendmentForm [name="title"]').fill('تغییر دامنه قابل ادامه');await page.locator('#amendmentForm [name="reason"]').fill('تکمیل شرایط');await page.locator('#amendmentForm [name="body"]').fill('متن پیشنهادی <script>bad()</script>');
}
for(const width of [1440,390])test(`amendment work survives keep, reload and contract changes, then explicit discard at ${width}px`,async({page,request},testInfo)=>{
 await page.setViewportSize({width,height:width===390?844:1000});page.on('dialog',d=>d.accept());
 const c=await fixture(request,`ادامه الحاقیه ${width}`),other=await fixture(request,`قرارداد مستقل ${width}`),before=await(await request.get('/api/contracts/'+c.id)).json(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/'))writes.push(r.url());});
 await dossier(page,c);await page.locator('[data-action="new-amendment"]').click();await fill(page);
 await expect(page.locator('[data-amendment-draft-status]')).toContainText('ذخیره موقت');
 await page.locator('[data-action="detail-back"]').click();await page.locator('[data-action="save-amendment-exit"]').click();await expect(page.locator('[data-action="resume-amendment"]')).toBeVisible();
 await page.keyboard.press('Escape');await dossier(page,other);await expect(page.locator('[data-action="resume-amendment"]')).toHaveCount(0);
 await page.keyboard.press('Escape');await page.reload();await dossier(page,c);await page.locator('[data-action="resume-amendment"]').click();
 await expect(page.locator('#amendmentForm [name="body"]')).toHaveValue('متن پیشنهادی <script>bad()</script>');await expect(page.locator('[data-amendment-draft-status]')).toContainText('بازیابی');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:testInfo.outputPath(`amendment-resumed-${width}.png`)});
 await page.locator('[data-action="detail-back"]').click();await page.locator('[data-action="discard-changes"]').click();await expect(page.locator('[data-action="resume-amendment"]')).toHaveCount(0);
 await page.locator('[data-action="new-amendment"]').click();await expect(page.locator('#amendmentForm [name="body"]')).toHaveValue('');
 expect(await(await request.get('/api/contracts/'+c.id)).json()).toEqual(before);expect(writes).toEqual([]);expect(errors).toEqual([]);
});
test('lost amendment response retries the same request after reload and creates only one record',async({page,request})=>{
 page.on('dialog',d=>d.accept());const c=await fixture(request,'ارسال الحاقیه قطع‌شده قابل بازیابی');await dossier(page,c);await page.locator('[data-action="new-amendment"]').click();await fill(page);
 const keys=[];let first=true;
 await page.route(`**/api/contracts/${c.id}/amendments`,async route=>{keys.push(route.request().postDataJSON().idempotencyKey);const response=await route.fetch();expect(response.status()).toBe(200);if(first){first=false;await route.abort('connectionreset');}else await route.fulfill({response});});
 await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('#modalError')).toBeVisible();await page.reload();await dossier(page,c);await page.locator('[data-action="resume-amendment"]').click();await expect(page.locator('[data-action="save-amendment"]')).toContainText('همان ارسال');
 await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('[data-amendment-id]')).toHaveCount(1);await expect(page.locator('[data-action="resume-amendment"]')).toHaveCount(0);
 expect(keys).toHaveLength(2);expect(keys[1]).toBe(keys[0]);const saved=await(await request.get('/api/contracts/'+c.id)).json();expect(saved.amendments).toHaveLength(1);expect(saved.snapshot).toEqual(c.snapshot);
});
test('resuming financial work preserves its pinned revision and rejects a stale basis without losing text',async({page,request})=>{
 page.on('dialog',d=>d.accept());const c=await fixture(request,'نسخه ثابت الحاقیه قابل ادامه');let plan=await(await request.post('/api/pricing-plans',{data:{model:price(200)}})).json();
 await dossier(page,c);await page.locator('[data-action="new-amendment"]').click();await fill(page);await page.locator('[data-amendment-plan]').selectOption(plan.id);await expect(page.locator('[data-amendment-after]')).toContainText('۴۰۰');
 plan=await(await request.put('/api/pricing-plans/'+plan.id,{data:{model:price(900),revision:plan.revision}})).json();expect(plan.revision).toBe(2);
 await page.reload();await dossier(page,c);await page.locator('[data-action="resume-amendment"]').click();await expect(page.locator('[data-amendment-after]')).toContainText('۴۰۰');await expect(page.locator('[data-amendment-plan] option:checked')).toContainText('نسخه محفوظ ۱');
 await page.reload();await page.route(`**/api/contracts/${c.id}/amendments/preview`,route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'مبنای مالی پرونده تغییر کرده است؛ آخرین جزئیات را بازبینی کنید.'})}));
 await dossier(page,c);await page.locator('[data-action="resume-amendment"]').click();await expect(page.locator('#amendmentPricingPreview [role="alert"]')).toContainText('مبنای مالی پرونده تغییر');await expect(page.locator('[data-action="save-amendment"]')).toBeDisabled();await expect(page.locator('#amendmentForm [name="body"]')).toHaveValue('متن پیشنهادی <script>bad()</script>');
 await page.locator('[data-amendment-plan]').selectOption('');await expect(page.locator('[data-action="save-amendment"]')).toBeEnabled();expect((await(await request.get('/api/contracts/'+c.id)).json()).amendments).toHaveLength(0);
});
test('an unchanged financial retry can recover a committed record even if a fresh preview is unavailable',async({page,request})=>{
 page.on('dialog',d=>d.accept());const c=await fixture(request,'پاسخ مالی قطع‌شده قابل بازیابی'),plan=await(await request.post('/api/pricing-plans',{data:{model:price(200)}})).json();
 await dossier(page,c);await page.locator('[data-action="new-amendment"]').click();await fill(page);await page.locator('[data-amendment-plan]').selectOption(plan.id);await expect(page.locator('[data-amendment-after]')).toContainText('۴۰۰');
 const bodies=[];let first=true;await page.route(`**/api/contracts/${c.id}/amendments`,async route=>{
  bodies.push(route.request().postDataJSON());const response=await route.fetch();expect(response.status()).toBe(200);if(first){first=false;await route.abort('connectionreset');}else await route.fulfill({response});
 });
 await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('#modalError')).toBeVisible();await page.reload();
 await page.route(`**/api/contracts/${c.id}/amendments/preview`,route=>route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'مبنای مالی پرونده تغییر کرده است؛ آخرین جزئیات را بازبینی کنید.'})}));
 await dossier(page,c);await page.locator('[data-action="resume-amendment"]').click();await expect(page.locator('#amendmentPricingPreview [role="alert"]')).toBeVisible();await expect(page.locator('[data-action="save-amendment"]')).toBeEnabled();
 await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('[data-action="resume-amendment"]')).toHaveCount(0);await expect(page.locator('[data-amendment-id]')).toHaveCount(1);
 expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);expect((await(await request.get('/api/contracts/'+c.id)).json()).amendments).toHaveLength(1);
});
