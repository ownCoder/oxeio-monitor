import { Controller, Get } from '@nestjs/common';

import { Public } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /// Docker healthcheck ও Live Board-এর "সার্ভার আছে তো?" — দুটোই এখানে।
  /// লগইন ছাড়াই পৌঁছাতে হয়, তাই @Public।
  @Public()
  @Get()
  async check(): Promise<{
    status: 'ok' | 'degraded';
    db: 'up' | 'down';
    time: string;
  }> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      time: new Date().toISOString(),
    };
  }
}
