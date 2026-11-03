import type { ExecutionContext } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isOfficeAddress,
  OfficeNetworkGuard,
} from '../src/agent/office-network.guard';

describe('agent access mode', () => {
  afterEach(() => vi.unstubAllEnvs());
  const context = (ip: string) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ ip }) }),
    }) as ExecutionContext;

  it.each([undefined, 'any'])('allows any source in mode %s', (mode) => {
    vi.stubEnv('AGENT_ACCESS_MODE', mode);
    // A previously configured office IP must not restrict unrestricted mode.
    vi.stubEnv('AGENT_OFFICE_NETWORKS', '144.79.106.62');
    for (const ip of ['203.0.113.10', '2001:db8::5', '127.0.0.1']) {
      expect(new OfficeNetworkGuard().canActivate(context(ip))).toBe(true);
    }
  });

  it('can explicitly enable the office allowlist later', () => {
    vi.stubEnv('AGENT_ACCESS_MODE', 'office');
    vi.stubEnv('AGENT_OFFICE_NETWORKS', '144.79.106.62');
    expect(new OfficeNetworkGuard().canActivate(context('144.79.106.62'))).toBe(
      true,
    );
    expect(() =>
      new OfficeNetworkGuard().canActivate(context('203.0.113.10')),
    ).toThrow();
    vi.stubEnv('AGENT_OFFICE_NETWORKS', '');
    expect(() =>
      new OfficeNetworkGuard().canActivate(context('144.79.106.62')),
    ).toThrow();
  });

  it('rejects an invalid mode', () => {
    vi.stubEnv('AGENT_ACCESS_MODE', 'typo');
    expect(() =>
      new OfficeNetworkGuard().canActivate(context('144.79.106.62')),
    ).toThrow();
  });
});

describe('office address validation', () => {
  it.each(['144.79.106.62', '::ffff:144.79.106.62'])('accepts %s', (ip) => {
    expect(isOfficeAddress(ip, '144.79.106.62')).toBe(true);
  });
  it.each([
    undefined,
    '',
    '144.79.106.63',
    '127.0.0.1',
    '144.79.106.62, 203.0.113.1',
  ])('rejects %s', (ip) => {
    expect(isOfficeAddress(ip, '144.79.106.62')).toBe(false);
  });
  it.each([
    '',
    'bad',
    '144.79.106.62,',
    '144.79.106.62/33',
    '144.79.106.62/no',
    '144.79.106.62/32/1',
  ])('fails closed for invalid configuration %s', (config) => {
    expect(isOfficeAddress('144.79.106.62', config)).toBe(false);
  });
  it('supports explicit IPv4 and IPv6 networks', () => {
    expect(isOfficeAddress('192.0.2.5', '192.0.2.0/24,2001:db8::/32')).toBe(
      true,
    );
    expect(isOfficeAddress('2001:db8::5', '192.0.2.0/24,2001:db8::/32')).toBe(
      true,
    );
    expect(isOfficeAddress('2001:db9::5', '192.0.2.0/24,2001:db8::/32')).toBe(
      false,
    );
  });
});
