import {readFile,stat} from 'node:fs/promises';
import pg from 'pg';
import {checkCentralAccess} from '../lib/central-access-preflight.mjs';

// This command intentionally never opens PGlite, migrates or seeds a database.
let pool;
try{
 const path=process.argv[2];
 if(!path||process.argv.length!==3||(await stat(path)).size>65536)throw Error();
 const cases=JSON.parse(await readFile(path,'utf8'));
 const report=await checkCentralAccess({cases,readMemberships:async(subjects,tenants)=>{
  if(!process.env.NEOCONTRACT_DATABASE_URL)throw Error();
  pool=new pg.Pool({connectionString:process.env.NEOCONTRACT_DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:5000,query_timeout:6000});
  const client=await pool.connect();
  try{
   await client.query('BEGIN READ ONLY');
   const result=await client.query(`SELECT u.subject,u.tenant_id,u.status,t.status AS tenant_status
    FROM contracts.app_users u JOIN contracts.tenants t ON t.id=u.tenant_id
    WHERE u.subject=ANY($1::text[]) AND u.tenant_id=ANY($2::uuid[])`,[subjects,tenants]);
   await client.query('COMMIT');return result.rows;
  }finally{client.release();}
 }});
 console.log(JSON.stringify(report,null,2));process.exitCode=report.ready?0:1;
}catch{
 console.log(JSON.stringify({ready:false,activationChanged:false,checks:[{check:'input_file',status:'fail'}]}));
 process.exitCode=1;
}finally{if(pool)await pool.end();}
