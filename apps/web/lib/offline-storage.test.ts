import 'fake-indexeddb/auto';

import type {
  AgendaEntry,
  FamilyMeal,
  FamilyMember,
  MealPlanEntry,
  ShoppingItem,
} from '@familyhub/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyOptimisticShoppingUpdate,
  applyOptimisticTaskCompletion,
  clearOfflineData,
  createOptimisticShoppingItem,
  createOptimisticTask,
  enqueueTaskCompletion,
  enqueueTaskCreate,
  enqueueShoppingCreate,
  enqueueShoppingUpdate,
  offlineSessionKey,
  readOfflineSession,
  readAgendaCache,
  readMealPlanCache,
  readMealsCache,
  readShoppingCache,
  readTaskCache,
  saveOfflineSession,
  shoppingMutationCounts,
  synchronizeShoppingMutations,
  synchronizeTaskMutations,
  taskMutationCounts,
  writeAgendaCache,
  writeMealPlanCache,
  writeMealsCache,
  writeTaskCache,
  type TaskCreatePayload,
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

  it('rejoue les actions de tâche dans leur ordre local', async () => {
    const sessionKey = offlineSessionKey(member);
    const familyMember = {
      id: member.id,
      firstName: member.firstName,
      lastName: null,
      email: 'alice@example.test',
      role: 'ADMIN',
      status: 'ACTIVE',
      joinedAt: new Date().toISOString(),
      groupIds: [],
    } satisfies FamilyMember;
    const createPayload = {
      title: 'Vider le lave-vaisselle',
      description: null,
      kind: 'OPEN_CHORE',
      assigneeId: null,
      claimable: true,
      dueAt: null,
      periodStartAt: null,
      periodEndAt: null,
      recurrenceIntervalDays: null,
      frequencyHint: 'Une fois par jour',
      reopenPolicy: 'IMMEDIATE',
      reopenDelayHours: null,
      visibility: 'ALL_MEMBERS',
      groupIds: [],
      userIds: [],
      clientMutationId: '01af2bd3-0d1d-4de7-816d-d86ab0322d4e',
    } satisfies TaskCreatePayload;
    const created = createOptimisticTask(createPayload, member, [familyMember]);
    await writeTaskCache(sessionKey, [], [familyMember]);
    await enqueueTaskCreate(sessionKey, created, createPayload);

    const completionPayload = {
      comment: 'Fait avant le petit déjeuner',
      clientMutationId: '4e61b9c1-912e-49d8-aad6-5917d0388afe',
    };
    const completed = applyOptimisticTaskCompletion(
      created,
      completionPayload,
      member,
    );
    await enqueueTaskCompletion(sessionKey, completed, completionPayload);

    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push(url);
      const task = url.endsWith('/complete')
        ? completed
        : { ...created, version: 1 };
      return new Response(JSON.stringify({ task }), {
        status: url.endsWith('/tasks') ? 201 : 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    expect(await taskMutationCounts(sessionKey)).toEqual({
      pending: 2,
      conflicts: 0,
    });
    const result = await synchronizeTaskMutations({
      sessionKey,
      csrfToken: 'csrf',
      fetcher,
    });
    expect(calls).toEqual([
      '/api/v1/tasks',
      `/api/v1/tasks/${created.id}/complete`,
    ]);
    expect(result).toMatchObject({ synchronized: 2, pending: 0, conflicts: 0 });
    expect((await readTaskCache(sessionKey))?.tasks[0]).toMatchObject({
      id: created.id,
      status: 'OPEN',
      completions: [expect.objectContaining({ completedBy: member.id })],
    });
  });

  it('retrouve une période d’agenda depuis un cache plus large', async () => {
    const sessionKey = offlineSessionKey(member);
    const entry = {
      id: 'event:1:2026-09-15',
      resourceId: '41b16605-275e-4e1b-a345-8dd4d33c3590',
      sourceType: 'event',
      title: 'Dentiste',
      description: null,
      startAt: '2026-09-15T08:00:00.000Z',
      endAt: '2026-09-15T09:00:00.000Z',
      seriesStartAt: '2026-09-15T08:00:00.000Z',
      seriesEndAt: '2026-09-15T09:00:00.000Z',
      allDay: false,
      location: null,
      eventType: 'APPOINTMENT',
      visibility: 'ALL_MEMBERS',
      createdBy: member.id,
      createdByName: member.firstName,
      editable: true,
      recurrence: 'NONE',
      recurrenceInterval: 1,
      recurrenceUntil: null,
      reminderMinutes: 30,
      participants: [],
    } satisfies AgendaEntry;
    await writeAgendaCache(
      sessionKey,
      '2026-09-01T00:00:00.000Z',
      '2026-10-01T00:00:00.000Z',
      [entry],
    );
    expect(
      await readAgendaCache(
        sessionKey,
        '2026-09-14T00:00:00.000Z',
        '2026-09-21T00:00:00.000Z',
      ),
    ).toEqual([entry]);
  });

  it('conserve les plats et le planning hebdomadaire en lecture locale', async () => {
    const sessionKey = offlineSessionKey(member);
    const meal = {
      id: '2eb3ac09-d001-44ec-aebe-8a821e991f8c',
      name: 'Curry',
      description: null,
      photoUrl: null,
      referencePortions: 4,
      ingredients: [],
      instructions: null,
      tags: ['rapide'],
      comments: null,
      visibility: 'ALL_MEMBERS',
      createdBy: member.id,
      createdByName: member.firstName,
      editable: true,
      preferences: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies FamilyMeal;
    const plan = {
      id: '06a3816c-2836-429f-bfa1-ff0585351fc8',
      mealId: meal.id,
      mealName: meal.name,
      date: '2026-09-15',
      slot: 'DINNER',
      slotLabel: null,
      portions: 4,
      note: null,
      createdBy: member.id,
      createdByName: member.firstName,
      editable: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies MealPlanEntry;
    const mealMembers = [{ id: member.id, firstName: member.firstName }];
    await writeMealsCache(sessionKey, [meal], mealMembers, true);
    await writeMealPlanCache(sessionKey, '2026-09-14', '2026-09-20', [plan]);
    expect(await readMealsCache(sessionKey)).toEqual({
      meals: [meal],
      members: mealMembers,
      shoppingEnabled: true,
    });
    expect(
      await readMealPlanCache(sessionKey, '2026-09-14', '2026-09-20'),
    ).toEqual([plan]);
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
