import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { TelegramAiAnswerService } from '../src/telegram-ai/telegram-ai-answer.service';
import { TelegramAiLinkService } from '../src/telegram-ai/telegram-ai-link.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { MeService } from '../src/me/me.service';
import type { ReportsService } from '../src/reports/reports.service';

describe('Telegram AI access', () => {
  it('does not read team reports for a staff account', async () => {
    const summary = vi.fn();
    const service = new TelegramAiAnswerService({} as PrismaService, {} as MeService, { summary } as unknown as ReportsService);
    const answer = await service.answer({ id: 1, fullName: 'Staff', role: UserRole.employee, employeeId: 3 }, '/team');
    expect(answer).toContain('manager');
    expect(summary).not.toHaveBeenCalled();
  });

  it('returns no account after it is disabled, even if Telegram remains linked', async () => {
    const findFirst = vi.fn().mockResolvedValue({ user: { id: 1, fullName: 'Staff', role: UserRole.employee, employeeId: 3, isActive: false, mustChangePw: false } });
    const service = new TelegramAiLinkService({ telegramAiAccount: { findFirst } } as unknown as PrismaService);
    expect(await service.linkedUser('100', '200')).toBeNull();
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ chatId: '100', telegramUserId: '200' }) }));
  });

  it('requires a valid unexpired one-time code before linking', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const updateMany = vi.fn();
    const service = new TelegramAiLinkService({ telegramAiAccount: { findUnique, updateMany } } as unknown as PrismaService);
    expect(await service.link('invalid', '100', '200')).toBe(false);
    expect(await service.link('A1B2C3D4E5F6', '100', '200')).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
