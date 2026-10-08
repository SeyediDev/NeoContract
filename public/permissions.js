// Shared by the API and the UI. Workflow roles belong to the saved contract.
export const isAdministrator = roles => roles?.some(role => ['contract_admin','platform_admin'].includes(role)) === true;
export function canAdvance(roles, status, stageRole) {
  if (!['draft','in_process','awaiting_signature'].includes(status)) return false;
  if (isAdministrator(roles)) return true;
  if (status === 'draft') return roles?.includes('account_manager') === true;
  const role = String(stageRole || '').trim().toLowerCase();
  return (roles?.includes('legal_reviewer') && ['legal','واحد حقوقی'].includes(role)) === true
    || (roles?.includes('finance_reviewer') && ['finance','واحد مالی'].includes(role)) === true
    || (roles?.includes('account_manager') && ['account_manager','requester','مدیر حساب','واحد درخواست‌کننده'].includes(role)) === true;
}
