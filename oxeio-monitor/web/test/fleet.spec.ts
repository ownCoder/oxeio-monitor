import { describe, expect, it } from 'vitest';

import type { AgentVersionView, DeviceView } from '../src/api/admin';
import {
  compareVersion,
  fleetGroups,
  fleetTally,
  isQuiet,
  lagOf,
  newestOffered,
  QUIET_HOURS,
} from '../src/pages/settings/fleet';

/**
 * **কোন PC কোন বিল্ডে** — R-বহির্ভূত, মালিকের সরাসরি প্রশ্ন (১৮ আগস্ট)।
 *
 * ⭐ এখানকার সবচেয়ে জরুরি টেস্ট দুটো: **০.৪.১০ বনাম ০.৪.৯** (স্ট্রিং
 * তুলনায় উল্টো), আর **গোনায় শুধু active ডিভাইস** (নইলে একই পর্দায় দুটো
 * আলাদা সংখ্যা বসত)।
 */

const NOW = new Date('2026-08-18T14:40:00.000Z');

function device(over: Partial<DeviceView> = {}): DeviceView {
  return {
    id: 1,
    hostname: 'PC',
    windowsUsername: 'user',
    machineGuid: 'guid',
    osVersion: null,
    agentVersion: '0.4.9',
    monitors: 1,
    status: 'active',
    lastSeenAt: NOW.toISOString(),
    lastDriftSec: 0,
    maxDriftSec: 0,
    enrolledAt: NOW.toISOString(),
    employee: { id: 1, empCode: 'OX-01', fullName: 'One' },
    ...over,
  };
}

function version(over: Partial<AgentVersionView> = {}): AgentVersionView {
  return {
    version: '0.4.9',
    sha256: 'x',
    sizeBytes: 1,
    rolloutStage: 'partial',
    isMandatory: false,
    releaseNotes: null,
    releasedAt: NOW.toISOString(),
    fileMissing: false,
    devicesOn: 0,
    pilotDeviceId: null,
    pilotLabel: null,
    ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════

describe('compareVersion', () => {
  /**
   * ⚠️⚠️ **গোটা ফাইলের সবচেয়ে জরুরি টেস্ট।** স্ট্রিং তুলনায়
   * `'0.4.10' < '0.4.9'` — বর্ণক্রমে সত্যি, আর ভুলটা নীরব: পর্দা সবচেয়ে
   * নতুন বিল্ডটাকেই "পিছিয়ে" দেখাত, আর কেউ বুঝতেই পারত না কেন।
   */
  it('০.৪.১০ ০.৪.৯-এর চেয়ে নতুন', () => {
    expect(compareVersion('0.4.10', '0.4.9')).toBe(1);
    expect(compareVersion('0.4.9', '0.4.10')).toBe(-1);
  });

  it('সমান হলে শূন্য', () => {
    expect(compareVersion('1.2.3', '1.2.3')).toBe(0);
  });

  /** ⚠️ অনুপস্থিত অংশ শূন্য — সার্ভারের `isNewer()` ঠিক এটাই করে */
  it('অসম দৈর্ঘ্য — অনুপস্থিত অংশ শূন্য ধরা হয়', () => {
    expect(compareVersion('1.2', '1.2.0')).toBe(0);
    expect(compareVersion('1.2.1', '1.2')).toBe(1);
  });

  /** ⚠️ আবর্জনা এলেও যেন NaN ছড়িয়ে না পড়ে */
  it('সংখ্যা নয় এমন অংশ শূন্য', () => {
    expect(compareVersion('0.4.9-beta', '0.4.9')).toBe(0);
  });
});

describe('newestOffered — সার্ভার যাকে বিলি করে', () => {
  /**
   * ⭐⭐ ক্রম ধরে, ভার্সন নম্বর ধরে নয় — `UpdateService.offerFor`
   * `releasedAt desc` মেনে প্রথম non-halted সারিটা নেয়। ⚠️ এখানে নম্বর
   * ধরে বাছলে দুটো আলাদা "নতুন" জন্মাত: পর্দা একটাকে লক্ষ্য বলত, সার্ভার
   * অন্যটা বিলি করত।
   */
  it('halted বাদ দিয়ে তালিকার প্রথমটা', () => {
    const list = [
      version({ version: '0.5.0', rolloutStage: 'halted' }),
      version({ version: '0.4.9', rolloutStage: 'partial' }),
      version({ version: '0.4.8', rolloutStage: 'halted' }),
    ];
    expect(newestOffered(list)).toBe('0.4.9');
  });

  it('সব halted হলে লক্ষ্যই নেই', () => {
    expect(newestOffered([version({ rolloutStage: 'halted' })])).toBeNull();
    expect(newestOffered([])).toBeNull();
  });
});

describe('lagOf — করণীয় কী', () => {
  it('লক্ষ্যেই আছে', () => {
    expect(lagOf('0.4.9', '0.4.9')).toBe('newest');
  });

  /** ⚠️ হাতে বসানো আরও নতুন বিল্ড "পিছিয়ে" নয় */
  it('লক্ষ্যের চেয়েও নতুন হলেও পিছিয়ে নয়', () => {
    expect(lagOf('0.5.0', '0.4.9')).toBe('newest');
  });

  /**
   * ⭐⭐ **এই দুটো আলাদা হওয়াই এই পর্দার আসল কারণ।** ০.৪.১+ PC অপেক্ষা
   * করলেই আপডেট নেবে; ০.৪.১-এর আগেরগুলোয় ট্রে-তে মেনুই নেই, ওখানে
   * কাউকে গিয়ে MSI বসাতে হবে। ১৮ আগস্ট এই তফাতটা না জানার কারণেই ধরে
   * নেওয়া হয়েছিল `partial` করলেই সবাই আপডেট পাবে।
   */
  it('০.৪.১+ নিজে থেকেই নেবে, তার আগেরগুলো নেবে না', () => {
    expect(lagOf('0.4.2', '0.4.9')).toBe('behind');
    expect(lagOf('0.4.1', '0.4.9')).toBe('behind');
    expect(lagOf('0.3.8', '0.4.9')).toBe('stranded');
    expect(lagOf('0.3.7', '0.4.9')).toBe('stranded');
  });

  it('ভার্সন জানা না থাকলে unknown', () => {
    expect(lagOf(null, '0.4.9')).toBe('unknown');
  });

  /** ⚠️ লক্ষ্য না থাকলে কেউ পিছিয়ে নেই — পর্দা তখন বারটাই লুকিয়ে রাখে */
  it('লক্ষ্য না থাকলে কেউ পিছিয়ে নয়', () => {
    expect(lagOf('0.3.7', null)).toBe('newest');
  });
});

describe('isQuiet', () => {
  const at = (hoursAgo: number) =>
    new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString();

  /**
   * ⚠️⚠️ **সারারাত বন্ধ থাকা কখনো "চুপ" নয়** — সন্ধ্যা ৬টায় বন্ধ হয়ে
   * সকাল ৯টায় খোলা মানে ১৫ ঘণ্টা। দোরগোড়া ওর নিচে নামালে রোজ সকালে
   * গোটা ফ্লিট লাল দেখাত, আর তখন চিহ্নটার আর কোনো মানে থাকত না।
   */
  it('১৫ ঘণ্টা (সারারাত) চুপ নয়, ২৫ ঘণ্টা চুপ', () => {
    expect(isQuiet(at(15), NOW)).toBe(false);
    expect(isQuiet(at(QUIET_HOURS + 1), NOW)).toBe(true);
  });

  /** ⚠️ কখনো সাড়া না দেওয়া মানে "সমস্যা নেই" নয় */
  it('কখনো সাড়া না দিলে চুপ', () => {
    expect(isQuiet(null, NOW)).toBe(true);
  });

  it('ভাঙা তারিখেও ক্র্যাশ নয়', () => {
    expect(isQuiet('not-a-date', NOW)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════

describe('fleetGroups', () => {
  /**
   * ⚠️⚠️ **শুধু active** — পাশের টেবিলের "PCs on it" কলামটাও তাই গোনে
   * (`agent-versions.service.ts`)। revoke করা PC ধরলে **একই পর্দায় দুটো
   * আলাদা সংখ্যা** বসত, আর কোনটা সত্যি বোঝার উপায় থাকত না।
   */
  it('revoke করা ডিভাইস গোনায় আসে না', () => {
    const groups = fleetGroups(
      [
        device({ id: 1, agentVersion: '0.4.9' }),
        device({ id: 2, agentVersion: '0.4.9', status: 'revoked' }),
      ],
      '0.4.9',
      NOW,
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].deviceId).toBe(1);
  });

  it('নতুন থেকে পুরোনো ক্রমে দল', () => {
    const groups = fleetGroups(
      [
        device({ id: 1, agentVersion: '0.3.7' }),
        device({ id: 2, agentVersion: '0.4.10' }),
        device({ id: 3, agentVersion: '0.4.9' }),
      ],
      '0.4.10',
      NOW,
    );

    expect(groups.map((g) => g.version)).toEqual(['0.4.10', '0.4.9', '0.3.7']);
    expect(groups.map((g) => g.lag)).toEqual(['newest', 'behind', 'stranded']);
  });

  /** ⚠️ অজানা ভার্সন কোনো দল নয়, একটা ফাঁক — তাই সবার শেষে */
  it('ভার্সন না বলা ডিভাইস সবার শেষে', () => {
    const groups = fleetGroups(
      [
        device({ id: 1, agentVersion: null }),
        device({ id: 2, agentVersion: '0.3.7' }),
      ],
      '0.4.9',
      NOW,
    );

    expect(groups.map((g) => g.version)).toEqual(['0.3.7', null]);
  });

  /** ⚠️ দলের ভেতরে ক্রম empCode ধরে — শেষ-সাড়া বা ঘণ্টা ধরে নয় */
  it('দলের ভেতরে empCode ক্রমে', () => {
    const groups = fleetGroups(
      [
        device({ id: 1, employee: { id: 1, empCode: 'OX-09', fullName: 'Nine' } }),
        device({ id: 2, employee: { id: 2, empCode: 'OX-04', fullName: 'Four' } }),
      ],
      '0.4.9',
      NOW,
    );

    expect(groups[0].rows.map((r) => r.employee?.empCode)).toEqual([
      'OX-04',
      'OX-09',
    ]);
  });

  /** ⚠️ কর্মীর সাথে যুক্ত নয় এমন ডিভাইস শেষে, কিন্তু **বাদ নয়** */
  it('কারো সাথে যুক্ত নয় এমন ডিভাইস শেষে থাকে, লুকোয় না', () => {
    const groups = fleetGroups(
      [
        device({ id: 1, employee: null, hostname: 'SPARE' }),
        device({ id: 2, employee: { id: 2, empCode: 'OX-04', fullName: 'Four' } }),
      ],
      '0.4.9',
      NOW,
    );

    expect(groups[0].rows.map((r) => r.employee?.empCode ?? r.hostname)).toEqual([
      'OX-04',
      'SPARE',
    ]);
  });
});

describe('fleetTally', () => {
  /**
   * ⭐ `behind` আর `stranded` আলাদা গোনা হয় কারণ **করণীয় আলাদা** —
   * একটায় অপেক্ষাই যথেষ্ট, অন্যটায় কাউকে গিয়ে বসাতে হবে।
   */
  it('চার ভাগে গোনে, আর যোগফল মেলে', () => {
    const groups = fleetGroups(
      [
        device({ id: 1, agentVersion: '0.4.9' }),
        device({ id: 2, agentVersion: '0.4.9' }),
        device({ id: 3, agentVersion: '0.4.2' }),
        device({ id: 4, agentVersion: '0.3.7' }),
        device({ id: 5, agentVersion: null }),
      ],
      '0.4.9',
      NOW,
    );

    expect(fleetTally(groups)).toEqual({
      newest: 2,
      behind: 1,
      stranded: 1,
      unknown: 1,
      total: 5,
    });
  });

  it('কিছু না থাকলে সব শূন্য', () => {
    expect(fleetTally([]).total).toBe(0);
  });
});
