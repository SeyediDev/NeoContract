import {randomUUID,createHash} from 'node:crypto';
import {AppError,requireValue,text} from './domain.mjs';
import {canExecute,executionActionAvailable} from '../public/execution-permissions.js';
import {executionFollowups} from '../public/execution-followups.js';
const check=(ok,message,status=400)=>requireValue(ok,message,status);
const str=(v,label,max=1000)=>text(v,label,{max});
const optional=(v,label,max=1000)=>text(v,label,{optional:true,max});
const money=(v,label)=>{check(Number.isSafeInteger(v)&&v>=0,`${label}: مبلغ صحیح و نامنفی ریالی لازم است.`);return v;};
const sum=values=>{const n=values.reduce((a,v)=>a+BigInt(v),0n);check(n<=BigInt(Number.MAX_SAFE_INTEGER),'جمع مبلغ خارج از محدوده امن است.');return Number(n);};
const qty=v=>{const s=String(v);check(/^\d{1,12}(\.\d{1,3})?$/.test(s),'مقدار مثبت با حداکثر سه رقم اعشار لازم است.');const [a,b='']=s.split('.'),n=Number(a)*1000+Number(b.padEnd(3,'0'));check(Number.isSafeInteger(n)&&n>0,'مقدار معتبر نیست.');return n;};
const day=(v,label)=>{const d=new Date(typeof v==='string'?v+'T00:00:00Z':NaN);check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(+d)&&d.toISOString().slice(0,10)===v,`${label}: تاریخ میلادی معتبر لازم است.`);return v;};
const reference=p=>str(p.reference,'مرجع مدرک / صورتجلسه / رسید',500);
const find=(rows,id)=>{const row=rows.find(r=>r.id===id);check(row,'رکورد اجرای قرارداد یافت نشد.',404);return row;};
const liveInvoice=i=>!['cancelled','rejected'].includes(i.status);
const paid=(s,id)=>sum(s.payments.filter(p=>p.invoiceId===id&&!s.reversals.some(r=>r.paymentId===p.id)).map(p=>p.amount));
const accepted=(s,id)=>s.deliveries.filter(d=>d.itemId===id&&d.status==='accepted').reduce((a,d)=>a+d.quantity,0);
const delivered=(s,id)=>s.deliveries.filter(d=>d.itemId===id&&d.status!=='rejected').reduce((a,d)=>a+d.quantity,0);
const billed=(s,id)=>s.invoices.filter(liveInvoice).flatMap(i=>i.lines||[]).filter(l=>l.itemId===id).reduce((a,l)=>a+l.quantity,0);
const settled=(s,id,kind)=>sum(s.deductionSettlements.filter(x=>x.invoiceId===id&&x.kind===kind&&!s.deductionReversals.some(r=>r.settlementId===x.id)).map(x=>x.amount));
const aggregate=()=>({items:[],deliveries:[],milestones:[],invoices:[],payments:[],reversals:[],deductionSettlements:[],deductionReversals:[],obligations:[],guarantees:[],issues:[],changes:[]});
const lineAmount=(quantity,unitPrice)=>{const n=(BigInt(quantity)*BigInt(unitPrice)+500n)/1000n;check(n<=BigInt(Number.MAX_SAFE_INTEGER),'مبلغ ردیف خارج از محدوده امن است.');return Number(n);};
const plannedValue=(s,milestoneId)=>sum([...s.invoices.filter(i=>liveInvoice(i)&&i.milestoneId===milestoneId).map(i=>i.gross),...s.items.filter(i=>i.milestoneId===milestoneId).map(i=>lineAmount(i.quantity-billed(s,i.id),i.unitPrice))]);
export function executionSummary(s,today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tehran',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())){
 if(!s)return null;
 const invoices=s.invoices.filter(liveInvoice),approved=invoices.filter(i=>['approved','disputed'].includes(i.status));
 const advancePaid=sum(invoices.filter(i=>i.kind==='advance').map(i=>paid(s,i.id)));
 const recovered=sum(invoices.map(i=>i.advanceRecovery));
 const retained=sum(invoices.filter(i=>i.status==='approved'||i.status==='disputed').map(i=>i.retention));
 const released=sum(invoices.filter(i=>i.kind==='retention').map(i=>i.net));
 const summary={effectiveAmount:s.effectiveAmount,earned:sum(approved.filter(i=>['progress','final'].includes(i.kind)).map(i=>i.gross)),invoiced:sum(approved.map(i=>i.net)),paid:sum(invoices.map(i=>paid(s,i.id))),outstanding:sum(approved.map(i=>i.net-paid(s,i.id))),advancePaid,advanceRecoveryReserved:recovered,advanceOutstanding:advancePaid-recovered,retentionHeld:retained-released,withholdingOutstanding:sum(approved.map(i=>i.withholding-settled(s,i.id,'withholding'))),insuranceOutstanding:sum(approved.map(i=>i.insurance-settled(s,i.id,'insurance'))),
  itemProgress:s.items.map(i=>({id:i.id,accepted:accepted(s,i.id)/1000,submitted:delivered(s,i.id)/1000,quantity:i.quantity/1000,billed:billed(s,i.id)/1000})),
  milestoneProgress:s.milestones.map(m=>{const items=s.items.filter(i=>i.milestoneId===m.id),docs=invoices.filter(i=>i.milestoneId===m.id),reviewed=docs.filter(i=>['approved','disputed'].includes(i.status)),outstanding=sum(reviewed.map(i=>i.net-paid(s,i.id)));const status=!items.length?'planned':items.some(i=>accepted(s,i.id)<i.quantity)?'delivery_pending':items.some(i=>billed(s,i.id)<i.quantity)||docs.some(i=>i.status!=='approved')?'finance_pending':outstanding?'payment_pending':'settled';return {id:m.id,status,committedGross:sum(docs.map(i=>i.gross)),approvedGross:sum(reviewed.map(i=>i.gross)),paid:sum(docs.map(i=>paid(s,i.id))),outstanding};}),
  overdueItems:s.items.filter(i=>i.dueDate<today&&accepted(s,i.id)<i.quantity).map(i=>i.id),overdueInvoices:approved.filter(i=>i.dueDate<today&&paid(s,i.id)<i.net).map(i=>i.id),
  expiringGuarantees:s.guarantees.filter(g=>g.status==='held'&&g.expiryDate<=today).map(g=>g.id),openIssues:s.issues.filter(i=>i.status==='open').length,overdueObligations:s.obligations.filter(o=>o.status==='open'&&o.dueDate<today).map(o=>o.id)};
 return {...summary,followups:executionFollowups(s,summary,{today})};
}
function apply(s,action,p,at){
 const id=randomUUID(),base={id,createdAt:at};
 if(action==='milestone'){
  const gross=money(p.gross,'سقف مرحله');check(gross>0,'سقف مرحله باید مثبت باشد.');check(sum([...s.milestones.map(m=>m.gross),gross])<=s.effectiveAmount,'جمع مراحل از مبلغ توافق‌شده بیشتر است.');
  s.milestones.push({...base,title:str(p.title,'عنوان مرحله',200),gross,dueDate:day(p.dueDate,'سررسید'),condition:str(p.condition,'شرط آزادسازی مرحله')});
 }else if(action==='item'){
  const m=find(s.milestones,p.milestoneId);s.items.push({...base,milestoneId:m.id,title:str(p.title,'عنوان قلم',200),unit:str(p.unit,'واحد',80),quantity:qty(p.quantity),unitPrice:money(p.unitPrice,'نرخ واحد'),dueDate:day(p.dueDate,'موعد تحویل'),owner:str(p.owner,'مسئول',200),criteria:str(p.criteria,'معیار پذیرش',2000)});check(plannedValue(s,m.id)<=m.gross,'ارزش اقلام و کارکرد ثبت‌شده از سقف مرحله بیشتر است.');
 }else if(action==='delivery'){
  const item=find(s.items,p.itemId),quantity=qty(p.quantity);check(quantity+delivered(s,item.id)<=item.quantity,'تحویل بیش از مقدار تعهدشده مجاز نیست.');
  s.deliveries.push({...base,itemId:item.id,quantity,deliveredAt:day(p.deliveredAt,'تاریخ تحویل'),reference:reference(p),note:optional(p.note,'توضیح'),status:'submitted'});
 }else if(['accept','reject'].includes(action)){
  const d=find(s.deliveries,p.id);check(d.status==='submitted','این تحویل قبلاً بررسی شده است.',409);d.status=action==='accept'?'accepted':'rejected';d.review={at,reference:reference(p),comment:str(p.comment,'توضیح پذیرش / رد',2000)};
 }else if(action==='invoice'){
  check(['advance','progress','final'].includes(p.kind),'نوع صورت‌وضعیت معتبر نیست.');
  const number=str(p.number,'شماره صورت‌وضعیت',120);check(!s.invoices.some(i=>i.number===number),'شماره صورت‌وضعیت تکراری است.',409);
  let lines=[],gross,m=null;
  if(p.kind==='advance'){gross=money(p.gross,'پیش‌پرداخت');check(sum([gross,...s.invoices.filter(i=>liveInvoice(i)&&i.kind==='advance').map(i=>i.gross)])<=s.basis.advanceLimit,'سقف پیش‌پرداخت رعایت نشده است.');}
  else{
   m=find(s.milestones,p.milestoneId);check(Array.isArray(p.lines)&&p.lines.length>0&&p.lines.length<=100,'ردیف تحویل تأییدشده لازم است.');
   const seen=new Set();lines=p.lines.map(l=>{const item=find(s.items,l.itemId);check(!seen.has(item.id)&&item.milestoneId===m.id,'ردیف تکراری یا مربوط به مرحله دیگری است.');seen.add(item.id);const quantity=qty(l.quantity);check(quantity+billed(s,item.id)<=accepted(s,item.id),'مقدار صورت‌وضعیت از تحویل تأییدشده قابل صورتحساب بیشتر است.');return {itemId:item.id,title:item.title,quantity,unitPrice:item.unitPrice,amount:lineAmount(quantity,item.unitPrice)};});
   gross=sum(lines.map(l=>l.amount));check(sum([gross,...s.invoices.filter(i=>liveInvoice(i)&&i.milestoneId===m.id).map(i=>i.gross)])<=m.gross,'صورت‌وضعیت از سقف مرحله بیشتر است.');
   check(sum([gross,...s.invoices.filter(i=>liveInvoice(i)&&['progress','final'].includes(i.kind)).map(i=>i.gross)])<=s.effectiveAmount,'صورت‌وضعیت از مبلغ توافق‌شده بیشتر است.');
   if(p.kind==='final')check(s.items.length>0&&s.items.every(i=>accepted(s,i.id)===i.quantity),'تحویل همه اقلام برای صورت‌وضعیت نهایی لازم است.');
  }
  check(gross>0||p.kind!=='advance','مبلغ پیش‌پرداخت باید مثبت باشد.');
  const tax=money(p.tax,'مالیات افزوده'),retention=money(p.retention,'سپرده حسن انجام'),withholding=money(p.withholding,'مالیات تکلیفی'),insurance=money(p.insurance,'کسور بیمه'),penalty=money(p.penalty,'جریمه توافق‌شده'),advanceRecovery=money(p.advanceRecovery,'بازیافت پیش‌پرداخت');
  const deduction=sum([retention,withholding,insurance,penalty,advanceRecovery]);check(deduction<=gross,'کسورات از مبلغ ناخالص بیشتر است.');
  if(p.kind==='advance')check(deduction===0&&tax===0,'پیش‌پرداخت باید بدون کسورات و مالیات ثبت شود.');
  if(deduction||tax)str(p.basis,'مستند و مبنای مالیات / کسورات',2000);
  const summary=executionSummary(s);check(advanceRecovery<=summary.advanceOutstanding,'بازیافت از پیش‌پرداخت دریافت/پرداخت‌شده باقیمانده بیشتر است.');
  s.invoices.push({...base,number,kind:p.kind,milestoneId:m?.id||null,lines,gross,tax,retention,withholding,insurance,penalty,advanceRecovery,net:sum([gross-deduction,tax]),dueDate:day(p.dueDate,'سررسید مالی'),reference:reference(p),basis:optional(p.basis,'مبنای مالی',2000),status:'submitted',decisions:[]});
 }else if(['invoice-approve','invoice-reject','invoice-dispute','invoice-resolve','invoice-cancel'].includes(action)){
  const i=find(s.invoices,p.id);const statuses={'invoice-approve':['submitted'],'invoice-reject':['submitted'],'invoice-dispute':['approved'],'invoice-resolve':['disputed'],'invoice-cancel':['submitted','approved','disputed']};check(statuses[action].includes(i.status),'وضعیت صورت‌وضعیت اجازه این اقدام را نمی‌دهد.',409);
  if(action==='invoice-cancel'){check(paid(s,i.id)===0&&settled(s,i.id,'withholding')===0&&settled(s,i.id,'insurance')===0,'ابتدا پرداخت‌ها و تسویه کسورات باید با رسید برگشت اصلاح شوند.');if(i.kind==='advance'){const others=sum(s.invoices.filter(x=>x.id!==i.id&&liveInvoice(x)&&x.kind==='advance').map(x=>paid(s,x.id)));check(others>=executionSummary(s).advanceRecoveryReserved,'این پیش‌پرداخت در بازیافت مصرف شده است.');}if(i.retention){const retainedOthers=sum(s.invoices.filter(x=>x.id!==i.id&&['approved','disputed'].includes(x.status)).map(x=>x.retention));check(retainedOthers>=sum(s.invoices.filter(x=>liveInvoice(x)&&x.kind==='retention').map(x=>x.net)),'سپرده این صورت‌وضعیت آزاد شده است.');}}
  i.status={'invoice-approve':'approved','invoice-reject':'rejected','invoice-dispute':'disputed','invoice-resolve':'approved','invoice-cancel':'cancelled'}[action];i.decisions.push({action,at,comment:str(p.comment,'علت تصمیم',2000),reference:reference(p)});
 }else if(action==='payment'){
  const i=find(s.invoices,p.invoiceId);check(i.status==='approved','صورت‌وضعیت باید تأیید مالی و بدون اختلاف باز باشد.',409);const amount=money(p.amount,'مبلغ پرداخت');check(amount>0&&amount<=i.net-paid(s,i.id),'پرداخت مثبت و در حد مانده صورت‌وضعیت لازم است.');
  const ref=reference(p);check(!s.payments.some(x=>x.reference===ref),'مرجع پرداخت تکراری است.',409);s.payments.push({...base,invoiceId:i.id,amount,paidAt:day(p.paidAt,'تاریخ پرداخت'),reference:ref,method:str(p.method,'روش پرداخت',120),note:optional(p.note,'توضیح')});
 }else if(action==='payment-reverse'){
  const payment=find(s.payments,p.id);check(!s.reversals.some(r=>r.paymentId===payment.id),'پرداخت قبلاً برگشت خورده است.',409);const i=find(s.invoices,payment.invoiceId);
  if(i.kind==='advance')check(executionSummary(s).advanceOutstanding>=payment.amount,'این پیش‌پرداخت در بازیافت رزرو شده است؛ ابتدا صورت‌وضعیت مربوطه را اصلاح کنید.');
  s.reversals.push({...base,paymentId:payment.id,reference:reference(p),reason:str(p.comment,'علت برگشت',2000)});
 }else if(action==='deduction-settle'){
  const i=find(s.invoices,p.invoiceId);check(i.status==='approved','تأیید مالی و رفع اختلاف لازم است.',409);check(['withholding','insurance'].includes(p.kind),'نوع کسور معتبر نیست.');const amount=money(p.amount,'تسویه کسور');check(amount>0&&amount<=i[p.kind]-settled(s,i.id,p.kind),'مبلغ از کسور تسویه‌نشده بیشتر است.');const ref=reference(p);check(!s.deductionSettlements.some(x=>x.reference===ref),'مرجع تسویه کسور تکراری است.',409);s.deductionSettlements.push({...base,invoiceId:i.id,kind:p.kind,amount,settledAt:day(p.settledAt,'تاریخ تسویه'),reference:ref,recipient:str(p.recipient,'مرجع ذی‌نفع / سازمان'),note:str(p.comment,'شرح تسویه / مفاصاحساب',2000)});
 }else if(action==='deduction-reverse'){
  const d=find(s.deductionSettlements,p.id);check(!s.deductionReversals.some(r=>r.settlementId===d.id),'تسویه قبلاً برگشت خورده است.',409);s.deductionReversals.push({...base,settlementId:d.id,reference:reference(p),reason:str(p.comment,'علت برگشت',2000)});
 }else if(action==='retention-release'){
  const amount=money(p.amount,'آزادسازی سپرده');check(amount>0&&amount<=executionSummary(s).retentionHeld,'مبلغ آزادسازی از سپرده نگهداری‌شده بیشتر است.');
  check(s.invoices.filter(i=>liveInvoice(i)&&i.retention>0).every(i=>i.status==='approved'&&paid(s,i.id)===i.net),'تسویه صورت‌وضعیت‌های دارای سپرده و رفع اختلاف لازم است.');
  s.invoices.push({...base,number:'RET-'+id.slice(0,8),kind:'retention',milestoneId:null,lines:[],gross:0,tax:0,retention:0,withholding:0,insurance:0,penalty:0,advanceRecovery:0,net:amount,dueDate:day(p.dueDate,'سررسید آزادسازی'),reference:reference(p),basis:str(p.comment,'مجوز آزادسازی',2000),status:'approved',decisions:[]});
 }else if(action==='obligation'){
  s.obligations.push({...base,title:str(p.title,'تعهد',200),owner:str(p.owner,'مسئول',200),dueDate:day(p.dueDate,'موعد تعهد'),condition:str(p.condition,'شرط انجام',2000),status:'open'});
 }else if(action==='obligation-complete'){
  const o=find(s.obligations,p.id);check(o.status==='open','تعهد قبلاً انجام شده است.',409);o.status='completed';o.completion={at,reference:reference(p),comment:str(p.comment,'شرح انجام')};
 }else if(action==='guarantee'){
  check(['performance','advance','insurance','other'].includes(p.kind),'نوع تضمین معتبر نیست.');const amount=money(p.amount,'مبلغ تضمین');check(amount>0,'مبلغ تضمین باید مثبت باشد.');s.guarantees.push({...base,kind:p.kind,amount,reference:reference(p),issuer:str(p.issuer,'صادرکننده',200),beneficiary:str(p.beneficiary,'ذی‌نفع',200),expiryDate:day(p.expiryDate,'انقضا'),condition:str(p.condition,'شرط آزادسازی'),status:'held'});
 }else if(action==='guarantee-extend'){
  const g=find(s.guarantees,p.id);check(g.status==='held','فقط تضمین نگهداری‌شده قابل تمدید است.',409);const expiryDate=day(p.expiryDate,'انقضای جدید');check(expiryDate>g.expiryDate,'انقضای جدید باید پس از انقضای فعلی باشد.');g.extensions=[...(g.extensions||[]),{at,from:g.expiryDate,to:expiryDate,reference:reference(p),comment:str(p.comment,'مجوز تمدید')}];g.expiryDate=expiryDate;
 }else if(action==='guarantee-release'){
  const g=find(s.guarantees,p.id);check(g.status==='held','تضمین قبلاً آزاد شده است.',409);if(g.kind==='advance')check(executionSummary(s).advanceOutstanding===0,'پیش‌پرداخت تسویه نشده است.');g.status='released';g.release={at,reference:reference(p),comment:str(p.comment,'مجوز آزادسازی')};
 }else if(action==='issue'){
  check(['delay','dispute','risk','dependency'].includes(p.kind),'نوع رویداد معتبر نیست.');s.issues.push({...base,kind:p.kind,title:str(p.title,'عنوان',200),owner:str(p.owner,'مسئول',200),dueDate:day(p.dueDate,'موعد پیگیری'),impact:str(p.impact,'اثر و اقدام لازم',2000),status:'open'});
 }else if(action==='issue-resolve'){
  const i=find(s.issues,p.id);check(i.status==='open','رویداد قبلاً بسته شده است.',409);i.status='resolved';i.resolution={at,reference:reference(p),comment:str(p.comment,'نتیجه رسیدگی',2000)};
 }else if(action==='change'){
  const effectiveAmount=money(p.effectiveAmount,'مبلغ توافق‌شده جدید'),endDate=day(p.endDate,'تاریخ پایان جدید');check(endDate>=s.basis.startDate,'پایان پیش از شروع است.');
  let milestoneChange=null;if(p.milestoneId){const m=find(s.milestones,p.milestoneId),gross=money(p.gross,'سقف جدید مرحله');check(gross>0,'سقف مرحله باید مثبت باشد.');milestoneChange={milestoneId:m.id,before:m.gross,after:gross};m.gross=gross;}
  check(effectiveAmount>=sum(s.milestones.map(m=>m.gross)),'مبلغ جدید کمتر از مجموع سقف مراحل است.');
  let itemChange=null;if(p.itemId){const i=find(s.items,p.itemId),quantity=qty(p.quantity);check(quantity>=Math.max(delivered(s,i.id),billed(s,i.id)),'کاهش مقدار کمتر از تحویل/صورتحساب ممکن نیست.');itemChange={itemId:i.id,before:{quantity:i.quantity,dueDate:i.dueDate,unitPrice:i.unitPrice},after:{quantity,dueDate:day(p.dueDate,'موعد جدید'),unitPrice:p.unitPrice===undefined?i.unitPrice:money(p.unitPrice,'نرخ جدید')}};Object.assign(i,itemChange.after);}
  check(s.milestones.every(m=>plannedValue(s,m.id)<=m.gross),'ارزش اقلام و کارکرد ثبت‌شده از سقف جدید مرحله بیشتر است.');
  s.changes.push({...base,reference:reference(p),reason:str(p.comment,'علت تغییر توافق‌شده',2000),before:{amount:s.effectiveAmount,endDate:s.endDate},after:{amount:effectiveAmount,endDate},itemChange,milestoneChange});s.effectiveAmount=effectiveAmount;s.endDate=endDate;
 }else if(action==='pause'||action==='resume'){
  check(s.status===(action==='pause'?'running':'paused'),'وضعیت اجرا تغییر کرده است.',409);s.status=action==='pause'?'paused':'running';s.lastStatus={at,reference:reference(p),comment:str(p.comment,'علت توقف / شروع مجدد')};
 }else if(action==='close'){
  const summary=executionSummary(s);check(s.items.length>0&&s.items.every(i=>accepted(s,i.id)===i.quantity&&billed(s,i.id)===i.quantity),'تحویل و صورت‌وضعیت کامل اقلام لازم است.');check(s.obligations.every(o=>o.status==='completed')&&s.issues.every(i=>i.status==='resolved'),'تعهد یا اختلاف باز وجود دارد.');check(s.guarantees.every(g=>g.status==='released'),'تضمین آزاد نشده وجود دارد.');check(s.invoices.every(i=>!liveInvoice(i)||(i.status==='approved'&&paid(s,i.id)===i.net)),'صورت‌وضعیت تأییدنشده، اختلاف یا مانده پرداخت وجود دارد.');check(summary.advanceOutstanding===0&&summary.retentionHeld===0&&summary.withholdingOutstanding===0&&summary.insuranceOutstanding===0,'پیش‌پرداخت، سپرده یا کسورات تسویه نشده است.');s.status='closed';s.closed={at,reference:reference(p),comment:str(p.comment,'صورتجلسه خاتمه و تسویه')};
 }else throw new AppError('اقدام اجرای قرارداد پشتیبانی نمی‌شود.',400);
 return s;
}
export function createExecutionStore(db,tenantId){
 async function read(contractId){
  const c=(await db.query('SELECT id FROM contracts.contracts WHERE tenant_id=$1 AND id=$2',[tenantId,contractId])).rows[0];check(c,'قرارداد یافت نشد.',404);
  const row=(await db.query('SELECT * FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2',[tenantId,contractId])).rows[0];
  if(!row)return null;
  const history=(await db.query('SELECT revision,action,actor,payload,occurred_at FROM contracts.execution_commands WHERE tenant_id=$1 AND contract_id=$2 AND revision<=$3 ORDER BY revision',[tenantId,contractId,row.revision])).rows.map(r=>({revision:r.revision,action:r.action,actor:r.actor,payload:r.payload,at:r.occurred_at instanceof Date?r.occurred_at.toISOString():r.occurred_at}));
  return {...row.state,revision:row.revision,summary:executionSummary(row.state),history};
 }
 async function command(contractId,input,actor=null){
  check(!actor||actor.tenantId===tenantId,'اجازه دسترسی به این تننت وجود ندارد.',403);
  const roles=actor?.roles||['contract_admin'];check(canExecute(roles,input?.action),'نقش کاربر اجازه این اقدام اجرا را ندارد.',403);
  await db.transaction(async tx=>{
   const c=(await tx.query('SELECT * FROM contracts.contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,contractId])).rows[0];check(c,'قرارداد یافت نشد.',404);
   check(input&&typeof input==='object'&&!Array.isArray(input),'درخواست معتبر نیست.');const key=str(input.idempotencyKey,'کلید درخواست',120);check(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>=0,'نسخه مورد انتظار لازم است.');check(input.payload&&typeof input.payload==='object'&&!Array.isArray(input.payload),'محتوای اقدام معتبر نیست.');
   const who=actor?{id:actor.id,subject:actor.subject,name:actor.name,email:actor.email}:null;
   const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
   const hash=createHash('sha256').update(JSON.stringify(canonical({action:input.action,payload:input.payload,expectedRevision:input.expectedRevision,subject:who?.subject||null}))).digest('hex');
   const receipt=(await tx.query('SELECT request_hash FROM contracts.execution_commands WHERE tenant_id=$1 AND contract_id=$2 AND request_key=$3',[tenantId,contractId,key])).rows[0];if(receipt){check(receipt.request_hash===hash,'کلید درخواست برای محتوای دیگری استفاده شده است.',409);return;}
   const row=(await tx.query('SELECT * FROM contracts.contract_execution WHERE tenant_id=$1 AND contract_id=$2 FOR UPDATE',[tenantId,contractId])).rows[0];check((row?.revision||0)===input.expectedRevision,'اجرای قرارداد تغییر کرده است؛ آخرین نسخه را دریافت کنید.',409);
   const at=new Date().toISOString(),p=input.payload;let state=row?.state;
   if(input.action==='start'){
    check(!state,'اجرای قرارداد قبلاً آغاز شده است.',409);check(c.status==='active','گردش قرارداد باید تکمیل و قرارداد فعال شده باشد.',409);check(p.confirmSigned===true,'ثبت تأیید امضای طرفین لازم است.');
    const signedDate=day(p.signedDate,'تاریخ امضا'),startDate=day(p.startDate,'تاریخ اثر'),endDate=day(p.endDate,'تاریخ پایان');check(endDate>=startDate,'پایان پیش از شروع است.');check(['receivable','payable'].includes(p.direction),'جهت مالی لازم است.');const amount=money(p.amount,'مبلغ توافق‌شده'),advanceLimit=money(p.advanceLimit,'سقف پیش‌پرداخت');check(amount>0&&advanceLimit<=amount,'مبلغ مثبت و سقف پیش‌پرداخت در حد مبلغ قرارداد لازم است.');
    state={...aggregate(),basis:{reference:reference(p),signedDate,startDate,endDate,amount,advanceLimit,direction:p.direction,counterparties:str(p.counterparties,'امضاکنندگان طرفین',1000),actor:who,recordedAt:at},effectiveAmount:amount,endDate,status:'running'};
   }else{check(state,'ابتدا مبنای امضاشده اجرا را ثبت کنید.',409);check(state.status!=='closed','پرونده اجرا خاتمه یافته است.',409);if(state.status==='paused')check(executionActionAvailable(state.status,input.action),'اجرا متوقف است؛ این اقدام به شروع مجدد نیاز دارد.',409);state=apply(state,input.action,p,at);}
   const revision=(row?.revision||0)+1;
   if(row)await tx.query('UPDATE contracts.contract_execution SET revision=$3,state=$4,updated_at=now() WHERE tenant_id=$1 AND contract_id=$2',[tenantId,contractId,revision,JSON.stringify(state)]);
   else await tx.query('INSERT INTO contracts.contract_execution(tenant_id,contract_id,revision,state) VALUES($1,$2,$3,$4)',[tenantId,contractId,revision,JSON.stringify(state)]);
   await tx.query('INSERT INTO contracts.execution_commands(tenant_id,contract_id,request_key,request_hash,revision,action,actor,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[tenantId,contractId,key,hash,revision,input.action,JSON.stringify(who),JSON.stringify(p)]);
   await tx.query('INSERT INTO contracts.contract_events(tenant_id,contract_id,event_type,actor_label,payload) VALUES($1,$2,$3,$4,$5)',[tenantId,contractId,'execution_updated',who?.name||'آزمون محلی',JSON.stringify({action:input.action,revision,actor:who})]);
  });return read(contractId);
 }
 return {read,command};
}
