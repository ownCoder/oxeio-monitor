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
 @Get('daily') async daily(@Query('from') from: string, @Query('to') to: string) {
  const {start,end}=insightRange(from,to);
  const rows=await this.prisma.$queryRaw<{
   date:string;employeeId:number;empCode:string;fullName:string;completed:number;issued:number;
   skipped:number|null;pending:number|null;notFound:number|null;events:number|null;copyright:number|null;birthday:number|null;others:number|null;
   replacementIssued:number|null;replacementOwed:number|null;
  }[]>(Prisma.sql`
   WITH days AS (
    SELECT generate_series(${from}::date,LEAST(${to}::date,(now() AT TIME ZONE 'Asia/Dhaka')::date),interval '1 day')::date AS report_date
   ), completed AS (
    SELECT assigned_to_id employee_id,(completed_at AT TIME ZONE 'Asia/Dhaka')::date AS work_date,count(*)::int n
    FROM design_targets
    WHERE assigned_to_id IS NOT NULL AND completed_at>=${start} AND completed_at<${end}
    GROUP BY 1,2
   ), issued AS (
    SELECT (after_state->>'assigned_to_id')::integer employee_id,
     (recorded_at AT TIME ZONE 'Asia/Dhaka')::date AS work_date,count(*)::int n
    FROM design_target_events
    WHERE action='assigned' AND recorded_at>=${start} AND recorded_at<${end}
    GROUP BY 1,2
   ), skips AS (
    SELECT employee_id,(requested_at AT TIME ZONE 'Asia/Dhaka')::date AS work_date,
     count(*) FILTER (WHERE decision IN ('automatic','approved') OR (decision='pending' AND target.status='skipped'))::int skipped,
     count(*) FILTER (WHERE decision='pending')::int pending,
     count(*) FILTER (WHERE (decision IN ('automatic','approved') OR (decision='pending' AND target.status='skipped')) AND reason='not_found')::int not_found,
     count(*) FILTER (WHERE (decision IN ('automatic','approved') OR (decision='pending' AND target.status='skipped')) AND reason='events')::int events,
     count(*) FILTER (WHERE (decision IN ('automatic','approved') OR (decision='pending' AND target.status='skipped')) AND reason='copyright')::int copyright,
     count(*) FILTER (WHERE (decision IN ('automatic','approved') OR (decision='pending' AND target.status='skipped')) AND reason='birthday')::int birthday,
     count(*) FILTER (WHERE (decision IN ('automatic','approved') OR (decision='pending' AND target.status='skipped')) AND reason='others')::int others,
     count(*) FILTER (WHERE replacement_target_id IS NOT NULL)::int replacement_issued,
     count(*) FILTER (WHERE replacement_due)::int replacement_owed
    FROM design_skip_requests request JOIN design_targets target ON target.id=request.target_id
    WHERE requested_at>=${start} AND requested_at<${end}
    GROUP BY 1,2
   )
   SELECT to_char(d.report_date,'YYYY-MM-DD') date,e.id "employeeId",e.emp_code "empCode",e.full_name "fullName",
    coalesce(c.n,0)::int completed,coalesce(i.n,0)::int issued,
    CASE WHEN d.report_date<DATE '2026-09-28' THEN NULL ELSE coalesce(s.skipped,0)::int END skipped,
    CASE WHEN d.report_date<DATE '2026-09-28' THEN NULL ELSE coalesce(s.pending,0)::int END pending,
    CASE WHEN d.report_date<DATE '2026-09-28' THEN NULL ELSE coalesce(s.not_found,0)::int END "notFound",
    CASE WHEN d.report_date<DATE '2026-09-28' THEN NULL ELSE coalesce(s.events,0)::int END events,
    CASE WHEN d.report_date<DATE '2026-09-28' THEN NULL ELSE coalesce(s.copyright,0)::int END copyright,
    CASE WHEN d.report_date<DATE '2026-09-28' THEN NULL ELSE coalesce(s.birthday,0)::int END birthday,
    CASE WHEN d.report_date<DATE '2026-09-28' THEN NULL ELSE coalesce(s.others,0)::int END others,
    coalesce(s.replacement_issued,0)::int "replacementIssued",
    coalesce(s.replacement_owed,0)::int "replacementOwed"
   FROM days d CROSS JOIN employees e
   LEFT JOIN completed c ON c.employee_id=e.id AND c.work_date=d.report_date
   LEFT JOIN issued i ON i.employee_id=e.id AND i.work_date=d.report_date
   LEFT JOIN skips s ON s.employee_id=e.id AND s.work_date=d.report_date
   WHERE (e.joined_on IS NULL OR e.joined_on<=d.report_date)
     AND (e.left_on IS NULL OR e.left_on>=d.report_date)
   ORDER BY d.report_date DESC,e.emp_code
  `);
  return {from,to,skipHistoryCompleteFrom:'2026-09-28',rows,
   definition:'Issued counts recorded assignment events on the Dhaka issue day (history starts 27 September 2026). Completed is credited to current assigned staff on completion day. Skipped and reasons count automatic/approved requests plus pending requests whose target is already skipped; legacy pending assignments remain only in Pending. Replacement issued/owed describe those requests as of now, even if delivery happened later. Replacement tracking began with release 453 on 7 October; earlier zeros do not mean replacements were delivered. Skip days before 28 September are unknown.'};
 }
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
