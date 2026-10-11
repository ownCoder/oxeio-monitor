import {ForbiddenException,Injectable} from '@nestjs/common';
import {UserRole} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service';
import {QUEUES,queueWhere} from '../production/production.rules';

export const DATA_TOPICS=['pool','review','office','production','alerts','salary'] as const;
export type DataTopic=typeof DATA_TOPICS[number];
type Reader={role:UserRole;employeeId:number|null};
const manager=(role:UserRole)=>role===UserRole.owner||role===UserRole.manager;
const dhakaDay=()=>new Date(Date.now()+6*3600_000).toISOString().slice(0,10);

/** One permission boundary for the portal endpoint and the Telegram worker. */
@Injectable()
export class TelegramAiDataService {
 constructor(private readonly db:PrismaService){}

 async read(reader:Reader,topic:DataTopic){
  const day=dhakaDay();
  const start=new Date(`${day}T00:00:00+06:00`);
  const end=new Date(start.getTime()+86400_000);
  if(topic==='office'){
   const own=manager(reader.role)?{}:{employeeId:reader.employeeId??-1};
   const [openHelp,assigned]=await Promise.all([
    this.db.officeEntry.count({where:{...own,archivedAt:null,kind:'blocker',content:{path:['state'],equals:'open'}}}),
    this.db.designTarget.count({where:{status:'assigned',...(manager(reader.role)?{}:{assignedToId:reader.employeeId??-1})}}),
   ]);
   return {topic,asOf:day,scope:manager(reader.role)?'team':'self',openHelp,assignedDesigns:assigned};
  }
  if(topic==='production'){
   if(reader.role===UserRole.employee) throw new ForbiddenException('Production board is not available to staff accounts.');
   const counts=await Promise.all(QUEUES.map(queue=>this.db.designTarget.count({where:queueWhere(queue)})));
   return {topic,asOf:day,queues:Object.fromEntries(QUEUES.map((queue,index)=>[queue,counts[index]]))};
  }
  if(!manager(reader.role)) throw new ForbiddenException('Team data is available only to managers and the owner.');
  if(topic==='pool'){
   const [available,inHand,completed,skipped,deleted]=await Promise.all([
    this.db.designTarget.count({where:{status:'pool'}}),
    this.db.designTarget.count({where:{status:'assigned'}}),
    this.db.designTarget.count({where:{status:'done'}}),
    this.db.designTarget.count({where:{status:'skipped'}}),
    this.db.designTarget.count({where:{status:'deleted'}}),
   ]);
   return {topic,asOf:day,available,inHand,completed,skipped,deleted};
  }
  if(topic==='review'){
   const [pendingSkipReviews,replacementsOwed,completedToday,skipsToday]=await Promise.all([
    this.db.designSkipRequest.count({where:{decision:'pending'}}),
    this.db.designSkipRequest.count({where:{replacementDue:true}}),
    this.db.designTarget.count({where:{completedAt:{gte:start,lt:end}}}),
    this.db.designSkipRequest.count({where:{requestedAt:{gte:start,lt:end},decision:{in:['automatic','approved']}}}),
   ]);
   return {topic,asOf:day,pendingSkipReviews,replacementsOwed,completedToday,acceptedSkipsToday:skipsToday};
  }
  if(topic==='alerts'){
   if(reader.role!==UserRole.owner) throw new ForbiddenException('Alerts are owner-only.');
   const [openAlerts,criticalAlerts]=await Promise.all([
    this.db.alert.count({where:{acknowledgedAt:null,resolvedAt:null}}),
    this.db.alert.count({where:{acknowledgedAt:null,resolvedAt:null,severity:'critical'}}),
   ]);
   return {topic,asOf:day,openAlerts,criticalAlerts};
  }
  if(reader.role!==UserRole.owner) throw new ForbiddenException('Salary payment status is owner-only.');
  const month=day.slice(0,7);
  const eligible={OR:[{status:'active' as const},{leftOn:{gte:new Date(`${month}-01T00:00:00Z`)}}]};
  const paymentWhere={yearMonth:month,employee:eligible};
  const [staffInPeriod,recorded,paid,partial,unpaid]=await Promise.all([
   this.db.employee.count({where:eligible}),
   this.db.salaryPayment.count({where:paymentWhere}),
   this.db.salaryPayment.count({where:{...paymentWhere,status:'paid'}}),
   this.db.salaryPayment.count({where:{...paymentWhere,status:'partial'}}),
   this.db.salaryPayment.count({where:{...paymentWhere,status:'unpaid'}}),
  ]);
  return {topic,asOf:day,month,staffInPeriod,recorded,paid,partial,unpaid,unknown:Math.max(0,staffInPeriod-recorded),note:'Payment records show recorded state; missing rows are unknown, not unpaid.'};
 }

 render(data:Awaited<ReturnType<TelegramAiDataService['read']>>):string{
  switch(data.topic){
   case 'office':return `${data.asOf} · ${data.scope==='self'?'আপনার':'দলের'} Office: ${data.assignedDesigns}টি assigned design, ${data.openHelp}টি open blocker।`;
   case 'production':return `Production · ${data.asOf}\nUnstarted ${data.queues.unstarted}, in progress ${data.queues.in_progress}, to check ${data.queues.to_check}, to fix ${data.queues.to_fix}, to upload ${data.queues.to_upload}, to live ${data.queues.to_live}।`;
   case 'pool':return `Design Pool · ${data.asOf}\nPool ${data.available}, in hand ${data.inHand}, done ${data.completed}, skipped ${data.skipped}, deleted ${data.deleted}।`;
   case 'review':return `Review · ${data.asOf}\nPending skip review ${data.pendingSkipReviews}, replacement owed ${data.replacementsOwed}। আজ complete ${data.completedToday}, accepted skip ${data.acceptedSkipsToday}।`;
   case 'alerts':return `Alerts · ${data.asOf}\nOpen ${data.openAlerts}, critical ${data.criticalAlerts}। বিস্তারিত portal-এর Alerts page-এ দেখুন।`;
   case 'salary':return `Salary payment · ${data.month}\nএই মাসে অন্তর্ভুক্ত staff ${data.staffInPeriod}, paid record ${data.paid}, partial ${data.partial}, unpaid record ${data.unpaid}, record নেই ${data.unknown}। Record নেই মানে unpaid নয়; portal-এর Salary page মিলিয়ে দেখুন।`;
  }
 }
}
