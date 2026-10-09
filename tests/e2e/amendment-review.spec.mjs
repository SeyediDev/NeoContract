import {test,expect} from '@playwright/test';
async function fixture(request,title,financial=false){
 const data=await(await request.get('/api/bootstrap')).json();
 const c=await(await request.post('/api/contracts',{data:{templateId:data.templates.find(t=>t.currentPublishedVersion).id,customerId:data.customers[0].id,title,owner:'آزمون',amount:1000,start:'2026-10-01',end:'2027-10-01',paymentTerms:'توافقی',services:[]}})).json();
 let reference={};if(financial){const p=await(await request.post('/api/pricing-plans',{data:{model:{name:'پیوست آزمون بررسی',bases:[{id:'base',name:'واحد',unit:'عدد',amount:200}],items:[{id:'one',title:'خدمت',quantity:10,components:[{baseId:'base',coefficient:1}]}]}}})).json();reference={pricingPlanId:p.id,pricingPlanRevision:1,expectedPricingBasis:c.amendmentPricingBasis.token};}
 const r=await request.post(`/api/contracts/${c.id}/amendments`,{data:{title:'بررسی تغییر خدمات',reason:'استعلام جدید',body:'پیشنهاد جهت توافق طرفین',...reference}});expect(r.status()).toBe(200);return {c,a:(await r.json()).amendments[0]};
}
async function open(page,c){await page.goto('/#view=contracts');await page.locator('[data-search="contracts"]').fill(c.title);await page.locator('button.contract-link').click();await page.locator('[data-action="detail-tab"][data-tab="document"]').click();await page.locator('[data-amendment-id] > summary').click();}
async function decide(page,action,comment='توضیح تصمیم'){await page.locator(`[data-decision="${action}"]`).click();await page.locator('#amendmentDecisionForm [name="comment"]').fill(comment);await page.locator('[data-action="save-amendment-decision"]').click();await expect(page.locator('[data-amendment-id]')).toBeVisible();await page.locator('[data-amendment-id] > summary').click();}
test('stale conflict preserves comment and back reloads state',async({page,request})=>{
 const {c,a}=await fixture(request,'تعارض تصمیم');await open(page,c);await page.locator('[data-decision="submit"]').click();await page.locator('#amendmentDecisionForm [name="comment"]').fill('متن محفوظ');
 await request.post(`/api/contracts/${c.id}/amendments/${a.id}/review`,{data:{action:'submit',expectedStatus:'draft',expectedRevision:0,idempotencyKey:crypto.randomUUID()}});
 await page.locator('[data-action="save-amendment-decision"]').click();await expect(page.locator('#modalError')).toContainText('آخرین نسخه');await expect(page.locator('#amendmentDecisionForm [name="comment"]')).toHaveValue('متن محفوظ');
 await page.locator('[data-action="amendment-detail-back"]').click();await page.locator('[data-action="discard-changes"]').click();await page.locator('[data-amendment-id] > summary').click();await expect(page.locator('[data-amendment-review]')).toContainText('بررسی حقوقی');
});
for(const role of ['finance_reviewer','viewer'])test(`${role} cannot see legal decision controls`,async({page,request})=>{
 const {c,a}=await fixture(request,'مشاهده بررسی '+role);await request.post(`/api/contracts/${c.id}/amendments/${a.id}/review`,{data:{action:'submit',expectedStatus:'draft',expectedRevision:0,idempotencyKey:crypto.randomUUID()}});
 const data=await(await request.get('/api/bootstrap')).json();
 await page.route('**/api/bootstrap',route=>route.fulfill({json:{...data,access:{mode:'oidc-proxy',identity:{roles:[role]}}}}));await open(page,c);await expect(page.locator('[data-action="amendment-decision"]')).toHaveCount(0);await expect(page.locator('[data-amendment-review]')).toContainText('بررسی حقوقی');
});
for(const width of [1440,390])test(`financial amendment review and lost response retry at ${width}px`,async({page,request},testInfo)=>{
 await page.setViewportSize({width,height:width===390?844:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const {c,a}=await fixture(request,`بررسی مالی ${width}`,true);await open(page,c);
 await decide(page,'submit');await expect(page.locator('[data-amendment-review]')).toContainText('بررسی حقوقی');
 const keys=[];let first=true;const url=`**/api/contracts/${c.id}/amendments/${a.id}/review`;
 await page.route(url,async route=>{keys.push(route.request().postDataJSON().idempotencyKey);const response=await route.fetch();expect(response.status()).toBe(200);if(first){first=false;await route.abort('connectionreset');}else await route.fulfill({response});});
 await page.locator('[data-decision="approve"]').click();await page.locator('#amendmentDecisionForm [name="comment"]').fill('تأیید حقوقی <script>bad()</script>');await page.locator('[data-action="save-amendment-decision"]').click();await expect(page.locator('#modalError')).toBeVisible();await expect(page.locator('#amendmentDecisionForm [name="comment"]')).toHaveValue('تأیید حقوقی <script>bad()</script>');
 await page.locator('[data-action="save-amendment-decision"]').click();await expect(page.locator('[data-amendment-id]')).toBeVisible();await page.locator('[data-amendment-id] > summary').click();expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);await page.unroute(url);
 await expect(page.locator('[data-amendment-review]')).toContainText('بررسی مالی');await expect(page.locator('.amendment-decisions li')).toHaveCount(2);
 await decide(page,'approve','تأیید مالی');await expect(page.locator('[data-amendment-id] > summary')).toContainText('تأیید داخلی');await expect(page.locator('[data-decision="approve"]')).toHaveCount(0);await expect(page.locator('.amendment-decisions li')).toHaveCount(3);await expect(page.locator('[data-amendment-review]')).toContainText('امضای طرفین');
 await page.locator('[data-amendment-review]').evaluate(el=>el.scrollIntoView({block:'center'}));await page.screenshot({path:testInfo.outputPath(`review-${width}.png`)});
 expect(await page.locator('.modal').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();expect(errors).toEqual([]);
 const saved=await(await request.get('/api/contracts/'+c.id,{maxRetries:1})).json();expect(saved.amendments[0].financial).toEqual(a.financial);expect(saved.amendments[0].workflow.revision).toBe(3);for(const k of ['snapshot','amount','status','document','stages'])expect(saved[k]).toEqual(c[k]);
});
