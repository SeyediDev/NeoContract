import { resolve } from 'node:path';
import { createDatabase } from '../lib/database.mjs';
import { backupDatabase } from '../lib/backup.mjs';
import { createStore } from '../lib/store.mjs';
import { getTitanBoard } from '../lib/titan-board.mjs';

// Run with the local server stopped: never open two PGlite instances on one directory.
const db=await createDatabase({dataDir:process.env.NEOCONTRACT_DATA_DIR,connectionString:process.env.NEOCONTRACT_DATABASE_URL,seed:false,migrate:false});
try {
  const before=(await db.query('SELECT id,template_snapshot,status FROM contracts.contracts ORDER BY id')).rows;
  const backup=await backupDatabase(db,resolve(`.data/backups/before-titan-${new Date().toISOString().replaceAll(':','-')}.json`));
  await db.seed();
  const after=(await db.query('SELECT id,template_snapshot,status FROM contracts.contracts ORDER BY id')).rows;
  for(const original of before){
    const saved=after.find(row=>row.id===original.id);
    if(!saved || JSON.stringify(saved)!==JSON.stringify(original)) throw new Error(`Existing contract changed during provisioning: ${original.id}`);
  }
  const board=await getTitanBoard(createStore(db,'00000000-0000-0000-0000-000000000002'));
  console.log(JSON.stringify({backup,existingContractsPreserved:before.length,board:board.stats,contractIds:board.rows.filter(row=>row.contractId).map(row=>row.contractId)},null,2));
} finally { await db.close(); }
