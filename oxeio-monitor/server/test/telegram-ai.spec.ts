import { describe, expect, it, vi } from 'vitest';
import { UserRole } from '@prisma/client';
import { TelegramAiAnswerService } from '../src/telegram-ai/telegram-ai-answer.service';
import { TelegramAiLinkService } from '../src/telegram-ai/telegram-ai-link.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { MeService } from '../src/me/me.service';
import type { ReportsService } from '../src/reports/reports.service';

describe('Telegram AI access', () => {
  it('answers a greeting immediately without waiting for a report or model', async () => {
    const summary = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const service = new TelegramAiAnswerService({} as PrismaService, {} as MeService, { summary } as unknown as ReportsService);
      const answer = await service.answer({ id: 1, fullName: 'Owner', role: UserRole.owner, employeeId: null }, 'hello!');
      expect(answer).toContain('হ্যালো Owner');
      expect(answer).toContain('/team');
      expect(summary).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not read team reports for a staff account', async () => {
    const summary = vi.fn();
    const service = new TelegramAiAnswerService({} as PrismaService, {} as MeService, { summary } as unknown as ReportsService);
    const answer = await service.answer({ id: 1, fullName: 'Staff', role: UserRole.employee, employeeId: 3 }, '/team');
    expect(answer).toContain('manager');
    expect(summary).not.toHaveBeenCalled();
  });

  it('calculates the most completed designs from verified rows without asking a model', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const prisma = {
        designTarget: { groupBy: vi.fn().mockResolvedValue([{ assignedToId: 3, _count: { _all: 8 } }, { assignedToId: 4, _count: { _all: 15 } }]) },
        designSkipRequest: { groupBy: vi.fn().mockResolvedValue([]) },
      } as unknown as PrismaService;
      const reports = { summary: vi.fn().mockResolvedValue({ rows: [
        { employeeId: 3, empCode: 'OX-03', fullName: 'Staff A', creditedHours: 25, targetHours: 40, shortfallHours: 15 },
        { employeeId: 4, empCode: 'OX-04', fullName: 'Staff B', creditedHours: 30, targetHours: 40, shortfallHours: 10 },
      ] }) } as unknown as ReportsService;
      const service = new TelegramAiAnswerService(prisma, {} as MeService, reports);
      const answer = await service.answer({ id: 1, fullName: 'Owner', role: UserRole.owner, employeeId: null }, 'কে সবচেয়ে বেশি design complete করেছে?');
      expect(answer).toContain('OX-04 Staff B — 15টি');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('explains report numbers from definitions without asking a model', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      const prisma = { designTarget: { groupBy: vi.fn().mockResolvedValue([]) }, designSkipRequest: { groupBy: vi.fn().mockResolvedValue([]) } } as unknown as PrismaService;
      const reports = { summary: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as ReportsService;
      const service = new TelegramAiAnswerService(prisma, {} as MeService, reports);
      const answer = await service.answer({ id: 1, fullName: 'Owner', role: UserRole.owner, employeeId: null }, 'এই সংখ্যাগুলো কীভাবে বুঝব?');
      expect(answer).toContain('credited hours মানে');
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
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
      const rows = Array.from({ length: 11 }, (_, index) => ({ employeeId: index + 1, empCode: `OX-${index + 1}`, fullName: `Designer ${index + 1}`, creditedHours: 30, targetHours: 48, shortfallHours: 18 }));
      const reports = { summary: vi.fn().mockResolvedValue({ rows }) } as unknown as ReportsService;
      const service = new TelegramAiAnswerService(prisma, {} as MeService, reports);
      const answer = await service.answer({ id: 1, fullName: 'Owner', role: UserRole.owner, employeeId: null }, 'পরের সপ্তাহে কীভাবে পরিকল্পনা করব?');
      expect(answer).toContain('portal report');
      const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://oxeio-ollama:11434/api/chat');
      expect(request.headers).not.toHaveProperty('authorization');
      const payload = JSON.parse(request.body as string) as {model:string;stream:boolean;think:boolean;messages:{content:string}[]};
      expect(payload).toMatchObject({ model: 'qwen3:1.7b', stream: false, think: false });
      expect(payload.messages[1].content.length).toBeLessThan(500);
      expect(payload.messages[1].content).not.toContain('Designer 1');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
