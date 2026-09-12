import type {
  CurrentMember,
  ShoppingItem,
  ShoppingItemCreate,
  ShoppingItemUpdate,
} from '@familyhub/contracts';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DATABASE_NAME = 'familyhub-offline';
const CURRENT_SESSION_KEY = 'current';
const MAX_CACHED_SHOPPING_ITEMS = 500;

type MutationState = 'PENDING' | 'SENDING' | 'CONFLICT';

type CachedSession = {
  key: typeof CURRENT_SESSION_KEY;
  member: CurrentMember;
  cachedAt: string;
};

type ShoppingCache = {
  sessionKey: string;
  items: ShoppingItem[];
  updatedAt: string;
};

type CreateMutation = {
  id: string;
  sessionKey: string;
  kind: 'CREATE';
  itemId: string;
  payload: ShoppingItemCreate;
  createdAt: string;
  state: MutationState;
};

type UpdateMutation = {
  id: string;
  sessionKey: string;
  kind: 'UPDATE';
  itemId: string;
  payload: ShoppingItemUpdate;
  createdAt: string;
  state: MutationState;
};

export type OfflineShoppingMutation = CreateMutation | UpdateMutation;

interface FamilyHubOfflineDatabase extends DBSchema {
  session: {
    key: string;
    value: CachedSession;
  };
  shopping: {
    key: string;
    value: ShoppingCache;
  };
  mutations: {
    key: string;
    value: OfflineShoppingMutation;
    indexes: { 'by-session': string };
  };
}

export type ShoppingMutationCounts = {
  pending: number;
  conflicts: number;
};

export type ShoppingSyncResult = ShoppingMutationCounts & {
  synchronized: number;
  authenticationRequired: boolean;
};

type SyncOptions = {
  sessionKey: string;
  csrfToken: string;
  fetcher?: typeof fetch;
};

let databasePromise: Promise<IDBPDatabase<FamilyHubOfflineDatabase>> | null =
  null;

function boundedShoppingItems(items: ShoppingItem[]): ShoppingItem[] {
  return items.slice(0, MAX_CACHED_SHOPPING_ITEMS);
}

function database() {
  databasePromise ??= openDB<FamilyHubOfflineDatabase>(DATABASE_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('session', { keyPath: 'key' });
      db.createObjectStore('shopping', { keyPath: 'sessionKey' });
      const mutations = db.createObjectStore('mutations', { keyPath: 'id' });
      mutations.createIndex('by-session', 'sessionKey');
    },
  });
  return databasePromise;
}

export function offlineSessionKey(
  member: Pick<CurrentMember, 'id' | 'instanceId'>,
): string {
  return `${member.instanceId}:${member.id}`;
}

export async function saveOfflineSession(member: CurrentMember): Promise<void> {
  const db = await database();
  await db.put('session', {
    key: CURRENT_SESSION_KEY,
    member,
    cachedAt: new Date().toISOString(),
  });
}

export async function readOfflineSession(): Promise<CurrentMember | null> {
  const db = await database();
  return (await db.get('session', CURRENT_SESSION_KEY))?.member ?? null;
}

export async function clearOfflineData(): Promise<void> {
  const db = await database();
  const transaction = db.transaction(
    ['session', 'shopping', 'mutations'],
    'readwrite',
  );
  await Promise.all([
    transaction.objectStore('session').clear(),
    transaction.objectStore('shopping').clear(),
    transaction.objectStore('mutations').clear(),
    transaction.done,
  ]);
  if (typeof navigator !== 'undefined') {
    navigator.serviceWorker?.controller?.postMessage({
      type: 'CLEAR_PRIVATE_CACHES',
    });
  }
}

export async function readShoppingCache(
  sessionKey: string,
): Promise<ShoppingItem[] | null> {
  const db = await database();
  return (await db.get('shopping', sessionKey))?.items ?? null;
}

export async function writeShoppingCache(
  sessionKey: string,
  items: ShoppingItem[],
): Promise<void> {
  const db = await database();
  await db.put('shopping', {
    sessionKey,
    items: boundedShoppingItems(items),
    updatedAt: new Date().toISOString(),
  });
}

async function sessionMutations(
  sessionKey: string,
): Promise<OfflineShoppingMutation[]> {
  const db = await database();
  const mutations = await db.getAllFromIndex(
    'mutations',
    'by-session',
    sessionKey,
  );
  return mutations.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export async function shoppingMutationCounts(
  sessionKey: string,
): Promise<ShoppingMutationCounts> {
  const mutations = await sessionMutations(sessionKey);
  return {
    pending: mutations.filter((mutation) => mutation.state !== 'CONFLICT')
      .length,
    conflicts: mutations.filter((mutation) => mutation.state === 'CONFLICT')
      .length,
  };
}

export function createOptimisticShoppingItem(
  mutationId: string,
  input: ShoppingItemCreate,
  member: Pick<CurrentMember, 'id' | 'firstName'>,
): ShoppingItem {
  const now = new Date().toISOString();
  return {
    id: `offline:${mutationId}`,
    name: input.name,
    quantity: input.quantity ?? null,
    note: input.note ?? null,
    source: 'MANUAL',
    requestedBy: member.id,
    requestedByName: member.firstName,
    purchasedBy: null,
    purchasedByName: null,
    purchasedAt: null,
    clientMutationId: input.clientMutationId,
    version: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function applyOptimisticShoppingUpdate(
  item: ShoppingItem,
  update: ShoppingItemUpdate,
  member: Pick<CurrentMember, 'id' | 'firstName'>,
): ShoppingItem {
  const purchasedAt =
    update.purchased === undefined
      ? item.purchasedAt
      : update.purchased
        ? new Date().toISOString()
        : null;
  return {
    ...item,
    ...(update.name === undefined ? {} : { name: update.name }),
    ...(update.quantity === undefined ? {} : { quantity: update.quantity }),
    ...(update.note === undefined ? {} : { note: update.note }),
    purchasedAt,
    purchasedBy:
      update.purchased === undefined
        ? item.purchasedBy
        : update.purchased
          ? member.id
          : null,
    purchasedByName:
      update.purchased === undefined
        ? item.purchasedByName
        : update.purchased
          ? member.firstName
          : null,
    updatedAt: new Date().toISOString(),
  };
}

export async function enqueueShoppingCreate(
  sessionKey: string,
  item: ShoppingItem,
  payload: ShoppingItemCreate,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['shopping', 'mutations'], 'readwrite');
  const cached = await transaction.objectStore('shopping').get(sessionKey);
  await transaction.objectStore('shopping').put({
    sessionKey,
    items: boundedShoppingItems([item, ...(cached?.items ?? [])]),
    updatedAt: new Date().toISOString(),
  });
  await transaction.objectStore('mutations').put({
    id: payload.clientMutationId,
    sessionKey,
    kind: 'CREATE',
    itemId: item.id,
    payload,
    createdAt: new Date().toISOString(),
    state: 'PENDING',
  });
  await transaction.done;
}

export async function enqueueShoppingUpdate(
  sessionKey: string,
  item: ShoppingItem,
  payload: ShoppingItemUpdate,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['shopping', 'mutations'], 'readwrite');
  const shoppingStore = transaction.objectStore('shopping');
  const mutationStore = transaction.objectStore('mutations');
  const cached = await shoppingStore.get(sessionKey);
  await shoppingStore.put({
    sessionKey,
    items: boundedShoppingItems(
      (cached?.items ?? []).map((candidate) =>
        candidate.id === item.id ? item : candidate,
      ),
    ),
    updatedAt: new Date().toISOString(),
  });

  const mutations = await mutationStore.index('by-session').getAll(sessionKey);
  const existing = mutations.find(
    (mutation): mutation is UpdateMutation =>
      mutation.kind === 'UPDATE' &&
      mutation.itemId === item.id &&
      mutation.state === 'PENDING',
  );
  await mutationStore.put(
    existing
      ? { ...existing, payload: { ...existing.payload, ...payload } }
      : {
          id: crypto.randomUUID(),
          sessionKey,
          kind: 'UPDATE',
          itemId: item.id,
          payload,
          createdAt: new Date().toISOString(),
          state: 'PENDING',
        },
  );
  await transaction.done;
}

async function setMutationState(
  id: string,
  state: MutationState,
): Promise<void> {
  const db = await database();
  const mutation = await db.get('mutations', id);
  if (mutation) await db.put('mutations', { ...mutation, state });
}

async function acknowledgeMutation(
  mutation: OfflineShoppingMutation,
  item: ShoppingItem,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['shopping', 'mutations'], 'readwrite');
  const shoppingStore = transaction.objectStore('shopping');
  const mutationStore = transaction.objectStore('mutations');
  const cached = await shoppingStore.get(mutation.sessionKey);
  await shoppingStore.put({
    sessionKey: mutation.sessionKey,
    items: boundedShoppingItems(
      (cached?.items ?? []).map((candidate) =>
        candidate.id === mutation.itemId ||
        candidate.clientMutationId === item.clientMutationId
          ? item
          : candidate,
      ),
    ),
    updatedAt: new Date().toISOString(),
  });

  if (mutation.kind === 'CREATE' && mutation.itemId !== item.id) {
    const queued = await mutationStore
      .index('by-session')
      .getAll(mutation.sessionKey);
    await Promise.all(
      queued
        .filter(
          (candidate) =>
            candidate.kind === 'UPDATE' && candidate.itemId === mutation.itemId,
        )
        .map((candidate) =>
          mutationStore.put({ ...candidate, itemId: item.id }),
        ),
    );
  }
  await mutationStore.delete(mutation.id);
  await transaction.done;
}

export async function discardShoppingConflicts(
  sessionKey: string,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction('mutations', 'readwrite');
  const store = transaction.objectStore('mutations');
  const mutations = await store.index('by-session').getAll(sessionKey);
  await Promise.all(
    mutations
      .filter((mutation) => mutation.state === 'CONFLICT')
      .map((mutation) => store.delete(mutation.id)),
  );
  await transaction.done;
}

export async function synchronizeShoppingMutations({
  sessionKey,
  csrfToken,
  fetcher = fetch,
}: SyncOptions): Promise<ShoppingSyncResult> {
  const result: ShoppingSyncResult = {
    synchronized: 0,
    pending: 0,
    conflicts: 0,
    authenticationRequired: false,
  };
  if (!csrfToken || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { ...result, ...(await shoppingMutationCounts(sessionKey)) };
  }

  const mutations = await sessionMutations(sessionKey);
  for (const mutation of mutations) {
    if (mutation.state === 'CONFLICT') continue;
    await setMutationState(mutation.id, 'SENDING');
    try {
      const response = await fetcher(
        mutation.kind === 'CREATE'
          ? '/api/v1/shopping-items'
          : `/api/v1/shopping-items/${mutation.itemId}`,
        {
          method: mutation.kind === 'CREATE' ? 'POST' : 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': csrfToken,
          },
          body: JSON.stringify(mutation.payload),
        },
      );
      if (response.status === 401 || response.status === 403) {
        await setMutationState(mutation.id, 'PENDING');
        result.authenticationRequired = true;
        break;
      }
      if (response.status === 429) {
        await setMutationState(mutation.id, 'PENDING');
        break;
      }
      if (response.status >= 400 && response.status < 500) {
        await setMutationState(mutation.id, 'CONFLICT');
        continue;
      }
      if (!response.ok) {
        await setMutationState(mutation.id, 'PENDING');
        break;
      }
      const payload = (await response.json()) as { item: ShoppingItem };
      await acknowledgeMutation(mutation, payload.item);
      if (mutation.kind === 'CREATE' && mutation.itemId !== payload.item.id) {
        for (const candidate of mutations) {
          if (
            candidate.kind === 'UPDATE' &&
            candidate.itemId === mutation.itemId
          ) {
            candidate.itemId = payload.item.id;
          }
        }
      }
      result.synchronized += 1;
    } catch {
      await setMutationState(mutation.id, 'PENDING');
      break;
    }
  }
  return { ...result, ...(await shoppingMutationCounts(sessionKey)) };
}
