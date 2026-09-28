import { BadRequestException, Controller, Get, NotFoundException, Param, ParseIntPipe, Query } from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

export function insightRange(from: string, to: string) {
  const day = (value: string) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(new Date(value+'T00:00:00Z').getTime()) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value) throw new BadRequestException('Use valid YYYY-MM-DD dates');
    return new Date(value+'T00:00:00+06:00');
  };
  const start = day(from), end = new Date(day(to).getTime()+86400000);
  if (end <= start || end.getTime()-start.getTime()>366*86400000) throw new BadRequestException('Choose a date range of up to 366 days, with From before To');
  return {start,end};
}

@Controller('target-insights')
@Roles(UserRole.owner, UserRole.manager)
export class TargetInsightsController {
 constructor(private readonly prisma: PrismaService) {}
 @Get('skips') async skips(@Query('from') from: string, @Query('to') to: string) {
  const {start,end}=insightRange(from,to);
  const [rows,since] = await this.prisma.$transaction([
   this.prisma.$queryRaw(Prisma.sql`
    WITH assignments AS (
     SELECT DISTINCT target_id, (after_state->>'assigned_to_id')::integer employee_id
     FROM design_target_events WHERE action='assigned' AND recorded_at>=${start} AND recorded_at<${end}
    ), requests AS (
     SELECT r.*, a.target_id IS NOT NULL in_cohort FROM design_skip_requests r
     LEFT JOIN assignments a ON a.target_id=r.target_id AND a.employee_id=r.employee_id
     WHERE requested_at>=${start} AND requested_at<${end}
    ), counts AS (
     SELECT employee_id, count(*)::integer requests,
      count(*) FILTER (WHERE decision='automatic')::integer automatic,
      count(*) FILTER (WHERE decision='pending')::integer pending,
      count(*) FILTER (WHERE decision='approved')::integer approved,
      count(*) FILTER (WHERE decision='rejected')::integer rejected,
      count(DISTINCT target_id) FILTER (WHERE in_cohort AND decision IN ('automatic','approved'))::integer cohort_skipped,
      count(*) FILTER (WHERE NOT in_cohort)::integer outside_cohort
     FROM requests GROUP BY employee_id
    ), cohort AS (SELECT employee_id,count(*)::integer assigned FROM assignments GROUP BY employee_id)
    SELECT e.id, e.emp_code "empCode", e.full_name "fullName", coalesce(a.assigned,0) assigned,
     coalesce(c.requests,0) requests,coalesce(c.automatic,0) automatic,coalesce(c.pending,0) pending,
     coalesce(c.approved,0) approved,coalesce(c.rejected,0) rejected,
     coalesce(c.cohort_skipped,0) "cohortSkipped",coalesce(c.outside_cohort,0) "outsideCohort",
     CASE WHEN a.assigned>0 THEN round(100.0*coalesce(c.cohort_skipped,0)/a.assigned,1)::float ELSE NULL END "skipRate"
    FROM employees e LEFT JOIN counts c ON c.employee_id=e.id LEFT JOIN cohort a ON a.employee_id=e.id
    WHERE c.employee_id IS NOT NULL OR a.employee_id IS NOT NULL ORDER BY coalesce(c.requests,0) DESC,e.emp_code
   `),
   this.prisma.setting.findUnique({where:{key:'production.history.since'},select:{value:true}}),
  ],{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  return {from,to,historySince:since?.value??null,rows,definition:'Rate = unique targets with automatic or approved skip requests in this period from unique targets assigned to that person in this period. Pending and rejected requests are excluded from the rate. Carry-in/unknown assignments are excluded from the rate and shown separately. Request counts include repeated and rejected requests. Decisions show their current state.'};
 }
 @Get(':id/history') async history(@Param('id',ParseIntPipe) id:number,@Query('before') raw?:string) {
  const before=raw===undefined?undefined:Number(raw);
  if(before!==undefined&&(!Number.isSafeInteger(before)||before<1||before>2147483647)) throw new BadRequestException('Invalid history cursor');
  const target=await this.prisma.designTarget.findUnique({where:{id},select:{id:true,asin:true,jobNumber:true,status:true}});
  if(!target) throw new NotFoundException('Target not found');
  const rows=await this.prisma.designTargetEvent.findMany({where:{targetId:id,...(before?{id:{lt:before}}:{})},orderBy:{id:'desc'},take:51});
  const since=await this.prisma.setting.findUnique({where:{key:'production.history.since'},select:{value:true}});
  return {target,historySince:since?.value??null,rows:rows.slice(0,50),nextBefore:rows.length>50?rows[49].id:null};
 }
}
