// Shared by the API and the UI. Workflow roles belong to the saved contract.
export const isAdministrator = roles => roles?.some(role => ['contract_admin','platform_admin'].includes(role)) === true;
// Internal review only. Approval never records a counterparty signature.
export function canReviewAmendment(roles, amendment, action) {
  const status=amendment?.status, stage=amendment?.workflow?.stage;
  if(action==='submit')return status==='draft'&&(isAdministrator(roles)||roles?.includes('account_manager'))===true;
  if(action==='cancel')return ['draft','in_review','approved'].includes(status)&&(isAdministrator(roles)||roles?.includes('account_manager'))===true;
  if(!['approve','reject'].includes(action)||status!=='in_review'||!['legal','finance'].includes(stage))return false;
  return isAdministrator(roles)||(stage==='legal'&&roles?.includes('legal_reviewer'))===true||(stage==='finance'&&roles?.includes('finance_reviewer'))===true;
}
export function canAdvance(roles, status, stageRole) {
  if (!['draft','in_process','awaiting_signature'].includes(status)) return false;
  if (isAdministrator(roles)) return true;
  if (status === 'draft') return roles?.includes('account_manager') === true;
  const role = String(stageRole || '').trim().toLowerCase();
  return (roles?.includes('legal_reviewer') && ['legal','واحد حقوقی'].includes(role)) === true
    || (roles?.includes('finance_reviewer') && ['finance','واحد مالی'].includes(role)) === true
    || (roles?.includes('account_manager') && ['account_manager','requester','مدیر حساب','واحد درخواست‌کننده'].includes(role)) === true;
}
