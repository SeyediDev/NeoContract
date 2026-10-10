import {defineConfig} from '@playwright/test';
const executablePath=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
const port=process.env.NEOCONTRACT_E2E_PORT||'4188',baseURL=`http://127.0.0.1:${port}`;
export default defineConfig({
 testDir:'./tests/e2e',testIgnore:'customer-tenancy.spec.mjs',timeout:120000,
 expect:{timeout:15000},fullyParallel:false,workers:1,reporter:'list',
 use:{baseURL,viewport:{width:1440,height:1000},
  launchOptions:executablePath?{executablePath}:{},screenshot:'only-on-failure',trace:'retain-on-failure'},
 webServer:{command:'node server.mjs',url:baseURL+'/api/health',timeout:120000,reuseExistingServer:false,
  env:{PORT:port,NODE_ENV:'test',NEOCONTRACT_AUTH_MODE:'local-demo',NEOCONTRACT_TENANT_TOKENS:'{}',
   NEOCONTRACT_ACCESS_ENABLED:'false',NEOCONTRACT_TRUST_PROXY_AUTH:'false',
   NEOCONTRACT_CUSTOMER_TENANTS:'false',NEOCONTRACT_DEFAULT_TENANT:'00000000-0000-0000-0000-000000000001',
   NEOCONTRACT_DATA_DIR:'memory://',NEOCONTRACT_DATABASE_URL:'',
   NEOCONTRACT_TELEMETRY_ENABLED:'true',NEOCONTRACT_TELEMETRY_RETENTION_DAYS:'30',
   NEOCONTRACT_TELEMETRY_PRODUCERS:JSON.stringify([{id:'test-gateway',token:'local-e2e-producer-credential-only-00001',tenantIds:['00000000-0000-0000-0000-000000000001']}])}}
});
