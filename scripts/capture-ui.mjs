import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await mkdir('artifacts',{recursive:true});
try{
 await page.goto(process.env.DEMO_URL||'http://127.0.0.1:4173/',{waitUntil:'networkidle'});
 await page.locator('[data-action="new-contract"]').first().waitFor();
 await page.screenshot({path:'artifacts/dashboard.png',fullPage:true});
 await page.locator('[data-view="catalog"]').first().click();await page.locator('[data-service="ABR-01"]').waitFor();
 await page.screenshot({path:'artifacts/catalog.png',fullPage:false});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'artifacts/mobile-catalog.png',fullPage:false});
 const overflow=await page.evaluate(()=>({viewport:innerWidth,width:document.documentElement.scrollWidth}));
 console.log(JSON.stringify({errors,overflow,services:await page.locator('[data-service]').count(),title:await page.title()}));
}finally{await browser.close();}
