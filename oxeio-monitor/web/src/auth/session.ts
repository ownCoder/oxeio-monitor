import { logout, me, type Me } from '../api/auth';
import { ApiError } from '../api/client';

export type SessionResult =
  | { kind: 'authenticated'; user: Me }
  | { kind: 'signed-out' }
  | { kind: 'unavailable' };

/** Only a 401 establishes that sign-in is needed; service failure is unknown. */
export async function loadSession(): Promise<SessionResult> {
  try {
    return { kind: 'authenticated', user: await me() };
  } catch (error) {
    return error instanceof ApiError && error.status === 401
      ? { kind: 'signed-out' }
      : { kind: 'unavailable' };
  }
}

const LOGOUT_INTENT = 'oxeio.logout-pending';

export function hasLogoutIntent(): boolean {
  try { return sessionStorage.getItem(LOGOUT_INTENT) === '1'; }
  catch { return false; }
}

export function saveLogoutIntent(pending: boolean): void {
  try {
    if (pending) sessionStorage.setItem(LOGOUT_INTENT, '1');
    else sessionStorage.removeItem(LOGOUT_INTENT);
  } catch { /* Restricted storage still allows the in-memory logout guard. */ }
}

/** A 401 already establishes that this session cannot authenticate. */
export async function endSession(): Promise<boolean> {
  try { await logout(); return true; }
  catch (error) { return error instanceof ApiError && error.status === 401; }
}
