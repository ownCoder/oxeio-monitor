import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { storageRoot } from '../common/storage.config';

export const DEVELOPMENT_STATUSES = ['queued', 'in_progress', 'blocked', 'implemented', 'deployed', 'deferred'] as const;
export interface DevelopmentRoadmap {
  version: 1;
  updatedAt: string;
  schedule: string;
  currentTaskId: string | null;
  lastRelease: { build: string; commit: string; summary: string } | null;
  tasks: { id: string; title: string; priority: number; status: typeof DEVELOPMENT_STATUSES[number]; note: string }[];
  nextActions: string[];
}

function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max
    && [...value].every(char => char.charCodeAt(0) >= 32 || [9, 10, 13].includes(char.charCodeAt(0)));
}

export function parseDevelopmentRoadmap(value: unknown): DevelopmentRoadmap | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !text(v.updatedAt, 40) || !Number.isFinite(Date.parse(v.updatedAt)) || !text(v.schedule, 160)) return null;
  if (!Array.isArray(v.tasks) || v.tasks.length > 40 || !Array.isArray(v.nextActions) || v.nextActions.length > 6) return null;
  const ids = new Set<string>();
  const tasks: DevelopmentRoadmap['tasks'] = [];
  for (const item of v.tasks) {
    if (!item || typeof item !== 'object') return null;
    const t = item as Record<string, unknown>;
    if (!text(t.id, 40) || !/^[A-Z][A-Z0-9_-]*$/u.test(t.id) || ids.has(t.id)
      || !text(t.title, 180) || !t.title.trim() || !text(t.note, 400)
      || ![1, 2, 3].includes(t.priority as number)
      || !DEVELOPMENT_STATUSES.includes(t.status as never)) return null;
    ids.add(t.id);
    tasks.push({ id: t.id, title: t.title, note: t.note, priority: t.priority as number, status: t.status as DevelopmentRoadmap['tasks'][number]['status'] });
  }
  if (v.currentTaskId !== null && (!text(v.currentTaskId, 40) || !ids.has(v.currentTaskId))) return null;
  if (!v.nextActions.every((x) => text(x, 250))) return null;
  let lastRelease: DevelopmentRoadmap['lastRelease'] = null;
  if (v.lastRelease !== null) {
    if (!v.lastRelease || typeof v.lastRelease !== 'object') return null;
    const r = v.lastRelease as Record<string, unknown>;
    if (!text(r.build, 20) || !text(r.commit, 40) || !/^[a-f0-9]{7,40}$/u.test(r.commit) || !text(r.summary, 180)) return null;
    lastRelease = { build: r.build, commit: r.commit, summary: r.summary };
  }
  return { version: 1, updatedAt: v.updatedAt, schedule: v.schedule, currentTaskId: v.currentTaskId as string | null, lastRelease, tasks, nextActions: v.nextActions as string[] };
}

@Injectable()
export class DevelopmentRoadmapService {
  private readonly logger = new Logger(DevelopmentRoadmapService.name);
  private readonly path: string;
  constructor(config: ConfigService) {
    this.path = join(storageRoot(config), 'ops', 'development-roadmap.json');
  }
  async read(): Promise<DevelopmentRoadmap | null> {
    try {
      const file = await stat(this.path);
      if (!file.isFile() || file.size > 65536) return null;
      return parseDevelopmentRoadmap(JSON.parse(await readFile(this.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.logger.warn('Development roadmap is unavailable or invalid.');
      return null;
    }
  }
}
