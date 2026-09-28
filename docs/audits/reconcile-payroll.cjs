const fs = require('node:fs/promises');
const {NestFactory} = require('@nestjs/core');
const {AppModule} = require('/app/dist/app.module');
const {PrismaService} = require('/app/dist/prisma/prisma.service');
const {PayrollService} = require('/app/dist/payroll/payroll.service');
const {MeService} = require('/app/dist/me/me.service');
const {ReportsService} = require('/app/dist/reports/reports.service');
async function main() {
 const app=await NestFactory.createApplicationContext(AppModule,{logger:false});
 try {
  const p=app.get(PrismaService), owner=await p.user.findFirst({where:{role:'owner'}});
  if(!owner) throw new Error('No owner in restored snapshot');
  const month='2026-09', sheet=await app.get(PayrollService).sheet(month,owner.id,'127.0.0.1');
  const summaries=await p.monthlySummary.findMany({where:{yearMonth:month}});
  const daily=await p.dailySummary.groupBy({by:['employeeId'],where:{workDate:{gte:new Date('2026-09-01'),lt:new Date('2026-10-01')}},_sum:{workedSec:true,adjustmentSec:true,creditedSec:true}});
  const issues=[], differences=[];
  const selfViewDifferences=[], reportDifferences=[];
  const report=await app.get(ReportsService).summary({from:'2026-09-01',to:'2026-09-30',groupBy:'month'});
  const money=v=>Math.round(Number(v)*100);
  for(const row of sheet.rows) {
   const s=summaries.find(x=>x.employeeId===row.employeeId);
   if(row.creditedHours!==(s.creditedSec/3600).toFixed(2)) issues.push({empCode:row.empCode,check:'payroll credited hours vs monthly'});
   if(row.payable!==null && row.netPayable!==null && money(row.netPayable)!==Math.max(0,money(row.payable)-money(row.securityDeposit??'0'))) issues.push({empCode:row.empCode,check:'net payable arithmetic'});
   const d=daily.find(x=>x.employeeId===row.employeeId);
   for(const field of ['workedSec','adjustmentSec','creditedSec']) if(s[field] !== (d?._sum[field]??0)) differences.push({empCode:row.empCode,field,monthly:s[field],daily:d?._sum[field]??0});
   const personal=await app.get(MeService).summary({userId:owner.id,email:owner.email,role:'employee',employeeId:row.employeeId,mustChangePw:false,issuedAt:0},new Date('2026-09-27T20:30:00Z'));
   if(personal.progress.monthCreditedSec!==s.creditedSec) selfViewDifferences.push({empCode:row.empCode,monthly:s.creditedSec,self:personal.progress.monthCreditedSec});
   const exported=report.rows.find(x=>x.employeeId===row.employeeId);
   if(!exported || Number(exported.creditedHours)!==Number(row.creditedHours)) reportDifferences.push({empCode:row.empCode,monthlyHours:row.creditedHours,reportHours:exported?.creditedHours??null});
  }
  const review={generatedAt:new Date().toISOString(),month,sourceBackup:'oxeio-2026-09-28-0230.dump.enc',status:'owner review required; partial month; not closed',isolation:'restored disposable clone; payroll ledger/audit writes occur only in clone',checks:{payrollRows:sheet.rows.length,monthlyRows:summaries.length,arithmeticIssues:issues.length,rollupDifferences:differences.length,selfViewDifferences:selfViewDifferences.length,reportDifferences:reportDifferences.length,missingSalary:sheet.missingSalary.length,missingSummary:sheet.missingSummary.length,depositExceedsPayable:sheet.depositExceedsPayable.length,approximateHolidayDates:sheet.approximateHolidayDates.length},issues,differences,selfViewDifferences,reportDifferences,sheet};
  await fs.writeFile('/review/payroll-review-2026-09.json',JSON.stringify(review,null,2),{mode:0o600});
  const escape=v=>String(v??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const columns=['empCode','fullName','monthlySalary','workdays','monthWorkdays','observedWorkdays','targetHours','observedTargetHours','creditedHours','deduction','payable','securityDeposit','netPayable'];
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><title>September payroll owner review</title><style>body{font:14px system-ui;margin:28px;color:#18252b}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:8px;border:1px solid #cbd5da;text-align:right}th{background:#edf4f4}td:nth-child(2){text-align:left}pre{white-space:pre-wrap}</style><h1>September payroll — owner review</h1><p>Partial month; snapshot 28 September 2026 at 02:30 Dhaka. Not approved or closed. No live ledger changes.</p><p>Monthly salary is the configured monthly rate; payable applies employment proration and observed-day deductions. Missing rows and differences must be reviewed before closing.</p><pre>'+escape(JSON.stringify(review.checks,null,2))+'</pre><table><thead><tr>'+columns.map(c=>'<th>'+escape(c)+'</th>').join('')+'</tr></thead><tbody>'+sheet.rows.map(r=>'<tr>'+columns.map(c=>'<td>'+escape(r[c])+'</td>').join('')+'</tr>').join('')+'</tbody></table></html>';
  await fs.writeFile('/review/payroll-review-2026-09.html',html,{mode:0o600});
  console.log(JSON.stringify({status:review.status,...review.checks}));
 } finally {await app.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
