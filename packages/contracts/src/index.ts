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
  type: 'member' | 'shopping' | 'task' | 'agenda' | 'meal';
  title: string;
  description: string | null;
  view: 'members' | 'shopping' | 'tasks' | 'agenda' | 'meals';
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
    | 'meal.planned';
  actorName: string;
  subject: string;
  occurredAt: string;
  view: 'shopping' | 'tasks' | 'meals';
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

export const agendaEventTypeSchema = z.enum([
  'EVENT',
  'APPOINTMENT',
  'BIRTHDAY',
  'REMINDER',
]);
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
      context.addIssue({ code: 'custom', message: 'La fin doit suivre le début.' });
    }
    if (
      value.recurrenceUntil &&
      new Date(value.recurrenceUntil).getTime() < new Date(value.startAt).getTime()
    ) {
      context.addIssue({ code: 'custom', message: 'La récurrence doit finir après le début.' });
    }
    if (value.recurrence === 'NONE' && value.recurrenceUntil) {
      context.addIssue({ code: 'custom', message: 'Une fin de récurrence nécessite une répétition.' });
    }
  });

export const agendaEventCreateSchema = agendaEventFields.and(
  z.object({ clientMutationId: z.string().uuid() }),
);
export const agendaEventUpdateSchema = agendaEventFields;
export const agendaResponseUpdateSchema = z.object({ response: agendaResponseSchema });

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

export const mealCreateSchema = mealFields.extend({ clientMutationId: z.string().uuid() });
export const mealUpdateSchema = mealFields;
export const mealPreferenceUpdateSchema = z.object({ value: mealPreferenceSchema });

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

export const chatMessageCreateSchema = z.object({
  body: z.string().trim().max(4000).default(''),
  replyToId: z.string().uuid().nullable().optional(),
  attachmentIds: z.array(z.string().uuid()).max(8).default([]),
  clientMutationId: z.string().uuid(),
}).refine((value) => value.body.length > 0 || value.attachmentIds.length > 0, {
  message: 'Un message ou une pièce jointe est requis.',
});

export const uploadInitSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(150),
  size: z.number().int().positive(),
  clientMutationId: z.string().uuid(),
});

export const chatMessagesQuerySchema = z.object({
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const chatReactionUpdateSchema = z.object({ emoji: chatReactionSchema });

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
};

export type ChatRealtimeEvent =
  | { type: 'chat.message'; conversationId: string; message: ChatMessage }
  | { type: 'chat.reaction'; conversationId: string; message: ChatMessage }
  | { type: 'chat.conversation'; conversation: ConversationSummary };
