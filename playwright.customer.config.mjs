import base from './playwright.config.mjs';
export default {...base,testIgnore:[],testMatch:'customer-tenancy.spec.mjs',webServer:{...base.webServer,env:{...base.webServer.env,NEOCONTRACT_CUSTOMER_TENANTS:'true'}}};
