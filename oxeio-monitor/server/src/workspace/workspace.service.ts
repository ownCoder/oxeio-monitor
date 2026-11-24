import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { OfficeService } from '../office/office.service';

export interface Notice { key: string; title: string; href: string; at: Date; category: string }
export function deadlineState(due: Date, now: Date) {
  return due < now ? 'overdue' : due.getTime() - now.getTime() <= 86400000 ? 'due-soon' : 'scheduled';
}
export function officeHref(kind: string, id: number) {
  const section = ({brief:'briefs',brief_template:'briefs',blocker:'help',submission:'checks',checklist_template:'checks',sop:'library',asset:'equipment',lifecycle:'people',lifecycle_template:'people',coaching:'coaching'} as Record<string,string>)[kind] ?? 'today';
  return `/office/${section}?entry=${id}`;
}
@Injectable()
export class WorkspaceService {
  constructor(private readonly db: PrismaService, private readonly office: OfficeService) {}
  private targetScope(actor: SessionUser): Prisma.DesignTargetWhereInput {
    return actor.role === 'owner' || actor.role === 'manager' ? {} : {assignedToId:actor.employeeId ?? -1};
  }
  async search(actor: SessionUser, q: string) {
    q=q.trim();
    if(q.length<2) return {rows:[]};
    const numeric=/^\d+$/.test(q) && Number(q)<=2147483647 ? Number(q) : null;
    const [targets, entries, people] = await Promise.all([
      this.db.designTarget.findMany({where:{AND:[this.targetScope(actor),{OR:[{asin:{contains:q,mode:'insensitive'}},...(numeric!==null?[{jobNumber:numeric}]:[])]}]},select:{id:true,jobNumber:true,asin:true,status:true},take:20,orderBy:{jobNumber:'asc'}}),
      this.db.officeEntry.findMany({where:{AND:[this.office.scope(actor),{archivedAt:null,title:{contains:q,mode:'insensitive'}}]},select:{id:true,title:true,kind:true},take:20,orderBy:{updatedAt:'desc'}}),
      this.db.employee.findMany({where:{AND:[actor.role==='owner'||actor.role==='manager'?{}:{id:actor.employeeId??-1},{OR:[{fullName:{contains:q,mode:'insensitive'}},{empCode:{contains:q,mode:'insensitive'}}]}]},select:{id:true,fullName:true,empCode:true},take:10,orderBy:{fullName:'asc'}}),
    ]);
    return {rows:[...targets.map(t=>({key:`design:${t.id}`,title:`${t.jobNumber??t.asin} · ${t.asin}`,detail:`Design · ${t.status}`,href:`/production/board?target=${t.id}`})),...entries.map(e=>({key:`office:${e.id}`,title:e.title,detail:e.kind.replaceAll('_',' '),href:officeHref(e.kind,e.id)})),...people.map(p=>({key:`person:${p.id}`,title:`${p.empCode} · ${p.fullName}`,detail:'Staff',href:actor.role==='owner'||actor.role==='manager'?`/staff/${p.id}`:'/me'}))]};
  }
  async deadlines(actor:SessionUser, now=new Date()) {
    const rows=await this.db.designTarget.findMany({where:{AND:[this.targetScope(actor),{status:'assigned',dueAt:{not:null}}]},select:{id:true,jobNumber:true,asin:true,dueAt:true,assignedTo:{select:{empCode:true,fullName:true}}},orderBy:[{dueAt:'asc'},{id:'asc'}],take:200});
    return {rows:rows.map(r=>({...r,state:deadlineState(r.dueAt!,now),href:`/production/board?target=${r.id}`})),limited:rows.length===200};
  }
  async notices(actor:SessionUser, now=new Date()) {
    const since=new Date(now.getTime()-30*86400000);
    const scope=this.targetScope(actor);
    const [assigned,events,comments,deadlines,pending]=await Promise.all([
      this.db.designTarget.findMany({where:{AND:[scope,{status:'assigned',assignedAt:{gte:since}}]},select:{id:true,jobNumber:true,asin:true,assignedAt:true},orderBy:{assignedAt:'desc'},take:50}),
      this.db.officeEvent.findMany({where:{actorId:{not:actor.userId},createdAt:{gte:since},action:{in:['created','updated']},entry:{AND:[this.office.scope(actor),{archivedAt:null}]}},include:{entry:{select:{id:true,title:true,kind:true}}},orderBy:{id:'desc'},take:50}),
      this.db.designComment.findMany({where:{authorId:{not:actor.userId},createdAt:{gte:since},resolvedAt:null,preview:{target:scope}},select:{id:true,createdAt:true,preview:{select:{targetId:true,target:{select:{jobNumber:true,asin:true}}}}},orderBy:{id:'desc'},take:50}),
      this.deadlines(actor,now),
      actor.role==='owner'||actor.role==='manager'?this.db.designTarget.findMany({where:{skipReviewPending:true},select:{id:true,jobNumber:true,asin:true,skipRequestedAt:true},orderBy:{skipRequestedAt:'asc'},take:50}):Promise.resolve([]),
    ]);
    const rows:Notice[]=[
      ...assigned.map(t=>({key:`assignment:${t.id}:${t.assignedAt!.toISOString()}`,title:`Assigned: ${t.jobNumber??t.asin}`,href:`/production/board?target=${t.id}`,at:t.assignedAt!,category:'Assignment'})),
      ...events.map(e=>({key:`office:${e.id}`,title:`${e.action==='created'?'New':'Updated'}: ${e.entry.title}`,href:officeHref(e.entry.kind,e.entry.id),at:e.createdAt,category:e.entry.kind==='blocker'?'Help update':'Office update'})),
      ...comments.map(c=>({key:`comment:${c.id}`,title:`Review comment: ${c.preview.target.jobNumber??c.preview.target.asin}`,href:`/production/board?target=${c.preview.targetId}`,at:c.createdAt,category:'Design review'})),
      ...deadlines.rows.filter(t=>t.state!=='scheduled').map(t=>({key:`deadline:${t.id}:${t.dueAt!.toISOString()}:${t.state}`,title:`${t.state==='overdue'?'Overdue':'Due within 24 hours'}: ${t.jobNumber??t.asin}`,href:t.href,at:t.dueAt!,category:'Deadline'})),
      ...pending.map(t=>({key:`skip:${t.id}:${t.skipRequestedAt?.toISOString()??'pending'}`,title:`Skip approval needed: ${t.jobNumber??t.asin}`,href:`/targets/all?q=${t.asin}`,at:t.skipRequestedAt??now,category:'Approval'})),
    ];
    rows.sort((a,b)=>b.at.getTime()-a.at.getTime());
    const visible=rows.slice(0,200);
    const reads=await this.db.workspaceReceipt.findMany({where:{userId:actor.userId,key:{in:visible.map(r=>r.key)}},select:{key:true}});
    const read=new Set(reads.map(r=>r.key));
    return {rows:visible.map(r=>({...r,read:read.has(r.key)})),unread:visible.filter(r=>!read.has(r.key)).length,limited:rows.length>200};
  }
  async read(actor:SessionUser,key:string) {
    if(key.length>120) throw new BadRequestException('Invalid notification.');
    const current=await this.notices(actor);
    if(!current.rows.some(r=>r.key===key)) throw new NotFoundException('Notification not found.');
    await this.db.workspaceReceipt.upsert({where:{userId_key:{userId:actor.userId,key}},create:{userId:actor.userId,key},update:{}});
    return {ok:true};
  }
}
