// Quantities are thousandths; invoice rates are historical.
const live = invoice => !['cancelled', 'rejected'].includes(invoice.status);
const total = values => values.reduce((sum, value) => sum + BigInt(value), 0n);
const lineAmount = (quantity, rate) => (quantity * BigInt(rate) + 500n) / 1000n;
export function executionPreparation(execution) {
  if (!execution) return null;
  const invoices = execution.invoices.filter(live), billed = new Map();
  for (const invoice of invoices) for (const line of invoice.lines || []) {
    billed.set(line.itemId, (billed.get(line.itemId) || 0n) + BigInt(line.quantity));
  }
  const allocated = total(execution.milestones.map(stage => stage.gross));
  const stages = execution.milestones.map(stage => {
    const items = execution.items.filter(item => item.milestoneId === stage.id);
    const recorded = total(invoices.filter(invoice => invoice.milestoneId === stage.id).map(invoice => invoice.gross));
    const future = total(items.map(item => lineAmount(BigInt(item.quantity) - (billed.get(item.id) || 0n), item.unitPrice)));
    return {id:stage.id, title:stage.title, itemCount:items.length, gross:String(stage.gross), committed:String(recorded + future), remaining:String(BigInt(stage.gross) - recorded - future)};
  });
  return {allocated:String(allocated), unallocated:String(BigInt(execution.effectiveAmount) - allocated), stages, emptyStages:stages.filter(stage => !stage.itemCount).length};
}
export function executionItemValue(quantity, rate) {
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(String(quantity)) || !/^\d+$/.test(String(rate))) return null;
  const [whole, fraction=''] = String(quantity).split('.');
  const units = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (units <= 0n || BigInt(rate) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return String(lineAmount(units, rate));
}
