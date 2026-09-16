import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const memberRole = pgEnum('member_role', ['ADMIN', 'MEMBER']);
export const memberStatus = pgEnum('member_status', ['ACTIVE', 'INACTIVE']);
export const visibility = pgEnum('visibility', [
  'PRIVATE',
  'ALL_MEMBERS',
  'GROUPS',
  'SELECTED_USERS',
]);

export const instances = pgTable('instance', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('fr'),
  timezone: text('timezone').notNull().default('Europe/Paris'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  'app_user',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    phone: text('phone'),
    birthDate: text('birth_date'),
    timezone: text('timezone').notNull().default('Europe/Paris'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('app_user_email_uq').on(table.email)],
);

export const instanceMembers = pgTable(
  'instance_member',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('MEMBER'),
    status: memberStatus('status').notNull().default('ACTIVE'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('instance_member_instance_user_uq').on(table.instanceId, table.userId),
    index('instance_member_instance_idx').on(table.instanceId),
  ],
);

export const groups = pgTable(
  'member_group',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('member_group_instance_name_uq').on(table.instanceId, table.name)],
);

export const groupMemberships = pgTable(
  'group_membership',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.groupId, table.memberId] })],
);

export const invitations = pgTable(
  'invite',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: memberRole('role').notNull().default('MEMBER'),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invite_token_hash_uq').on(table.tokenHash),
    uniqueIndex('invite_instance_email_active_uq')
      .on(table.instanceId, table.email)
      .where(sql`${table.consumedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    index('invite_instance_email_idx').on(table.instanceId, table.email),
    index('invite_expiry_idx').on(table.expiresAt),
  ],
);

export const moduleConfigs = pgTable(
  'module_config',
  {
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    enabled: boolean('enabled').notNull(),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.instanceId, table.moduleKey] })],
);

export const sessions = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfHash: text('csrf_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('session_token_hash_uq').on(table.tokenHash),
    index('session_member_idx').on(table.memberId),
    index('session_expiry_idx').on(table.expiresAt),
  ],
);

export const resources = pgTable(
  'resource',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    visibility: visibility('visibility').notNull().default('PRIVATE'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    index('resource_instance_type_idx').on(table.instanceId, table.resourceType),
    index('resource_creator_idx').on(table.createdBy),
  ],
);

export const resourceAclGroups = pgTable(
  'resource_acl_group',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.resourceId, table.groupId] })],
);

export const resourceAclUsers = pgTable(
  'resource_acl_user',
  {
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
  },
  (table) => [primaryKey({ columns: [table.resourceId, table.memberId] })],
);

export const adminAuditLogs = pgTable(
  'admin_audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    actorMemberId: uuid('actor_member_id').references(() => instanceMembers.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admin_audit_instance_created_idx').on(table.instanceId, table.createdAt)],
);

export const notifications = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    recipientMemberId: uuid('recipient_member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    actorMemberId: uuid('actor_member_id').references(() => instanceMembers.id, {
      onDelete: 'set null',
    }),
    type: text('type').notNull(),
    moduleKey: text('module_key'),
    title: text('title').notNull(),
    body: text('body'),
    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notification_recipient_state_idx').on(
      table.recipientMemberId,
      table.readAt,
      table.createdAt,
    ),
    index('notification_instance_created_idx').on(table.instanceId, table.createdAt),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preference',
  {
    memberId: uuid('member_id')
      .primaryKey()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    level: text('level').notNull().default('ALL'),
    mutedModules: text('muted_modules').array().notNull().default([]),
    quietStart: time('quiet_start'),
    quietEnd: time('quiet_end'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('notification_preference_instance_idx').on(table.instanceId)],
);

export const deviceSubscriptions = pgTable(
  'device_subscription',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('device_subscription_endpoint_uq').on(table.endpoint),
    index('device_subscription_member_idx').on(table.memberId),
  ],
);

export const notificationDeliveries = pgTable(
  'notification_delivery',
  {
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => deviceSubscriptions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.notificationId, table.subscriptionId] })],
);

export const shoppingItems = pgTable(
  'shopping_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: text('quantity'),
    note: text('note'),
    source: text('source').notNull().default('MANUAL'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    purchasedBy: uuid('purchased_by').references(() => instanceMembers.id, {
      onDelete: 'set null',
    }),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }),
    clientMutationId: uuid('client_mutation_id').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('shopping_item_instance_mutation_uq').on(table.instanceId, table.clientMutationId),
    index('shopping_item_instance_state_idx').on(
      table.instanceId,
      table.purchasedAt,
      table.createdAt,
    ),
  ],
);

export const familyTasks = pgTable(
  'family_task',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => resources.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('OPEN'),
    assigneeId: uuid('assignee_id').references(() => instanceMembers.id, {
      onDelete: 'set null',
    }),
    claimable: boolean('claimable').notNull().default(false),
    dueAt: timestamp('due_at', { withTimezone: true }),
    periodStartAt: timestamp('period_start_at', { withTimezone: true }),
    periodEndAt: timestamp('period_end_at', { withTimezone: true }),
    recurrenceIntervalDays: integer('recurrence_interval_days'),
    frequencyHint: text('frequency_hint'),
    reopenPolicy: text('reopen_policy').notNull().default('NONE'),
    reopenDelayHours: integer('reopen_delay_hours'),
    nextAvailableAt: timestamp('next_available_at', { withTimezone: true }),
    clientMutationId: uuid('client_mutation_id').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('family_task_instance_mutation_uq').on(table.instanceId, table.clientMutationId),
    index('family_task_instance_state_idx').on(
      table.instanceId,
      table.status,
      table.dueAt,
      table.createdAt,
    ),
    index('family_task_assignee_state_idx').on(table.assigneeId, table.status),
  ],
);

export const taskCompletions = pgTable(
  'task_completion',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => familyTasks.id, { onDelete: 'cascade' }),
    completedBy: uuid('completed_by')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
    comment: text('comment'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    clientMutationId: uuid('client_mutation_id').notNull(),
  },
  (table) => [
    uniqueIndex('task_completion_task_mutation_uq').on(table.taskId, table.clientMutationId),
    index('task_completion_task_date_idx').on(table.taskId, table.completedAt),
    index('task_completion_member_date_idx').on(table.completedBy, table.completedAt),
  ],
);

export const calendarEvents = pgTable(
  'calendar_event',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => resources.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    eventType: text('event_type').notNull().default('EVENT'),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location'),
    recurrence: text('recurrence').notNull().default('NONE'),
    recurrenceInterval: integer('recurrence_interval').notNull().default(1),
    recurrenceUntil: timestamp('recurrence_until', { withTimezone: true }),
    recurrenceTimezone: text('recurrence_timezone').notNull().default('Europe/Paris'),
    reminderMinutes: integer('reminder_minutes'),
    clientMutationId: uuid('client_mutation_id').notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('calendar_event_instance_mutation_uq').on(table.instanceId, table.clientMutationId),
    index('calendar_event_instance_range_idx').on(table.instanceId, table.startAt, table.endAt),
    index('calendar_event_instance_recurrence_idx').on(
      table.instanceId,
      table.recurrence,
      table.recurrenceUntil,
    ),
  ],
);

export const calendarEventParticipants = pgTable(
  'calendar_event_participant',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    response: text('response').notNull().default('PENDING'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.memberId] }),
    index('calendar_event_participant_member_idx').on(table.memberId, table.response),
  ],
);

export const meals = pgTable(
  'meal',
  {
    id: uuid('id')
      .primaryKey()
      .references(() => resources.id, { onDelete: 'cascade' }),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    photoUrl: text('photo_url'),
    referencePortions: integer('reference_portions').notNull().default(4),
    instructions: text('instructions'),
    tags: text('tags').array().notNull().default([]),
    comments: text('comments'),
    clientMutationId: uuid('client_mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('meal_instance_mutation_uq').on(table.instanceId, table.clientMutationId),
    index('meal_instance_name_idx').on(table.instanceId, table.name),
  ],
);

export const ingredients = pgTable(
  'ingredient',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('ingredient_instance_normalized_uq').on(table.instanceId, table.normalizedName),
  ],
);

export const mealIngredients = pgTable(
  'meal_ingredient',
  {
    mealId: uuid('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    ingredientId: uuid('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'restrict' }),
    quantity: numeric('quantity', { precision: 12, scale: 3 }).notNull(),
    unit: text('unit').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.mealId, table.ingredientId] })],
);

export const mealPreferences = pgTable(
  'meal_preference',
  {
    mealId: uuid('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    value: smallint('value').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.mealId, table.memberId] }),
    index('meal_preference_member_idx').on(table.memberId),
  ],
);

export const mealPlanEntries = pgTable(
  'meal_plan_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    mealId: uuid('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    date: date('date').notNull(),
    slot: text('slot').notNull(),
    slotLabel: text('slot_label'),
    portions: integer('portions').notNull(),
    note: text('note'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    clientMutationId: uuid('client_mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('meal_plan_instance_mutation_uq').on(table.instanceId, table.clientMutationId),
    index('meal_plan_instance_date_idx').on(table.instanceId, table.date, table.slot),
  ],
);

export const conversations = pgTable(
  'conversation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title'),
    directKey: text('direct_key'),
    sourceGroupId: uuid('source_group_id').references(() => groups.id, {
      onDelete: 'set null',
    }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    clientMutationId: uuid('client_mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('conversation_instance_mutation_uq').on(table.instanceId, table.clientMutationId),
    uniqueIndex('conversation_direct_key_uq')
      .on(table.instanceId, table.directKey)
      .where(sql`${table.directKey} IS NOT NULL AND ${table.deletedAt} IS NULL`),
    index('conversation_instance_updated_idx').on(table.instanceId, table.updatedAt),
    index('conversation_source_group_idx')
      .on(table.sourceGroupId)
      .where(sql`${table.sourceGroupId} IS NOT NULL`),
  ],
);

export const conversationMembers = pgTable(
  'conversation_member',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    muted: boolean('muted').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.memberId] }),
    index('conversation_member_member_idx').on(table.memberId, table.conversationId),
  ],
);

export const messages = pgTable(
  'message',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    replyToId: uuid('reply_to_id'),
    clientMutationId: uuid('client_mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('message_conversation_mutation_uq').on(
      table.conversationId,
      table.clientMutationId,
    ),
    index('message_conversation_created_idx').on(table.conversationId, table.createdAt, table.id),
  ],
);

export const messageReactions = pgTable(
  'message_reaction',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.messageId, table.memberId, table.emoji] })],
);

export const attachments = pgTable(
  'attachment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    instanceId: uuid('instance_id')
      .notNull()
      .references(() => instances.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => instanceMembers.id, { onDelete: 'restrict' }),
    originalFilename: text('original_filename').notNull(),
    storageKey: uuid('storage_key').notNull().defaultRandom(),
    declaredMime: text('declared_mime').notNull(),
    detectedMime: text('detected_mime'),
    expectedSize: integer('expected_size').notNull(),
    actualSize: integer('actual_size'),
    sha256: text('sha256'),
    status: text('status').notNull().default('PENDING'),
    uploadPurpose: text('upload_purpose').notNull().default('RESOURCE'),
    clientMutationId: uuid('client_mutation_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('attachment_storage_key_uq').on(table.storageKey),
    uniqueIndex('attachment_instance_mutation_uq').on(table.instanceId, table.clientMutationId),
    index('attachment_uploader_status_idx').on(table.uploadedBy, table.status, table.createdAt),
  ],
);

export const messageAttachments = pgTable(
  'message_attachment',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'restrict' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.messageId, table.attachmentId] }),
    uniqueIndex('message_attachment_attachment_uq').on(table.attachmentId),
  ],
);

export const memberProfilePreferences = pgTable('member_profile_preference', {
  memberId: uuid('member_id')
    .primaryKey()
    .references(() => instanceMembers.id, { onDelete: 'cascade' }),
  avatarAttachmentId: uuid('avatar_attachment_id')
    .unique()
    .references(() => attachments.id, { onDelete: 'set null' }),
  birthdayEventId: uuid('birthday_event_id')
    .unique()
    .references(() => calendarEvents.id, { onDelete: 'set null' }),
  locale: text('locale').notNull().default('fr'),
  visibility: text('visibility').notNull().default('ALL_MEMBERS'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
