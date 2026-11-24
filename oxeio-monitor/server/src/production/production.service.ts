import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { SessionUser } from '../auth/types';
import { PrismaService } from '../prisma/prisma.service';
import { targetWrite } from '../targets/target-history.context';
import { DESIGN_WORK_STAFF_TYPES } from '../targets/targets.rules';
import { DESIGN_APPS_SQL, DESIGN_ID_SQL_EXPR, designTargetOf } from '../summary/design.rules';
import { summarizeEstimates } from './estimate.math';
import { summarizeEvidence, type EvidenceTrace } from './target-evidence.math';
import {
  QUEUES,
  WAIT_FIELD,
  queueWhere,
  reportRange,
  validDay,
  type Queue,
} from './production.rules';

@Injectable()
export class ProductionService {
  constructor(private readonly prisma: PrismaService) {}

  async target(actor: SessionUser, id: number) {
    const target = await this.prisma.designTarget.findUnique({
      where: { id },
      include: { assignedTo: { select: { fullName: true, empCode: true } } },
    });
    if (!target) throw new NotFoundException('Target not found.');
    if (
      actor.role === 'employee' &&
      (!actor.employeeId || target.assignedToId !== actor.employeeId)
    ) {
      throw new ForbiddenException('This target is not assigned to you.');
    }
    return target;
  }

  async history(actor: SessionUser, id: number, before?: number) {
    const target = await this.target(actor, id);
    const rows = await this.prisma.designTargetEvent.findMany({
      where: { targetId: id, ...(before ? { id: { lt: before } } : {}) },
      orderBy: { id: 'desc' },
      take: 51,
    });
    const since = await this.prisma.setting.findUnique({
      where: { key: 'production.history.since' },
    });
    return {
      target,
      since: since?.value ?? null,
      rows: rows.slice(0, 50),
      nextBefore: rows.length > 50 ? rows[49].id : null,
    };
  }

  async queue(
    queue: Queue,
    page = 1,
    staffId?: number,
    q?: string,
    now = new Date(),
  ) {
    const numeric = q && /^\d+$/.test(q) ? Number(q) : null;
    const where: Prisma.DesignTargetWhereInput = {
      ...queueWhere(queue),
      ...(staffId ? { assignedToId: staffId } : {}),
      ...(q
        ? {
            OR: [
              { asin: { contains: q.toUpperCase() } },
              ...(numeric !== null &&
              Number.isSafeInteger(numeric) &&
              numeric <= 2147483647
                ? [{ jobNumber: numeric }]
                : []),
            ],
          }
        : {}),
    };
    const field = WAIT_FIELD[queue];
    const [total, rows] = await this.prisma.$transaction(
      [
        this.prisma.designTarget.count({ where }),
        this.prisma.designTarget.findMany({
          where,
          skip: (page - 1) * 20,
          take: 20,
          orderBy: [
            { priority: 'desc' },
            { [field]: { sort: 'asc', nulls: 'last' } },
            { id: 'asc' },
          ],
          select: {
            id: true,
            asin: true,
            jobNumber: true,
            priority: true,
            dueAt: true,
            assignedAt: true,
            startedAt: true,
            completedAt: true,
            errorFoundAt: true,
            uploadedAt: true,
            assignedTo: { select: { id: true, fullName: true, empCode: true } },
          },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      queue,
      total,
      page,
      pages: Math.ceil(total / 20),
      rows: rows.map((row) => ({
        ...row,
        waitingSince: row[field],
        waitingHours:
          row[field] === null
            ? null
            : Math.max(0, (now.getTime() - row[field].getTime()) / 3600000),
      })),
    };
  }

  async board(staffId?: number, q?: string) {
    return {
      generatedAt: new Date().toISOString(),
      queues: await Promise.all(
        QUEUES.map((queue) => this.queue(queue, 1, staffId, q)),
      ),
    };
  }

  async workload() {
    const employees = await this.prisma.employee.findMany({
      where: {
        status: 'active',
        staffType: { in: [...DESIGN_WORK_STAFF_TYPES] },
      },
      select: {
        id: true,
        fullName: true,
        empCode: true,
        dailyDesignTarget: true,
        policy: { select: { dailyDesignTarget: true } },
      },
      orderBy: { empCode: 'asc' },
    });
    const rows = await this.prisma.designTarget.findMany({
      where: { status: 'assigned' },
      select: {
        assignedToId: true,
        startedAt: true,
        priority: true,
        dueAt: true,
      },
    });
    const now = new Date();
    return employees.map((emp) => {
      const own = rows.filter((row) => row.assignedToId === emp.id);
      const { policy, ...person } = emp;
      return {
        ...person,
        dailyDesignTarget: designTargetOf(emp.dailyDesignTarget, policy?.dailyDesignTarget),
        unstarted: own.filter((row) => row.startedAt === null).length,
        started: own.filter((row) => row.startedAt !== null).length,
        highPriority: own.filter((row) => row.priority === 2).length,
        overdue: own.filter((row) => row.dueAt !== null && row.dueAt < now)
          .length,
      };
    });
  }

  async actionCenter(now = new Date()) {
    const stored = await this.prisma.setting.findUnique({
      where: { key: 'production.digest.config' },
      select: { value: true },
    });
    const configured = (stored?.value as { staleHours?: unknown } | null)?.staleHours;
    const staleHours =
      typeof configured === 'number' && Number.isInteger(configured) && configured >= 1 && configured <= 720
        ? configured
        : 48;
    const cutoff = new Date(now.getTime() - staleHours * 3600000);
    const targetSelect = {
      id: true,
      asin: true,
      jobNumber: true,
      assignedAt: true,
      dueAt: true,
      errorFoundAt: true,
      skipRequestedAt: true,
      assignedTo: { select: { id: true, fullName: true, empCode: true } },
    } as const;
    const [
      skipReviewCount,
      skipReview,
      replacementCount,
      replacements,
      overdueCount,
      overdue,
      unstartedCount,
      unstarted,
      reworkCount,
      rework,
      staff,
    ] = await this.prisma.$transaction([
      this.prisma.designTarget.count({ where: { status: 'skipped', skipReviewPending: true } }),
      this.prisma.designTarget.findMany({
        where: { status: 'skipped', skipReviewPending: true },
        select: targetSelect,
        orderBy: [{ skipRequestedAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 25,
      }),
      this.prisma.designSkipRequest.count({ where: { replacementDue: true } }),
      this.prisma.designSkipRequest.findMany({
        where: { replacementDue: true },
        select: { id: true, requestedAt: true, target: { select: targetSelect } },
        orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
        take: 25,
      }),
      this.prisma.designTarget.count({
        where: { status: 'assigned', skipReviewPending: false, dueAt: { lt: now } },
      }),
      this.prisma.designTarget.findMany({
        where: { status: 'assigned', skipReviewPending: false, dueAt: { lt: now } },
        select: targetSelect,
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
        take: 25,
      }),
      this.prisma.designTarget.count({
        where: {
          status: 'assigned', skipReviewPending: false, startedAt: null,
          assignedAt: { not: null, lt: cutoff },
        },
      }),
      this.prisma.designTarget.findMany({
        where: {
          status: 'assigned', skipReviewPending: false, startedAt: null,
          assignedAt: { not: null, lt: cutoff },
        },
        select: targetSelect,
        orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
        take: 25,
      }),
      this.prisma.designTarget.count({
        where: { status: 'done', errorFoundAt: { not: null }, fixedAt: null },
      }),
      this.prisma.designTarget.findMany({
        where: { status: 'done', errorFoundAt: { not: null }, fixedAt: null },
        select: targetSelect,
        orderBy: [{ errorFoundAt: 'asc' }, { id: 'asc' }],
        take: 25,
      }),
      this.prisma.employee.findMany({
        where: { status: 'active', staffType: { in: [...DESIGN_WORK_STAFF_TYPES] } },
        select: {
          id: true, fullName: true, empCode: true,
          devices: { where: { status: 'active' }, select: { lastSeenAt: true } },
        },
        orderBy: { empCode: 'asc' },
      }),
    ]);
    const agentMissing = staff.filter(
      (person) => person.devices.length === 0 || person.devices.every((device) => device.lastSeenAt === null),
    );
    const key = (row: { jobNumber: number | null; asin: string }) => row.jobNumber ?? row.asin;
    const person = (row: { assignedTo: { id: number; fullName: string; empCode: string } | null }) =>
      row.assignedTo ? { employeeId: row.assignedTo.id, fullName: row.assignedTo.fullName, empCode: row.assignedTo.empCode } : null;
    const rows = [
      ...skipReview.map((row) => ({
        id: `skip:${row.id}`, type: 'skip_review' as const, priority: 1,
        title: `Skip review · ${key(row)}`, detail: 'Approve, correct the reason, return to the designer, or send to Design Pool.',
        at: row.skipRequestedAt, targetId: row.id, person: person(row),
        href: `/targets/review?q=${encodeURIComponent(String(key(row)))}`, action: 'Review skip',
      })),
      ...replacements.map(({ id, requestedAt, target: row }) => ({
        id: `replacement:${id}`, type: 'replacement_owed' as const, priority: 1,
        title: `Replacement owed · ${key(row)}`, detail: 'The recorded skip still needs its 1:1 replacement allocation.',
        at: requestedAt, targetId: row.id, person: person(row),
        href: `/targets/review?q=${encodeURIComponent(String(key(row)))}`, action: 'Open skip record',
      })),
      ...rework.map((row) => ({
        id: `rework:${row.id}`, type: 'rework' as const, priority: 1,
        title: `Rework open · ${key(row)}`, detail: 'A quality check found an error and no fix is recorded yet.',
        at: row.errorFoundAt, targetId: row.id, person: person(row),
        href: `/production/action-center?target=${row.id}`, action: 'Open design',
      })),
      ...overdue.map((row) => ({
        id: `overdue:${row.id}`, type: 'overdue' as const, priority: 2,
        title: `Overdue · ${key(row)}`, detail: 'The assigned design has passed its recorded due time.',
        at: row.dueAt, targetId: row.id, person: person(row),
        href: `/production/action-center?target=${row.id}`, action: 'Open design',
      })),
      ...unstarted.map((row) => ({
        id: `unstarted:${row.id}`, type: 'unstarted' as const, priority: 3,
        title: `Unstarted over ${staleHours}h · ${key(row)}`, detail: 'Assigned time is old and no file-start signal is recorded.',
        at: row.assignedAt, targetId: row.id, person: person(row),
        href: `/production/action-center?target=${row.id}`, action: 'Open design',
      })),
      ...agentMissing.slice(0, 25).map((row) => ({
        id: `agent:${row.id}`, type: 'agent_data_missing' as const, priority: 4,
        title: `Agent setup missing · ${row.empCode}`, detail: row.devices.length === 0
          ? 'No active agent device is linked to this design staff member.'
          : 'An active device is linked, but it has never reported data.',
        at: null, targetId: null, person: { employeeId: row.id, fullName: row.fullName, empCode: row.empCode },
        href: `/staff/${row.id}`, action: 'Open staff',
      })),
    ];
    const counts = {
      skip_review: skipReviewCount,
      replacement_owed: replacementCount,
      rework: reworkCount,
      overdue: overdueCount,
      unstarted: unstartedCount,
      agent_data_missing: agentMissing.length,
    };
    return {
      generatedAt: now.toISOString(), staleHours, counts,
      total: Object.values(counts).reduce((sum, count) => sum + count, 0),
      limited: Object.values(counts).some((count) => count > 25),
      rows,
    };
  }

  async plan(
    actor: SessionUser,
    id: number,
    priority: number,
    dueDay: string | null,
    reason: string,
    workType?: string | null,
    estimatedMinutes?: number | null,
  ) {
    await this.target(actor, id);
    const dueAt =
      dueDay === null
        ? null
        : new Date(validDay(dueDay).getTime() + 86400000 - 1);
    await targetWrite(this.prisma, actor.userId, 'planning', (tx) =>
      tx.designTarget.update({
        where: { id },
        data: {
          priority,
          dueAt,
          assignmentReason: reason,
          ...(workType !== undefined ? { workType } : {}),
          ...(estimatedMinutes !== undefined ? { estimatedMinutes } : {}),
        },
      }),
    );
    return { ok: true };
  }

  async reassign(
    actor: SessionUser,
    id: number,
    employeeId: number,
    reason: string,
  ) {
    return targetWrite(
      this.prisma,
      actor.userId,
      'reassignment',
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM design_targets WHERE id = ${id} FOR UPDATE`;
        const row = await tx.designTarget.findUnique({ where: { id } });
        if (!row) throw new NotFoundException('Target not found.');
        if (row.status !== 'assigned' || row.startedAt !== null || row.skipReviewPending)
          throw new ConflictException(
            'Only assigned, unstarted work without a pending skip can be reassigned.',
          );
        const emp = await tx.employee.findFirst({
          where: {
            id: employeeId,
            status: 'active',
            staffType: { in: [...DESIGN_WORK_STAFF_TYPES] },
          },
        });
        if (!emp)
          throw new BadRequestException(
            'Choose an active design staff member.',
          );
        if (row.assignedToId === employeeId) return { ok: true };
        await tx.designTarget.update({
          where: { id },
          data: {
            assignedToId: employeeId,
            assignedAt: new Date(),
            assignmentReason: reason,
          },
        });
        return { ok: true };
      },
    );
  }

  async previews(actor: SessionUser, id: number) {
    await this.target(actor, id);
    return this.prisma.designPreview.findMany({
      where: { targetId: id },
      orderBy: { version: 'desc' },
      take: 50,
      select: {
        id: true,
        version: true,
        filename: true,
        mime: true,
        authorName: true,
        note: true,
        createdAt: true,
        comments: { orderBy: { id: 'asc' }, take: 200 },
      },
    });
  }

  async previewImage(actor: SessionUser, id: number) {
    const preview = await this.prisma.designPreview.findUnique({
      where: { id },
    });
    if (!preview) throw new NotFoundException('Preview not found.');
    await this.target(actor, preview.targetId);
    return preview;
  }

  async upload(
    actor: SessionUser,
    targetId: number,
    filename: string,
    base64: string,
    note: string,
  ) {
    await this.target(actor, targetId);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0)
      throw new BadRequestException('Invalid image encoding.');
    const image = Buffer.from(base64, 'base64');
    if (!image.length || image.length > 2 * 1024 * 1024)
      throw new BadRequestException('Preview must be at most 2 MB.');
    const png = image
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = image[0] === 255 && image[1] === 216 && image[2] === 255;
    if (!png && !jpeg)
      throw new BadRequestException('Use a PNG or JPEG preview.');
    const sha256 = createHash('sha256').update(image).digest('hex');
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { fullName: true },
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM design_targets WHERE id = ${targetId} FOR UPDATE`;
      const current = await tx.designTarget.findUnique({
        where: { id: targetId },
      });
      if (
        !current ||
        (actor.role === 'employee' && current.assignedToId !== actor.employeeId)
      )
        throw new ForbiddenException(
          'Assignment changed; refresh before uploading.',
        );
      const existing = await tx.designPreview.findUnique({
        where: { targetId_sha256: { targetId, sha256 } },
        select: { id: true, version: true },
      });
      if (existing) return existing;
      const max = await tx.designPreview.aggregate({
        where: { targetId },
        _max: { version: true },
      });
      if ((max._max.version ?? 0) >= 50)
        throw new BadRequestException(
          'This target already has 50 preview versions.',
        );
      return tx.designPreview.create({
        data: {
          targetId,
          version: (max._max.version ?? 0) + 1,
          filename,
          mime: png ? 'image/png' : 'image/jpeg',
          sha256,
          image,
          authorId: actor.userId,
          authorName: user.fullName,
          note,
        },
        select: { id: true, version: true },
      });
    });
  }

  async comment(
    actor: SessionUser,
    id: number,
    text: string,
    x?: number | null,
    y?: number | null,
  ) {
    const preview = await this.previewImage(actor, id);
    if ((x === undefined || x === null) !== (y === undefined || y === null))
      throw new BadRequestException(
        'Both coordinates are required for a pinned comment.',
      );
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { fullName: true },
    });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM design_targets WHERE id = ${preview.targetId} FOR UPDATE`;
      const current = await tx.designTarget.findUnique({
        where: { id: preview.targetId },
      });
      if (
        !current ||
        (actor.role === 'employee' && current.assignedToId !== actor.employeeId)
      )
        throw new ForbiddenException(
          'Assignment changed; refresh before commenting.',
        );
      await tx.$queryRaw`SELECT id FROM design_previews WHERE id = ${id} FOR UPDATE`;
      if (
        (await tx.designComment.count({ where: { previewId: preview.id } })) >=
        200
      )
        throw new BadRequestException('This version already has 200 comments.');
      return tx.designComment.create({
        data: {
          previewId: id,
          text,
          x,
          y,
          authorId: actor.userId,
          authorName: user.fullName,
        },
      });
    });
  }

  async resolve(actor: SessionUser, id: number, resolved: boolean) {
    const comment = await this.prisma.designComment.findUnique({
      where: { id },
      include: { preview: { select: { targetId: true } } },
    });
    if (!comment) throw new NotFoundException('Comment not found.');
    await this.target(actor, comment.preview.targetId);
    // Staff can discuss assigned work; reviewers/management close review issues.
    if (actor.role === 'employee' && comment.authorId !== actor.userId)
      throw new ForbiddenException('The reviewer must resolve this comment.');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM design_targets WHERE id = ${comment.preview.targetId} FOR UPDATE`;
      const current = await tx.designTarget.findUnique({
        where: { id: comment.preview.targetId },
      });
      if (
        !current ||
        (actor.role === 'employee' && current.assignedToId !== actor.employeeId)
      )
        throw new ForbiddenException(
          'Assignment changed; refresh before resolving.',
        );
      await tx.designComment.updateMany({
        where: { id, resolvedAt: resolved ? null : { not: null } },
        data: {
          resolvedAt: resolved ? new Date() : null,
          resolvedById: resolved ? actor.userId : null,
        },
      });
    });
    return { ok: true };
  }

  async tasks(actor: SessionUser, targetId: number) {
    await this.target(actor, targetId);
    return this.prisma.designTaskItem.findMany({
      where: { targetId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
  }

  async addTask(actor: SessionUser, targetId: number, text: string) {
    await this.target(actor, targetId);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM design_targets WHERE id = ${targetId} FOR UPDATE`;
      const last = await tx.designTaskItem.aggregate({
        where: { targetId },
        _max: { position: true },
        _count: { _all: true },
      });
      if (last._count._all >= 50)
        throw new BadRequestException('This target already has 50 checklist items.');
      return tx.designTaskItem.create({
        data: {
          targetId,
          text,
          position: (last._max.position ?? 0) + 1,
          createdById: actor.userId,
        },
      });
    });
  }

  async taskState(actor: SessionUser, id: number, completed: boolean) {
    const item = await this.prisma.designTaskItem.findUnique({
      where: { id },
      include: { target: { select: { assignedToId: true } } },
    });
    if (!item) throw new NotFoundException('Checklist item not found.');
    if (
      actor.role === 'employee' &&
      (!actor.employeeId || item.target.assignedToId !== actor.employeeId)
    )
      throw new ForbiddenException('This target is not assigned to you.');
    await this.prisma.designTaskItem.update({
      where: { id },
      data: {
        completedAt: completed ? new Date() : null,
        completedById: completed ? actor.userId : null,
      },
    });
    return { ok: true };
  }

  async deleteTask(actor: SessionUser, id: number) {
    const item = await this.prisma.designTaskItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Checklist item not found.');
    await this.target(actor, item.targetId);
    await this.prisma.designTaskItem.delete({ where: { id } });
    return { ok: true };
  }

  async quality(from: string, to: string) {
    const { start, end } = reportRange(from, to);
    const planned = await this.prisma.designTarget.groupBy({
      by: ['workType'],
      where: {
        completedAt: { gte: start, lt: end },
        workType: { not: null },
        estimatedMinutes: { not: null },
      },
      _count: { _all: true },
    });
    type EstimateTrace = EvidenceTrace & {
      targetId: number;
      workType: string;
      estimatedMinutes: number;
    };
    const traces = await this.prisma.$queryRaw<EstimateTrace[]>`
      SELECT t.id AS "targetId", t.work_type AS "workType", t.estimated_minutes AS "estimatedMinutes",
        a.employee_id AS "employeeId", e.full_name AS "fullName", e.emp_code AS "empCode",
        a.device_id AS "deviceId", a.process_name AS "processName", a.work_date AS "workDate",
        a.started_at AS "startedAt", a.ended_at AS "endedAt"
      FROM design_targets t
      JOIN app_usage a ON ${Prisma.raw(DESIGN_ID_SQL_EXPR)} = t.job_number::text
      JOIN employees e ON e.id = a.employee_id
      WHERE t.completed_at >= ${start} AND t.completed_at < ${end}
        AND t.work_type IS NOT NULL AND t.estimated_minutes IS NOT NULL
        AND ${Prisma.raw(DESIGN_APPS_SQL)} AND a.segment_state = 'active' AND a.ended_at > a.started_at
      ORDER BY t.id, a.started_at, a.id LIMIT 50001`;
    const byTarget = new Map<number, EstimateTrace[]>();
    for (const trace of traces.slice(0, 50000)) {
      byTarget.set(trace.targetId, [...(byTarget.get(trace.targetId) ?? []), trace]);
    }
    const samples = [...byTarget.values()].map((rows) => ({
      workType: rows[0].workType,
      estimatedMinutes: rows[0].estimatedMinutes,
      observedSec: summarizeEvidence(rows).foregroundSec,
    }));
    const plannedCount = planned.reduce((sum, row) => sum + row._count._all, 0);
    const review = await this.prisma.$queryRaw<
      { reviewed: number; accepted: number; rework: number }[]
    >`
      WITH first_checks AS (
        SELECT *, row_number() OVER (PARTITION BY target_id ORDER BY id) AS position
        FROM design_target_events WHERE action = 'checked'
      ) SELECT count(*)::int AS reviewed,
        count(*) FILTER (WHERE after_state->>'error_found_at' IS NULL)::int AS accepted,
        count(*) FILTER (WHERE after_state->>'error_found_at' IS NOT NULL)::int AS rework
      FROM first_checks WHERE position = 1 AND recorded_at >= ${start} AND recorded_at < ${end}`;
    const flow = await this.prisma.$queryRaw<
      {
        completeToUploadHours: number | null;
        uploadToLiveHours: number | null;
        uploadSamples: number;
        liveSamples: number;
      }[]
    >`
      SELECT
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM uploaded_at-completed_at)/3600)
          FILTER (WHERE uploaded_at >= ${start} AND uploaded_at < ${end} AND uploaded_at >= completed_at) AS "completeToUploadHours",
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM live_at-uploaded_at)/3600)
          FILTER (WHERE live_at >= ${start} AND live_at < ${end} AND live_at >= uploaded_at) AS "uploadToLiveHours",
        count(*) FILTER (WHERE uploaded_at >= ${start} AND uploaded_at < ${end} AND uploaded_at >= completed_at)::int AS "uploadSamples",
        count(*) FILTER (WHERE live_at >= ${start} AND live_at < ${end} AND live_at >= uploaded_at)::int AS "liveSamples"
      FROM design_targets WHERE (uploaded_at >= ${start} AND uploaded_at < ${end}) OR (live_at >= ${start} AND live_at < ${end})`;
    const since = await this.prisma.setting.findUnique({
      where: { key: 'production.history.since' },
    });
    return {
      from,
      to,
      historySince: since?.value ?? null,
      ...review[0],
      ...flow[0],
      firstPassRate: review[0].reviewed
        ? review[0].accepted / review[0].reviewed
        : null,
      estimates: {
        planned: plannedCount,
        matched: samples.length,
        missingObserved: plannedCount - samples.length,
        tracesLimited: traces.length > 50000,
        byType: summarizeEstimates(samples),
      },
    };
  }
}
