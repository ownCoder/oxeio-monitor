import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { BackupService } from '../ops/backup.service';
import { BackupStateStore } from '../ops/backup.state';
import { backupVerdict } from '../ops/ops.rules';
import { PrismaService } from '../prisma/prisma.service';

/** Public monitoring gets only a verdict; private operations data stays authenticated. */
@Controller('health')
export class ReadinessController {
  constructor(private readonly prisma: PrismaService, private readonly state: BackupStateStore, private readonly backup: BackupService) {}

  @Public()
  @Get('ready')
  async ready() {
    try { await this.prisma.$queryRaw`SELECT 1`; }
    catch { throw new ServiceUnavailableException({status:'unavailable'}); }
    return {status:'ok'};
  }

  @Public()
  @Get('backup')
  async backupReady() {
    const snapshot=await this.state.read(this.backup.configured);
    if (!snapshot.lastSuccessAt || !Number.isFinite(snapshot.lastSuccessAt.getTime()) || backupVerdict(snapshot,new Date())) {
      throw new ServiceUnavailableException({status:'unavailable'});
    }
    return {status:'ok'};
  }
}
