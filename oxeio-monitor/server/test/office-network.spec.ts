import { describe, expect, it } from 'vitest';
import { isOfficeAddress } from '../src/agent/office-network.guard';

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
