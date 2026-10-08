import {test,expect} from '@playwright/test';
const fixture=name=>({name,bases:[{id:'compute',name:'پردازش',unit:'هسته‌ساعت',amount:1000,source:'استعلام'},{id:'storage',name:'ذخیره‌سازی',unit:'گیگابایت‌ماه',amount:200}],items:[{id:'a',title:'بسته اول',quantity:2,components:[{baseId:'compute',coefficient:3},{baseId:'storage',coefficient:5}]},{id:'b',title:'بسته دوم',quantity:4,components:[{baseId:'compute',coefficient:1}]}]});

for(const width of [1440,390])test(`live price impact and historical comparison preserve draft and isolate tenant at ${width}px`,async({page,request})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:width===390?844:1000});
 const model=fixture('مقایسه '+width),created=await request.post('/api/pricing-plans',{data:{model}});expect(created.status()).toBe(201);const plan=await created.json();
 await page.goto('/#view=pricing');await page.locator(`[data-p-action="load"][data-id="${plan.id}"]`).click();
 const amount=page.locator('[data-p-field="bases.0.amount"]'),baseline=page.getByRole('combobox',{name:'نسخه مبنای مقایسه'});
 await expect(page.locator('[data-p-comparison-unchanged]')).toBeVisible();await amount.fill('2000');await expect(amount).toBeFocused();
 await expect(page.locator('[data-p-before-total]')).toContainText('۱۲٬۰۰۰');await expect(page.locator('[data-p-after-total]')).toContainText('۲۲٬۰۰۰');await expect(page.locator('[data-p-delta]')).toContainText('افزایش ۱۰٬۰۰۰');
 await expect(page.locator('[data-p-impact="base"]')).toHaveCount(1);await expect(page.locator('[data-p-impact="item"]')).toHaveCount(2);
 await amount.fill('');await expect(page.locator('[data-p-comparison-error]')).toBeVisible();await expect(page.locator('[data-p-delta]')).toHaveCount(0);await amount.fill('2000');
 await page.locator('[data-p-action="save"]').click();await expect(page.locator('[data-p-dirty]')).toHaveText('');await expect(baseline.locator('option')).toHaveCount(2);await expect(baseline).toHaveValue('2');
 await expect(page.locator('[data-p-delta]')).toHaveText('بدون تغییر');await baseline.selectOption('1');await expect(page.locator('[data-p-delta]')).toContainText('۱۰٬۰۰۰');
 await amount.fill('2500');await baseline.selectOption('2');await expect(amount).toHaveValue('2500');await expect(page.locator('[data-p-delta]')).toContainText('۵٬۰۰۰');
 await page.reload();await expect(baseline).toHaveValue('2');await expect(amount).toHaveValue('2500');await expect(page.locator('[data-p-delta]')).toContainText('۵٬۰۰۰');
 expect((await(await request.get('/api/pricing-plans/'+plan.id)).json()).model.bases[0].amount).toBe(2000);
 await page.locator('.pricing-impact-details>summary').click();await expect(page.locator('[data-p-impact="item"]').first()).toBeVisible();
 await amount.fill('2600');await expect(page.locator('.pricing-impact-details')).toHaveAttribute('open','');await expect(page.locator('[data-p-delta]')).toContainText('۶٬۰۰۰');await amount.fill('2500');
 await page.locator('[data-p-comparison]').scrollIntoViewIfNeeded();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`artifacts/pricing-impact-${width}.png`,fullPage:false});
 if(width===390)await page.locator('.hamburger').click();await page.locator('#tenantSelect').selectOption('00000000-0000-0000-0000-000000000002');await expect(page.locator('#tenantSelect')).toBeEnabled();await expect(page.locator('[data-p-comparison]')).toHaveText('');
 if(width===390)await page.locator('.hamburger').click();await page.locator('#tenantSelect').selectOption('00000000-0000-0000-0000-000000000001');await expect(page.locator('#tenantSelect')).toBeEnabled();await expect(baseline).toHaveValue('2');await expect(amount).toHaveValue('2500');
 expect(errors).toEqual([]);
});

test('viewer can compare an experimental price without a save action or server mutation',async({page,request})=>{
 const created=await request.post('/api/pricing-plans',{data:{model:fixture('مقایسه مشاهده‌گر')}}),plan=await created.json();
 const data=await(await request.get('/api/bootstrap')).json();data.access={mode:'oidc-proxy',identity:{id:'viewer',name:'مشاهده‌گر',roles:['viewer']}};
 const tenants=await(await request.get('/api/tenants')).json();await page.route('**/api/tenants',route=>route.fulfill({json:{...tenants,mode:'oidc-proxy'}}));
 await page.route('**/api/bootstrap',route=>route.fulfill({json:data}));
 await page.goto('/#view=pricing');await page.locator(`[data-p-action="load"][data-id="${plan.id}"]`).click();
 await page.locator('[data-p-field="bases.0.amount"]').fill('2000');await expect(page.locator('[data-p-delta]')).toContainText('۱۰٬۰۰۰');await expect(page.locator('[data-p-action="save"]')).toHaveCount(0);
 expect((await(await request.get('/api/pricing-plans/'+plan.id)).json()).revision).toBe(1);
});

test('legacy draft without its saved baseline cannot silently compare against a newer server version',async({page,request})=>{
 const model=fixture('پیش‌نویس قدیمی'),created=await request.post('/api/pricing-plans',{data:{model}}),plan=await created.json();
 await page.goto('/#view=pricing');await page.locator(`[data-p-action="load"][data-id="${plan.id}"]`).click();await page.locator('[data-p-field="bases.0.amount"]').fill('3000');
 await page.evaluate(()=>{const key='neocontract-pricing-draft:00000000-0000-0000-0000-000000000001',d=JSON.parse(sessionStorage.getItem(key));delete d.baseline;delete d.compareRevision;d.history=[];sessionStorage.setItem(key,JSON.stringify(d));});
 model.bases[0].amount=2000;expect((await request.put('/api/pricing-plans/'+plan.id,{data:{model,revision:1}})).ok()).toBe(true);
 await page.reload();await expect(page.locator('[data-p-field="bases.0.amount"]')).toHaveValue('3000');await expect(page.locator('[data-p-comparison]')).toContainText('نسخه مبنا در دسترس نیست');await expect(page.locator('[data-p-delta]')).toHaveCount(0);await expect(page.getByRole('combobox',{name:'نسخه مبنای مقایسه'})).toBeDisabled();
});
