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
  locale?: 'fr' | 'en';
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

export const instanceSettingsUpdateSchema = z.object({
  apiRateLimitPerMinute: z.number().int().min(300).max(10_000),
  storageQuotaBytes: z.number().int().min(104_857_600).max(10_995_116_277_760),
});

export type InstanceSettings = z.infer<typeof instanceSettingsUpdateSchema>;

export type StorageUsage = {
  usedBytes: number;
  reservedBytes: number;
  quotaBytes: number;
  attachmentCount: number;
  filesystemFreeBytes: number | null;
};

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

export const memberAdministrationUpdateSchema = z
  .object({
    role: z.enum(['ADMIN', 'MEMBER']).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined, {
    message: 'Au moins un champ doit être modifié.',
  });

export type FamilyMember = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  avatarUrl?: string | null;
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
  locale: z.enum(['fr', 'en']).default('fr'),
  profileVisibility: z.enum(['ALL_MEMBERS', 'PRIVATE']).default('ALL_MEMBERS'),
  avatarAttachmentId: z.string().uuid().nullable().default(null),
});

export type MemberProfile = z.infer<typeof profileUpdateSchema> & {
  email: string;
  avatarUrl: string | null;
};

export const notificationReadSchema = z.object({ read: z.boolean() });

export const notificationPreferenceSchema = z.object({
  level: z.enum(['ALL', 'IMPORTANT']),
  mutedModules: z.array(z.enum(functionalModuleKeys)).max(functionalModuleKeys.length),
  quietStart: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
  quietEnd: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});

export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(2_048),
  keys: z.object({
    p256dh: z.string().min(20).max(512),
    auth: z.string().min(8).max(256),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().startsWith('https://').max(2_048),
});

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
  type:
    | 'member'
    | 'shopping'
    | 'task'
    | 'agenda'
    | 'meal'
    | 'bookmark'
    | 'page'
    | 'collection'
    | 'poll'
    | 'idea'
    | 'contact'
    | 'document';
  title: string;
  description: string | null;
  view:
    | 'members'
    | 'shopping'
    | 'tasks'
    | 'agenda'
    | 'meals'
    | 'bookmarks'
    | 'pages'
    | 'collections'
    | 'polls'
    | 'ideas'
    | 'contacts'
    | 'documents';
  updatedAt: string;
};

export type HomeAttention = {
  id: 'notifications' | 'shopping' | 'tasks' | 'meals' | 'chat';
  count: number;
  title: string;
  detail: string;
  view: 'notifications' | 'shopping' | 'tasks' | 'meals' | 'chat';
};

export type HomeActivity = {
  id: string;
  type:
    | 'shopping.added'
    | 'shopping.purchased'
    | 'task.created'
    | 'task.completed'
    | 'meal.created'
    | 'meal.planned'
    | 'bookmark.shared'
    | 'page.updated'
    | 'collection.item.added'
    | 'poll.created'
    | 'idea.created'
    | 'contact.created'
    | 'document.created';
  actorName: string;
  subject: string;
  occurredAt: string;
  view:
    | 'shopping'
    | 'tasks'
    | 'meals'
    | 'bookmarks'
    | 'pages'
    | 'collections'
    | 'polls'
    | 'ideas'
    | 'contacts'
    | 'documents';
};

export type HomeSummary = {
  attention: HomeAttention[];
  activity: HomeActivity[];
  unreadNotificationCount: number;
};

export const taskKindSchema = z.enum(['SCHEDULED', 'OPEN_CHORE', 'SEASONAL']);
export const taskStatusSchema = z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']);
export const taskVisibilitySchema = z.enum(['PRIVATE', 'ALL_MEMBERS', 'GROUPS', 'SELECTED_USERS']);
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
  groupIds: z.array(z.string().uuid()).max(50).default([]),
  userIds: z.array(z.string().uuid()).max(50).default([]),
});

export const taskCreateSchema = taskFields
  .extend({ clientMutationId: z.string().uuid() })
  .superRefine((value, context) => {
    if (value.recurrenceIntervalDays && !value.dueAt && !value.periodStartAt) {
      context.addIssue({
        code: 'custom',
        message: 'Une répétition planifiée nécessite une date ou une période de départ.',
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
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.userIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'Sélectionnez au moins une personne.',
      });
    }
    if (
      value.visibility === 'SELECTED_USERS' &&
      value.assigneeId &&
      !value.userIds.includes(value.assigneeId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['assigneeId'],
        message: 'Le responsable doit faire partie des personnes autorisées.',
      });
    }
    if (
      value.periodStartAt &&
      value.periodEndAt &&
      new Date(value.periodEndAt).getTime() < new Date(value.periodStartAt).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'La période de fin doit suivre le début.',
      });
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
  actionable: boolean;
  dueAt: string | null;
  periodStartAt: string | null;
  periodEndAt: string | null;
  recurrenceIntervalDays: number | null;
  frequencyHint: string | null;
  reopenPolicy: TaskReopenPolicy;
  reopenDelayHours: number | null;
  nextAvailableAt: string | null;
  visibility: z.infer<typeof taskVisibilitySchema>;
  groupIds: string[];
  userIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  completions: TaskCompletion[];
};

export type TaskActivityEntry = TaskCompletion & {
  taskId: string;
  taskTitle: string;
  taskKind: TaskKind;
};

export type TaskStatisticEntry = {
  memberId: string;
  memberName: string;
  taskId: string;
  taskTitle: string;
  count: number;
};

export type TaskStatistics = {
  from: string;
  to: string;
  entries: TaskStatisticEntry[];
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

export const agendaEventTypeSchema = z.enum(['EVENT', 'APPOINTMENT', 'BIRTHDAY', 'REMINDER']);
export const agendaRecurrenceSchema = z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
export const agendaResponseSchema = z.enum(['YES', 'NO', 'MAYBE', 'PENDING']);

export const agendaRangeSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
  })
  .refine((value) => {
    const start = new Date(value.start).getTime();
    const end = new Date(value.end).getTime();
    return end > start && end - start <= 370 * 24 * 60 * 60 * 1000;
  });

const agendaEventFields = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: optionalText(2000),
    eventType: agendaEventTypeSchema.default('EVENT'),
    startAt: z.string().datetime({ offset: true }),
    endAt: z.string().datetime({ offset: true }),
    allDay: z.boolean().default(false),
    location: optionalText(240),
    participantIds: z.array(z.string().uuid()).max(100).default([]),
    recurrence: agendaRecurrenceSchema.default('NONE'),
    recurrenceInterval: z.number().int().min(1).max(365).default(1),
    recurrenceUntil: z.string().datetime({ offset: true }).nullable().optional(),
    reminderMinutes: z.number().int().min(0).max(525600).nullable().optional(),
    visibility: taskVisibilitySchema.default('ALL_MEMBERS'),
  })
  .superRefine((value, context) => {
    if (new Date(value.endAt).getTime() <= new Date(value.startAt).getTime()) {
      context.addIssue({
        code: 'custom',
        message: 'La fin doit suivre le début.',
      });
    }
    if (
      value.recurrenceUntil &&
      new Date(value.recurrenceUntil).getTime() < new Date(value.startAt).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'La récurrence doit finir après le début.',
      });
    }
    if (value.recurrence === 'NONE' && value.recurrenceUntil) {
      context.addIssue({
        code: 'custom',
        message: 'Une fin de récurrence nécessite une répétition.',
      });
    }
  });

export const agendaEventCreateSchema = agendaEventFields.and(
  z.object({ clientMutationId: z.string().uuid() }),
);
export const agendaEventUpdateSchema = agendaEventFields;
export const agendaResponseUpdateSchema = z.object({
  response: agendaResponseSchema,
});

export type AgendaEventType = z.infer<typeof agendaEventTypeSchema>;
export type AgendaRecurrence = z.infer<typeof agendaRecurrenceSchema>;
export type AgendaResponse = z.infer<typeof agendaResponseSchema>;

export type AgendaParticipant = {
  memberId: string;
  memberName: string;
  response: AgendaResponse;
};

export type AgendaEntry = {
  id: string;
  resourceId: string;
  sourceType: 'event' | 'task';
  title: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  seriesStartAt: string;
  seriesEndAt: string | null;
  allDay: boolean;
  location: string | null;
  eventType: AgendaEventType | 'TASK';
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  createdBy: string;
  createdByName: string;
  editable: boolean;
  recurrence: AgendaRecurrence;
  recurrenceInterval: number;
  recurrenceUntil: string | null;
  reminderMinutes: number | null;
  participants: AgendaParticipant[];
};

export const mealPreferenceSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);
export const mealSlotSchema = z.enum(['LUNCH', 'DINNER', 'OTHER']);

export const mealIngredientSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  quantity: z.number().positive().max(100000),
  unit: z.string().trim().min(1).max(40),
});

const mealFields = z.object({
  name: z.string().trim().min(1).max(160),
  description: optionalText(2000),
  photoUrl: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((value) => value.startsWith('https://') || value.startsWith('http://'), {
      message: 'La photo doit utiliser une adresse HTTP ou HTTPS.',
    })
    .nullable()
    .optional(),
  referencePortions: z.number().int().min(1).max(100),
  ingredients: z.array(mealIngredientSchema).min(1).max(100),
  instructions: optionalText(10000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  comments: optionalText(2000),
  visibility: taskVisibilitySchema.default('ALL_MEMBERS'),
});

export const mealCreateSchema = mealFields.extend({
  clientMutationId: z.string().uuid(),
});
export const mealUpdateSchema = mealFields;
export const mealPreferenceUpdateSchema = z.object({
  value: mealPreferenceSchema,
});

export const mealPlanRangeSchema = z
  .object({
    start: z.string().date(),
    end: z.string().date(),
  })
  .refine((value) => {
    const start = Date.parse(`${value.start}T00:00:00Z`);
    const end = Date.parse(`${value.end}T00:00:00Z`);
    return end >= start && end - start <= 62 * 24 * 60 * 60 * 1000;
  });

export const mealPlanCreateSchema = z
  .object({
    mealId: z.string().uuid(),
    date: z.string().date(),
    slot: mealSlotSchema,
    slotLabel: optionalText(80),
    portions: z.number().int().min(1).max(100),
    note: optionalText(500),
    clientMutationId: z.string().uuid(),
  })
  .refine((value) => value.slot !== 'OTHER' || Boolean(value.slotLabel), {
    message: 'Un libellé est requis pour un autre créneau.',
    path: ['slotLabel'],
  });

export const mealPlanUpdateSchema = z
  .object({
    mealId: z.string().uuid(),
    date: z.string().date(),
    slot: mealSlotSchema,
    slotLabel: optionalText(80),
    portions: z.number().int().min(1).max(100),
    note: optionalText(500),
  })
  .refine((value) => value.slot !== 'OTHER' || Boolean(value.slotLabel), {
    message: 'Un libellé est requis pour un autre créneau.',
    path: ['slotLabel'],
  });

export const mealToShoppingSchema = z.object({
  portions: z.number().int().min(1).max(100),
  items: z
    .array(
      z.object({
        ingredientId: z.string().uuid(),
        clientMutationId: z.string().uuid(),
      }),
    )
    .min(1)
    .max(100),
});

export type MealPreference = z.infer<typeof mealPreferenceSchema>;
export type MealSlot = z.infer<typeof mealSlotSchema>;
export type MealIngredient = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
};

export type MealPreferenceEntry = {
  memberId: string;
  memberName: string;
  value: MealPreference;
};

export type FamilyMeal = {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  referencePortions: number;
  ingredients: MealIngredient[];
  instructions: string | null;
  tags: string[];
  comments: string | null;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  createdBy: string;
  createdByName: string;
  editable: boolean;
  preferences: MealPreferenceEntry[];
  createdAt: string;
  updatedAt: string;
};

export type MealPlanEntry = {
  id: string;
  mealId: string;
  mealName: string;
  date: string;
  slot: MealSlot;
  slotLabel: string | null;
  portions: number;
  note: string | null;
  createdBy: string;
  createdByName: string;
  editable: boolean;
  createdAt: string;
  updatedAt: string;
};

export const conversationTypeSchema = z.enum(['DIRECT', 'GROUP', 'TOPIC']);
export const chatReactionSchema = z.enum(['👍', '❤️', '😂', '😮', '😢', '👏']);

export const conversationCreateSchema = z.object({
  type: conversationTypeSchema,
  title: optionalText(120),
  participantIds: z.array(z.string().uuid()).min(1).max(100),
  clientMutationId: z.string().uuid(),
});

export const chatMessageCreateSchema = z
  .object({
    body: z.string().trim().max(4000).default(''),
    replyToId: z.string().uuid().nullable().optional(),
    attachmentIds: z.array(z.string().uuid()).max(8).default([]),
    clientMutationId: z.string().uuid(),
  })
  .refine((value) => value.body.length > 0 || value.attachmentIds.length > 0, {
    message: 'Un message ou une pièce jointe est requis.',
  });

export const uploadInitSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  size: z.number().int().positive(),
  clientMutationId: z.string().uuid(),
  purpose: z.enum(['RESOURCE', 'AVATAR']).default('RESOURCE'),
});

export const chatMessagesQuerySchema = z
  .object({
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export const chatReactionUpdateSchema = z.object({ emoji: chatReactionSchema });
export const conversationMuteUpdateSchema = z.object({ muted: z.boolean() });

export type ConversationType = z.infer<typeof conversationTypeSchema>;
export type ChatReaction = z.infer<typeof chatReactionSchema>;

export type ConversationParticipant = {
  memberId: string;
  memberName: string;
};

export type ConversationSummary = {
  id: string;
  type: ConversationType;
  title: string;
  displayTitle: string;
  createdBy: string;
  participants: ConversationParticipant[];
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  muted: boolean;
  createdAt: string;
};

export type ChatMessageReaction = {
  emoji: ChatReaction;
  count: number;
  memberIds: string[];
};

export type ChatAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  kind: 'image' | 'file';
  url: string;
};

export type ChatMessage = {
  id: string;
  conversationId: string;
  authorId: string;
  authorName: string;
  body: string;
  replyTo: {
    id: string;
    authorName: string;
    body: string;
  } | null;
  attachments: ChatAttachment[];
  reactions: ChatMessageReaction[];
  createdAt: string;
  deletedAt: string | null;
};

export type ChatRealtimeEvent =
  | { type: 'chat.message'; conversationId: string; message: ChatMessage }
  | { type: 'chat.reaction'; conversationId: string; message: ChatMessage }
  | {
      type: 'chat.message.deleted';
      conversationId: string;
      message: ChatMessage;
    }
  | { type: 'chat.conversation'; conversation: ConversationSummary };

export const bookmarkVisibilitySchema = z.enum([
  'PRIVATE',
  'ALL_MEMBERS',
  'GROUPS',
  'SELECTED_USERS',
]);

const bookmarkFieldsSchema = z
  .object({
    url: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), {
        message: 'Seuls les liens HTTP et HTTPS sont acceptés.',
      }),
    title: optionalText(200),
    description: optionalText(1000),
    personalComment: optionalText(1000),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    visibility: bookmarkVisibilitySchema.default('PRIVATE'),
    groupIds: z.array(z.string().uuid()).max(50).default([]),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine((value, context) => {
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.memberIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['memberIds'],
        message: 'Sélectionnez au moins un membre.',
      });
    }
  });

export const bookmarkCreateSchema = bookmarkFieldsSchema.and(
  z.object({ clientMutationId: z.string().uuid() }),
);

export const bookmarkUpdateSchema = bookmarkFieldsSchema.and(
  z.object({ version: z.number().int().positive() }),
);

export const bookmarksQuerySchema = z
  .object({
    scope: z.enum(['mine', 'recommended', 'favorites', 'all']).default('all'),
    q: z.string().trim().max(100).optional(),
    tag: z.string().trim().max(40).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export type BookmarkVisibility = z.infer<typeof bookmarkVisibilitySchema>;

export type FamilyBookmark = {
  id: string;
  url: string;
  hostname: string;
  title: string;
  description: string | null;
  personalComment: string | null;
  faviconUrl: string | null;
  imageUrl: string | null;
  tags: string[];
  visibility: BookmarkVisibility;
  groupIds: string[];
  memberIds: string[];
  createdBy: string;
  createdByName: string;
  favorite: boolean;
  usefulCount: number;
  usefulByMe: boolean;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PageContentMark = {
  type: 'bold' | 'italic' | 'link';
  attrs?: Record<string, unknown>;
};

export type PageContentNode = {
  type:
    | 'doc'
    | 'paragraph'
    | 'heading'
    | 'text'
    | 'hardBreak'
    | 'horizontalRule'
    | 'bulletList'
    | 'orderedList'
    | 'listItem'
    | 'taskList'
    | 'taskItem'
    | 'blockquote'
    | 'image'
    | 'table'
    | 'tableRow'
    | 'tableHeader'
    | 'tableCell';
  attrs?: Record<string, unknown>;
  content?: PageContentNode[];
  marks?: PageContentMark[];
  text?: string;
};

export type PageDocument = PageContentNode & { type: 'doc' };

export const emptyPageContent: PageDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

function safePageUrl(value: unknown, internal = false): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (internal && /^familyhub:\/\/page\/[0-9a-f-]{36}$/i.test(value)) return true;
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isPageContentMark(value: unknown): value is PageContentMark {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const mark = value as Record<string, unknown>;
  if (mark.type === 'bold' || mark.type === 'italic') return true;
  if (mark.type !== 'link' || !mark.attrs || typeof mark.attrs !== 'object') return false;
  return safePageUrl((mark.attrs as Record<string, unknown>).href, true);
}

function isPageContentNode(
  value: unknown,
  depth: number,
  counter: { value: number },
): value is PageContentNode {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 30) return false;
  counter.value += 1;
  if (counter.value > 5_000) return false;
  const node = value as Record<string, unknown>;
  const types = new Set([
    'doc',
    'paragraph',
    'heading',
    'text',
    'hardBreak',
    'horizontalRule',
    'bulletList',
    'orderedList',
    'listItem',
    'taskList',
    'taskItem',
    'blockquote',
    'image',
    'table',
    'tableRow',
    'tableHeader',
    'tableCell',
  ]);
  if (typeof node.type !== 'string' || !types.has(node.type)) return false;
  if (
    node.attrs !== undefined &&
    (!node.attrs || typeof node.attrs !== 'object' || Array.isArray(node.attrs))
  ) {
    return false;
  }
  if (node.text !== undefined && (typeof node.text !== 'string' || node.text.length > 100_000)) {
    return false;
  }
  if (node.type === 'text' && typeof node.text !== 'string') return false;
  if (node.type === 'heading') {
    const level = (node.attrs as Record<string, unknown> | undefined)?.level;
    if (level !== 1 && level !== 2 && level !== 3) return false;
  }
  if (node.type === 'taskItem') {
    const checked = (node.attrs as Record<string, unknown> | undefined)?.checked;
    if (typeof checked !== 'boolean') return false;
  }
  if (node.type === 'image') {
    const attrs = node.attrs as Record<string, unknown> | undefined;
    if (!attrs || !safePageUrl(attrs.src)) return false;
    if (attrs.alt !== undefined && (typeof attrs.alt !== 'string' || attrs.alt.length > 500)) {
      return false;
    }
  }
  if (node.marks !== undefined) {
    if (!Array.isArray(node.marks) || !node.marks.every(isPageContentMark)) return false;
  }
  if (node.content !== undefined) {
    if (!Array.isArray(node.content)) return false;
    if (!node.content.every((child) => isPageContentNode(child, depth + 1, counter))) {
      return false;
    }
  }
  return true;
}

export const pageContentSchema = z
  .custom<PageDocument>((value) => {
    const counter = { value: 0 };
    return isPageContentNode(value, 0, counter) && value.type === 'doc';
  }, 'Le contenu de la page est invalide.')
  .refine((value) => JSON.stringify(value).length <= 500_000, {
    message: 'Le contenu de la page est trop volumineux.',
  });

export const pageVisibilitySchema = bookmarkVisibilitySchema;

const pageFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    content: pageContentSchema,
    folder: optionalText(80),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    visibility: pageVisibilitySchema.default('PRIVATE'),
    groupIds: z.array(z.string().uuid()).max(50).default([]),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
    linkedPageIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine((value, context) => {
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.memberIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['memberIds'],
        message: 'Sélectionnez au moins un membre.',
      });
    }
  });

export const pageCreateSchema = pageFieldsSchema.and(
  z.object({ clientMutationId: z.string().uuid() }),
);

export const pageUpdateSchema = pageFieldsSchema.and(
  z.object({ version: z.number().int().positive() }),
);

export const pagesQuerySchema = z
  .object({
    scope: z.enum(['mine', 'shared', 'all']).default('all'),
    q: z.string().trim().max(100).optional(),
    tag: z.string().trim().max(40).optional(),
    folder: z.string().trim().max(80).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export const pageRestoreSchema = z.object({
  revisionId: z.string().uuid(),
  version: z.number().int().positive(),
});

export type PageVisibility = z.infer<typeof pageVisibilitySchema>;

export type FamilyPageSummary = {
  id: string;
  title: string;
  excerpt: string | null;
  folder: string | null;
  tags: string[];
  visibility: PageVisibility;
  createdBy: string;
  createdByName: string;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type FamilyPage = FamilyPageSummary & {
  content: PageDocument;
  groupIds: string[];
  memberIds: string[];
  linkedPageIds: string[];
};

export type PageRevision = {
  id: string;
  revisionNumber: number;
  editedBy: string;
  editedByName: string;
  createdAt: string;
  current: boolean;
};

export const collectionTypeSchema = z.enum([
  'BOOKS',
  'MOVIES',
  'SERIES',
  'CREATORS',
  'MUSIC',
  'RESTAURANTS',
  'GAMES',
  'PLACES',
  'GIFTS',
  'OTHER',
]);

export const collectionVisibilitySchema = bookmarkVisibilitySchema;

const safeOptionalUrl = z
  .string()
  .trim()
  .max(2048)
  .transform((value) => value || null)
  .nullable()
  .refine((value) => {
    if (value === null) return true;
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'L’URL doit commencer par http:// ou https://.')
  .optional();

const collectionAudienceFields = {
  visibility: collectionVisibilitySchema.default('PRIVATE'),
  groupIds: z.array(z.string().uuid()).max(50).default([]),
  memberIds: z.array(z.string().uuid()).max(100).default([]),
};

const collectionFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: optionalText(1000),
    type: collectionTypeSchema,
    imageUrl: safeOptionalUrl,
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    ...collectionAudienceFields,
  })
  .superRefine((value, context) => {
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.memberIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['memberIds'],
        message: 'Sélectionnez au moins un membre.',
      });
    }
  });

export const collectionCreateSchema = collectionFieldsSchema.and(
  z.object({ clientMutationId: z.string().uuid() }),
);

export const collectionUpdateSchema = collectionFieldsSchema.and(
  z.object({ version: z.number().int().positive() }),
);

export const collectionsQuerySchema = z
  .object({
    scope: z.enum(['mine', 'shared', 'all']).default('all'),
    q: z.string().trim().max(100).optional(),
    tag: z.string().trim().max(40).optional(),
    type: collectionTypeSchema.optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export const collectionItemMetadataSchema = z
  .record(z.string().trim().min(1).max(40), z.string().trim().max(300))
  .refine((value) => Object.keys(value).length <= 20, {
    message: 'Un élément ne peut pas dépasser 20 métadonnées.',
  });

const collectionItemFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  subtitle: optionalText(240),
  description: optionalText(2000),
  url: safeOptionalUrl,
  imageUrl: safeOptionalUrl,
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  metadata: collectionItemMetadataSchema.default({}),
});

export const collectionItemCreateSchema = collectionItemFieldsSchema.and(
  z.object({ clientMutationId: z.string().uuid() }),
);

export const collectionItemUpdateSchema = collectionItemFieldsSchema.and(
  z.object({ version: z.number().int().positive() }),
);

export const collectionPreferenceSchema = z.object({
  value: z.number().int().min(-1).max(1),
});

export const collectionCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  clientMutationId: z.string().uuid(),
});

export type CollectionType = z.infer<typeof collectionTypeSchema>;
export type CollectionVisibility = z.infer<typeof collectionVisibilitySchema>;

export type FamilyCollectionSummary = {
  id: string;
  name: string;
  description: string | null;
  type: CollectionType;
  imageUrl: string | null;
  tags: string[];
  visibility: CollectionVisibility;
  itemCount: number;
  createdBy: string;
  createdByName: string;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type FamilyCollection = FamilyCollectionSummary & {
  groupIds: string[];
  memberIds: string[];
};

export type CollectionItemComment = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  editable: boolean;
  createdAt: string;
};

export type CollectionPreferenceSummary = {
  negative: number;
  neutral: number;
  positive: number;
};

export type FamilyCollectionItem = {
  id: string;
  collectionId: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  url: string | null;
  imageUrl: string | null;
  tags: string[];
  metadata: Record<string, string>;
  addedBy: string;
  addedByName: string;
  editable: boolean;
  preference: -1 | 0 | 1 | null;
  preferences: CollectionPreferenceSummary;
  comments: CollectionItemComment[];
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const pollVisibilitySchema = bookmarkVisibilitySchema;

const pollFieldsSchema = z
  .object({
    question: z.string().trim().min(1).max(300),
    description: optionalText(1500),
    options: z.array(z.string().trim().min(1).max(160)).min(2).max(12),
    allowMultiple: z.boolean().default(false),
    anonymous: z.boolean().default(false),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    visibility: pollVisibilitySchema.default('ALL_MEMBERS'),
    groupIds: z.array(z.string().uuid()).max(50).default([]),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine((value, context) => {
    const normalized = value.options.map((option) => option.toLocaleLowerCase('fr'));
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Chaque réponse doit être unique.',
      });
    }
    if (value.endsAt && new Date(value.endsAt).getTime() <= Date.now()) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'La date de fin doit être dans le futur.',
      });
    }
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.memberIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['memberIds'],
        message: 'Sélectionnez au moins un membre.',
      });
    }
  });

export const pollCreateSchema = pollFieldsSchema.and(
  z.object({ clientMutationId: z.string().uuid() }),
);

export const pollsQuerySchema = z
  .object({
    scope: z.enum(['mine', 'shared', 'all']).default('all'),
    status: z.enum(['active', 'ended', 'all']).default('active'),
    q: z.string().trim().max(100).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export const pollVoteSchema = z.object({
  optionIds: z.array(z.string().uuid()).min(1).max(12),
});

export type PollVisibility = z.infer<typeof pollVisibilitySchema>;

export type FamilyPollOption = {
  id: string;
  label: string;
  position: number;
  voteCount: number;
  percentage: number;
  selectedByMe: boolean;
  voterNames: string[] | null;
};

export type FamilyPoll = {
  id: string;
  question: string;
  description: string | null;
  allowMultiple: boolean;
  anonymous: boolean;
  endsAt: string | null;
  ended: boolean;
  visibility: PollVisibility;
  groupIds: string[];
  memberIds: string[];
  options: FamilyPollOption[];
  hasVoted: boolean;
  voterCount: number;
  createdBy: string;
  createdByName: string;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const ideaCategorySchema = z.enum([
  'OUTING',
  'MOVIE',
  'PURCHASE',
  'ACTIVITY',
  'PROJECT',
  'RESTAURANT',
  'DESTINATION',
  'GENERAL',
]);
export const ideaStatusSchema = z.enum(['PROPOSED', 'RETAINED', 'REJECTED', 'REALIZED']);
export const ideaVisibilitySchema = bookmarkVisibilitySchema;

const ideaFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: optionalText(2000),
    category: ideaCategorySchema.default('GENERAL'),
    visibility: ideaVisibilitySchema.default('ALL_MEMBERS'),
    groupIds: z.array(z.string().uuid()).max(50).default([]),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine((value, context) => {
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.memberIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['memberIds'],
        message: 'Sélectionnez au moins un membre.',
      });
    }
  });

export const ideaCreateSchema = ideaFieldsSchema.and(
  z.object({ clientMutationId: z.string().uuid() }),
);

export const ideasQuerySchema = z
  .object({
    scope: z.enum(['mine', 'shared', 'all']).default('all'),
    status: z.union([ideaStatusSchema, z.literal('ALL')]).default('PROPOSED'),
    category: ideaCategorySchema.optional(),
    q: z.string().trim().max(100).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export const ideaStatusUpdateSchema = z.object({
  status: ideaStatusSchema,
  version: z.number().int().positive(),
});

export const ideaReactionSchema = z.object({
  value: z.union([z.literal(-1), z.literal(1), z.null()]),
});

export const ideaCommentCreateSchema = z.object({
  body: z.string().trim().min(1).max(1000),
  clientMutationId: z.string().uuid(),
});

const ideaConversionMutationSchema = z.object({
  clientMutationId: z.string().uuid(),
});

export const ideaConvertSchema = z
  .discriminatedUnion('target', [
    ideaConversionMutationSchema.extend({ target: z.literal('TASK') }),
    ideaConversionMutationSchema.extend({
      target: z.literal('EVENT'),
      startsAt: z.string().datetime({ offset: true }),
      endsAt: z.string().datetime({ offset: true }),
    }),
    ideaConversionMutationSchema.extend({
      target: z.literal('COLLECTION_ITEM'),
      collectionId: z.string().uuid(),
    }),
  ])
  .superRefine((value, context) => {
    if (
      value.target === 'EVENT' &&
      new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'La fin doit suivre le début.',
        path: ['endsAt'],
      });
    }
  });

export type IdeaCategory = z.infer<typeof ideaCategorySchema>;
export type IdeaStatus = z.infer<typeof ideaStatusSchema>;
export type IdeaVisibility = z.infer<typeof ideaVisibilitySchema>;

export type IdeaComment = {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  editable: boolean;
  createdAt: string;
};

export type IdeaConversion = {
  id: string;
  targetType: 'TASK' | 'EVENT' | 'COLLECTION_ITEM';
  targetId: string;
  convertedByName: string;
  createdAt: string;
};

export type FamilyIdea = {
  id: string;
  title: string;
  description: string | null;
  category: IdeaCategory;
  status: IdeaStatus;
  visibility: IdeaVisibility;
  groupIds: string[];
  memberIds: string[];
  positiveCount: number;
  negativeCount: number;
  myReaction: -1 | 1 | null;
  comments: IdeaComment[];
  conversion: IdeaConversion | null;
  createdBy: string;
  createdByName: string;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const contactVisibilitySchema = bookmarkVisibilitySchema;

const contactEmailSchema = z
  .string()
  .trim()
  .max(254)
  .transform((value) => value.toLowerCase() || null)
  .nullable()
  .optional()
  .refine(
    (value) => value === null || value === undefined || z.string().email().safeParse(value).success,
    {
      message: 'Adresse e-mail invalide.',
    },
  );

const contactFieldsSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: optionalText(80),
    phone: optionalText(40),
    email: contactEmailSchema,
    address: optionalText(500),
    notes: optionalText(2000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    visibility: contactVisibilitySchema.default('ALL_MEMBERS'),
    groupIds: z.array(z.string().uuid()).max(50).default([]),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine((value, context) => {
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.memberIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['memberIds'],
        message: 'Sélectionnez au moins un membre.',
      });
    }
  });

export const contactCreateSchema = contactFieldsSchema.and(
  z.object({ clientMutationId: z.string().uuid() }),
);
export const contactUpdateSchema = contactFieldsSchema.and(
  z.object({ version: z.number().int().positive() }),
);
export const contactsQuerySchema = z
  .object({
    scope: z.enum(['mine', 'shared', 'all']).default('all'),
    q: z.string().trim().max(100).optional(),
    tag: z.string().trim().max(40).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export type ContactVisibility = z.infer<typeof contactVisibilitySchema>;

export type FamilyContact = {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  tags: string[];
  visibility: ContactVisibility;
  groupIds: string[];
  memberIds: string[];
  createdBy: string;
  createdByName: string;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export const documentVisibilitySchema = bookmarkVisibilitySchema;

const documentFieldsSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: z.string().trim().min(1).max(80),
    comment: optionalText(2000),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    visibility: documentVisibilitySchema.default('ALL_MEMBERS'),
    groupIds: z.array(z.string().uuid()).max(50).default([]),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .superRefine((value, context) => {
    if (value.visibility === 'GROUPS' && value.groupIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['groupIds'],
        message: 'Sélectionnez au moins un groupe.',
      });
    }
    if (value.visibility === 'SELECTED_USERS' && value.memberIds.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['memberIds'],
        message: 'Sélectionnez au moins un membre.',
      });
    }
  });

export const documentCreateSchema = documentFieldsSchema.and(
  z.object({
    attachmentId: z.string().uuid(),
    clientMutationId: z.string().uuid(),
  }),
);
export const documentUpdateSchema = documentFieldsSchema.and(
  z.object({ version: z.number().int().positive() }),
);
export const documentsQuerySchema = z
  .object({
    scope: z.enum(['mine', 'shared', 'all']).default('all'),
    q: z.string().trim().max(100).optional(),
    category: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(40).optional(),
    before: z.string().datetime({ offset: true }).optional(),
    beforeId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .refine((value) => Boolean(value.before) === Boolean(value.beforeId), {
    message: 'before et beforeId doivent être fournis ensemble.',
  });

export type DocumentVisibility = z.infer<typeof documentVisibilitySchema>;

export type FamilyDocument = {
  id: string;
  title: string;
  category: string;
  comment: string | null;
  tags: string[];
  visibility: DocumentVisibility;
  groupIds: string[];
  memberIds: string[];
  attachment: ChatAttachment;
  createdBy: string;
  createdByName: string;
  editable: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
