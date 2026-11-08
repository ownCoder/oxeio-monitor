import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { parseDevelopmentRoadmap, type DevelopmentRoadmapService } from '../src/telegram-ai/development-roadmap.service';
import { TelegramAiDataService } from '../src/telegram-ai/telegram-ai-data.service';
import { TelegramAiAnswerService } from '../src/telegram-ai/telegram-ai-answer.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { MeService } from '../src/me/me.service';
import type { ReportsService } from '../src/reports/reports.service';
import { dhakaNoon } from './setup/clock';

const sample = () => ({ version: 1, updatedAt: dhakaNoon().toISOString(), schedule: '08:00 Asia/Dhaka, Saturday–Thursday', currentTaskId: 'D01', lastRelease: null, tasks: [{ id: 'D01', title: 'Design evidence', note: 'Implementing', priority: 1, status: 'in_progress' }], nextActions: ['Permission tests'] });
describe('development assistant status', () => {
  it('parses bounded status fields and drops unexpected data', () => {
    const result = parseDevelopmentRoadmap({ ...sample(), secret: 'should not be exposed' });
    expect(result?.tasks[0].status).toBe('in_progress');
    expect(result).not.toHaveProperty('secret');
  });
  it('rejects duplicate tasks, unknown current tasks and invalid status', () => {
    const value = sample();
    expect(parseDevelopmentRoadmap({ ...value, tasks: [value.tasks[0], value.tasks[0]] })).toBeNull();
    expect(parseDevelopmentRoadmap({ ...value, currentTaskId: 'UNKNOWN' })).toBeNull();
    expect(parseDevelopmentRoadmap({ ...value, tasks: [{ ...value.tasks[0], status: 'everything done' }] })).toBeNull();
  });
  it('denies all non-owner roles before reading the private status file', async () => {
    const read = vi.fn().mockResolvedValue(sample());
    const service = new TelegramAiDataService({} as PrismaService, { read } as unknown as DevelopmentRoadmapService);
    for (const role of [UserRole.employee, UserRole.researcher, UserRole.manager]) {
      await expect(service.read({ role, employeeId: 7 }, 'development')).rejects.toMatchObject({ status: 403 });
    }
    expect(read).not.toHaveBeenCalled();
    const data = await service.read({ role: UserRole.owner, employeeId: null }, 'development');
    expect(service.render(data)).toContain('D01');
    expect(service.render(data)).toContain('in_progress');
  });
  it('routes owner private commands without an AI call and keeps group status private', async () => {
    const data = { read: vi.fn().mockResolvedValue({ topic: 'development', roadmap: sample() }), render: TelegramAiDataService.prototype.render };
    const answers = new TelegramAiAnswerService({} as PrismaService, {} as MeService, {} as ReportsService, data as unknown as TelegramAiDataService);
    const owner = { id: 1, role: UserRole.owner, employeeId: null, fullName: 'Owner' };
    expect(await answers.answer(owner, '/roadmap')).toContain('D01');
    expect(data.read).toHaveBeenCalledWith(owner, 'development');
    expect(await answers.groupAnswer(owner, '/roadmap@oXeioAlertsBot')).toContain('private');
    expect(data.read).toHaveBeenCalledTimes(1);
  });
});
