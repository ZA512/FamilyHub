import { z } from 'zod';

export const setupRequestSchema = z.object({
  instanceName: z.string().trim().min(2).max(80),
  firstName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200),
  setupToken: z.string().min(1),
});

export const loginRequestSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
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
