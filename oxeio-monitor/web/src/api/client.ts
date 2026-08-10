const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** সার্ভার mustChangePassword ফ্ল্যাগ পাঠালে সেটা এখানে */
    readonly mustChangePassword = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * CSRF টোকেন cookie থেকে পড়া হয় — সার্ভার ওটা ইচ্ছাকৃতভাবে httpOnly রাখে না,
 * কারণ double-submit-এর পুরো কৌশলটাই দাঁড়িয়ে আছে "ভিন্ন origin cookie পাঠাতে
 * পারলেও পড়তে পারে না" — এর উপর (ADR-016)।
 */
function csrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)oxeio_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** 401-এ স্বয়ংক্রিয় লগআউট এড়াতে (যেমন লগইন কল নিজেই) */
  silent401?: boolean;
  /**
   * ⭐ পুরোনো রিকোয়েস্ট বাতিল করার জন্য (`useApi` এটাই ব্যবহার করে)।
   *
   * ⚠️ বাতিল হলে fetch একটা `AbortError` ছোড়ে — সেটা `ApiError` **নয়**।
   *    কোথাও catch করে "ভুল হয়েছে" দেখানোর আগে `isAbortError()` দিয়ে
   *    ছেঁকে নিতে হবে, নইলে তারিখ বদলানোর মতো নিরীহ কাজেও পর্দায়
   *    এরর ভেসে উঠত।
   */
  signal?: AbortSignal;
}

/** বাতিল হওয়া রিকোয়েস্ট — এটা কোনো ব্যর্থতা নয়, তাই আলাদা করে চেনা দরকার */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

type Unauthorized = () => void;
let onUnauthorized: Unauthorized = () => {};

export function setUnauthorizedHandler(fn: Unauthorized): void {
  onUnauthorized = fn;
}

export async function api<T>(
  path: string,
  { method = 'GET', body, silent401 = false, signal }: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};

  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (MUTATING.has(method)) {
    const token = csrfToken();
    if (token) headers['X-CSRF-Token'] = token;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    // cookie পাঠানোর জন্য অপরিহার্য
    credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const payload: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const p = payload as {
      message?: string | string[];
      mustChangePassword?: boolean;
    } | null;

    const message = Array.isArray(p?.message)
      ? p.message.join(', ')
      : (p?.message ?? `রিকোয়েস্ট ব্যর্থ (${res.status})`);

    if (res.status === 401 && !silent401) onUnauthorized();

    throw new ApiError(res.status, message, p?.mustChangePassword === true);
  }

  return payload as T;
}
