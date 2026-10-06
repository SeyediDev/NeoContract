import { randomUUID } from 'node:crypto';
import { AppError, requireValue, text } from './domain.mjs';
import { calculatePricing, PricingError } from '../public/pricing.js';
import { pricingLinks, syncTitanPricing, titanPricingSource } from './titan-pricing.mjs';

export function validatedPricing(input) {
  try { return calculatePricing(input); }
  catch (error) { if (error instanceof PricingError) throw new AppError(error.message, 400, 'pricing_validation'); throw error; }
}
const dto = row => ({ id: row.id, name: row.name, revision: row.revision, model: row.model, total: Number(row.total), createdAt: row.created_at, updatedAt: row.updated_at });
const validId = id => requireValue(typeof id==='string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id),'شناسه مدل قیمت‌گذاری معتبر نیست.');
export function createPricingStore(db, tenantId) {
  const list = async () => {
    const plans=(await db.query('SELECT * FROM contracts.pricing_plans WHERE tenant_id=$1 ORDER BY updated_at DESC,id', [tenantId])).rows.map(dto);
    for(const plan of plans)plan.linkedContracts=await pricingLinks(db,tenantId,plan.id);
    return plans;
  };
  async function get(id) {
    validId(id);
    const row = (await db.query('SELECT * FROM contracts.pricing_plans WHERE tenant_id=$1 AND id=$2', [tenantId, id])).rows[0];
    requireValue(row, 'مدل قیمت‌گذاری یافت نشد.', 404);
    const linkedContracts=await pricingLinks(db,tenantId,id);
    return {...dto(row),linkedContracts,...(linkedContracts.length?{proposalSource:await titanPricingSource(linkedContracts[0].intakeId)}:{})};
  }
  async function history(id) {
    await get(id);
    return (await db.query('SELECT revision,model,actor,created_at AS "createdAt" FROM contracts.pricing_plan_versions WHERE tenant_id=$1 AND plan_id=$2 ORDER BY revision DESC', [tenantId, id])).rows;
  }
  async function save(input, id, actor = 'local-demo') {
    requireValue(input && typeof input==='object','مدل قیمت‌گذاری معتبر نیست.');
    if(id)validId(id);
    const model = validatedPricing(input.model);
    const actorLabel = text(actor, 'عامل تغییر', { max: 200 });
    const planId = id || randomUUID();
    let result,linkedContracts=[];
    await db.transaction(async tx => {
      let revision = 1;
      if (id) {
        const row = (await tx.query('SELECT * FROM contracts.pricing_plans WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [tenantId, id])).rows[0];
        requireValue(row, 'مدل قیمت‌گذاری یافت نشد.', 404);
        requireValue(Number.isInteger(input.revision) && input.revision === row.revision, 'مدل قیمت‌گذاری تغییر کرده است؛ نسخه تازه را بارگذاری کنید.', 409);
        revision = row.revision + 1;
        result = (await tx.query('UPDATE contracts.pricing_plans SET name=$3,revision=$4,model=$5,total=$6,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *', [tenantId, planId, model.name, revision, JSON.stringify(model), model.total])).rows[0];
      } else {
        result = (await tx.query('INSERT INTO contracts.pricing_plans(id,tenant_id,name,model,total) VALUES($1,$2,$3,$4,$5) RETURNING *', [planId, tenantId, model.name, JSON.stringify(model), model.total])).rows[0];
      }
      await tx.query('INSERT INTO contracts.pricing_plan_versions(tenant_id,plan_id,revision,model,actor) VALUES($1,$2,$3,$4,$5)', [tenantId, planId, revision, JSON.stringify(model), actorLabel]);
      linkedContracts=await syncTitanPricing(tx,tenantId,planId,model,revision,actorLabel);
    });
    return {...dto(result),linkedContracts,...(linkedContracts.length?{proposalSource:await titanPricingSource(linkedContracts[0].intakeId)}:{})};
  }
  return { list, get, save, history };
}
