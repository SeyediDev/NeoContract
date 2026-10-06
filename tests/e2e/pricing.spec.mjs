import {test,expect} from '@playwright/test';

test('dynamic pricing edits multiple dependent items, persists revisions and captures the contract quote',async({page,request})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#view=pricing');await expect(page.getByRole('heading',{name:'قیمت‌گذاری پویا',exact:true})).toBeVisible();
 const f=path=>page.locator(`[data-p-field="${path}"]`);
 await f('name').fill('مدل آزمون رابط');await f('bases.0.name').fill('پردازش');await f('bases.0.unit').fill('هسته‌ساعت');await f('bases.0.amount').fill('1000');
 await page.locator('[data-p-action="base-add"]').click();await f('bases.1.name').fill('ذخیره‌سازی');await f('bases.1.unit').fill('گیگابایت‌ماه');await f('bases.1.amount').fill('200');
 await f('items.0.title').fill('بسته اول');await f('items.0.quantity').fill('2');await f('items.0.serviceCode').selectOption('ABR-01');await f('items.0.components.0.coefficient').fill('3');
 await page.locator('[data-p-action="component-add"][data-index="0"]').click();await f('items.0.components.1.coefficient').fill('5');
 await page.locator('[data-p-action="item-add"]').click();await f('items.1.title').fill('بسته دوم');await f('items.1.quantity').fill('4');
 await expect(page.locator('[data-p-total]')).toContainText('۱۲٬۰۰۰');
 await f('bases.0.amount').fill('2000');await expect(f('bases.0.amount')).toBeFocused();await expect(page.locator('[data-p-line="0"]')).toContainText('۱۴٬۰۰۰');await expect(page.locator('[data-p-line="1"]')).toContainText('۸٬۰۰۰');
 await f('bases.0.amount').fill('1000');await page.screenshot({path:'artifacts/pricing-desktop.png',fullPage:true});
 await page.locator('[data-p-action="save"]').click();await expect(page.locator('[data-p-dirty]')).toHaveText('');
 let data=await(await request.get('/api/bootstrap')).json();const plan=data.pricingPlans.find(p=>p.name==='مدل آزمون رابط');expect(plan.total).toBe(12000);
 await page.reload();await expect(f('name')).toHaveValue('مدل آزمون رابط');await expect(page.locator('[data-p-total]')).toContainText('۱۲٬۰۰۰');
 await page.locator('[data-view="catalog"]').first().click();await page.locator('[data-service="ABR-01"]').check();await page.locator('[data-action="catalog-contract"]').first().click();
 const template=data.templates.find(t=>t.code==='purchase');await page.locator(`[data-action="wizard-template"][data-id="${template.id}"]`).click();await page.locator('[data-action="wizard-next"]').click();
 await page.locator('#wizardForm [name="title"]').fill('قرارداد پویای آزمون');await page.locator('#wizardForm [name="customerId"]').selectOption(data.customers[0].id);await page.locator('#wizardForm [name="end"]').fill('2027-10-01');
 await page.locator('[data-p-select]').selectOption(plan.id);await expect(page.locator('#wizardForm [name="amount"]')).toHaveValue('12000');await expect(page.locator('#wizardForm [name="amount"]')).toHaveAttribute('readonly','');
 await page.locator('[data-action="wizard-next"]').click();await f('bases.0.amount').fill('2000');await expect(page.locator('[data-p-total]')).toContainText('۲۲٬۰۰۰');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await page.locator('[data-view="dashboard"]').first().click();await page.locator('[data-action="resume-wizard"]').click();await expect(f('bases.0.amount')).toHaveValue('2000');await expect(page.locator('[data-p-total]')).toContainText('۲۲٬۰۰۰');
 await page.locator('#wizardForm [name="slaTier"]').selectOption('T1');await page.locator('#wizardForm [name="delivery"]').selectOption('managed');await expect(page.locator('#wizardForm [name="unitPrice"]')).toHaveValue('7000');await expect(page.locator('#wizardForm [name="quantity"]')).toHaveValue('2');
 await page.locator('[data-action="wizard-next"]').click();await page.locator('[data-action="wizard-next"]').click();await expect(page.locator('.document-paper')).toContainText('پیوست قیمت‌گذاری پویا');await page.locator('[data-action="wizard-create"]').click();await expect(page.locator('.pricing-captured')).toContainText('۲۲٬۰۰۰');
 data=await(await request.get('/api/bootstrap')).json();const c=data.contracts.find(c=>c.title==='قرارداد پویای آزمون');expect(c.amount).toBe(22000);expect(c.snapshot.pricing.total).toBe(22000);expect(data.pricingPlans.find(p=>p.id===plan.id).total).toBe(12000);
 const doc=await request.get(`/api/contracts/${c.id}/document`);expect(doc.ok()).toBeTruthy();expect(await doc.text()).toContain('مراکز خدمات قرارداد');expect(await doc.text()).toContain('پیوست قیمت‌گذاری پویا');
 await page.locator('[data-action="detail-tab"][data-tab="document"]').click();const [printRequest]=await Promise.all([page.waitForRequest(r=>new URL(r.url()).pathname===`/api/contracts/${c.id}/document`),page.locator('.document-actions [data-action="print-document"]').click()]);expect(printRequest.headers()['x-tenant-id']).toBe(data.tenant.id);await expect(page.frameLocator('.print-frame').locator('h1')).toHaveText(c.title);await expect(page.frameLocator('.print-frame').locator('header svg')).toHaveCount(1);
 const changed=structuredClone(plan.model);changed.bases[0].amount=3000;const saved=await request.put('/api/pricing-plans/'+plan.id,{data:{model:changed,revision:1}});expect(saved.ok()).toBeTruthy();
 const after=await(await request.get('/api/contracts/'+c.id)).json();expect(after.snapshot).toEqual(c.snapshot);
 expect(errors).toEqual([]);
});

test('all official center logos and mobile pricing render in RTL without overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#view=catalog');await expect(page.locator('.catalog-center')).toHaveCount(14);await page.evaluate(()=>document.fonts.ready);
 const assets=await page.locator('.catalog-center>summary .center-lockup img').evaluateAll(async imgs=>{await Promise.all(imgs.map(img=>img.decode()));return imgs.map(img=>({src:img.getAttribute('src'),width:img.naturalWidth,height:img.naturalHeight}));});
 expect(new Set(assets.map(a=>a.src)).size).toBe(14);expect(assets.every(a=>a.width>0&&a.height>0)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'artifacts/centers-mobile.png',fullPage:true});
 await page.locator('.hamburger').click();await page.locator('#sidebar [data-view="pricing"]').click();await page.locator('[data-p-field="bases.0.amount"]').fill('۱۰۰۰۰');await page.locator('[data-p-action="item-add"]').click();await expect(page.locator('[data-p-total]')).toContainText('۲۰٬۰۰۰');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>document.fonts.check('16px Vazirmatn','فن‌آسا'))).toBe(true);
 await page.screenshot({path:'artifacts/pricing-mobile.png',fullPage:true});expect(errors).toEqual([]);
 const name=page.locator('[data-p-field="name"]');await name.fill('پیش‌نویس قیمت‌گذاری این سازمان');
 await page.locator('.hamburger').click();await page.locator('#tenantSelect').selectOption('00000000-0000-0000-0000-000000000002');await expect(page.locator('#tenantSelect')).toBeEnabled();await expect(name).toHaveValue('مدل قیمت‌گذاری جدید');
 await page.locator('.hamburger').click();await page.locator('#tenantSelect').selectOption('00000000-0000-0000-0000-000000000001');await expect(page.locator('#tenantSelect')).toBeEnabled();await expect(name).toHaveValue('پیش‌نویس قیمت‌گذاری این سازمان');expect(errors).toEqual([]);
});
