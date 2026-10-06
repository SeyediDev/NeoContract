import { test, expect } from '@playwright/test';

const reviewedAt = '2026-09-30T08:00:00.000Z';
const operatorReview = status => ({ status, importId: status === 'approved' ? 'active-import' : null, reviewedAt: status === 'approved' ? reviewedAt : null });
const connected = project => ({ status: 'connected', project, projectId: 'project-test-id', url: 'http://localhost:5181', checkedAt: reviewedAt });
const integration = (neo, imports = []) => ({ neo, sync: { imports, operatorReview: operatorReview('approved') }, database: { status: 'ready' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function mockReview(page, status) {
  await page.route('**/api/bootstrap', async route => {
    const response = await route.fetch();
    const data = await response.json();
    data.catalog = { ...data.catalog, importId: 'old-reference', reviewedAt, verificationStatus: 'http-observed-unverified', operatorReview: operatorReview(status) };
    await route.fulfill({ response, json: data });
  });
}
async function open(page, view) { await page.locator('[data-view="' + view + '"]').first().click(); }
async function ready(page) { await page.goto('/'); await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible(); }

test('reviewed source, import readiness and a delayed connection preserve and save settings correctly', async ({ page, request }) => {
  const settingsBefore = (await (await request.get('/api/bootstrap')).json()).settings;
  settingsBefore.defaultPaymentTerms = 'پرداخت ماهانه پس از پذیرش خدمات';
  expect((await request.put('/api/settings', { data: settingsBefore })).ok()).toBeTruthy();
  const gate = deferred();
  const imports = [
    { id: 'approved-import', status: 'approved', reviewedAt, createdAt: reviewedAt, counts: { centers: 14, services: 87 }, httpStatus: 200 },
    { id: 'ready-import', status: 'pending', createdAt: reviewedAt, counts: { centers: 14, services: 87 }, httpStatus: 200 },
    { id: 'loading-import', status: 'pending', createdAt: reviewedAt, counts: null },
    { id: 'failed-import', status: 'failed', createdAt: reviewedAt, counts: null, error: 'upstream timeout' },
  ];
  await mockReview(page, 'approved');
  await page.route('**/api/integrations', async route => {
    await gate.promise;
    await route.fulfill({ json: integration(connected('مدیریت قراردادها'), imports) });
  });
  try {
    await ready(page);
    await open(page, 'catalog');
    await expect(page.locator('[data-operator-review="approved"]')).toContainText('بازبینی اپراتور ثبت شده');
    await expect(page.locator('[data-source-verification]')).toContainText('تأیید مستقل نشده');
    await open(page, 'settings');
    await expect(page.locator('#integrationLoadStatus')).toBeVisible();
    const name = page.locator('#settingsForm [name="organizationName"]');
    await name.fill('فضای کاری آزمون تنظیمات');
    gate.resolve();
    await expect(page.locator('#neoIntegrationPanel')).toContainText('مدیریت قراردادها');
    await expect(page.locator('#neoIntegrationPanel')).toContainText('اتصال به Neo با موفقیت برقرار است.');
    await expect(page.locator('#neoIntegrationPanel')).toContainText('آخرین بررسی');
    await expect(name).toHaveValue('فضای کاری آزمون تنظیمات');
    const history = page.locator('#fanasaImportHistory');
    await expect(history).toContainText('۸۷');
    await expect(history).toContainText('۱۴');
    await expect(history.locator('[data-action="approve-import"]')).toHaveCount(1);
    await expect(history.locator('[data-action="approve-import"]')).toHaveAttribute('data-id', 'ready-import');
    const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().method() === 'PUT');
    await page.locator('[data-action="save-settings"]').click();
    const saved = await savedResponse;
    expect(saved.ok()).toBeTruthy();
    const body = saved.request().postDataJSON();
    expect(body.workspaceName).toBe('فضای کاری آزمون تنظیمات');
    expect(body.defaultPaymentTerms).toBe(settingsBefore.defaultPaymentTerms);
    await expect(page.locator('#workspaceLabel')).toHaveText('فضای کاری آزمون تنظیمات');
    await page.reload();
    await expect(page.locator('#breadcrumbCurrent')).toHaveText('تنظیمات و اتصال‌ها');
    await expect(page.locator('#settingsForm [name="organizationName"]')).toHaveValue('فضای کاری آزمون تنظیمات');
  } finally { gate.resolve(); }
});

test('approving a ready import refreshes review status without replacing the workspace form', async ({ page, request }) => {
  const catalog = (await (await request.get('/api/bootstrap')).json()).catalog;
  const row = { id: 'ready-to-approve', status: 'pending', createdAt: reviewedAt, httpStatus: 200, counts: { centers: 14, services: 87 } };
  const gate = deferred();
  let approvalRequests = 0;
  await mockReview(page, 'unreviewed');
  await page.route('**/api/integrations', route => route.fulfill({ json: { ...integration(connected('پروژه آزمون')), sync: { imports: [row], operatorReview: operatorReview('unreviewed') } } }));
  await page.route('**/api/integrations/sync/approve', async route => {
    approvalRequests++;
    expect(route.request().postDataJSON()).toEqual({ importId: row.id });
    await gate.promise;
    await route.fulfill({ json: { ...row, status: 'approved', reviewedAt } });
  });
  await page.route('**/api/catalog', route => route.fulfill({ json: { ...catalog, verificationStatus: 'http-observed-unverified', operatorReview: operatorReview('approved') } }));
  try {
    await ready(page);
    await open(page, 'settings');
    await expect(page.locator('#fanasaImportHistory [data-action="approve-import"]')).toHaveCount(1);
    const name = page.locator('#settingsForm [name="organizationName"]');
    await name.fill('ویرایش ذخیره‌نشده هنگام تأیید');
    await page.locator('#fanasaImportHistory [data-action="approve-import"]').click();
    await expect.poll(() => approvalRequests).toBe(1);
    await expect(page.locator('#fanasaImportHistory [data-action="approve-import"]')).toBeDisabled();
    gate.resolve();
    await expect(page.locator('[data-operator-review="approved"]')).toContainText('بازبینی اپراتور ثبت شده');
    await expect(page.locator('#fanasaImportHistory [data-action="approve-import"]')).toHaveCount(0);
    await expect(page.locator('[data-source-verification]')).toContainText('تأیید مستقل نشده');
    await expect(name).toHaveValue('ویرایش ذخیره‌نشده هنگام تأیید');
    expect(approvalRequests).toBe(1);
  } finally { gate.resolve(); }
});

test('operator review uses the server review state without inferring approval from old metadata', async ({ page }) => {
  await mockReview(page, 'unreviewed');
  await ready(page);
  await open(page, 'catalog');
  await expect(page.locator('[data-operator-review="unreviewed"]')).toContainText('بازبینی اپراتور انجام نشده');
  await expect(page.locator('[data-operator-review="approved"]')).toHaveCount(0);
  await expect(page.locator('[data-source-verification]')).toContainText('تأیید مستقل نشده');
});

test('a failed status request can retry without discarding an unsaved settings draft', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/integrations', async route => {
    requests++;
    if (requests === 1) return route.fulfill({ status: 503, json: { error: 'آزمون خطای دریافت وضعیت' } });
    await route.fulfill({ json: integration(connected({ name: 'پروژه بازیابی‌شده' })) });
  });
  await ready(page);
  await open(page, 'settings');
  await expect(page.locator('#integrationLoadStatus')).toContainText('آزمون خطای دریافت وضعیت');
  await page.locator('#settingsForm [name="organizationName"]').fill('نام هنوز ذخیره نشده');
  await page.locator('[data-action="retry-integrations"]').click();
  await expect(page.locator('#neoIntegrationPanel')).toContainText('پروژه بازیابی‌شده');
  await expect(page.locator('#settingsForm [name="organizationName"]')).toHaveValue('نام هنوز ذخیره نشده');
  await expect(page.locator('#integrationLoadStatus')).not.toContainText('آزمون خطای دریافت وضعیت');
});

test('an older unavailable response cannot replace a newer successful connection', async ({ page }) => {
  const old = deferred(), delivered = deferred();
  let requests = 0;
  await page.route('**/api/integrations', async route => {
    const number = ++requests;
    if (number === 1) {
      await old.promise;
      await route.fulfill({ json: integration({ status: 'unavailable', message: 'خطای قدیمی اتصال', checkedAt: reviewedAt }) });
      delivered.resolve();
    } else await route.fulfill({ json: integration(connected('نتیجه تازه اتصال')) });
  });
  try {
    await ready(page);
    await open(page, 'settings');
    await expect.poll(() => requests).toBe(1);
    await open(page, 'dashboard');
    await open(page, 'settings');
    await expect(page.locator('#neoIntegrationPanel')).toContainText('نتیجه تازه اتصال');
    const oldResponse = page.waitForResponse(async response => response.url().endsWith('/api/integrations') && (await response.json()).neo?.status === 'unavailable');
    old.resolve();
    await delivered.promise;
    await (await oldResponse).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#neoIntegrationPanel')).toContainText('نتیجه تازه اتصال');
    await expect(page.locator('#neoIntegrationPanel')).not.toContainText('خطای قدیمی اتصال');
  } finally { old.resolve(); }
});
