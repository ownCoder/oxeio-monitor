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
const fail = (message: string): never => {
  throw new Error(message);
};
function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    value.trim().length > max ||
    (required && !value.trim())
  )
    return fail('Invalid text field.');
  return value.trim();
}
function number(value: unknown, min: number, max: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  )
    return fail('Invalid number field.');
  return value;
}
function day(value: unknown): string {
  if (value === '') return '';
  const s = text(value, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(s) ||
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) !== s
  )
    return fail('Invalid calendar date.');
  return s;
}
function choice(value: unknown, values: string[]): string {
  const s = text(value, 40, true);
  if (!values.includes(s)) return fail('Invalid choice.');
  return s;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || !value.length || value.length > 30)
    return fail('Use between 1 and 30 items.');
  return value;
}
export function normalize(kind: Kind, input: unknown): Content {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return fail('Invalid content.');
  const v = input as Content;
  let result: Content;
  switch (kind) {
    case 'brief':
    case 'brief_template':
      result = Object.fromEntries(
        [
          'niche',
          'audience',
          'style',
          'requiredText',
          'reference',
          'output',
        ].map((k) => [k, text(v[k] ?? '', 2000, k === 'output')]),
      );
      break;
    case 'blocker':
      result = {
        category: choice(v.category, ['brief', 'link', 'tool', 'pc', 'other']),
        detail: text(v.detail, 3000, true),
        state: choice(v.state ?? 'open', ['open', 'resolved']),
        response: text(v.response ?? '', 3000),
      };
      break;
    case 'checklist_template':
      result = {
        items: array(v.items).map((x) => text(x, 200, true)),
        format: choice(v.format, ['any', 'png', 'jpeg', 'ai', 'psd', 'svg']),
        width: number(v.width ?? 0, 0, 20000),
        height: number(v.height ?? 0, 0, 20000),
      };
      break;
    case 'submission':
      result = {
        checklistId: number(v.checklistId, 1, 2147483647),
        checklistVersion: number(v.checklistVersion, 1, 2147483647),
        checked: array(v.checked).map((x) => {
          if (typeof x !== 'boolean') return fail('Invalid checklist.');
          return x;
        }),
        fileName: text(v.fileName, 150, true),
        format: choice(v.format, ['png', 'jpeg', 'ai', 'psd', 'svg']),
        width: number(v.width ?? 0, 0, 20000),
        height: number(v.height ?? 0, 0, 20000),
        note: text(v.note ?? '', 2000),
      };
      break;
    case 'sop':
      result = { body: text(v.body, 12000, true) };
      break;
    case 'asset':
      result = {
        tag: text(v.tag, 80, true),
        serial: text(v.serial ?? '', 150),
        deviceId: number(v.deviceId ?? 0, 0, 2147483647),
        warranty: day(v.warranty ?? ''),
        state: choice(v.state, ['spare', 'in_use', 'repair', 'returned']),
        note: text(v.note ?? '', 3000),
      };
      break;
    case 'lifecycle':
    case 'lifecycle_template':
      result = {
        type: choice(v.type, ['joining', 'leaving']),
        due: day(v.due ?? ''),
        tasks: array(v.tasks).map((x) => {
          if (!x || typeof x !== 'object') return fail('Invalid task.');
          const t = x as Content;
          return {
            label: text(t.label, 200, true),
            done: kind === 'lifecycle' && t.done === true,
            responsible: text(t.responsible ?? '', 120),
          };
        }),
      };
      break;
    case 'coaching':
      result = {
        skills: array(v.skills).map((x) => {
          if (!x || typeof x !== 'object') return fail('Invalid skill.');
          const s = x as Content;
          return {
            name: text(s.name, 120, true),
            level: number(s.level, 1, 5),
          };
        }),
        goal: text(v.goal, 2000, true),
        followUp: day(v.followUp ?? ''),
        note: text(v.note ?? '', 3000),
      };
      break;
  }
  // Reject hidden/unsupported fields rather than silently accepting them.
  if (Object.keys(v).some((k) => !(k in result)))
    return fail('Unsupported content field.');
  return result;
}
export function preflight(
  content: Content,
  checklist: Content,
  jobNumber: number | null,
): string[] {
  const warnings: string[] = [];
  const checked = content.checked as boolean[],
    items = checklist.items as string[];
  if (checked.length !== items.length || checked.some((x) => !x))
    warnings.push('Complete every checklist item.');
  if (checklist.format !== 'any' && content.format !== checklist.format)
    warnings.push(`Expected ${String(checklist.format)} format.`);
  for (const k of ['width', 'height'])
    if (Number(checklist[k]) > 0 && content[k] !== checklist[k])
      warnings.push(`Expected ${k}: ${String(checklist[k])} px.`);
  if (
    jobNumber !== null &&
    !String(content.fileName).startsWith(`${jobNumber}-`)
  )
    warnings.push(`Start the file name with ${jobNumber}-.`);
  return warnings;
}
