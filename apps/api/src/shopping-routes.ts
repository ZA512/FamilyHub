import {
  shoppingItemCreateSchema,
  shoppingItemUpdateSchema,
  type ShoppingItem,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const shoppingItemIdSchema = z.string().uuid();

type ShoppingRow = {
  id: string;
  name: string;
  quantity: string | null;
  note: string | null;
  source: string;
  requestedBy: string;
  requestedByName: string;
  purchasedBy: string | null;
  purchasedByName: string | null;
  purchasedAt: Date | null;
  clientMutationId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

const selectShoppingItem = `
  SELECT i.id, i.name, i.quantity, i.note, i.source,
         i.requested_by AS "requestedBy", requester.first_name AS "requestedByName",
         i.purchased_by AS "purchasedBy", purchaser.first_name AS "purchasedByName",
         i.purchased_at AS "purchasedAt", i.client_mutation_id AS "clientMutationId",
         i.version, i.created_at AS "createdAt", i.updated_at AS "updatedAt"
  FROM shopping_item i
  JOIN instance_member requester_member ON requester_member.id = i.requested_by
  JOIN app_user requester ON requester.id = requester_member.user_id
  LEFT JOIN instance_member purchaser_member ON purchaser_member.id = i.purchased_by
  LEFT JOIN app_user purchaser ON purchaser.id = purchaser_member.user_id
`;

function serializeShoppingItem(row: ShoppingRow): ShoppingItem {
  return {
    ...row,
    purchasedAt: row.purchasedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requireShoppingModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'shopping' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

export async function registerShoppingRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/shopping-items', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireShoppingModule(request, reply, pool))) return;
    const result = await pool.query<ShoppingRow>(
      `${selectShoppingItem}
       WHERE i.instance_id = $1 AND i.deleted_at IS NULL
       ORDER BY i.purchased_at NULLS FIRST, i.created_at DESC`,
      [request.session?.instanceId],
    );
    return { items: result.rows.map(serializeShoppingItem) };
  });

  app.post(
    '/api/v1/shopping-items',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireShoppingModule(request, reply, pool))) return;
      const parsed = shoppingItemCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO shopping_item
           (instance_id, name, quantity, note, requested_by, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (instance_id, client_mutation_id)
         DO UPDATE SET client_mutation_id = EXCLUDED.client_mutation_id
         RETURNING id`,
        [
          request.session?.instanceId,
          parsed.data.name,
          parsed.data.quantity ?? null,
          parsed.data.note ?? null,
          request.session?.id,
          parsed.data.clientMutationId,
        ],
      );
      const result = await pool.query<ShoppingRow>(
        `${selectShoppingItem}
         WHERE i.id = $1 AND i.instance_id = $2 AND i.deleted_at IS NULL`,
        [inserted.rows[0]?.id, request.session?.instanceId],
      );
      const row = result.rows[0];
      if (!row) throw new Error('Shopping item creation returned no row.');
      return reply.code(201).send({ item: serializeShoppingItem(row) });
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/shopping-items/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireShoppingModule(request, reply, pool))) return;
      const parsed = shoppingItemUpdateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

      const itemId = shoppingItemIdSchema.safeParse(request.params.id);
      if (!itemId.success) return reply.code(404).send({ error: 'SHOPPING_ITEM_NOT_FOUND' });

      const current = await pool.query<{ purchased_at: Date | null; purchased_by: string | null }>(
        `SELECT purchased_at, purchased_by FROM shopping_item
         WHERE id = $1 AND instance_id = $2 AND deleted_at IS NULL`,
        [itemId.data, request.session?.instanceId],
      );
      if (!current.rows[0]) return reply.code(404).send({ error: 'SHOPPING_ITEM_NOT_FOUND' });

      const purchasedAt =
        parsed.data.purchased === undefined
          ? current.rows[0].purchased_at
          : parsed.data.purchased
            ? new Date()
            : null;
      const purchasedBy =
        parsed.data.purchased === undefined
          ? current.rows[0].purchased_by
          : parsed.data.purchased
            ? request.session?.id
            : null;

      const updated = await pool.query<{ id: string }>(
        `UPDATE shopping_item
         SET name = COALESCE($1, name),
             quantity = CASE WHEN $2 THEN $3 ELSE quantity END,
             note = CASE WHEN $4 THEN $5 ELSE note END,
             purchased_at = $6,
             purchased_by = $7,
             version = version + 1,
             updated_at = now()
         WHERE id = $8 AND instance_id = $9 AND deleted_at IS NULL
         RETURNING id`,
        [
          parsed.data.name ?? null,
          Object.hasOwn(parsed.data, 'quantity'),
          parsed.data.quantity ?? null,
          Object.hasOwn(parsed.data, 'note'),
          parsed.data.note ?? null,
          purchasedAt,
          purchasedBy,
          itemId.data,
          request.session?.instanceId,
        ],
      );
      const result = await pool.query<ShoppingRow>(
        `${selectShoppingItem}
         WHERE i.id = $1 AND i.instance_id = $2 AND i.deleted_at IS NULL`,
        [updated.rows[0]?.id, request.session?.instanceId],
      );
      const row = result.rows[0];
      if (!row) return reply.code(404).send({ error: 'SHOPPING_ITEM_NOT_FOUND' });
      return { item: serializeShoppingItem(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/shopping-items/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireShoppingModule(request, reply, pool))) return;
      const itemId = shoppingItemIdSchema.safeParse(request.params.id);
      if (!itemId.success) return reply.code(404).send({ error: 'SHOPPING_ITEM_NOT_FOUND' });
      const result = await pool.query(
        `UPDATE shopping_item SET deleted_at = now(), updated_at = now(), version = version + 1
         WHERE id = $1 AND instance_id = $2 AND deleted_at IS NULL`,
        [itemId.data, request.session?.instanceId],
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'SHOPPING_ITEM_NOT_FOUND' });
      return reply.code(204).send();
    },
  );
}
