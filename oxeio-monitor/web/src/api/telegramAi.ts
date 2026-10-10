import { api } from './client';

export interface TelegramAiStatus { linked: boolean; linkedAt: string | null }
export interface TelegramAiCode { code: string; expiresAt: string }

export const getTelegramAiStatus = () => api<TelegramAiStatus>('/me/telegram-ai');
export const createTelegramAiCode = () => api<TelegramAiCode>('/me/telegram-ai/code', { method: 'POST' });
export const unlinkTelegramAi = () => api<TelegramAiStatus>('/me/telegram-ai', { method: 'DELETE' });
