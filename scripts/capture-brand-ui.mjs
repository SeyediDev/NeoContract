import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [], assetFailures = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() >= 400 && (response.url().includes('/assets/') || response.url().includes('.css'))) {
    assetFailures.push({ url: response.url(), status: response.status() });
  }
});
const views = ['dashboard', 'contracts', 'templates', 'catalog', 'customers', 'managers', 'processes', 'reports', 'settings'];
const output = 'artifacts/brand';
await mkdir(output, { recursive: true });

async function openView(view, mobile = false) {
  if (mobile) await page.locator('.hamburger').click();
  const loaded = view === 'settings' ? page.waitForResponse(response => response.url().endsWith('/api/integrations') && response.request().method() === 'GET') : null;
  await page.locator('[data-view="' + view + '"]').first().click();
  if (loaded) {
    const response = await loaded;
    assert(response.ok(), 'Integration settings failed to load');
    await response.finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await page.locator('#viewRoot h1').waitFor();
}

async function screenshot(name, fullPage = false) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(img => img.decode().catch(() => {})));
  });
  await page.screenshot({ path: output + '/' + name + '.png', fullPage, animations: 'disabled' });
}

async function capture(view, width) {
  await screenshot(width + '-' + view, view === 'dashboard');
  const result = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
    font: getComputedStyle(document.body).fontFamily,
    background: getComputedStyle(document.body).backgroundColor,
    images: [...document.images].filter(img => img.getBoundingClientRect().width > 0).map(img => ({
      src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0,
    })),
  }));
  assert(result.width <= result.viewport, view + ' overflow at ' + width);
  assert(result.images.every(img => img.loaded), 'Missing image ' + view);
  checks.push({ view, ...result });
}

try {
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.locator('[data-action="new-contract"]').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert(await page.evaluate(() => document.fonts.check('14px Vazirmatn', 'فن‌آسا')), 'Vazirmatn font unavailable');
  for (const view of views) { await openView(view); await capture(view, 1440); }

  await openView('catalog');
  assert.equal(await page.locator('[data-service]').count(), 87);
  await page.locator('[data-service="ABR-01"]').check();
  await page.locator('[data-action="catalog-contract"]').first().click();
  await page.getByRole('dialog').waitFor();
  await screenshot('1440-wizard');
  await page.keyboard.press('Escape');

  await openView('templates');
  await page.locator('[data-action="new-template"]').click();
  await page.getByRole('dialog').waitFor();
  await screenshot('1440-template-form');
  await page.keyboard.press('Escape');

  await openView('contracts');
  await page.locator('button.contract-link').first().click();
  await page.getByRole('dialog').waitFor();
  await screenshot('1440-contract-detail');
  await page.keyboard.press('Escape');

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    for (const view of views) { await openView(view, true); await capture(view, width); }
    await openView('catalog', true);
    await page.locator('[data-action="catalog-contract"]').first().click();
    await page.getByRole('dialog').waitFor();
    await screenshot(width + '-wizard');
    await page.keyboard.press('Escape');
  }

  const fontResponse = await page.request.get(new URL('/assets/fonts/Vazirmatn-Fa.woff2', page.url()).href);
  assert.equal(fontResponse.status(), 200);
  assert.equal(fontResponse.headers()['content-type'], 'font/woff2');
  assert.equal(errors.length, 0);
  assert.equal(assetFailures.length, 0);
  const report = {
    checkedAt: new Date().toISOString(), views: views.length, widths: [1440, 768, 390],
    screenshots: 32, checks, errors, assetFailures, fontMime: fontResponse.headers()['content-type'],
  };
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ views: views.length, widths: report.widths, checks: checks.length, errors, assetFailures, fontMime: report.fontMime }));
} finally {
  await browser.close();
}
