import type {
  AgendaEntry,
  CurrentMember,
  FamilyMeal,
  FamilyMember,
  FamilyTask,
  MealPlanEntry,
  ShoppingItem,
  ShoppingItemCreate,
  ShoppingItemUpdate,
  TaskKind,
  TaskReopenPolicy,
} from '@familyhub/contracts';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

const DATABASE_NAME = 'familyhub-offline';
const CURRENT_SESSION_KEY = 'current';
const MAX_CACHED_SHOPPING_ITEMS = 500;
const MAX_CACHED_TASKS = 500;
const MAX_CACHED_AGENDA_RANGES = 24;
const MAX_CACHED_MEAL_PLAN_RANGES = 16;

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

type TaskCache = {
  sessionKey: string;
  items: FamilyTask[];
  members: FamilyMember[];
  updatedAt: string;
};

export type TaskCreatePayload = {
  title: string;
  description: string | null;
  kind: TaskKind;
  assigneeId: string | null;
  claimable: boolean;
  dueAt: string | null;
  periodStartAt: string | null;
  periodEndAt: string | null;
  recurrenceIntervalDays: number | null;
  frequencyHint: string | null;
  reopenPolicy: TaskReopenPolicy;
  reopenDelayHours: number | null;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  clientMutationId: string;
};

type TaskMutation = {
  id: string;
  sessionKey: string;
  taskId: string;
  kind: 'CREATE' | 'STATUS' | 'COMPLETE' | 'REOPEN';
  payload:
    | TaskCreatePayload
    | { status: 'IN_PROGRESS' | 'CANCELLED' }
    | {
        comment: string | null;
        clientMutationId: string;
      }
    | Record<string, never>;
  createdAt: string;
  order: number;
  state: MutationState;
};

type AgendaCache = {
  key: string;
  sessionKey: string;
  start: string;
  end: string;
  entries: AgendaEntry[];
  updatedAt: string;
};

type MealsCache = {
  sessionKey: string;
  meals: FamilyMeal[];
  shoppingEnabled: boolean;
  updatedAt: string;
};

type MealPlanCache = {
  key: string;
  sessionKey: string;
  start: string;
  end: string;
  entries: MealPlanEntry[];
  updatedAt: string;
};

type CreateMutation = {
  id: string;
  sessionKey: string;
  kind: 'CREATE';
  itemId: string;
  payload: ShoppingItemCreate;
  createdAt: string;
  order?: number;
  state: MutationState;
};

type UpdateMutation = {
  id: string;
  sessionKey: string;
  kind: 'UPDATE';
  itemId: string;
  payload: ShoppingItemUpdate;
  createdAt: string;
  order?: number;
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
  tasks: {
    key: string;
    value: TaskCache;
  };
  taskMutations: {
    key: string;
    value: TaskMutation;
    indexes: { 'by-session': string };
  };
  agenda: {
    key: string;
    value: AgendaCache;
    indexes: { 'by-session': string };
  };
  meals: {
    key: string;
    value: MealsCache;
  };
  mealPlan: {
    key: string;
    value: MealPlanCache;
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
let lastMutationOrder = 0;

function nextMutationOrder() {
  lastMutationOrder = Math.max(lastMutationOrder + 1, Date.now() * 1_000);
  return lastMutationOrder;
}

function boundedShoppingItems(items: ShoppingItem[]): ShoppingItem[] {
  return items.slice(0, MAX_CACHED_SHOPPING_ITEMS);
}

function database() {
  databasePromise ??= openDB<FamilyHubOfflineDatabase>(DATABASE_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('session', { keyPath: 'key' });
        db.createObjectStore('shopping', { keyPath: 'sessionKey' });
        const mutations = db.createObjectStore('mutations', { keyPath: 'id' });
        mutations.createIndex('by-session', 'sessionKey');
      }
      if (oldVersion < 2) {
        db.createObjectStore('tasks', { keyPath: 'sessionKey' });
        const taskMutations = db.createObjectStore('taskMutations', {
          keyPath: 'id',
        });
        taskMutations.createIndex('by-session', 'sessionKey');
        const agenda = db.createObjectStore('agenda', { keyPath: 'key' });
        agenda.createIndex('by-session', 'sessionKey');
        db.createObjectStore('meals', { keyPath: 'sessionKey' });
        const mealPlan = db.createObjectStore('mealPlan', { keyPath: 'key' });
        mealPlan.createIndex('by-session', 'sessionKey');
      }
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
    [
      'session',
      'shopping',
      'mutations',
      'tasks',
      'taskMutations',
      'agenda',
      'meals',
      'mealPlan',
    ],
    'readwrite',
  );
  await Promise.all([
    transaction.objectStore('session').clear(),
    transaction.objectStore('shopping').clear(),
    transaction.objectStore('mutations').clear(),
    transaction.objectStore('tasks').clear(),
    transaction.objectStore('taskMutations').clear(),
    transaction.objectStore('agenda').clear(),
    transaction.objectStore('meals').clear(),
    transaction.objectStore('mealPlan').clear(),
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
  return mutations.sort(
    (left, right) =>
      (left.order ?? Date.parse(left.createdAt)) -
      (right.order ?? Date.parse(right.createdAt)),
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
    order: nextMutationOrder(),
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
          order: nextMutationOrder(),
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

export type OfflineTaskSnapshot = {
  tasks: FamilyTask[];
  members: FamilyMember[];
};

export type TaskMutationCounts = {
  pending: number;
  conflicts: number;
};

export type TaskSyncResult = TaskMutationCounts & {
  synchronized: number;
  authenticationRequired: boolean;
};

export async function readTaskCache(
  sessionKey: string,
): Promise<OfflineTaskSnapshot | null> {
  const cached = await (await database()).get('tasks', sessionKey);
  return cached ? { tasks: cached.items, members: cached.members } : null;
}

export async function writeTaskCache(
  sessionKey: string,
  tasks: FamilyTask[],
  members?: FamilyMember[],
): Promise<void> {
  const db = await database();
  const current = await db.get('tasks', sessionKey);
  await db.put('tasks', {
    sessionKey,
    items: tasks.slice(0, MAX_CACHED_TASKS),
    members: members ?? current?.members ?? [],
    updatedAt: new Date().toISOString(),
  });
}

export function createOptimisticTask(
  payload: TaskCreatePayload,
  currentMember: Pick<CurrentMember, 'id' | 'firstName'>,
  members: FamilyMember[],
): FamilyTask {
  const now = new Date().toISOString();
  const assignee = members.find((member) => member.id === payload.assigneeId);
  return {
    id: payload.clientMutationId,
    title: payload.title,
    description: payload.description,
    kind: payload.kind,
    status: 'OPEN',
    assigneeId: payload.assigneeId,
    assigneeName:
      payload.assigneeId === currentMember.id
        ? currentMember.firstName
        : (assignee?.firstName ?? null),
    createdBy: currentMember.id,
    createdByName: currentMember.firstName,
    claimable: payload.claimable,
    dueAt: payload.dueAt,
    periodStartAt: payload.periodStartAt,
    periodEndAt: payload.periodEndAt,
    recurrenceIntervalDays: payload.recurrenceIntervalDays,
    frequencyHint: payload.frequencyHint,
    reopenPolicy: payload.reopenPolicy,
    reopenDelayHours: payload.reopenDelayHours,
    nextAvailableAt: null,
    visibility: payload.visibility,
    version: 0,
    createdAt: now,
    updatedAt: now,
    completions: [],
  };
}

export function applyOptimisticTaskStatus(
  task: FamilyTask,
  status: 'IN_PROGRESS' | 'CANCELLED',
  currentMember: Pick<CurrentMember, 'id' | 'firstName'>,
): FamilyTask {
  const shouldClaim =
    status === 'IN_PROGRESS' && task.claimable && !task.assigneeId;
  return {
    ...task,
    status,
    assigneeId: shouldClaim ? currentMember.id : task.assigneeId,
    assigneeName: shouldClaim ? currentMember.firstName : task.assigneeName,
    version: task.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

function advanceOfflineDate(value: string, intervalDays: number, now: Date) {
  const next = new Date(value);
  do {
    next.setUTCDate(next.getUTCDate() + intervalDays);
  } while (next <= now);
  return next.toISOString();
}

export function applyOptimisticTaskCompletion(
  task: FamilyTask,
  payload: { comment: string | null; clientMutationId: string },
  currentMember: Pick<CurrentMember, 'id' | 'firstName'>,
): FamilyTask {
  const completedAt = new Date();
  let status: FamilyTask['status'] = 'DONE';
  let dueAt = task.dueAt;
  let periodStartAt = task.periodStartAt;
  let periodEndAt = task.periodEndAt;
  let nextAvailableAt: string | null = null;
  let assigneeId = task.assigneeId;
  let assigneeName = task.assigneeName;

  if (task.kind !== 'OPEN_CHORE' && task.recurrenceIntervalDays && dueAt) {
    status = 'OPEN';
    dueAt = advanceOfflineDate(dueAt, task.recurrenceIntervalDays, completedAt);
  } else if (
    task.kind !== 'OPEN_CHORE' &&
    task.recurrenceIntervalDays &&
    periodStartAt
  ) {
    status = 'OPEN';
    const originalStart = new Date(periodStartAt);
    const duration = periodEndAt
      ? new Date(periodEndAt).getTime() - originalStart.getTime()
      : null;
    periodStartAt = advanceOfflineDate(
      periodStartAt,
      task.recurrenceIntervalDays,
      completedAt,
    );
    periodEndAt =
      duration === null
        ? null
        : new Date(new Date(periodStartAt).getTime() + duration).toISOString();
  } else if (task.kind === 'OPEN_CHORE' && task.reopenPolicy === 'IMMEDIATE') {
    status = 'OPEN';
    if (task.claimable) {
      assigneeId = null;
      assigneeName = null;
    }
  } else if (
    task.kind === 'OPEN_CHORE' &&
    task.reopenPolicy === 'AFTER_DELAY'
  ) {
    nextAvailableAt = new Date(
      completedAt.getTime() + (task.reopenDelayHours ?? 1) * 3_600_000,
    ).toISOString();
  }

  return {
    ...task,
    status,
    dueAt,
    periodStartAt,
    periodEndAt,
    nextAvailableAt,
    assigneeId,
    assigneeName,
    version: task.version + 1,
    updatedAt: completedAt.toISOString(),
    completions: [
      {
        id: `offline:${payload.clientMutationId}`,
        completedBy: currentMember.id,
        completedByName: currentMember.firstName,
        completedAt: completedAt.toISOString(),
        comment: payload.comment,
        scheduledFor: task.dueAt,
      },
      ...task.completions,
    ].slice(0, 10),
  };
}

export function applyOptimisticTaskReopen(task: FamilyTask): FamilyTask {
  return {
    ...task,
    status: 'OPEN',
    nextAvailableAt: null,
    assigneeId: task.claimable ? null : task.assigneeId,
    assigneeName: task.claimable ? null : task.assigneeName,
    version: task.version + 1,
    updatedAt: new Date().toISOString(),
  };
}

async function enqueueTaskMutation(
  mutation: TaskMutation,
  optimisticTask: FamilyTask,
): Promise<void> {
  const db = await database();
  const transaction = db.transaction(['tasks', 'taskMutations'], 'readwrite');
  const taskStore = transaction.objectStore('tasks');
  const cached = await taskStore.get(mutation.sessionKey);
  const current = cached?.items ?? [];
  const exists = current.some((task) => task.id === optimisticTask.id);
  await taskStore.put({
    sessionKey: mutation.sessionKey,
    items: (exists
      ? current.map((task) =>
          task.id === optimisticTask.id ? optimisticTask : task,
        )
      : [optimisticTask, ...current]
    ).slice(0, MAX_CACHED_TASKS),
    members: cached?.members ?? [],
    updatedAt: new Date().toISOString(),
  });
  await transaction.objectStore('taskMutations').put(mutation);
  await transaction.done;
}

function pendingTaskMutation(
  sessionKey: string,
  taskId: string,
  kind: TaskMutation['kind'],
  payload: TaskMutation['payload'],
  id: string = crypto.randomUUID(),
): TaskMutation {
  return {
    id,
    sessionKey,
    taskId,
    kind,
    payload,
    createdAt: new Date().toISOString(),
    order: nextMutationOrder(),
    state: 'PENDING',
  };
}

export async function enqueueTaskCreate(
  sessionKey: string,
  task: FamilyTask,
  payload: TaskCreatePayload,
) {
  await enqueueTaskMutation(
    pendingTaskMutation(
      sessionKey,
      task.id,
      'CREATE',
      payload,
      payload.clientMutationId,
    ),
    task,
  );
}

export async function enqueueTaskStatus(
  sessionKey: string,
  task: FamilyTask,
  status: 'IN_PROGRESS' | 'CANCELLED',
) {
  await enqueueTaskMutation(
    pendingTaskMutation(sessionKey, task.id, 'STATUS', { status }),
    task,
  );
}

export async function enqueueTaskCompletion(
  sessionKey: string,
  task: FamilyTask,
  payload: { comment: string | null; clientMutationId: string },
) {
  await enqueueTaskMutation(
    pendingTaskMutation(
      sessionKey,
      task.id,
      'COMPLETE',
      payload,
      payload.clientMutationId,
    ),
    task,
  );
}

export async function enqueueTaskReopen(sessionKey: string, task: FamilyTask) {
  await enqueueTaskMutation(
    pendingTaskMutation(sessionKey, task.id, 'REOPEN', {}),
    task,
  );
}

async function taskMutations(sessionKey: string): Promise<TaskMutation[]> {
  const mutations = await (
    await database()
  ).getAllFromIndex('taskMutations', 'by-session', sessionKey);
  return mutations.sort((left, right) => left.order - right.order);
}

export async function taskMutationCounts(
  sessionKey: string,
): Promise<TaskMutationCounts> {
  const mutations = await taskMutations(sessionKey);
  return {
    pending: mutations.filter((mutation) => mutation.state !== 'CONFLICT')
      .length,
    conflicts: mutations.filter((mutation) => mutation.state === 'CONFLICT')
      .length,
  };
}

async function setTaskMutationState(id: string, state: MutationState) {
  const db = await database();
  const mutation = await db.get('taskMutations', id);
  if (mutation) await db.put('taskMutations', { ...mutation, state });
}

async function acknowledgeTaskMutation(
  mutation: TaskMutation,
  task: FamilyTask,
) {
  const db = await database();
  const transaction = db.transaction(['tasks', 'taskMutations'], 'readwrite');
  const store = transaction.objectStore('tasks');
  const cached = await store.get(mutation.sessionKey);
  await store.put({
    sessionKey: mutation.sessionKey,
    items: (cached?.items ?? []).map((candidate) =>
      candidate.id === mutation.taskId ? task : candidate,
    ),
    members: cached?.members ?? [],
    updatedAt: new Date().toISOString(),
  });
  await transaction.objectStore('taskMutations').delete(mutation.id);
  await transaction.done;
}

export async function discardTaskConflicts(sessionKey: string) {
  const db = await database();
  const transaction = db.transaction('taskMutations', 'readwrite');
  const store = transaction.objectStore('taskMutations');
  const mutations = await store.index('by-session').getAll(sessionKey);
  const conflictedTasks = new Set(
    mutations
      .filter((mutation) => mutation.state === 'CONFLICT')
      .map((mutation) => mutation.taskId),
  );
  await Promise.all(
    mutations
      .filter((mutation) => conflictedTasks.has(mutation.taskId))
      .map((mutation) => store.delete(mutation.id)),
  );
  await transaction.done;
}

function taskMutationRequest(mutation: TaskMutation) {
  if (mutation.kind === 'CREATE') {
    return { url: '/api/v1/tasks', method: 'POST' };
  }
  const suffix =
    mutation.kind === 'COMPLETE'
      ? '/complete'
      : mutation.kind === 'REOPEN'
        ? '/reopen'
        : '';
  return {
    url: `/api/v1/tasks/${mutation.taskId}${suffix}`,
    method: mutation.kind === 'STATUS' ? 'PATCH' : 'POST',
  };
}

export async function synchronizeTaskMutations({
  sessionKey,
  csrfToken,
  fetcher = fetch,
}: SyncOptions): Promise<TaskSyncResult> {
  const result: TaskSyncResult = {
    synchronized: 0,
    pending: 0,
    conflicts: 0,
    authenticationRequired: false,
  };
  if (!csrfToken || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return { ...result, ...(await taskMutationCounts(sessionKey)) };
  }

  const mutations = await taskMutations(sessionKey);
  const blockedTasks = new Set(
    mutations
      .filter((mutation) => mutation.state === 'CONFLICT')
      .map((mutation) => mutation.taskId),
  );
  for (const mutation of mutations) {
    if (mutation.state === 'CONFLICT' || blockedTasks.has(mutation.taskId))
      continue;
    await setTaskMutationState(mutation.id, 'SENDING');
    try {
      const request = taskMutationRequest(mutation);
      const response = await fetcher(request.url, {
        method: request.method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrfToken,
        },
        body: JSON.stringify(mutation.payload),
      });
      if (response.status === 401 || response.status === 403) {
        await setTaskMutationState(mutation.id, 'PENDING');
        result.authenticationRequired = true;
        break;
      }
      if (response.status === 429 || response.status >= 500) {
        await setTaskMutationState(mutation.id, 'PENDING');
        break;
      }
      if (!response.ok) {
        await setTaskMutationState(mutation.id, 'CONFLICT');
        blockedTasks.add(mutation.taskId);
        continue;
      }
      const payload = (await response.json()) as { task: FamilyTask };
      await acknowledgeTaskMutation(mutation, payload.task);
      result.synchronized += 1;
    } catch {
      await setTaskMutationState(mutation.id, 'PENDING');
      break;
    }
  }
  return { ...result, ...(await taskMutationCounts(sessionKey)) };
}

function rangeKey(sessionKey: string, start: string, end: string) {
  return `${sessionKey}:${start}:${end}`;
}

async function pruneRangeStore(
  storeName: 'agenda' | 'mealPlan',
  sessionKey: string,
  maximum: number,
) {
  const db = await database();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  const ranges = await store.index('by-session').getAll(sessionKey);
  const obsolete = ranges
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(maximum);
  await Promise.all(obsolete.map((entry) => store.delete(entry.key)));
  await transaction.done;
}

export async function writeAgendaCache(
  sessionKey: string,
  start: string,
  end: string,
  entries: AgendaEntry[],
) {
  const db = await database();
  await db.put('agenda', {
    key: rangeKey(sessionKey, start, end),
    sessionKey,
    start,
    end,
    entries,
    updatedAt: new Date().toISOString(),
  });
  await pruneRangeStore('agenda', sessionKey, MAX_CACHED_AGENDA_RANGES);
}

export async function readAgendaCache(
  sessionKey: string,
  start: string,
  end: string,
): Promise<AgendaEntry[] | null> {
  const db = await database();
  const exact = await db.get('agenda', rangeKey(sessionKey, start, end));
  if (exact) return exact.entries;
  const ranges = await db.getAllFromIndex('agenda', 'by-session', sessionKey);
  if (!ranges.length) return null;
  const requestedStart = Date.parse(start);
  const requestedEnd = Date.parse(end);
  const entries = new Map<string, AgendaEntry>();
  for (const range of ranges) {
    for (const entry of range.entries) {
      const entryStart = Date.parse(entry.startAt);
      const entryEnd = Date.parse(entry.endAt ?? entry.startAt);
      if (entryStart < requestedEnd && entryEnd >= requestedStart) {
        entries.set(entry.id, entry);
      }
    }
  }
  return [...entries.values()];
}

export async function writeMealsCache(
  sessionKey: string,
  meals: FamilyMeal[],
  shoppingEnabled: boolean,
) {
  await (
    await database()
  ).put('meals', {
    sessionKey,
    meals,
    shoppingEnabled,
    updatedAt: new Date().toISOString(),
  });
}

export async function readMealsCache(sessionKey: string) {
  const cached = await (await database()).get('meals', sessionKey);
  return cached
    ? { meals: cached.meals, shoppingEnabled: cached.shoppingEnabled }
    : null;
}

export async function writeMealPlanCache(
  sessionKey: string,
  start: string,
  end: string,
  entries: MealPlanEntry[],
) {
  const db = await database();
  await db.put('mealPlan', {
    key: rangeKey(sessionKey, start, end),
    sessionKey,
    start,
    end,
    entries,
    updatedAt: new Date().toISOString(),
  });
  await pruneRangeStore('mealPlan', sessionKey, MAX_CACHED_MEAL_PLAN_RANGES);
}

export async function readMealPlanCache(
  sessionKey: string,
  start: string,
  end: string,
) {
  return (
    (await (await database()).get('mealPlan', rangeKey(sessionKey, start, end)))
      ?.entries ?? null
  );
}
