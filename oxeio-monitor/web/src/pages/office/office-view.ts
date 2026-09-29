export const KINDS = [
  'brief_template',
  'brief',
  'blocker',
  'checklist_template',
  'submission',
  'sop',
  'asset',
  'lifecycle_template',
  'lifecycle',
  'coaching',
] as const;
export type Kind = (typeof KINDS)[number];
export type Content = Record<string, unknown>;
export interface Entry {
  id: number;
  kind: Kind;
  title: string;
  content: Content;
  employeeId: number | null;
  targetId: number | null;
  version: number;
  updatedAt: string;
  archivedAt: string | null;
  employee?: { fullName: string; empCode: string };
  target?: { jobNumber: number | null; asin: string };
  acknowledgements?: { version: number; userId?: number }[];
  events?: {
    id: number;
    actorName: string;
    action: string;
    version: number;
    createdAt: string;
    snapshot: Content;
  }[];
}
export const LABELS: Record<Kind, string> = {
  brief_template: 'Brief templates',
  brief: 'Design briefs',
  blocker: 'Help requests',
  checklist_template: 'Checklist templates',
  submission: 'Submission checks',
  sop: 'SOP & examples',
  asset: 'Equipment',
  lifecycle_template: 'Joining / leaving templates',
  lifecycle: 'Joining / leaving',
  coaching: 'Skills & coaching',
};
export function defaults(kind: Kind): Content {
  switch (kind) {
    case 'brief':
    case 'brief_template':
      return {
        niche: '',
        audience: '',
        style: '',
        requiredText: '',
        reference: '',
        output: '',
      };
    case 'blocker':
      return { category: 'brief', detail: '', state: 'open', response: '' };
    case 'checklist_template':
      return {
        items: ['Check file name', 'Check requested output'],
        format: 'any',
        width: 0,
        height: 0,
      };
    case 'submission':
      return {
        checklistId: 0,
        checklistVersion: 0,
        checked: [],
        fileName: '',
        format: 'png',
        width: 0,
        height: 0,
        note: '',
      };
    case 'sop':
      return { body: '' };
    case 'asset':
      return {
        tag: '',
        serial: '',
        deviceId: 0,
        warranty: '',
        state: 'spare',
        note: '',
      };
    case 'lifecycle':
    case 'lifecycle_template':
      return {
        type: 'joining',
        due: '',
        tasks: [
          { label: 'Account and agent setup', done: false, responsible: '' },
          { label: 'SOP training', done: false, responsible: '' },
          { label: 'Equipment handover', done: false, responsible: '' },
        ],
      };
    case 'coaching':
      return {
        skills: [{ name: 'Typography', level: 1 }],
        goal: '',
        followUp: '',
        note: '',
      };
  }
}
export function editable(entry: Entry): Content {
  const content = { ...entry.content };
  delete content.items;
  delete content.warnings;
  return entry.kind === 'submission' ? content : { ...entry.content };
}
export function taskProgress(content: Content): string {
  const tasks = content.tasks as { done: boolean }[];
  return `${tasks.filter((t) => t.done).length}/${tasks.length} completed`;
}
