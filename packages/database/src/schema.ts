import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
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
    uniqueIndex('family_task_instance_mutation_uq').on(
      table.instanceId,
      table.clientMutationId,
    ),
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
    uniqueIndex('task_completion_task_mutation_uq').on(
      table.taskId,
      table.clientMutationId,
    ),
    index('task_completion_task_date_idx').on(table.taskId, table.completedAt),
  ],
);
