import 'fake-indexeddb/auto';

import type { ShoppingItem } from '@familyhub/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyOptimisticShoppingUpdate,
  clearOfflineData,
  createOptimisticShoppingItem,
  enqueueShoppingCreate,
  enqueueShoppingUpdate,
  offlineSessionKey,
  readOfflineSession,
  readShoppingCache,
  saveOfflineSession,
  shoppingMutationCounts,
  synchronizeShoppingMutations,
} from './offline-storage';

const member = {
  id: 'da3c334e-9319-4381-8835-9f9416fd8884',
  instanceId: 'f7ee3146-2184-4e50-a6e6-b70ad96a7464',
  firstName: 'Alice',
};

describe('offline shopping helpers', () => {
  beforeEach(async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    await clearOfflineData();
  });

  it('cloisonne le cache par instance et membre', () => {
    expect(offlineSessionKey(member)).toBe(`${member.instanceId}:${member.id}`);
  });

  it('crée un article optimiste lié à sa mutation idempotente', () => {
    const item = createOptimisticShoppingItem(
      '7756b2ba-eb95-4b43-85d1-7d6f6f4a99ca',
      {
        name: 'Pain',
        quantity: '2',
        note: null,
        clientMutationId: '7756b2ba-eb95-4b43-85d1-7d6f6f4a99ca',
      },
      member,
    );
    expect(item).toMatchObject({
      id: 'offline:7756b2ba-eb95-4b43-85d1-7d6f6f4a99ca',
      name: 'Pain',
      requestedBy: member.id,
      purchasedAt: null,
      version: 0,
    });
  });

  it('applique localement une coche puis une décoche', () => {
    const item = {
      id: 'item',
      name: 'Lait',
      quantity: null,
      note: null,
      source: 'MANUAL',
      requestedBy: member.id,
      requestedByName: member.firstName,
      purchasedBy: null,
      purchasedByName: null,
      purchasedAt: null,
      clientMutationId: crypto.randomUUID(),
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies ShoppingItem;
    const purchased = applyOptimisticShoppingUpdate(
      item,
      { purchased: true },
      member,
    );
    expect(purchased.purchasedAt).not.toBeNull();
    expect(purchased.purchasedByName).toBe('Alice');
    expect(
      applyOptimisticShoppingUpdate(purchased, { purchased: false }, member),
    ).toMatchObject({
      purchasedAt: null,
      purchasedBy: null,
      purchasedByName: null,
    });
  });

  it('rejoue une création puis sa coche avec le véritable identifiant serveur', async () => {
    const sessionKey = offlineSessionKey(member);
    const clientMutationId = '46d70d40-2f1d-4425-bb2a-95ceba9c83eb';
    const create = {
      name: 'Pommes',
      quantity: '6',
      note: null,
      clientMutationId,
    };
    const localItem = createOptimisticShoppingItem(
      clientMutationId,
      create,
      member,
    );
    await enqueueShoppingCreate(sessionKey, localItem, create);
    const checkedItem = applyOptimisticShoppingUpdate(
      localItem,
      { purchased: true },
      member,
    );
    await enqueueShoppingUpdate(sessionKey, checkedItem, { purchased: true });

    const serverId = '6f16b034-d4a2-407c-961d-928e7b3f1424';
    const calls: string[] = [];
    const fetcher = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        calls.push(url);
        const body = JSON.parse(
          typeof init?.body === 'string' ? init.body : '{}',
        ) as { purchased?: boolean };
        const item = {
          ...localItem,
          id: serverId,
          version: url.endsWith('/shopping-items') ? 1 : 2,
          purchasedAt: body.purchased ? new Date().toISOString() : null,
          purchasedBy: body.purchased ? member.id : null,
          purchasedByName: body.purchased ? member.firstName : null,
        } satisfies ShoppingItem;
        return new Response(JSON.stringify({ item }), {
          status: url.endsWith('/shopping-items') ? 201 : 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    ) as unknown as typeof fetch;

    expect(await shoppingMutationCounts(sessionKey)).toEqual({
      pending: 2,
      conflicts: 0,
    });
    const result = await synchronizeShoppingMutations({
      sessionKey,
      csrfToken: 'csrf',
      fetcher,
    });

    expect(calls).toEqual([
      '/api/v1/shopping-items',
      `/api/v1/shopping-items/${serverId}`,
    ]);
    expect(result).toMatchObject({ synchronized: 2, pending: 0, conflicts: 0 });
    expect(await readShoppingCache(sessionKey)).toEqual([
      expect.objectContaining({ id: serverId, purchasedBy: member.id }),
    ]);
  });

  it('efface les données privées à la déconnexion', async () => {
    await saveOfflineSession({
      ...member,
      userId: crypto.randomUUID(),
      instanceName: 'Foyer',
      email: 'alice@example.test',
      role: 'ADMIN',
    });
    await clearOfflineData();
    expect(await readOfflineSession()).toBeNull();
  });
});
