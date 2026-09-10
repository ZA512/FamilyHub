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
