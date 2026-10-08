import {test,expect} from '@playwright/test';
const titan='00000000-0000-0000-0000-000000000002';
async function identityRoutes(page,request,roles){
 const data=await(await request.get('/api/bootstrap',{headers:{'X-Tenant-Id':titan}})).json();
 const tenant=data.tenant;
 data.access={mode:'oidc-proxy',authorizationSource:'application-membership',identity:{id:'test-user',name:'کاربر آزمون',roles}};
 await page.route('**/api/tenants',r=>r.fulfill({json:{tenants:[tenant],activeTenant:tenant,mode:'oidc-proxy'}}));
 await page.route('**/api/bootstrap',r=>r.fulfill({json:data}));
 return data;
}
for(const width of [1440,390])test(`viewer actions are read-only at ${width}px`,async({page,request})=>{
 await page.setViewportSize({width,height:width===390?844:1000});
 await identityRoutes(page,request,['viewer']);
 await page.goto('/#view=contracts');
 await expect(page.locator('[data-action="new-contract"]').first()).toBeDisabled();
 await page.locator('[data-action="contract-detail"]').first().click();
 await expect(page.locator('[data-action="advance-dialog"]')).toBeDisabled();
 await page.locator('[data-action="detail-tab"][data-tab="document"]').click();
 await expect(page.locator('[data-action="new-amendment"]')).toBeDisabled();
 await expect(page.locator('[data-action="download-document"]')).toBeEnabled();
 await page.locator('[data-action="close-modal"]').click();
 await page.goto('/#view=settings');
 await expect(page.locator('[data-action="save-settings"]')).toBeDisabled();
 await expect(page.locator('#settingsForm input').first()).toHaveAttribute('readonly','');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('reviewer advance button follows the role of the saved current stage',async({page,request})=>{
 const data=await identityRoutes(page,request,['legal_reviewer']);
 const saved=data.contracts[0];let role='finance';
 await page.route('**/api/contracts/'+saved.id,r=>r.fulfill({json:{...saved,status:'in_process',stages:[{id:'current',stepId:'test-step',name:'بررسی جاری',status:'active',role,enabled:true,required:true,slaDays:1}]}}));
 await page.goto('/#view=contracts');
 const detail=page.locator(`[data-action="contract-detail"][data-id="${saved.id}"]`).first();
 await detail.click();await expect(page.locator('[data-action="advance-dialog"]')).toBeDisabled();
 await page.locator('[data-action="close-modal"]').click();role='legal';
 await detail.click();await expect(page.locator('[data-action="advance-dialog"]')).toBeEnabled();
});
test('late user responses from a previous tenant cannot replace the current users',async({page,request})=>{
 const listing=await(await request.get('/api/tenants')).json();
 const [first,second]=listing.tenants;let release,started;
 const pending=new Promise(resolve=>release=resolve),oldStarted=new Promise(resolve=>started=resolve);
 await page.addInitScript(id=>sessionStorage.setItem('neocontract-active-tenant',id),first.id);
 await page.route('**/api/tenants',r=>r.fulfill({json:{...listing,mode:'oidc-proxy'}}));
 await page.route('**/api/bootstrap',async r=>{
  const data=await(await request.get('/api/bootstrap',{headers:{'X-Tenant-Id':r.request().headers()['x-tenant-id']}})).json();
  data.access={mode:'oidc-proxy',identity:{id:'admin',roles:['contract_admin']}};
  await r.fulfill({json:data});
 });
 const response=name=>({users:[{id:name,subject:name,email:name+'@example.invalid',display_name:name,status:'active',roles:['viewer']}],roles:[]});
 await page.route('**/api/users',async r=>{
  if(r.request().headers()['x-tenant-id']===first.id){started();await pending;await r.fulfill({json:response('previous-tenant-user')});}
  else await r.fulfill({json:response('current-tenant-user')});
 });
 await page.goto('/#view=settings');await oldStarted;
 await page.locator('#tenantSelect').selectOption(second.id);
 await expect(page.locator('#userAdministrationPanel')).toContainText('current-tenant-user');
 const oldReply=page.waitForResponse(r=>r.url().endsWith('/api/users')&&r.request().headers()['x-tenant-id']===first.id);
 release();await(await oldReply).finished();
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.locator('#userAdministrationPanel')).toContainText('current-tenant-user');
 await expect(page.locator('#userAdministrationPanel')).not.toContainText('previous-tenant-user');
});
test('administrator can read access history with actor and before/after roles on mobile',async({page,request})=>{
 await page.setViewportSize({width:390,height:844});
 await identityRoutes(page,request,['contract_admin']);
 const roles=[{role_key:'viewer',label:'مشاهده‌گر'},{role_key:'legal_reviewer',label:'بازبین حقوقی'}];
 await page.route('**/api/users',r=>r.fulfill({json:{users:[{id:'member',subject:'subject',email:'member@example.invalid',display_name:'عضو آزمون',status:'active',roles:['viewer']}],roles}}));
 await page.route('**/api/users/member/audit',r=>r.fulfill({json:{events:[{created_at:'2026-10-09T00:00:00Z',actor_name:'مدیر قرارداد',before_state:{status:'active',roles:['viewer']},after_state:{status:'active',roles:['legal_reviewer']}}]}}));
 await page.goto('/#view=settings');await page.locator('[data-action="user-audit"]').click();
 await expect(page.getByRole('dialog')).toContainText('مدیر قرارداد');
 await expect(page.locator('[data-label="قبل از تغییر"]')).toContainText('مشاهده‌گر');
 await expect(page.locator('[data-label="پس از تغییر"]')).toContainText('بازبین حقوقی');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
