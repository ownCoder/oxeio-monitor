import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me } from '../src/api/auth';
import type { SessionResult } from '../src/auth/session';

const hooks = vi.hoisted(() => ({
  setters: [] as ReturnType<typeof vi.fn>[],
  effects: [] as (() => unknown)[],
}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const setter = vi.fn();
    hooks.setters.push(setter);
    return [typeof initial === 'function' ? initial() : initial, setter];
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (fn: unknown) => fn,
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
}));
vi.mock('../src/auth/useIdleLogout', () => ({ useIdleLogout: () => ({ phase: 'active' }) }));
vi.mock('../src/auth/session', async importOriginal => ({
  ...await importOriginal<typeof import('../src/auth/session')>(),
  endSession: vi.fn(),
  loadSession: vi.fn(),
}));
import { AuthProvider } from '../src/auth/AuthContext';
import { endSession, hasLogoutIntent, loadSession, saveLogoutIntent } from '../src/auth/session';

beforeEach(() => {
  vi.resetAllMocks();
  hooks.setters.length = 0;
  hooks.effects.length = 0;
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('logout intent and session races (real provider, isolated React hooks)', () => {
  it('shows failure without rejecting and blocks refresh after failed logout', async () => {
    vi.mocked(endSession).mockResolvedValue(false);
    const auth = AuthProvider({ children: null }).props.value;
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(hooks.setters[4]).toHaveBeenLastCalledWith('failed');
    expect(hasLogoutIntent()).toBe(true);
    await auth.refresh();
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('successful retry clears the persistent intent and permits login', async () => {
    vi.mocked(endSession).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const auth = AuthProvider({ children: null }).props.value;
    await auth.signOut();
    await auth.signOut();
    expect(hooks.setters[4]).toHaveBeenLastCalledWith('none');
    expect(hooks.setters[0]).toHaveBeenLastCalledWith(null);
    expect(hasLogoutIntent()).toBe(false);
  });

  it.each([true, false])('ignores a stale authenticated refresh when logout result is %s', async ended => {
    let resolve!: (result: SessionResult) => void;
    vi.mocked(loadSession).mockReturnValue(new Promise(r => { resolve = r; }));
    vi.mocked(endSession).mockResolvedValue(ended);
    const auth = AuthProvider({ children: null }).props.value;
    const refresh = auth.refresh();
    await auth.signOut();
    resolve({ kind: 'authenticated', user: { userId: 1 } as Me });
    await refresh;
    expect(hooks.setters[0]).toHaveBeenCalledTimes(1);
    expect(hooks.setters[0]).toHaveBeenLastCalledWith(null);
  });

  it('does not start duplicate logout requests', async () => {
    let resolve!: (ended: boolean) => void;
    vi.mocked(endSession).mockReturnValue(new Promise(r => { resolve = r; }));
    const auth = AuthProvider({ children: null }).props.value;
    const first = auth.signOut();
    await auth.signOut();
    expect(endSession).toHaveBeenCalledTimes(1);
    resolve(true);
    await first;
  });

  it('retries persisted logout on mount without checking the old session', async () => {
    saveLogoutIntent(true);
    vi.mocked(endSession).mockResolvedValue(true);
    const auth = AuthProvider({ children: null }).props.value;
    expect(auth.logoutStatus).toBe('pending');
    hooks.effects[0]();
    await Promise.resolve();
    expect(endSession).toHaveBeenCalledTimes(1);
    expect(loadSession).not.toHaveBeenCalled();
    expect(hasLogoutIntent()).toBe(false);
  });

  it('retries logout on reconnection instead of restoring the user', async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('window', {
      addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
      removeEventListener: vi.fn(),
    });
    vi.mocked(endSession).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const auth = AuthProvider({ children: null }).props.value;
    hooks.effects[1]();
    await auth.signOut();
    listeners.get('online')!();
    await Promise.resolve();
    expect(endSession).toHaveBeenCalledTimes(2);
    expect(loadSession).not.toHaveBeenCalled();
    expect(hasLogoutIntent()).toBe(false);
  });
});
