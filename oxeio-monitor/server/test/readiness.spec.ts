import {describe,it,expect,vi,afterEach} from 'vitest';
import {ServiceUnavailableException} from '@nestjs/common';
import {ReadinessController} from '../src/health/readiness.controller';
import {HealthController} from '../src/health/health.controller';
import type {PrismaService} from '../src/prisma/prisma.service';
import type {BackupStateStore} from '../src/ops/backup.state';
import type {BackupService} from '../src/ops/backup.service';
const now=new Date('2026-09-28T06:00:00Z');
function fixture(overrides:Record<string,unknown>={}) {
 const snapshot={configured:true,lastSuccessAt:new Date(now.getTime()-3600000),lastOutcome:'ok',lastAttemptAt:now,consecutiveFailures:0,lastCopyOutcome:null,observedSince:now,...overrides};
 const p={$queryRaw:vi.fn().mockResolvedValue([{one:1}])};
 return {p,c:new ReadinessController(p as unknown as PrismaService,{read:vi.fn().mockResolvedValue(snapshot)} as unknown as BackupStateStore,{configured:true} as BackupService)};
}
afterEach(()=>vi.useRealTimers());
describe('Independent monitoring readiness',()=>{
 it('passes a healthy DB probe',async()=>{expect(await fixture().c.ready()).toEqual({status:'ok'});});
 it('returns 503 with no error/credential disclosure when DB is down',async()=>{const {p,c}=fixture();p.$queryRaw.mockRejectedValue(new Error('private DB error'));try{await c.ready();throw new Error('did not fail');}catch(e){expect(e).toBeInstanceOf(ServiceUnavailableException);expect((e as ServiceUnavailableException).getStatus()).toBe(503);expect((e as ServiceUnavailableException).getResponse()).toEqual({status:'unavailable'});}});
 it('preserves existing Docker liveness response during DB outage',async()=>{const {p}=fixture();p.$queryRaw.mockRejectedValue(new Error('down'));expect(await new HealthController(p as unknown as PrismaService).check()).toMatchObject({status:'degraded',db:'down'});});
 it('passes a recent successful backup',async()=>{vi.useFakeTimers();vi.setSystemTime(now);expect(await fixture().c.backupReady()).toEqual({status:'ok'});});
 it('fails stale, missing, unconfigured, failed and copy-failed backups',async()=>{vi.useFakeTimers();vi.setSystemTime(now);for(const override of [{lastSuccessAt:new Date(now.getTime()-72*3600000)},{lastSuccessAt:null},{configured:false},{lastOutcome:'failed'},{lastCopyOutcome:'failed'}]) await expect(fixture(override).c.backupReady()).rejects.toBeInstanceOf(ServiceUnavailableException);});
});
