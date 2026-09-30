import { test, expect } from '@playwright/test';

const views = {
 dashboard: 'میزکار', catalog: 'کاتالوگ سرویس', contracts: 'قراردادها',
 templates: 'الگوهای قرارداد', customers: 'مشتریان هلدینگی', managers: 'مدیران حساب',
 processes: 'الگوهای گردش کار', reports: 'گزارش‌ها', settings: 'تنظیمات و اتصال‌ها'
};

for (const width of [1440, 390]) {
 test(`all nine views and service selection keep the same SPA document at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  const documents = [], errors = [];
  page.on('request', request => {
   if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();
  await page.evaluate(() => { window.spaOriginalDocument = document; window.spaOriginalShell = document.querySelector('#app'); });
  const visit = async view => {
   if (width === 390) await page.locator('.hamburger').click();
   const nav = page.locator(`#sidebar [data-view="${view}"]`);
   await nav.click();
   await expect(page.locator('#breadcrumbCurrent')).toHaveText(views[view]);
   await expect(nav).toHaveAttribute('aria-current', 'page');
   await expect(page.locator('#viewRoot')).toBeFocused();
   expect(await page.evaluate(() => window.spaOriginalDocument === document && window.spaOriginalShell === document.querySelector('#app'))).toBe(true);
  };
  await visit('catalog');
  await page.locator('[data-service="ABR-01"]').check();
  for (const view of Object.keys(views)) await visit(view);
  await visit('catalog');
  await expect(page.locator('[data-service="ABR-01"]')).toBeChecked();
  await page.locator('[data-action="catalog-contract"]').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.spaOriginalDocument === document && window.spaOriginalShell === document.querySelector('#app'))).toBe(true);
  expect(documents).toHaveLength(1);
  expect(errors).toEqual([]);
 });
}
