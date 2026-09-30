import {test,expect} from '@playwright/test';

test('holding CRM, versioned template, catalog and custom contract work through the Persian UI',async({page,request})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();
 await page.locator('[data-view="managers"]').first().click();await page.locator('[data-action="new-manager"]').click();
 await page.locator('#entityForm [name="name"]').fill('مدیر حساب آزمون');await page.locator('#entityForm [name="email"]').fill('account@example.test');await page.locator('[data-action="save-entity"]').click();await expect(page.getByRole('heading',{name:'مدیر حساب آزمون',exact:true})).toBeVisible();
 let data=await (await request.get('/api/bootstrap')).json();const manager=data.managers.find(x=>x.name==='مدیر حساب آزمون');
 await page.locator('[data-view="customers"]').first().click();await page.locator('[data-action="new-customer"]').click();await page.locator('#entityForm [name="name"]').fill('شرکت تابع آزمون');await page.locator('#entityForm [name="parentId"]').selectOption(data.customers[0].id);await page.locator('#entityForm [name="managerId"]').selectOption(manager.id);await page.locator('#entityForm [name="unit"]').fill('مرکز خدمات');await page.locator('[data-action="save-entity"]').click();await expect(page.locator('tr[data-search-row]').filter({hasText:'شرکت تابع آزمون'})).toBeVisible();
 data=await (await request.get('/api/bootstrap')).json();const customer=data.customers.find(x=>x.name==='شرکت تابع آزمون');
 await page.locator('[data-view="templates"]').first().click();await page.locator('[data-action="new-template"]').click();await page.locator('#templateForm [name="title"]').fill('الگوی اختصاصی آزمون');await page.locator('#templateForm [name="body"]').fill('قرارداد {{title}} با {{party}}\nخدمات: {{services}}\nتعهدات: {{sla}}\nمبلغ {{amount}} ریال\n{{paymentTerms}}');await page.locator('[data-action="save-template"]').click();await expect(page.locator('.template-card').filter({hasText:'الگوی اختصاصی آزمون'})).toBeVisible();await page.locator('.template-card').filter({hasText:'الگوی اختصاصی آزمون'}).locator('[data-action="publish-template"]').click();await expect(page.locator('.template-card').filter({hasText:'الگوی اختصاصی آزمون'}).locator('[data-action="use-template"]')).toBeVisible();
 data=await (await request.get('/api/bootstrap')).json();const template=data.templates.find(x=>x.title==='الگوی اختصاصی آزمون');
 await page.locator('[data-view="catalog"]').first().click();await expect(page.locator('[data-service]')).toHaveCount(87);await page.locator('[data-service="ABR-01"]').check();await page.locator('[data-action="catalog-contract"]').first().click();await page.locator(`[data-action="wizard-template"][data-id="${template.id}"]`).click();await page.locator('[data-action="wizard-next"]').click();
 await page.locator('#wizardForm [name="customerId"]').selectOption(customer.id);await expect(page.locator('#wizardForm [name="managerId"]')).toHaveValue(manager.id);await expect(page.locator('#wizardForm [name="party"]')).toHaveValue('شرکت تابع آزمون');
 await page.locator('#wizardForm [name="title"]').fill('قرارداد کامل آزمایش مرورگر');await page.locator('#wizardForm [name="owner"]').fill('مسئول آزمون');await page.locator('#wizardForm [name="amount"]').fill('240000000');await page.locator('#wizardForm [name="start"]').fill('2026-10-01');await page.locator('#wizardForm [name="end"]').fill('2027-10-01');await page.locator('[data-action="wizard-next"]').click();
 await page.locator('[name="slaTier"]').selectOption('T2');await page.locator('#wizardForm [name="delivery"]').selectOption('managed');await page.locator('[name="quantity"]').fill('10');await page.locator('[name="unitPrice"]').fill('24000000');await page.locator('[name="paymentTerms"]').fill('پرداخت ماهانه پس از پذیرش خدمات');await page.locator('[data-action="wizard-next"]').click();
 await page.locator('[data-action="stage-add"]').click();const added=page.locator('[data-stage-row]').last();await added.locator('[name="stageName"]').fill('بررسی مدیر حساب');await added.locator('[name="stageRole"]').selectOption({label:'مدیر حساب'});await added.locator('[name="stageDays"]').fill('1');await added.locator('[data-action="stage-up"]').click();await page.locator('[data-action="wizard-next"]').click();
 await expect(page.locator('.document-paper')).toContainText('قرارداد کامل آزمایش مرورگر');await expect(page.locator('.document-paper')).toContainText('ABR-01');await page.locator('[data-action="wizard-create"]').click();await expect(page.locator('#modalTitle')).toContainText('قرارداد کامل آزمایش مرورگر');
 data=await (await request.get('/api/bootstrap')).json();const contract=data.contracts.find(x=>x.title==='قرارداد کامل آزمایش مرورگر');expect(contract.snapshot.customer.name).toBe('شرکت تابع آزمون');expect(contract.services[0].slaTier).toBe('T2');expect(contract.stages).toHaveLength(5);expect(contract.status).toBe('draft');
 await page.reload();await page.locator('[data-view="contracts"]').first().click();await page.locator('[data-search="contracts"]').fill('قرارداد کامل');await expect(page.locator('button.contract-link')).toHaveCount(1);await page.locator('button.contract-link').click();await page.locator('[data-action="advance-dialog"]').click();await page.locator('#advanceForm [name="comment"]').fill('شروع فرآیند در آزمون');await page.locator('[data-action="advance-contract"]').click();await expect(page.locator('#modalRoot')).toContainText('در جریان');
 await page.locator('[data-action="detail-tab"][data-tab="document"]').click();await page.locator('[data-action="new-amendment"]').click();await page.locator('[name="title"]').fill('الحاقیه آزمون');await page.locator('[name="reason"]').fill('تغییر دامنه خدمات');await page.locator('[name="body"]').fill('دامنه جدید پس از تأیید طرفین اعمال می‌شود.');await page.locator('[data-action="save-amendment"]').click();
 const after=await (await request.get(`/api/contracts/${contract.id}`)).json();expect(after.amendments).toHaveLength(1);expect(after.status).toBe('in_process');expect(after.snapshot).toEqual(contract.snapshot);
 expect(errors).toEqual([]);
});

test('mobile menu, RTL catalog and keyboard modal remain usable without page overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();
 const sidebar=page.locator('#sidebar');expect(await sidebar.evaluate(el=>el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(389);
 await page.locator('.hamburger').click();await expect(sidebar).toHaveClass(/open/);await sidebar.locator('[data-view="catalog"]').click();await expect(sidebar).not.toHaveClass(/open/);await expect(page.locator('[data-service]')).toHaveCount(87);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();await page.locator('[data-service="ABR-01"]').check();await page.locator('[data-action="catalog-contract"]').first().click();await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('published process remains visible and stale publication requires review of the newer draft',async({page,request})=>{
 const data=await(await request.get('/api/bootstrap')).json();
 const base=data.templates.find(x=>x.code==='usage');
 let response=await request.post('/api/templates',{data:{...base,title:'فرآیند منتشرشده آزمون',body:'نسخه نخست برای {{title}}'}});expect(response.status()).toBe(201);let template=await response.json();
 const tokens=t=>({revision:t.revision,templateVersionId:t.templateVersionId});
 response=await request.post('/api/templates/'+template.id+'/publish',{data:tokens(template)});expect(response.status()).toBe(200);template=await response.json();
 response=await request.put('/api/templates/'+template.id,{data:{...template,title:'پیش‌نویس دوم آزمون',body:'نسخه دوم برای {{title}}'}});expect(response.status()).toBe(200);template=await response.json();
 await page.goto('/');await page.locator('[data-view="processes"]').first().click();
 await expect(page.getByRole('heading',{name:'فرآیند منتشرشده آزمون',exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'پیش‌نویس دوم آزمون',exact:true})).toHaveCount(0);
 await page.locator('[data-view="templates"]').first().click();
 const staleCard=page.locator('.template-card').filter({hasText:'پیش‌نویس دوم آزمون'});await expect(staleCard).toBeVisible();
 response=await request.put('/api/templates/'+template.id,{data:{...template,title:'نسخه ویرایش‌شده همکار',body:'محتوای جدید همکار برای {{title}}'}});expect(response.status()).toBe(200);
 await staleCard.locator('[data-action="publish-template"]').click();
 const freshCard=page.locator('.template-card').filter({hasText:'نسخه ویرایش‌شده همکار'});await expect(freshCard).toBeVisible();
 const current=(await(await request.get('/api/templates')).json()).find(x=>x.id===template.id);expect(current.status).toBe('draft');
 await freshCard.locator('[data-action="template-preview"]').click();await expect(page.locator('.document-paper')).toContainText('محتوای جدید همکار');await page.locator('[data-action="close-modal"]').first().click();
 await freshCard.locator('[data-action="publish-template"]').click();await expect(freshCard.locator('[data-action="publish-template"]')).toHaveCount(0);
 const published=(await(await request.get('/api/templates')).json()).find(x=>x.id===template.id);expect(published.status).toBe('published');expect(published.body).toBe('محتوای جدید همکار برای {{title}}');expect(published.versions.find(v=>v.version===1).title).toBe('فرآیند منتشرشده آزمون');
});
