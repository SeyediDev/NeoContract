import {test,expect} from '@playwright/test';

async function fixture(request,title){
 const data=await(await request.get('/api/bootstrap')).json(),template=data.templates.find(t=>t.currentPublishedVersion);
 const response=await request.post('/api/contracts',{data:{templateId:template.id,customerId:data.customers[0].id,title,owner:'آزمون',amount:1234,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]}});
 expect(response.status()).toBe(201);return response.json();
}
async function open(page,c){
 await page.goto('/#view=contracts');await page.locator('[data-search="contracts"]').fill(c.title);await page.locator('button.contract-link').click();
 await page.locator('[data-action="detail-tab"][data-tab="document"]').click();await page.locator('[data-action="new-amendment"]').click();
 await expect(page.locator('#amendmentForm')).toContainText('پیش‌نویس');
 await page.locator('#amendmentForm [name="title"]').fill('الحاقیه تغییر دامنه');await page.locator('#amendmentForm [name="reason"]').fill('تغییر خدمات');await page.locator('#amendmentForm [name="body"]').fill('متن پیشنهادی <script>bad()</script> پس از توافق طرفین');
}

for(const width of [1440,390])test(`amendment lost response retry preserves content and creates one draft at ${width}px`,async({page,request},testInfo)=>{
 await page.setViewportSize({width,height:width===390?844:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const c=await fixture(request,`الحاقیه قطع پاسخ ${width}`);await open(page,c);
 await page.screenshot({path:testInfo.outputPath(`amendment-form-${width}.png`)});
 const keys=[];let first=true;
 await page.route(`**/api/contracts/${c.id}/amendments`,async route=>{
  keys.push(route.request().postDataJSON().idempotencyKey);
  const response=await route.fetch();expect(response.status()).toBe(200);
  if(first){first=false;await route.abort('connectionreset');}else await route.fulfill({response});
 });
 await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('#modalError')).toBeVisible();
 await expect(page.locator('#amendmentForm [name="body"]')).toHaveValue('متن پیشنهادی <script>bad()</script> پس از توافق طرفین');
 await expect(page.locator('[data-action="save-amendment"]')).toBeEnabled();
 const stored=await(await request.get(`/api/contracts/${c.id}`)).json();expect(stored.amendments).toHaveLength(1);
 await page.locator('[data-action="save-amendment"]').click();const card=page.locator('[data-amendment-id]');await expect(card).toHaveCount(1);
 expect(keys).toHaveLength(2);expect(keys[0]).toBeTruthy();expect(keys[1]).toBe(keys[0]);
 await expect(card.locator('summary')).toContainText('پیش‌نویس');await card.locator('summary').click();await expect(card).toContainText('تأیید طرفین و اعمال مفاد آن ثبت نشده');await expect(card).toContainText('در سابقه ثبت نشده');
 await expect(card.locator('pre')).toContainText('<script>bad()</script>');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 expect(await page.locator('.modal').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
 await card.evaluate(el=>{const scroller=el.closest('.modal-body');scroller.scrollTop+=el.getBoundingClientRect().top-scroller.getBoundingClientRect().top-25;});
 await page.screenshot({path:testInfo.outputPath(`amendment-${width}.png`)});
 const after=await(await request.get(`/api/contracts/${c.id}`)).json();expect(after.amendments).toHaveLength(1);expect(after.snapshot).toEqual(c.snapshot);expect(after.amount).toBe(c.amount);expect(after.status).toBe(c.status);expect(errors).toEqual([]);
});

test('editing an unsubmitted amendment after transport failure uses a new request key',async({page,request})=>{
 const c=await fixture(request,'الحاقیه اصلاح پس از خطا');await open(page,c);
 const keys=[];let first=true;
 await page.route(`**/api/contracts/${c.id}/amendments`,async route=>{
  keys.push(route.request().postDataJSON().idempotencyKey);
  if(first){first=false;await route.abort('failed');}else await route.continue();
 });
 await page.locator('[data-action="save-amendment"]').click();await expect(page.locator('#modalError')).toBeVisible();
 await page.locator('#amendmentForm [name="body"]').fill('متن بازبینی‌شده');await page.locator('[data-action="save-amendment"]').click();
 await expect(page.locator('[data-amendment-id]')).toHaveCount(1);expect(keys).toHaveLength(2);expect(keys[0]).not.toBe(keys[1]);
 const saved=await(await request.get(`/api/contracts/${c.id}`,{maxRetries:1})).json();expect(saved.amendments).toHaveLength(1);expect(saved.amendments[0].body).toBe('متن بازبینی‌شده');
});
