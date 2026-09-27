import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service';

export async function targetHistoryContext(
  tx: Prisma.TransactionClient,
  userId: number | null,
  source: string,
): Promise<void> {
  // Transaction-local settings cannot leak actors between pooled connections.
  await tx.$queryRaw`SELECT set_config('oxeio.target_actor', ${userId?.toString() ?? ''}, true),
    set_config('oxeio.target_source', ${source}, true)`;
}

export function targetWrite<T>(
  prisma: PrismaService,
  userId: number | null,
  source: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  options?: { maxWait?: number; timeout?: number },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await targetHistoryContext(tx, userId, source);
    return write(tx);
  }, options);
}
