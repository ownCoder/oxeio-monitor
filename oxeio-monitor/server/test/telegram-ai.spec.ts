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

  it('answers a manager question through the local model without transmitting an API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'দলের তথ্য portal report থেকে মিলিয়ে দেখুন।' } }) });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const prisma = {
        designTarget: { groupBy: vi.fn().mockResolvedValue([]) },
        designSkipRequest: { groupBy: vi.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;
      const reports = { summary: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as ReportsService;
      const service = new TelegramAiAnswerService(prisma, {} as MeService, reports);
      const answer = await service.answer({ id: 1, fullName: 'Owner', role: UserRole.owner, employeeId: null }, 'দলের রিপোর্ট কেমন?');
      expect(answer).toContain('portal report');
      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://oxeio-ollama:11434/api/chat');
      expect(request.headers).not.toHaveProperty('authorization');
      expect(JSON.parse(request.body as string)).toMatchObject({ model: 'qwen3:4b-instruct', stream: false, think: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
