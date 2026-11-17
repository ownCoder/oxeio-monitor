import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createHarness,
  loginReady,
  MANAGER_EMAIL,
  MANAGER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  resetDatabase,
  type Harness,
} from './setup/harness';

let h: Harness;

beforeAll(async () => { h = await createHarness(); });
afterAll(async () => { await h.close(); });
beforeEach(async () => { await resetDatabase(h.prisma, h.app); });

describe('account-synced saved views', () => {
  it('keeps each account private and sanitizes view data', async () => {
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    const saved = await owner.http.put('/api/v1/me/preferences/pool')
      .set('X-CSRF-Token', owner.csrf)
      .send({ views: [{ name: ' My queue ', view: { filter: 'pool', q: 'shirt', unsafe: 'drop me', addedFrom: 7 } }] })
      .expect(200);

    expect(saved.body.views).toEqual([{ name: 'My queue', view: { filter: 'pool', q: 'shirt' } }]);
    expect(saved.body.columns).toEqual(['design', 'stage', 'file', 'people']);

    const columns = await owner.http.put('/api/v1/me/preferences/pool/columns')
      .set('X-CSRF-Token', owner.csrf)
      .send({ columns: ['people', 'design'] })
      .expect(200);
    expect(columns.body.columns).toEqual(['design', 'people']);
    expect(columns.body.views).toEqual(saved.body.views);

    const reread = await owner.http.get('/api/v1/me/preferences/pool').expect(200);
    expect(reread.body.columns).toEqual(['design', 'people']);

    const manager = await loginReady(h, MANAGER_EMAIL, MANAGER_PASSWORD);
    const privateView = await manager.http.get('/api/v1/me/preferences/pool').expect(200);
    expect(privateView.body.views).toEqual([]);
    await manager.http.get('/api/v1/me/preferences/unknown').expect(400);
  });

  it('requires authentication and CSRF for changes', async () => {
    await h.http().get('/api/v1/me/preferences/pool').expect(401);
    const owner = await loginReady(h, OWNER_EMAIL, OWNER_PASSWORD);
    await owner.http.put('/api/v1/me/preferences/pool').send({ views: [] }).expect(403);
    await owner.http.put('/api/v1/me/preferences/pool/columns').send({ columns: ['design'] }).expect(403);
  });
});
