import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const unique = text => `${text} ${randomUUID().slice(0, 8)}`;
const nameField = page => page.locator('#settingsForm [name="organizationName"]');
const saveButton = page => page.locator('#settingsForm [data-action="save-settings"]');
const open = async (page, view) => page.locator('#sidebar [data-view="' + view + '"]').click();
const unloadIsGuarded = page => page.evaluate(() => {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});

async function ready(page, request) {
  const data = await (await request.get('/api/bootstrap')).json();
  await page.route('**/api/integrations', route => route.fulfill({ json: {
    neo: { status: 'connected', project: 'پروژه آزمون' },
    sync: { imports: [] }, database: { status: 'ready' }
  } }));
  await page.goto('/');
  await expect(page.locator('[data-action="new-contract"]').first()).toBeVisible();
  await open(page, 'settings');
  return data.settings;
}

test('unsaved settings survive navigation and warn before leaving the document', async ({ page, request }) => {
  let writes = 0;
  await page.route('**/api/settings', route => {
    writes++;
    return route.fulfill({ status: 500, json: { error: 'این آزمون نباید ذخیره کند' } });
  });
  const saved = await ready(page, request);
  const original = saved.workspaceName || saved.organizationName || 'گروه انتخاب';
  const name = unique('نام فضای کاری ذخیره‌نشده');
  await nameField(page).fill(name);
  await expect(page.locator('#settingsDraftStatus')).toBeVisible();
  expect(await unloadIsGuarded(page)).toBe(true);
  await open(page, 'catalog');
  expect(await unloadIsGuarded(page)).toBe(true);
  await open(page, 'settings');
  await expect(nameField(page)).toHaveValue(name);
  await expect(page.locator('#settingsDraftStatus')).toContainText('تغییرات ذخیره‌نشده');
  await nameField(page).fill(original);
  await expect(page.locator('#settingsDraftStatus')).toBeHidden();
  expect(await unloadIsGuarded(page)).toBe(false);
  expect(writes).toBe(0);
});

test('a failed settings save keeps the edit and retry saves that same draft', async ({ page, request }) => {
  const saved = await ready(page, request);
  const sent = [];
  await page.route('**/api/settings', route => {
    expect(route.request().method()).toBe('PUT');
    const body = route.request().postDataJSON();
    sent.push(body);
    if (sent.length === 1) return route.fulfill({ status: 503, json: { error: 'خطای موقت آزمون ذخیره' } });
    return route.fulfill({ json: { ...saved, ...body } });
  });
  const name = unique('تنظیمات قابل تلاش دوباره');
  await nameField(page).fill(name);
  await saveButton(page).click();
  await expect(page.locator('#settingsSaveError')).toContainText('خطای موقت آزمون ذخیره');
  await expect(nameField(page)).toHaveValue(name);
  await expect(saveButton(page)).toBeEnabled();
  await open(page, 'dashboard');
  await open(page, 'settings');
  await expect(nameField(page)).toHaveValue(name);
  await expect(page.locator('#settingsSaveError')).toBeVisible();
  await expect(page.locator('#settingsDraftStatus')).toBeVisible();
  await saveButton(page).click();
  await expect(page.locator('#settingsSaveError')).toBeHidden();
  await expect(page.locator('#settingsDraftStatus')).toBeHidden();
  await expect(page.locator('#workspaceLabel')).toHaveText(name);
  await expect(saveButton(page)).toBeEnabled();
  expect(sent).toEqual([
    { workspaceName: name, defaultPaymentTerms: saved.defaultPaymentTerms || '' },
    { workspaceName: name, defaultPaymentTerms: saved.defaultPaymentTerms || '' }
  ]);
  expect(await unloadIsGuarded(page)).toBe(false);
  await open(page, 'catalog');
  await open(page, 'settings');
  await expect(nameField(page)).toHaveValue(name);
});

test('a pending save cannot clear a newer edit after navigating away and back', async ({ page, request }) => {
  const saved = await ready(page, request);
  const original = saved.workspaceName || saved.organizationName || 'گروه انتخاب';
  const submitted = unique('نام ارسال‌شده');
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  await page.route('**/api/settings', async route => {
    expect(route.request().method()).toBe('PUT');
    const body = route.request().postDataJSON();
    sent.push(body);
    if (sent.length === 1) await gate;
    await route.fulfill({ json: { ...saved, ...body } });
  });
  try {
    await nameField(page).fill(submitted);
    await saveButton(page).click();
    await expect.poll(() => sent.length).toBe(1);
    await expect(saveButton(page)).toBeDisabled();
    await expect(page.locator('#settingsForm')).toHaveAttribute('aria-busy', 'true');
    await nameField(page).fill(original);
    await open(page, 'dashboard');
    await open(page, 'settings');
    await expect(nameField(page)).toHaveValue(original);
    await expect(saveButton(page)).toBeDisabled();
    expect(await unloadIsGuarded(page)).toBe(true);
    release();
    await expect(saveButton(page)).toBeEnabled();
    await expect(page.locator('#settingsForm')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#workspaceLabel')).toHaveText(submitted);
    await expect(nameField(page)).toHaveValue(original);
    await expect(page.locator('#settingsDraftStatus')).toBeVisible();
    expect(await unloadIsGuarded(page)).toBe(true);
    expect(sent).toHaveLength(1);
    await saveButton(page).click();
    await expect(page.locator('#workspaceLabel')).toHaveText(original);
    await expect(page.locator('#settingsDraftStatus')).toBeHidden();
    await expect(saveButton(page)).toBeEnabled();
    expect(sent).toHaveLength(2);
    expect(sent[1].workspaceName).toBe(original);
    expect(await unloadIsGuarded(page)).toBe(false);
  } finally { release(); }
});
