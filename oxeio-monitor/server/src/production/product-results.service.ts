import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { parseSalesCsv } from './production.rules';

@Injectable()
export class ProductResultsService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(csv: string) {
    const rows = parseSalesCsv(csv).map((row) => ({
      ...row,
      royalty: new Prisma.Decimal(row.royalty).toFixed(2),
    }));
    const canonical = [...rows].sort((a, b) =>
      `${a.period}:${a.liveAsin}:${a.currency}`.localeCompare(
        `${b.period}:${b.liveAsin}:${b.currency}`,
      ),
    );
    const sha256 = createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex');
    const [targets, existing, batch] = await Promise.all([
      this.prisma.designTarget.findMany({
        where: { liveAsin: { in: rows.map((row) => row.liveAsin) } },
        select: { id: true, liveAsin: true, jobNumber: true },
      }),
      this.prisma.productSale.findMany({
        where: {
          OR: rows.map((row) => ({
            period: row.period,
            liveAsin: row.liveAsin,
            currency: row.currency,
          })),
        },
        select: { period: true, liveAsin: true, currency: true },
      }),
      this.prisma.salesImport.findUnique({
        where: { sha256 },
        select: { id: true },
      }),
    ]);
    const duplicates = new Set(
      existing.map((row) => `${row.period}:${row.liveAsin}:${row.currency}`),
    );
    return {
      sha256,
      alreadyImported: batch !== null,
      rows: rows.map((row) => {
        const matches = targets.filter(
          (target) => target.liveAsin === row.liveAsin,
        );
        return {
          ...row,
          targetId: matches.length === 1 ? matches[0].id : null,
          jobNumber: matches.length === 1 ? matches[0].jobNumber : null,
          match:
            matches.length === 1
              ? 'matched'
              : matches.length
                ? 'ambiguous'
                : 'unmatched',
          duplicate: duplicates.has(
            `${row.period}:${row.liveAsin}:${row.currency}`,
          ),
        };
      }),
    };
  }

  async import(
    userId: number,
    csv: string,
    name: string,
    acceptUnmatched: boolean,
  ) {
    const preview = await this.preview(csv);
    if (preview.alreadyImported || preview.rows.some((row) => row.duplicate))
      throw new ConflictException(
        'These monthly product totals have already been imported. No rows were saved.',
      );
    if (preview.rows.some((row) => row.match !== 'matched') && !acceptUnmatched)
      throw new BadRequestException(
        'Review and explicitly accept unmatched/ambiguous products before importing.',
      );
    try {
      return await this.prisma.$transaction(async (tx) => {
        const batch = await tx.salesImport.create({
          data: { sha256: preview.sha256, actorId: userId, name },
        });
        await tx.productSale.createMany({
          data: preview.rows.map((row) => ({
            importId: batch.id,
            period: row.period,
            liveAsin: row.liveAsin,
            units: row.units,
            royalty: row.royalty,
            currency: row.currency,
            targetId: row.targetId,
          })),
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'import_product_sales',
            targetType: 'sales_import',
            targetId: String(batch.id),
            meta: { rows: preview.rows.length },
          },
        });
        return {
          id: batch.id,
          imported: preview.rows.length,
          unmatched: preview.rows.filter((row) => row.targetId === null).length,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'Another request imported these rows. No duplicate totals were saved.',
        );
      throw error;
    }
  }

  async results(period?: string, page = 1) {
    if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period))
      throw new BadRequestException('Use YYYY-MM.');
    const where = period ? { period } : {};
    const [rows, total, currencies, imports] = await Promise.all([
      this.prisma.productSale.findMany({
        where,
        orderBy: [{ period: 'desc' }, { id: 'desc' }],
        take: 50,
        skip: (page - 1) * 50,
        include: {
          target: {
            select: {
              jobNumber: true,
              costs: { select: { amount: true, currency: true, note: true } },
            },
          },
        },
      }),
      this.prisma.productSale.count({ where }),
      this.prisma.productSale.groupBy({
        by: ['currency'],
        where,
        _sum: { units: true, royalty: true },
      }),
      this.prisma.salesImport.findMany({
        take: 20,
        orderBy: { id: 'desc' },
        select: {
          id: true,
          name: true,
          createdAt: true,
          _count: { select: { rows: true } },
        },
      }),
    ]);
    return {
      rows,
      total,
      page,
      pages: Math.ceil(total / 50),
      currencies: currencies.map((row) => ({
        currency: row.currency,
        units: row._sum.units ?? 0,
        royalty: row._sum.royalty?.toFixed(2) ?? '0.00',
      })),
      imports,
    };
  }

  async link(userId: number, id: number, targetId: number) {
    return this.prisma.$transaction(async (tx) => {
      const sale = await tx.productSale.findUnique({ where: { id } });
      const target = await tx.designTarget.findUnique({
        where: { id: targetId },
      });
      if (!sale || !target)
        throw new NotFoundException('Sale or target not found.');
      if (sale.liveAsin !== target.liveAsin)
        throw new BadRequestException(
          'The target must have this exact live product ASIN.',
        );
      await tx.productSale.update({ where: { id }, data: { targetId } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'link_product_sale',
          targetType: 'product_sale',
          targetId: String(id),
          meta: { before: sale.targetId, after: targetId },
        },
      });
      return { ok: true };
    });
  }

  async cost(
    userId: number,
    targetId: number,
    amount: string,
    currency: string,
    note: string,
  ) {
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount))
      throw new BadRequestException(
        'Enter a non-negative cost with at most two decimal places.',
      );
    if (!/^[A-Z]{3}$/.test(currency))
      throw new BadRequestException('Use a three-letter currency code.');
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await tx.designTarget.findUnique({
          where: { id: targetId },
          select: { id: true },
        }))
      )
        throw new NotFoundException('Target not found.');
      const before = await tx.productCost.findUnique({
        where: { targetId_currency: { targetId, currency } },
      });
      const row = await tx.productCost.upsert({
        where: { targetId_currency: { targetId, currency } },
        create: { targetId, amount, currency, note, actorId: userId },
        update: { amount, note, actorId: userId },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'set_product_cost_estimate',
          targetType: 'design_target',
          targetId: String(targetId),
          meta: {
            before: before?.amount.toFixed(2) ?? null,
            amount: row.amount.toFixed(2),
            currency,
            note,
          },
        },
      });
      return row;
    });
  }
}
