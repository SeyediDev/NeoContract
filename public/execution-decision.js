import {executionActionAvailable} from './execution-permissions.js';
import {executionPaymentCapacity} from './execution-finance.js';

export const executionDecisionActions=['invoice-approve','invoice-reject','invoice-dispute','invoice-resolve'];
const transitions={
 'invoice-approve':['submitted','approved'],
 'invoice-reject':['submitted','rejected'],
 'invoice-dispute':['approved','disputed'],
 'invoice-resolve':['disputed','approved']
};

export function executionDecisionPreview(s,action,id){
 const invoice=s.invoices.find(row=>row.id===id),errors=[];
 const result={action,invoice:invoice?structuredClone(invoice):null,direction:s.basis?.direction||null,errors,before:null,after:null,financial:null};
 if(!executionDecisionActions.includes(action)){errors.push('نوع تصمیم مالی معتبر نیست.');return result;}
 if(!executionActionAvailable(s.status,action))errors.push('این تصمیم در وضعیت فعلی اجرا مجاز نیست.');
 if(!invoice){errors.push('صورت‌وضعیت در این اجرا یافت نشد.');return result;}
 const [from,to]=transitions[action],capacity=executionPaymentCapacity(s,id);
 result.before={status:invoice.status,paymentAvailable:invoice.status==='approved'&&BigInt(capacity.remaining)>0n};
 result.financial={...capacity};
 if(invoice.status!==from)errors.push('وضعیت صورت‌وضعیت اجازه این تصمیم را نمی‌دهد؛ آخرین نسخه را دریافت کنید.');
 if(!errors.length)result.after={status:to,paymentAvailable:to==='approved'&&BigInt(capacity.remaining)>0n};
 return result;
}
