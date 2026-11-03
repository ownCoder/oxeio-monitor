import { BlockList, isIP } from 'node:net';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';

/** Only Express's trusted-proxy-derived address is authoritative. */
export function isOfficeAddress(
  address: string | undefined,
  networks: string,
): boolean {
  if (!address || !networks.trim()) return false;
  const list = new BlockList();
  try {
    for (const entry of networks.split(',')) {
      const [ip, prefix, extra] = entry.trim().split('/');
      const family = isIP(ip);
      if (!family || extra !== undefined) return false;
      const type = family === 4 ? 'ipv4' : 'ipv6';
      if (prefix === undefined) list.addAddress(ip, type);
      else {
        if (!/^\d+$/.test(prefix)) return false;
        list.addSubnet(ip, Number(prefix), type);
      }
    }
    const family = isIP(address);
    return family !== 0 && list.check(address, family === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return false;
  }
}

@Injectable()
export class OfficeNetworkGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (isOfficeAddress(request.ip, process.env.AGENT_OFFICE_NETWORKS ?? ''))
      return true;
    // Existing agents retry 503, retaining their queue and credentials. A generic
    // 403 would be treated as a permanent rejection and discard captured work.
    throw new ServiceUnavailableException({
      code: 'office_network_required',
      message: 'Connect to the office network to use the oXeio agent.',
    });
  }
}
