import {test,expect} from '@playwright/test';
const tenants=[['انتخاب','00000000-0000-0000-0000-000000000001',1,4],['باسلام','00000000-0000-0000-0000-000000000003',2,0],['زودکس','00000000-0000-0000-0000-000000000004',1,0],['سلام‌پی','00000000-0000-0000-0000-000000000005',1,0]];
for(const width of [1440,390])test(`isolated customer workspaces and linked pricing at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===390?844:1000});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/#view=titan');
 await expect(page.locator('#tenantSelect option')).toHaveCount(4);
 await expect(page.getByRole('heading',{name:'پرونده‌های قرارداد',exact:true})).toBeVisible();
 for(const [name,id,contracts,scopes] of tenants){
  if(width===390)await page.locator('.hamburger').click();
  await page.locator('#tenantSelect').selectOption(id);
  if(width===390&&await page.locator('#sidebar').evaluate(el=>el.classList.contains('open')))await page.locator('.sidebar-close').click();
  await expect(page.locator('#workspaceLabel')).toHaveText(name);
  await expect(page.locator('.titan-contract-card')).toHaveCount(contracts);
  await expect(page.locator('.titan-scope-card')).toHaveCount(scopes);
  await expect(page.locator('[data-p-action="load"]')).toHaveCount(contracts);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
 await page.locator('[data-p-action="load"]').first().click();
 await expect(page.locator('[data-p-field="name"]')).toHaveValue(/سلام/);
 if(width===390)expect((await page.locator('[data-p-field="items.0.quantity"]').boundingBox()).width).toBeGreaterThan(200);
 await page.screenshot({path:`test-results/customer-tenancy-${width}.png`,fullPage:false});
 expect(errors).toEqual([]);
});
