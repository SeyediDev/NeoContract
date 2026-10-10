export const actorRoles={infrastructure:'زیرساخت فن‌آسا',provider:'ارائه‌دهنده / توسعه‌دهنده سرویس',distributor:'توزیع‌کننده',partner:'بازیگر دیگر'};
export const fundingSources={prepayment:'پیش‌پرداخت مشتری',rebate:'اعتبار بازگشتی مصوب',sponsor:'تأمین اعتبار توسط حامی'};
export const revenueBases={net_collected:'دریافت‌شده پس از مالیات و برگشت',gross_collected:'دریافت‌شده پس از برگشت؛ مالیات جدا'};
export function percentParts(v){if(typeof v!=='string'||!/^\d{1,3}(\.\d{1,4})?$/.test(v))throw Error('درصد باید رشته عددی با حداکثر چهار رقم اعشار باشد.');const [a,b='']=v.split('.'),n=Number(a)*10000+Number(b.padEnd(4,'0'));if(n>1000000)throw Error('درصد باید بین صفر و صد باشد.');return n;}
export function allocateRevenue(amount,actors){
 if(typeof amount!=='string'||!/^\d{1,16}$/.test(amount)||BigInt(amount)>BigInt(Number.MAX_SAFE_INTEGER))throw Error('مبلغ صحیح ریالی معتبر لازم است.');
 if(!Array.isArray(actors)||actors.length<2||actors.length>30||new Set(actors.map(a=>a.key)).size!==actors.length)throw Error('بازیگران مستقل لازم‌اند.');
 const parts=actors.map(a=>percentParts(a.percent));if(parts.reduce((a,b)=>a+b,0)!==1000000)throw Error('مجموع سهم بازیگران باید دقیقاً ۱۰۰ درصد باشد.');
 const gross=BigInt(amount),scale=1000000n,rows=actors.map((a,i)=>{const product=gross*BigInt(parts[i]);return {actorKey:a.key,amount:product/scale,remainder:product%scale};});let left=gross-rows.reduce((sum,r)=>sum+r.amount,0n);
 for(const row of [...rows].sort((a,b)=>a.remainder===b.remainder?a.actorKey.localeCompare(b.actorKey):a.remainder>b.remainder?-1:1)){if(left===0n)break;row.amount++;left--;}
 return rows.map(({actorKey,amount})=>({actorKey,amount:amount.toString()}));
}
