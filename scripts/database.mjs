import { createDatabase } from '../lib/database.mjs';
import { backupDatabase, restoreDatabase } from '../lib/backup.mjs';
import { resolve } from 'node:path';
const [command='health',argument]=process.argv.slice(2);
const db=await createDatabase({dataDir:process.env.NEOCONTRACT_DATA_DIR,connectionString:process.env.NEOCONTRACT_DATABASE_URL,seed:command!=='restore'});
try {
 if(command==='backup')console.log(JSON.stringify(await backupDatabase(db,resolve(argument||`.data/backups/${new Date().toISOString().replaceAll(':','-')}.json`)),null,2));
 else if(command==='restore'){if(!argument)throw Error('Provide backup path and a NEW NEOCONTRACT_DATA_DIR.');console.log(JSON.stringify(await restoreDatabase(db,resolve(argument)),null,2));}
 else if(['health','migrate','seed'].includes(command))console.log(JSON.stringify(command==='seed'?await db.seed():await db.health(),null,2));
 else throw Error('Commands: health, migrate, seed, backup [path], restore <path>');
} finally {await db.close();}
