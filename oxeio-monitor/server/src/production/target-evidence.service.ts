import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionUser } from '../auth/types';
import { AuditService } from '../audit/audit.service';
import { OfficeService } from '../office/office.service';
import { PrismaService } from '../prisma/prisma.service';
import { SignedUrlService } from '../screenshots/signed-url.service';
import { DESIGN_APPS_SQL, DESIGN_ID_SQL, DESIGN_ID_SQL_EXPR } from '../summary/design.rules';
import { ProductionService } from './production.service';
import { summarizeEvidence, type EvidenceTrace } from './target-evidence.math';

type Shot = { id: bigint; employeeId: number; fullName: string; empCode: string; capturedAt: Date; monitorIndex: number; width: number | null; height: number | null };
const SHOT_ID = `substring(btrim(s.active_title) FROM '${DESIGN_ID_SQL}')`;
const SHOT_APPS = "lower(s.active_app) IN ('illustrator.exe', 'photoshop.exe')";

@Injectable()
export class TargetEvidenceService {
  constructor(
    private readonly db: PrismaService,
    private readonly production: ProductionService,
    private readonly office: OfficeService,
    private readonly urls: SignedUrlService,
    private readonly audit: AuditService,
  ) {}

  async read(actor: SessionUser, id: number, ip: string) {
    const target = await this.production.target(actor, id);
    const manager = actor.role === 'owner' || actor.role === 'manager';
    if (!manager && (!actor.employeeId || target.assignedToId !== actor.employeeId)) {
      throw new ForbiddenException('Design evidence is available to its assigned staff member and managers.');
    }
    const job = target.jobNumber?.toString();
    const scope = manager ? Prisma.empty : Prisma.sql`AND employee_id = ${actor.employeeId}`;
    const shotScope = manager ? Prisma.empty : Prisma.sql`AND s.employee_id = ${actor.employeeId}`;
    const traces = job ? await this.db.$queryRaw<EvidenceTrace[]>`
      SELECT employee_id AS "employeeId", e.full_name AS "fullName", e.emp_code AS "empCode",
             device_id AS "deviceId", process_name AS "processName", work_date AS "workDate",
             started_at AS "startedAt", ended_at AS "endedAt"
      FROM app_usage a JOIN employees e ON e.id = a.employee_id
      WHERE ${Prisma.raw(DESIGN_APPS_SQL)} AND ${Prisma.raw(DESIGN_ID_SQL_EXPR)} = ${job}
        AND segment_state = 'active' AND ended_at > started_at ${scope}
      ORDER BY started_at DESC, a.id DESC LIMIT 5001` : [];
    const included = traces.slice(0, 5000);
    const shotWhere = job ? Prisma.sql`
      s.deleted_at IS NULL AND s.work_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date - 90
      AND ${Prisma.raw(SHOT_APPS)} AND ${Prisma.raw(SHOT_ID)} = ${job} ${shotScope}` : Prisma.sql`false`;
    const [shots, counts, entries, previews, unresolvedComments] = await Promise.all([
      this.db.$queryRaw<Shot[]>`
        SELECT s.id, s.employee_id AS "employeeId", e.full_name AS "fullName", e.emp_code AS "empCode",
               s.captured_at AS "capturedAt", s.monitor_index AS "monitorIndex", s.width, s.height
        FROM screenshots s JOIN employees e ON e.id = s.employee_id
        WHERE ${shotWhere} ORDER BY s.captured_at DESC, s.id DESC LIMIT 24`,
      this.db.$queryRaw<{ total: number }[]>`SELECT count(*)::int AS total FROM screenshots s WHERE ${shotWhere}`,
      this.db.officeEntry.findMany({
        where: { AND: [this.office.scope(actor), { targetId: id, archivedAt: null, kind: { in: ['brief', 'blocker', 'submission'] } }] },
        select: { id: true, kind: true, title: true, content: true, updatedAt: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 20,
      }),
      this.db.designPreview.count({ where: { targetId: id } }),
      this.db.designComment.count({ where: { preview: { targetId: id }, resolvedAt: null } }),
    ]);
    if (shots.length) await this.audit.record({
      userId: actor.userId, action: 'view_screenshot', targetType: 'design_target', targetId: id, ipAddress: ip,
      meta: { source: 'design_evidence', screenshotIds: shots.map(s => s.id.toString()), matching: 'design_app_window_number' },
    });
    return {
      targetId: id, jobNumber: target.jobNumber, generatedAt: new Date().toISOString(),
      scope: manager ? 'team' : 'self', matching: 'design_app_window_number',
      ...summarizeEvidence(included),
      observations: included.length, tracesLimited: traces.length > 5000,
      timeline: included.slice(0, 80).map(row => ({
        employeeId: row.employeeId, empCode: row.empCode, fullName: row.fullName,
        processName: row.processName, deviceId: row.deviceId,
        startedAt: row.startedAt.toISOString(), endedAt: row.endedAt.toISOString(),
      })),
      screenshots: shots.map(shot => ({
        ...shot, id: shot.id.toString(), capturedAt: shot.capturedAt.toISOString(),
        thumbUrl: this.urls.urlFor(shot.id, 'thumb', actor.userId),
        fullUrl: this.urls.urlFor(shot.id, 'full', actor.userId),
      })),
      screenshotTotal: counts[0]?.total ?? 0,
      officeEntries: entries, previewVersions: previews, unresolvedComments,
    };
  }
}
