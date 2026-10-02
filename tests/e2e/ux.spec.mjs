import test, { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const unique = label => `${label} ${randomUUID().slice(0,8)}`;
const normalizeNumber = value => value.replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/٫/g,'.').replace(/٪/g,'%').replace(/[,٬\s\u200e\u200f]/g,'');
const startWizard = async page => {
 await page.locator('[data-action="new-contract"]').first().click();
 await expect(page.locator('#wizardForm')).toBeVisible();
 await page.locator('[data-action="wizard-next"]').click();
 await expect(page.locator('#wizardForm [name="title"]')).toBeVisible();
};

test.beforeEach(async({page})=>{
 await page.goto('/');
 await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();
});

test('desktop global search keeps focus and the complete query while changing screens',async({page})=>{
 const search=page.locator('#globalSearch');
 await search.focus();await search.pressSequentially('قرارداد نمونه',{delay:15});
 await expect(search).toHaveValue('قرارداد نمونه');await expect(search).toBeFocused();
 await expect(page.locator('#breadcrumbCurrent')).toHaveText('قراردادها');
 await expect(page.locator('[data-search="contracts"]')).toHaveValue('قرارداد نمونه');
});

test('wizard Escape and reload preserve the current step and entered contract fields',async({page,request})=>{
 const data=await(await request.get('/api/bootstrap')).json();const title=unique('پیش‌نویس قابل بازیابی');
 await startWizard(page);await page.locator('#wizardForm [name="customerId"]').selectOption(data.customers[0].id);
 await page.locator('#wizardForm [name="title"]').fill(title);await page.locator('#wizardForm [name="owner"]').fill('مالک پیش‌نویس');
 await page.locator('#wizardForm [name="amount"]').fill('۱۵٬۰۰۰');await page.locator('#wizardForm [name="end"]').fill('2027-12-31');
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await page.evaluate(()=>sessionStorage.getItem('neocontract-wizard-draft:' + document.querySelector('#tenantSelect').value))).toContain(title);
 await page.reload();await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();
 await page.locator('[data-action="new-contract"]').first().click();
 await expect(page.locator('[data-action="start-fresh-wizard"]')).toBeVisible();await page.locator('#modalRoot [data-action="resume-wizard"]').click();
 await expect(page.locator('#wizardForm [name="title"]')).toHaveValue(title);await expect(page.locator('#wizardForm [name="customerId"]')).toHaveValue(data.customers[0].id);
 await expect(page.locator('#wizardForm [name="owner"]')).toHaveValue('مالک پیش‌نویس');await expect(page.locator('#wizardForm [name="end"]')).toHaveValue('2027-12-31');
 expect(normalizeNumber(await page.locator('#wizardForm [name="amount"]').inputValue())).toBe('15000');
});

test('dirty form dismissal preserves edits until confirmed and modal keyboard focus stays contained',async({page})=>{
 await page.locator('[data-view="customers"]').first().click();const opener=page.locator('[data-action="new-customer"]');await opener.click();
 const name=page.locator('#entityForm [name="name"]');await name.fill('نام ذخیره‌نشده برای آزمون');
 expect(await page.locator('#app').evaluate(el=>el.inert)).toBe(true);
 await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toBeVisible();await expect(name).toHaveValue('نام ذخیره‌نشده برای آزمون');
 await page.locator('[data-action="keep-editing"]').click();await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(name).toHaveValue('نام ذخیره‌نشده برای آزمون');
 await page.locator('.modal-close').focus();await page.keyboard.press('/');
 await expect(page.locator('#globalSearch')).not.toBeFocused();expect(await page.locator('#modalRoot').evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Shift+Tab');expect(await page.locator('#modalRoot').evaluate(el=>el.contains(document.activeElement))).toBe(true);
 await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toBeVisible();await page.locator('[data-action="discard-changes"]').click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(opener).toBeFocused();
 expect(await page.locator('#app').evaluate(el=>el.inert)).toBe(false);
});

test('catalog keyboard selection retains focus, collapsed centers and editable selection review',async({page})=>{
 await page.locator('[data-view="catalog"]').first().click();await expect(page.locator('[data-service]')).toHaveCount(87);
 const firstCenter=page.locator('[data-center-id="abrgan"]'),otherCenter=page.locator('[data-center-id="karavan"]');
 expect(await firstCenter.evaluate(el=>el.open)).toBe(true);expect(await otherCenter.evaluate(el=>el.open)).toBe(false);
 const first=page.locator('[data-service="ABR-01"]'),second=page.locator('[data-service="ABR-02"]');
 await first.focus();await page.keyboard.press('Space');await expect(first).toBeChecked();await expect(first).toBeFocused();expect(await otherCenter.evaluate(el=>el.open)).toBe(false);
 await second.focus();await page.keyboard.press('Space');await expect(second).toBeChecked();await expect(second).toBeFocused();expect(await otherCenter.evaluate(el=>el.open)).toBe(false);
 await page.locator('[data-action="selected-only"]').click();await expect(page.locator('[data-service]:visible')).toHaveCount(2);
 await page.locator('[data-action="selection-review"]').first().click();await expect(page.getByRole('dialog')).toBeVisible();
 await page.locator('[data-action="selection-remove"][data-id="ABR-01"]').click();await expect(page.locator('[data-action="selection-remove"][data-id="ABR-01"]')).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.locator('[data-action="catalog-reset"]').click();await expect(page.locator('[data-service]')).toHaveCount(87);
 await expect(first).not.toBeChecked();await expect(second).toBeChecked();expect(await otherCenter.evaluate(el=>el.open)).toBe(false);
});

test('discarding a stored wizard requires confirmation and then starts a clean contract',async({page})=>{
 await startWizard(page);await page.locator('#wizardForm [name="title"]').fill('این پیش‌نویس عمداً حذف می‌شود');await page.keyboard.press('Escape');
 await page.locator('[data-action="discard-wizard"]').first().click();await expect(page.getByRole('alertdialog')).toBeVisible();
 await page.locator('[data-action="keep-editing"]').click();expect(await page.evaluate(()=>sessionStorage.getItem('neocontract-wizard-draft:' + document.querySelector('#tenantSelect').value))).not.toBeNull();
 await page.locator('[data-action="discard-wizard"]').first().click();await page.locator('[data-action="discard-changes"]').click();
 expect(await page.evaluate(()=>sessionStorage.getItem('neocontract-wizard-draft:' + document.querySelector('#tenantSelect').value))).toBeNull();
 await startWizard(page);await expect(page.locator('#wizardForm [name="title"]')).toHaveValue('');
});

test('mobile navigation traps focus, closes with Escape and opens focused contract search',async({page})=>{
 await page.setViewportSize({width:390,height:844});const toggle=page.locator('.hamburger');await toggle.click();
 await expect(toggle).toHaveAttribute('aria-expanded','true');expect(await page.locator('.main-content').evaluate(el=>el.inert)).toBe(true);
 for(let i=0;i<20;i++){await page.keyboard.press('Tab');expect(await page.locator('#sidebar').evaluate(el=>el.contains(document.activeElement))).toBe(true);}
 await page.keyboard.press('Escape');await expect(toggle).toHaveAttribute('aria-expanded','false');await expect(toggle).toBeFocused();expect(await page.locator('.main-content').evaluate(el=>el.inert)).toBe(false);
 await page.locator('[data-action="global-search"]').click();const search=page.locator('[data-search="contracts"]');await expect(search).toBeFocused();
 await search.pressSequentially('مشتری نمونه',{delay:15});await expect(search).toHaveValue('مشتری نمونه');await expect(search).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('creating a customer inside the wizard returns to the same contract with the new customer selected',async({page,request})=>{
 const name=unique('مشتری مسیر کوتاه'),title=unique('قرارداد در حال تکمیل');
 await startWizard(page);await page.locator('#wizardForm [name="title"]').fill(title);await page.locator('[data-action="wizard-add-customer"]').click();
 await page.locator('#entityForm [name="name"]').fill(name);await page.locator('[data-action="save-entity"]').click();
 await expect(page.locator('#wizardForm [name="customerId"]')).toBeVisible();await expect(page.locator('#wizardForm [name="title"]')).toHaveValue(title);
 const matches=(await(await request.get('/api/customers')).json()).filter(c=>c.name===name);expect(matches).toHaveLength(1);
 await expect(page.locator('#wizardForm [name="customerId"]')).toHaveValue(matches[0].id);await expect(page.locator('#wizardForm [name="party"]')).toHaveValue(name);
});

test('Persian money digits and grouping separators become the exact stored numeric amount',async({page,request})=>{
 const data=await(await request.get('/api/bootstrap')).json(),title=unique('مبلغ فارسی');
 await startWizard(page);await page.locator('#wizardForm [name="customerId"]').selectOption(data.customers[0].id);await page.locator('#wizardForm [name="title"]').fill(title);
 await page.locator('#wizardForm [name="owner"]').fill('مالک آزمون مبلغ');await page.locator('#wizardForm [name="amount"]').fill('۱۲۳٬۴۵۶٬۷۸۹');
 await page.locator('#wizardForm [name="start"]').fill('2026-10-01');await page.locator('#wizardForm [name="end"]').fill('2027-10-01');await page.locator('[data-action="wizard-next"]').click();
 await page.locator('#wizardForm [name="paymentTerms"]').fill('پرداخت آزمون مبلغ فارسی');await page.locator('[data-action="wizard-next"]').click();
 const [preview]=await Promise.all([page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname==='/api/contracts/preview'),page.locator('[data-action="wizard-next"]').click()]);
 expect(preview.postDataJSON().amount).toBe(123456789);await expect(page.locator('.document-paper')).toContainText(title);
 const [response]=await Promise.all([page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/contracts'),page.locator('[data-action="wizard-create"]').click()]);
 expect(response.status()).toBe(201);const created=await response.json();const stored=await(await request.get('/api/contracts/'+created.id)).json();
 expect(stored.amount).toBe(123456789);expect(stored.snapshot.terms.amount).toBe(123456789);
});

test('service details render the actual source SLA objects and availability percentage',async({page})=>{
 const {catalog}=JSON.parse(await readFile(new URL('../../planning/fanasa-catalog-current.json',import.meta.url),'utf8'));const source=catalog.services.find(s=>s.code==='ABR-01');
 await page.route('**/api/bootstrap',async route=>{const response=await route.fetch();const data=await response.json();await route.fulfill({response,json:{...data,catalog:{...catalog,operatorReview:{status:'unreviewed',importId:null,reviewedAt:null}}}});});
 await page.reload();await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();await page.locator('[data-view="catalog"]').first().click();await page.locator('[data-action="service-info"][data-id="ABR-01"]').click();
 const dialog=page.getByRole('dialog');await expect(dialog).not.toContainText('[object Object]');await expect(dialog).toContainText(source.sla.response.raw);await expect(dialog).toContainText(source.sla.resolution.raw);
 const availability=page.locator('#modalRoot .summary-list > div').filter({hasText:'دسترس‌پذیری'}).locator('b');
 expect(normalizeNumber(await availability.innerText())).toContain(String(source.sla.availabilityPercent)+'%');
});

test('template stage-only edits are retained until a dirty close is confirmed',async({page})=>{
 await page.locator('[data-view="templates"]').first().click();await page.locator('[data-action="new-template"]').click();
 const stages=page.locator('#templateForm [data-stage-row]');const initial=await stages.count();
 await page.locator('[data-action="stage-add"]').click();await expect(stages).toHaveCount(initial+1);
 await page.keyboard.press('Escape');await expect(page.getByRole('alertdialog')).toBeVisible();
 await page.locator('[data-action="keep-editing"]').click();await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(stages).toHaveCount(initial+1);
 await page.keyboard.press('Escape');await page.locator('[data-action="discard-changes"]').click();await expect(page.locator('#templateForm')).toHaveCount(0);
 await page.locator('[data-action="new-template"]').click();await expect(stages).toHaveCount(initial);
});

test('wizard template search retains complete input and selecting the same template preserves custom text',async({page,request})=>{
 const data=await(await request.get('/api/bootstrap')).json();
 await page.locator('[data-action="new-contract"]').first().click();
 const selected=await page.locator('[data-action="wizard-template"][aria-pressed="true"]').getAttribute('data-id');
 const search=page.locator('[data-search="wizard-templates"]');await search.focus();await search.pressSequentially('خدمات',{delay:15});await expect(search).toHaveValue('خدمات');await expect(search).toBeFocused();
 await search.fill('');await expect(search).toBeFocused();await page.locator('[data-action="wizard-next"]').click();
 await page.locator('#wizardForm [name="customerId"]').selectOption(data.customers[0].id);await page.locator('#wizardForm [name="title"]').fill(unique('متن سفارشی پایدار'));
 await page.locator('#wizardForm [name="amount"]').fill('1000');await page.locator('#wizardForm [name="start"]').fill('2026-10-01');await page.locator('#wizardForm [name="end"]').fill('2027-10-01');
 await page.locator('[data-action="wizard-next"]').click();const custom='متن سفارشی نگه‌داری‌شده برای {{title}}';await page.locator('#wizardForm .body-editor-disclosure > summary').click();await page.locator('#wizardForm [name="body"]').fill(custom);
 await page.locator('[data-action="wizard-back"]').click();await page.locator('[data-action="wizard-back"]').click();
 await page.locator('[data-action="wizard-template"][data-id="'+selected+'"]').click();await expect(page.getByRole('alertdialog')).toHaveCount(0);
 await page.locator('[data-action="wizard-next"]').click();await page.locator('[data-action="wizard-next"]').click();await page.locator('#wizardForm .body-editor-disclosure > summary').click();await expect(page.locator('#wizardForm [name="body"]')).toBeVisible();await expect(page.locator('#wizardForm [name="body"]')).toHaveValue(custom);
});

test('a delayed customer save freezes the form and closes only after the single request succeeds',async({page,request})=>{
 let release;const gate=new Promise(resolve=>release=resolve);let posts=0;const name=unique('ذخیره با تأخیر');
 await page.route('**/api/customers',async route=>{if(route.request().method()!=='POST')return route.continue();posts++;await gate;await route.continue();});
 try{
  await page.locator('[data-view="customers"]').first().click();await page.locator('[data-action="new-customer"]').click();await page.locator('#entityForm [name="name"]').fill(name);
  await page.locator('[data-action="save-entity"]').click();await expect.poll(()=>posts).toBe(1);await expect(page.getByRole('dialog')).toHaveAttribute('aria-busy','true');
  await expect(page.locator('#entityForm [name="name"]')).toBeDisabled();await expect(page.locator('[data-action="save-entity"]')).toBeDisabled();await expect(page.locator('.modal-close')).toBeDisabled();
  await page.keyboard.press('Escape');await expect(page.locator('#entityForm')).toBeVisible();await expect(page.getByRole('alertdialog')).toHaveCount(0);expect(posts).toBe(1);
  const responsePromise=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/customers');release();expect((await responsePromise).ok()).toBe(true);
  await expect(page.locator('#entityForm')).toHaveCount(0);await expect(page.locator('tr[data-search-row]').filter({hasText:name})).toBeVisible();
  const stored=(await(await request.get('/api/customers')).json()).filter(c=>c.name===name);expect(stored).toHaveLength(1);expect(posts).toBe(1);
 }finally{release();}
});

async function createUiFixture(request){
 const data=await(await request.get('/api/bootstrap')).json();const template=data.templates.find(t=>t.status==='published'),customer=data.customers[0];
 expect(template).toBeTruthy();const response=await request.post('/api/contracts',{data:{templateId:template.id,templateVersionId:template.templateVersionId,customerId:customer.id,title:unique('قرارداد آزمون پاسخ دیرهنگام'),party:customer.name,amount:1000,owner:'مالک آزمون',start:'2026-10-01',end:'2027-10-01',paymentTerms:'پرداخت توافقی',services:[]}});
 expect(response.status()).toBe(201);return response.json();
}
const settleUi=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

test('a delayed contract detail response cannot replace a subsequently opened contract wizard',async({page,request})=>{
 const contract=await createUiFixture(request);await page.reload();await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();await page.locator('[data-view="contracts"]').first().click();
 let release;const gate=new Promise(resolve=>release=resolve);let requested=0;
 await page.route('**/api/contracts/'+contract.id,async route=>{requested++;const response=await route.fetch();await gate;await route.fulfill({response});});
 try{
  await page.locator('button.contract-link[data-id="'+contract.id+'"]').click();await expect.poll(()=>requested).toBe(1);
  await startWizard(page);const title=unique('فرم جدید باید باقی بماند');await page.locator('#wizardForm [name="title"]').fill(title);
  const delivered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/contracts/'+contract.id);release();await(await delivered).finished();await settleUi(page);
  await expect(page.locator('#wizardForm [name="title"]')).toHaveValue(title);await expect(page.locator('.detail-overview')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(1);
 }finally{release();}
});

test('a delayed Neo connection result cannot replace a customer form edited after navigation',async({page})=>{
 let release;const gate=new Promise(resolve=>release=resolve);let requested=0;const neo={status:'connected',project:'پروژه آزمون',url:'http://localhost:5181',checkedAt:'2026-09-30T08:00:00.000Z'};
 await page.route('**/api/integrations',route=>route.fulfill({json:{neo,sync:{imports:[]},database:{status:'ready'}}}));
 await page.route('**/api/integrations/neo/run',async route=>{requested++;await gate;await route.fulfill({json:{...neo,message:'نتیجه اتصال دیرهنگام'}});});
 try{
  await page.locator('[data-view="settings"]').first().click();await page.locator('[data-action="check-neo"]').click();await expect.poll(()=>requested).toBe(1);
  await page.locator('[data-view="customers"]').first().click();await page.locator('[data-action="new-customer"]').click();const name=unique('ویرایش هم‌زمان با بررسی اتصال');await page.locator('#entityForm [name="name"]').fill(name);
  const delivered=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/integrations/neo/run');release();await(await delivered).finished();await settleUi(page);
  await expect(page.locator('#entityForm [name="name"]')).toHaveValue(name);await expect(page.locator('.integration-result')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(1);expect(requested).toBe(1);
 }finally{release();}
});

test('returning from a dirty amendment to contract details requires an explicit discard',async({page,request})=>{
 const contract=await createUiFixture(request);await page.reload();await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();await page.locator('[data-view="contracts"]').first().click();
 await page.locator('button.contract-link[data-id="'+contract.id+'"]').click();await expect(page.locator('#modalTitle')).toContainText(contract.title);
 await page.locator('[data-action="detail-tab"][data-tab="document"]').click();await page.locator('[data-action="new-amendment"]').click();const title=unique('الحاقیه ذخیره‌نشده');await page.locator('#amendmentForm [name="title"]').fill(title);
 await page.locator('[data-action="detail-back"]').click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.locator('[data-action="keep-editing"]').click();await expect(page.locator('#amendmentForm [name="title"]')).toHaveValue(title);
 await page.locator('[data-action="detail-back"]').click();await expect(page.getByRole('alertdialog')).toBeVisible();await page.locator('[data-action="discard-changes"]').click();await expect(page.locator('#amendmentForm')).toHaveCount(0);await expect(page.locator('.document-actions')).toBeVisible();
 const stored=await(await request.get('/api/contracts/'+contract.id)).json();expect(stored.amendments).toHaveLength(0);
});
