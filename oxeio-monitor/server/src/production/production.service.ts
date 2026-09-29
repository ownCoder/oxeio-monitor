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
import { designTargetOf } from '../summary/design.rules';
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

  async plan(
    actor: SessionUser,
    id: number,
    priority: number,
    dueDay: string | null,
    reason: string,
  ) {
    await this.target(actor, id);
    const dueAt =
      dueDay === null
        ? null
        : new Date(validDay(dueDay).getTime() + 86400000 - 1);
    await targetWrite(this.prisma, actor.userId, 'planning', (tx) =>
      tx.designTarget.update({
        where: { id },
        data: { priority, dueAt, assignmentReason: reason },
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

  async quality(from: string, to: string) {
    const { start, end } = reportRange(from, to);
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
    };
  }
}
