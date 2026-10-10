import {isAdministrator} from './permissions.js';
const operational=new Set(['item','delivery','milestone','obligation','obligation-complete','issue','issue-resolve','invoice']);
const financial=new Set(['invoice-approve','invoice-reject','invoice-dispute','invoice-resolve','invoice-cancel','payment','payment-reverse','retention-release','deduction-settle','deduction-reverse']);
const legal=new Set(['accept','reject','guarantee','guarantee-release','guarantee-extend','change']);
const pausedActions=new Set(['resume','issue','issue-resolve','payment','payment-reverse','invoice-dispute','invoice-resolve','guarantee-release','guarantee-extend','retention-release','deduction-settle','deduction-reverse']);
export function executionActionAvailable(status,action){return status==='running'||status==='paused'&&pausedActions.has(action);}
export function canExecute(roles,action){
 if(isAdministrator(roles))return true;
 if(action==='invoice'&&roles?.includes('finance_reviewer'))return true;
 if(operational.has(action))return roles?.includes('account_manager')===true;
 if(financial.has(action))return roles?.includes('finance_reviewer')===true;
 if(legal.has(action))return roles?.includes('legal_reviewer')===true;
 return false;
}
