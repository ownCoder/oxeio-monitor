import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SessionUser } from '../auth/types';
import { normalize, preflight, type Kind } from './office.rules';
interface Draft {
  kind: Kind;
  title: string;
  content: Record<string, unknown>;
  employeeId?: number | null;
  targetId?: number;
  version?: number;
}
const shared = [
  'brief_template',
  'checklist_template',
  'sop',
  'lifecycle_template',
];
function manager(actor: SessionUser) {
  return actor.role === 'owner' || actor.role === 'manager';
}
@Injectable()
export class OfficeService {
  constructor(private readonly db: PrismaService) {}
  private scope(actor: SessionUser): Prisma.OfficeEntryWhereInput {
    return manager(actor)
      ? {}
      : {
          OR: [
            { kind: { in: shared } },
            ...(actor.employeeId
              ? [
                  { employeeId: actor.employeeId, kind: { not: 'brief' } },
                  { kind: 'brief', target: { assignedToId: actor.employeeId } },
                ]
              : []),
          ],
        };
  }
  async devices(actor: SessionUser) {
    if (!manager(actor))
      throw new ForbiddenException('Only managers view the device register.');
    return this.db.device.findMany({
      select: { id: true, hostname: true, employeeId: true },
      orderBy: { hostname: 'asc' },
      take: 200,
    });
  }
  async designs(actor: SessionUser, q = '') {
    const number =
      /^\d+$/.test(q) && Number(q) <= 2147483647 ? Number(q) : null;
    return this.db.designTarget.findMany({
      where: {
        ...(manager(actor) ? {} : { assignedToId: actor.employeeId ?? -1 }),
        ...(q
          ? {
              OR: [
                { asin: { contains: q.toUpperCase() } },
                ...(number !== null ? [{ jobNumber: number }] : []),
              ],
            }
          : {}),
      },
      select: { id: true, jobNumber: true, asin: true, assignedToId: true },
      orderBy: { jobNumber: 'asc' },
      take: 50,
    });
  }
  async people(actor: SessionUser) {
    return this.db.employee.findMany({
      where: manager(actor) ? {} : { id: actor.employeeId ?? -1 },
      select: { id: true, fullName: true, empCode: true },
      orderBy: { fullName: 'asc' },
    });
  }
  async today(actor: SessionUser) {
    const [openHelp, assigned] = await this.db.$transaction([
      this.db.officeEntry.count({ where: { AND: [this.scope(actor), { archivedAt: null, kind: 'blocker', content: { path: ['state'], equals: 'open' } }] } }),
      this.db.designTarget.count({ where: { status: 'assigned', ...(manager(actor) ? {} : { assignedToId: actor.employeeId ?? -1 }) } }),
    ]);
    return { openHelp, assigned };
  }
  async list(
    actor: SessionUser,
    q: { kind?: Kind; q?: string; page?: number; archived?: string },
  ) {
    if (q.archived && !manager(actor))
      throw new ForbiddenException('Only managers browse archived records.');
    const where: Prisma.OfficeEntryWhereInput = {
      AND: [
        this.scope(actor),
        { archivedAt: q.archived ? { not: null } : null },
        ...(q.kind ? [{ kind: q.kind }] : []),
        ...(q.q
          ? [
              {
                OR: [
                  { title: { contains: q.q, mode: 'insensitive' as const } },
                  { content: { path: ['body'], string_contains: q.q } },
                ],
              },
            ]
          : []),
      ],
    };
    const [total, rows] = await this.db.$transaction([
      this.db.officeEntry.count({ where }),
      this.db.officeEntry.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: ((q.page ?? 1) - 1) * 40,
        take: 40,
        include: {
          acknowledgements: {
            where: { userId: actor.userId },
            select: { version: true },
          },
          employee: { select: { fullName: true, empCode: true } },
          target: { select: { jobNumber: true, asin: true } },
        },
      }),
    ]);
    return { total, rows, page: q.page ?? 1 };
  }
  async get(actor: SessionUser, id: number) {
    const row = await this.db.officeEntry.findFirst({
      where: { AND: [{ id }, this.scope(actor)] },
      include: {
        events: {
          orderBy: { id: 'desc' },
          take: 40,
          select: {
            id: true,
            actorName: true,
            action: true,
            createdAt: true,
            version: true,
            snapshot: true,
          },
        },
        acknowledgements: manager(actor)
          ? { select: { userId: true, version: true, createdAt: true } }
          : {
              where: { userId: actor.userId },
              select: { userId: true, version: true, createdAt: true },
            },
      },
    });
    if (!row) throw new NotFoundException('Office record not found.');
    return row;
  }
  async save(actor: SessionUser, draft: Draft, id?: number) {
    const title = draft.title.trim();
    if (!title) throw new BadRequestException('Title is required.');
    let content: Record<string, unknown>;
    try {
      content = normalize(draft.kind, draft.content);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    if (Buffer.byteLength(JSON.stringify(content), 'utf8') > 18000)
      throw new BadRequestException('Record is too long. Shorten the text.');
    const existing = id ? await this.get(actor, id) : null;
    if (
      existing &&
      (existing.kind !== draft.kind ||
        (draft.kind !== 'asset' &&
          existing.employeeId !== (draft.employeeId ?? null)) ||
        existing.targetId !== (draft.targetId ?? null))
    )
      throw new BadRequestException(
        'Record type and links cannot be changed. Create a new record.',
      );
    if (existing?.archivedAt)
      throw new ConflictException('Restore this record before editing.');
    if (!manager(actor)) {
      if (!['blocker', 'submission'].includes(draft.kind) || !actor.employeeId)
        throw new ForbiddenException(
          'Only managers can create or edit this record.',
        );
      if (draft.employeeId !== actor.employeeId)
        throw new ForbiddenException('Use your own employee account.');
      if (
        draft.kind === 'blocker' &&
        (content.state !== 'open' || content.response !== '')
      )
        throw new ForbiddenException('Managers resolve help requests.');
    }
    if (
      ['brief', 'blocker', 'submission'].includes(draft.kind) &&
      !draft.targetId
    )
      throw new BadRequestException('Select a design target.');
    if (
      ['blocker', 'submission', 'lifecycle', 'coaching'].includes(draft.kind) &&
      !draft.employeeId
    )
      throw new BadRequestException('Select an employee.');
    if (shared.includes(draft.kind) && (draft.targetId || draft.employeeId))
      throw new BadRequestException(
        'Templates and SOPs cannot be private employee records.',
      );
    return this.db
      .$transaction(async (tx) => {
        if (
          draft.kind === 'asset' &&
          Number(content.deviceId) > 0 &&
          !(await tx.device.findUnique({
            where: { id: Number(content.deviceId) },
            select: { id: true },
          }))
        )
          throw new BadRequestException('Linked agent device not found.');
        if (
          draft.employeeId &&
          !(await tx.employee.findUnique({
            where: { id: draft.employeeId },
            select: { id: true },
          }))
        )
          throw new BadRequestException('Employee not found.');
        if (draft.targetId)
          await tx.$queryRaw`SELECT id FROM design_targets WHERE id=${draft.targetId} FOR SHARE`;
        const target = draft.targetId
          ? await tx.designTarget.findUnique({
              where: { id: draft.targetId },
              select: { assignedToId: true, jobNumber: true },
            })
          : null;
        if (draft.targetId && !target)
          throw new BadRequestException('Design target not found.');
        if (
          target &&
          !manager(actor) &&
          target.assignedToId !== actor.employeeId
        )
          throw new ForbiddenException('This design is not assigned to you.');
        if (
          draft.kind === 'brief' &&
          draft.employeeId !== undefined &&
          draft.employeeId !== target?.assignedToId
        )
          throw new BadRequestException(
            'Brief employee must match current assignment.',
          );
        if (['blocker', 'submission'].includes(draft.kind) && draft.employeeId !== target?.assignedToId)
          throw new BadRequestException('Employee must match the current design assignment.');
        if (draft.kind === 'submission') {
          await tx.$queryRaw`SELECT id FROM office_entries WHERE id=${Number(content.checklistId)} FOR SHARE`;
          const checklist = await tx.officeEntry.findFirst({
            where: {
              id: Number(content.checklistId),
              kind: 'checklist_template',
              archivedAt: null,
            },
          });
          if (!checklist || checklist.version !== content.checklistVersion)
            throw new ConflictException(
              'Checklist changed. Reload the latest version.',
            );
          content = {
            ...content,
            items: (checklist.content as Record<string, unknown>).items,
            warnings: preflight(
              content,
              checklist.content as Record<string, unknown>,
              target!.jobNumber,
            ),
          };
        }
        const data = {
          title,
          content: content as Prisma.InputJsonObject,
          ...(draft.kind === 'asset'
            ? { employeeId: draft.employeeId ?? null }
            : {}),
        };
        let row;
        if (existing) {
          if (!draft.version)
            throw new ConflictException('Reload this record before editing.');
          const result = await tx.officeEntry.updateMany({
            where: {
              id: existing.id,
              version: draft.version,
              archivedAt: null,
            },
            data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (result.count !== 1)
            throw new ConflictException(
              'Another person edited this record. Reload before saving.',
            );
          row = await tx.officeEntry.findUniqueOrThrow({
            where: { id: existing.id },
          });
        } else
          row = await tx.officeEntry.create({
            data: {
              ...data,
              kind: draft.kind,
              employeeId: draft.employeeId,
              targetId: draft.targetId,
              createdBy: actor.userId,
            },
          });
        await tx.officeEvent.create({
          data: {
            entryId: row.id,
            actorId: actor.userId,
            actorName: actor.email,
            action: existing ? 'updated' : 'created',
            version: row.version,
            snapshot: {
              title: row.title,
              employeeId: row.employeeId,
              content: row.content,
            } as Prisma.InputJsonObject,
          },
        });
        return row;
      })
      .catch((error: unknown) => {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          throw new ConflictException('That asset tag is already registered.');
        throw error;
      });
  }
  async ack(actor: SessionUser, id: number, version: number) {
    await this.get(actor, id);
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { version: number; kind: string; archived_at: Date | null }[]
      >`SELECT version, kind, archived_at FROM office_entries WHERE id=${id} FOR UPDATE`;
      const row = rows[0];
      if (row?.kind !== 'sop' || row.archived_at || row.version !== version)
        throw new ConflictException('Read the current published SOP first.');
      return tx.officeAcknowledgement.upsert({
        where: {
          entryId_userId_version: {
            entryId: id,
            userId: actor.userId,
            version,
          },
        },
        create: { entryId: id, userId: actor.userId, version },
        update: {},
      });
    });
  }
  async archive(
    actor: SessionUser,
    id: number,
    dto: { version: number; archived: boolean },
  ) {
    if (!manager(actor))
      throw new ForbiddenException('Only managers archive records.');
    return this.db.$transaction(async (tx) => {
      const changed = await tx.officeEntry.updateMany({
        where: { id, version: dto.version },
        data: {
          archivedAt: dto.archived ? new Date() : null,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (!changed.count)
        throw new ConflictException('Record changed. Reload first.');
      const row = await tx.officeEntry.findUniqueOrThrow({ where: { id } });
      await tx.officeEvent.create({
        data: {
          entryId: id,
          actorId: actor.userId,
          actorName: actor.email,
          action: dto.archived ? 'archived' : 'restored',
          version: row.version,
          snapshot: row.content as Prisma.InputJsonObject,
        },
      });
      return row;
    });
  }
}
