import { z } from 'zod';

export const setupRequestSchema = z.object({
  instanceName: z.string().trim().min(2).max(80),
  firstName: z.string().trim().min(1).max(80),
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200),
  setupToken: z.string().min(1),
});

export const loginRequestSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(200),
});

export type SetupRequest = z.infer<typeof setupRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export type CurrentMember = {
  id: string;
  userId: string;
  instanceId: string;
  instanceName: string;
  firstName: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
};

export const essentialModuleKeys = [
  'home',
  'members',
  'notifications',
  'search',
  'settings',
] as const;

export const functionalModuleKeys = [
  'chat',
  'agenda',
  'tasks',
  'meals',
  'shopping',
  'bookmarks',
  'pages',
  'collections',
  'polls',
  'ideas',
  'contacts',
  'documents',
] as const;

export const moduleKeys = [...essentialModuleKeys, ...functionalModuleKeys] as const;
export const moduleKeySchema = z.enum(moduleKeys);
export const moduleUpdateSchema = z.object({ enabled: z.boolean() });

export type ModuleKey = z.infer<typeof moduleKeySchema>;
export type ModuleConfig = { key: ModuleKey; enabled: boolean };

const groupFields = z.object({
  name: z.string().trim().min(1).max(80),
  description: z
    .string()
    .trim()
    .max(240)
    .transform((value) => value || null)
    .nullable()
    .optional(),
});

export const groupCreateSchema = groupFields;

export const groupUpdateSchema = groupFields
  .partial()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    'Au moins un champ doit être modifié.',
  );

export type GroupCreate = z.infer<typeof groupCreateSchema>;
export type GroupUpdate = z.infer<typeof groupUpdateSchema>;

export type FamilyMember = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'INACTIVE';
  joinedAt: string;
  groupIds: string[];
};

export type FamilyGroup = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
};

export const invitationCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});

export const invitationInspectSchema = z.object({
  token: z.string().min(32).max(200),
});

export const invitationAcceptSchema = invitationInspectSchema.extend({
  firstName: z.string().trim().min(1).max(80),
  lastName: z
    .string()
    .trim()
    .max(80)
    .transform((value) => value || null)
    .nullable()
    .optional(),
  password: z.string().min(12).max(200),
});

export type PendingInvitation = {
  id: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  expiresAt: string;
  createdAt: string;
};

export type InvitationPreview = {
  instanceName: string;
  email: string;
  role: 'ADMIN' | 'MEMBER';
  expiresAt: string;
};

const nullableProfileText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null)
    .nullable();

function isIsoCalendarDate(value: string) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: nullableProfileText(80),
  phone: nullableProfileText(40),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .refine((value) => value === null || isIsoCalendarDate(value)),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('fr-FR', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }),
});

export type MemberProfile = z.infer<typeof profileUpdateSchema> & {
  email: string;
};

export const notificationReadSchema = z.object({ read: z.boolean() });

export type FamilyNotification = {
  id: string;
  type: string;
  moduleKey: ModuleKey | null;
  title: string;
  body: string | null;
  actorName: string | null;
  resourceType: string | null;
  resourceId: string | null;
  readAt: string | null;
  createdAt: string;
};

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export type SearchResult = {
  id: string;
  type: 'member' | 'shopping' | 'task';
  title: string;
  description: string | null;
  view: 'members' | 'shopping' | 'tasks';
  updatedAt: string;
};

export type HomeAttention = {
  id: 'notifications' | 'shopping' | 'tasks';
  count: number;
  title: string;
  detail: string;
  view: 'notifications' | 'shopping' | 'tasks';
};

export type HomeActivity = {
  id: string;
  type: 'shopping.added' | 'shopping.purchased' | 'task.created' | 'task.completed';
  actorName: string;
  subject: string;
  occurredAt: string;
  view: 'shopping' | 'tasks';
};

export type HomeSummary = {
  attention: HomeAttention[];
  activity: HomeActivity[];
  unreadNotificationCount: number;
};

export const taskKindSchema = z.enum(['SCHEDULED', 'OPEN_CHORE', 'SEASONAL']);
export const taskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const taskVisibilitySchema = z.enum(['PRIVATE', 'ALL_MEMBERS']);
export const taskReopenPolicySchema = z.enum(['NONE', 'IMMEDIATE', 'AFTER_DELAY', 'MANUAL']);

const taskOptionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null)
    .nullable()
    .optional();

const taskFields = z.object({
  title: z.string().trim().min(1).max(160),
  description: taskOptionalText(1000),
  kind: taskKindSchema,
  assigneeId: z.string().uuid().nullable().optional(),
  claimable: z.boolean().default(false),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  periodStartAt: z.string().datetime({ offset: true }).nullable().optional(),
  periodEndAt: z.string().datetime({ offset: true }).nullable().optional(),
  recurrenceIntervalDays: z.number().int().min(1).max(365).nullable().optional(),
  frequencyHint: taskOptionalText(160),
  reopenPolicy: taskReopenPolicySchema.default('NONE'),
  reopenDelayHours: z.number().int().min(1).max(8760).nullable().optional(),
  visibility: taskVisibilitySchema.default('ALL_MEMBERS'),
});

export const taskCreateSchema = taskFields
  .extend({ clientMutationId: z.string().uuid() })
  .superRefine((value, context) => {
    if (value.kind === 'SCHEDULED' && (!value.assigneeId || !value.dueAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Une tâche planifiée nécessite une échéance et un responsable.',
      });
    }
    if (value.kind === 'OPEN_CHORE' && (value.dueAt || value.periodStartAt || value.periodEndAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Une corvée ouverte ne possède pas de date planifiée.',
      });
    }
    if (value.kind !== 'OPEN_CHORE' && value.reopenPolicy !== 'NONE') {
      context.addIssue({
        code: 'custom',
        message: 'La réouverture est réservée aux corvées ouvertes.',
      });
    }
    if (value.reopenPolicy === 'AFTER_DELAY' && !value.reopenDelayHours) {
      context.addIssue({
        code: 'custom',
        message: 'Un délai de réouverture est requis.',
      });
    }
    if (
      value.periodStartAt &&
      value.periodEndAt &&
      new Date(value.periodEndAt).getTime() < new Date(value.periodStartAt).getTime()
    ) {
      context.addIssue({ code: 'custom', message: 'La période de fin doit suivre le début.' });
    }
  });

export const taskStatusUpdateSchema = z.object({ status: taskStatusSchema });
export const taskCompleteSchema = z.object({
  comment: taskOptionalText(500),
  clientMutationId: z.string().uuid(),
});

export type TaskKind = z.infer<typeof taskKindSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;
export type TaskReopenPolicy = z.infer<typeof taskReopenPolicySchema>;

export type TaskCompletion = {
  id: string;
  completedBy: string;
  completedByName: string;
  completedAt: string;
  comment: string | null;
  scheduledFor: string | null;
};

export type FamilyTask = {
  id: string;
  title: string;
  description: string | null;
  kind: TaskKind;
  status: TaskStatus;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string;
  createdByName: string;
  claimable: boolean;
  dueAt: string | null;
  periodStartAt: string | null;
  periodEndAt: string | null;
  recurrenceIntervalDays: number | null;
  frequencyHint: string | null;
  reopenPolicy: TaskReopenPolicy;
  reopenDelayHours: number | null;
  nextAvailableAt: string | null;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  version: number;
  createdAt: string;
  updatedAt: string;
  completions: TaskCompletion[];
};

const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .transform((value) => value || null)
    .nullable()
    .optional();

export const shoppingItemCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  quantity: optionalText(80),
  note: optionalText(500),
  clientMutationId: z.string().uuid(),
});

export const shoppingItemUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    quantity: optionalText(80),
    note: optionalText(500),
    purchased: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Au moins un champ doit être modifié.');

export type ShoppingItemCreate = z.infer<typeof shoppingItemCreateSchema>;
export type ShoppingItemUpdate = z.infer<typeof shoppingItemUpdateSchema>;

export type ShoppingItem = {
  id: string;
  name: string;
  quantity: string | null;
  note: string | null;
  source: string;
  requestedBy: string;
  requestedByName: string;
  purchasedBy: string | null;
  purchasedByName: string | null;
  purchasedAt: string | null;
  clientMutationId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
