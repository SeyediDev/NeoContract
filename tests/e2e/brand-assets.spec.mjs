import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const provenance = JSON.parse(await readFile(new URL('../../public/assets/brand/provenance.json', import.meta.url), 'utf8'));
const centers = ['abrgan', 'karavan', 'kavan', 'peyvand', 'dana', 'bonyan', 'fanasa-cloud', 'asman', 'kerane', 'rayan', 'dejan', 'ayin', 'didban', 'tarazu'];

async function checkImages(page, request) {
  const images = page.locator('img[src^="/assets/brand/"]');
  await expect.poll(() => images.evaluateAll(nodes => nodes.filter(n => !n.complete || n.naturalWidth === 0).map(n => n.getAttribute('src')))).toEqual([]);
  const paths = await images.evaluateAll(nodes => [...new Set(nodes.map(n => n.getAttribute('src')))]);
  for (const path of paths) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toBe('image/svg+xml');
    const official = provenance.files.find(file => '/assets/' + file.path === path);
    expect(official, path).toBeTruthy();
    expect(createHash('sha256').update(await response.body()).digest('hex'), path).toBe(official.sha256);
  }
}

for (const width of [1440, 390]) {
  test(`all official center marks and lockups render at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => sessionStorage.setItem('neocontract-active-tenant', '00000000-0000-0000-0000-000000000002'));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/#view=titan');
    await expect(page.locator('[data-action="board-center"]')).toHaveCount(14);
    for (const center of centers) await expect(page.locator(`[data-action="board-center"][data-id="${center}"] img`)).toHaveAttribute('src', `/assets/brand/center-${center}-mark-color.svg`);
    await checkImages(page, request);
    // Reload covers a fresh asset request as well as the first rendering.
    await page.reload();
    await expect(page.locator('[data-action="board-center"]')).toHaveCount(14);
    await checkImages(page, request);
    if (width === 390) await page.locator('.hamburger').click();
    await page.locator('#sidebar [data-view="catalog"]').click();
    await expect(page.locator('.center-lockup img')).toHaveCount(14);
    for (const center of centers) await expect(page.locator(`[data-brand-center="${center}"].center-lockup img`)).toHaveAttribute('src', `/assets/brand/center-${center}-lockup-fa-color.svg`);
    await checkImages(page, request);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
