import {
  mealCreateSchema,
  mealPlanCreateSchema,
  mealPlanRangeSchema,
  mealPlanUpdateSchema,
  mealPreferenceUpdateSchema,
  mealToShoppingSchema,
  mealUpdateSchema,
  type FamilyMeal,
  type MealIngredient,
  type MealListMember,
  type MealPlanEntry,
  type MealPreferenceEntry,
  type MealSlot,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const idSchema = z.string().uuid();

type MealRow = {
  id: string;
  name: string;
  description: string | null;
  photoUrl: string | null;
  referencePortions: number;
  instructions: string | null;
  tags: string[];
  comments: string | null;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  createdBy: string;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
};

type IngredientRow = MealIngredient & { mealId: string; quantity: string | number };
type PreferenceRow = Omit<MealPreferenceEntry, 'value'> & {
  mealId: string;
  value: number;
};

type PlanRow = {
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
  createdAt: Date;
  updatedAt: Date;
};

const readableMeal = `
  r.instance_id = $1
  AND r.deleted_at IS NULL
  AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $2)
`;

const selectMeal = `
  SELECT m.id, m.name, m.description, m.photo_url AS "photoUrl",
         m.reference_portions AS "referencePortions", m.instructions, m.tags, m.comments,
         r.visibility, r.created_by AS "createdBy", creator.first_name AS "createdByName",
         m.created_at AS "createdAt", m.updated_at AS "updatedAt"
  FROM meal m
  JOIN resource r ON r.id = m.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
`;

async function requireMealsModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'meals' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function normalizeIngredient(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('fr-FR');
}

function mayManage(createdBy: string, memberId: string, role: 'ADMIN' | 'MEMBER'): boolean {
  return role === 'ADMIN' || createdBy === memberId;
}

async function loadMeals(
  client: Pool | PoolClient,
  instanceId: string,
  memberId: string,
  role: 'ADMIN' | 'MEMBER',
  mealId?: string,
): Promise<FamilyMeal[]> {
  const rows = await client.query<MealRow>(
    `${selectMeal}
     WHERE ${readableMeal}${mealId ? ' AND m.id = $3' : ''}
     ORDER BY lower(m.name), m.created_at DESC`,
    mealId ? [instanceId, memberId, mealId] : [instanceId, memberId],
  );
  if (!rows.rowCount) return [];

  const ids = rows.rows.map((meal) => meal.id);
  const [ingredients, preferences] = await Promise.all([
    client.query<IngredientRow>(
      `SELECT mi.meal_id AS "mealId", i.id, i.name, mi.quantity, mi.unit
       FROM meal_ingredient mi
       JOIN ingredient i ON i.id = mi.ingredient_id
       WHERE mi.meal_id = ANY($1::uuid[])
       ORDER BY mi.meal_id, mi.sort_order, lower(i.name)`,
      [ids],
    ),
    client.query<PreferenceRow>(
      `SELECT mp.meal_id AS "mealId", mp.member_id AS "memberId",
              u.first_name AS "memberName", mp.value
       FROM meal_preference mp
       JOIN instance_member im ON im.id = mp.member_id
       JOIN app_user u ON u.id = im.user_id
       WHERE mp.meal_id = ANY($1::uuid[])
       ORDER BY lower(u.first_name)`,
      [ids],
    ),
  ]);

  const ingredientsByMeal = new Map<string, MealIngredient[]>();
  for (const ingredient of ingredients.rows) {
    const values = ingredientsByMeal.get(ingredient.mealId) ?? [];
    values.push({
      id: ingredient.id,
      name: ingredient.name,
      quantity: Number(ingredient.quantity),
      unit: ingredient.unit,
    });
    ingredientsByMeal.set(ingredient.mealId, values);
  }

  const preferencesByMeal = new Map<string, MealPreferenceEntry[]>();
  for (const preference of preferences.rows) {
    const values = preferencesByMeal.get(preference.mealId) ?? [];
    values.push({
      memberId: preference.memberId,
      memberName: preference.memberName,
      value: preference.value === -1 ? -1 : preference.value === 1 ? 1 : 0,
    });
    preferencesByMeal.set(preference.mealId, values);
  }

  return rows.rows.map((meal) => ({
    ...meal,
    ingredients: ingredientsByMeal.get(meal.id) ?? [],
    preferences: preferencesByMeal.get(meal.id) ?? [],
    editable: mayManage(meal.createdBy, memberId, role),
    createdAt: meal.createdAt.toISOString(),
    updatedAt: meal.updatedAt.toISOString(),
  }));
}

async function replaceIngredients(
  client: PoolClient,
  instanceId: string,
  mealId: string,
  values: Array<{ name: string; quantity: number; unit: string }>,
) {
  const normalized = values.map((ingredient) => normalizeIngredient(ingredient.name));
  if (new Set(normalized).size !== normalized.length) {
    throw Object.assign(new Error('Duplicate ingredient'), { code: 'DUPLICATE_INGREDIENT' });
  }

  await client.query('DELETE FROM meal_ingredient WHERE meal_id = $1', [mealId]);
  for (const [index, ingredient] of values.entries()) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO ingredient (instance_id, name, normalized_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (instance_id, normalized_name)
       DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [instanceId, ingredient.name, normalized[index]],
    );
    await client.query(
      `INSERT INTO meal_ingredient (meal_id, ingredient_id, quantity, unit, sort_order)
       VALUES ($1, $2, $3, $4, $5)`,
      [mealId, result.rows[0]!.id, ingredient.quantity, ingredient.unit, index],
    );
  }
}

async function loadPlanEntry(
  client: Pool | PoolClient,
  entryId: string,
  instanceId: string,
  memberId: string,
  role: 'ADMIN' | 'MEMBER',
): Promise<MealPlanEntry | null> {
  const result = await client.query<PlanRow>(
    `SELECT pe.id, pe.meal_id AS "mealId", m.name AS "mealName", pe.date::text,
            pe.slot, pe.slot_label AS "slotLabel", pe.portions, pe.note,
            pe.created_by AS "createdBy", u.first_name AS "createdByName",
            pe.created_at AS "createdAt", pe.updated_at AS "updatedAt"
     FROM meal_plan_entry pe
     JOIN meal m ON m.id = pe.meal_id
     JOIN resource r ON r.id = m.id
     JOIN instance_member im ON im.id = pe.created_by
     JOIN app_user u ON u.id = im.user_id
     WHERE pe.id = $3 AND pe.instance_id = $1
       AND r.deleted_at IS NULL
       AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $2)`,
    [instanceId, memberId, entryId],
  );
  const row = result.rows[0];
  return row
    ? {
        ...row,
        editable: mayManage(row.createdBy, memberId, role),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    : null;
}

export async function registerMealRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/meals', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireMealsModule(request, reply, pool))) return;
    const [meals, members] = await Promise.all([
      loadMeals(pool, request.session!.instanceId, request.session!.id, request.session!.role),
      pool.query<MealListMember>(
        `SELECT m.id, u.first_name AS "firstName"
         FROM instance_member m
         JOIN app_user u ON u.id = m.user_id
         WHERE m.instance_id = $1 AND m.status = 'ACTIVE'
         ORDER BY lower(u.first_name), m.joined_at`,
        [request.session!.instanceId],
      ),
    ]);
    return {
      meals,
      members: members.rows,
    };
  });

  app.post(
    '/api/v1/meals',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const parsed = mealCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM meal WHERE instance_id = $1 AND client_mutation_id = $2`,
          [request.session!.instanceId, parsed.data.clientMutationId],
        );
        let mealId = existing.rows[0]?.id;
        if (!mealId) {
          const resource = await client.query<{ id: string }>(
            `INSERT INTO resource
               (id, instance_id, resource_type, created_by, visibility)
             VALUES ($1, $2, 'meal', $3, $4)
             RETURNING id`,
            [
              parsed.data.clientMutationId,
              request.session!.instanceId,
              request.session!.id,
              parsed.data.visibility,
            ],
          );
          mealId = resource.rows[0]!.id;
          await client.query(
            `INSERT INTO meal
               (id, instance_id, name, description, photo_url, reference_portions,
                instructions, tags, comments, client_mutation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              mealId,
              request.session!.instanceId,
              parsed.data.name,
              parsed.data.description ?? null,
              parsed.data.photoUrl ?? null,
              parsed.data.referencePortions,
              parsed.data.instructions ?? null,
              parsed.data.tags,
              parsed.data.comments ?? null,
              parsed.data.clientMutationId,
            ],
          );
          await replaceIngredients(
            client,
            request.session!.instanceId,
            mealId,
            parsed.data.ingredients,
          );
        }
        const [meal] = await loadMeals(
          client,
          request.session!.instanceId,
          request.session!.id,
          request.session!.role,
          mealId,
        );
        await client.query('COMMIT');
        return reply.code(201).send({ meal });
      } catch (error) {
        await client.query('ROLLBACK');
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'DUPLICATE_INGREDIENT'
        ) {
          return reply.code(400).send({ error: 'DUPLICATE_INGREDIENT' });
        }
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/meals/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const id = idSchema.safeParse(request.params.id);
      const parsed = mealUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const current = await client.query<{ createdBy: string }>(
          `SELECT r.created_by AS "createdBy"
           FROM meal m JOIN resource r ON r.id = m.id
           WHERE m.id = $1 AND r.instance_id = $2 AND r.deleted_at IS NULL
             AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $3)
           FOR UPDATE OF m, r`,
          [id.data, request.session!.instanceId, request.session!.id],
        );
        const row = current.rows[0];
        if (!row) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'MEAL_NOT_FOUND' });
        }
        if (!mayManage(row.createdBy, request.session!.id, request.session!.role)) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'MEAL_ACTION_FORBIDDEN' });
        }

        await client.query(
          `UPDATE meal SET name = $1, description = $2, photo_url = $3,
             reference_portions = $4, instructions = $5, tags = $6, comments = $7,
             updated_at = now()
           WHERE id = $8`,
          [
            parsed.data.name,
            parsed.data.description ?? null,
            parsed.data.photoUrl ?? null,
            parsed.data.referencePortions,
            parsed.data.instructions ?? null,
            parsed.data.tags,
            parsed.data.comments ?? null,
            id.data,
          ],
        );
        await client.query(
          `UPDATE resource SET visibility = $1, version = version + 1, updated_at = now()
           WHERE id = $2`,
          [parsed.data.visibility, id.data],
        );
        await replaceIngredients(
          client,
          request.session!.instanceId,
          id.data,
          parsed.data.ingredients,
        );
        const [meal] = await loadMeals(
          client,
          request.session!.instanceId,
          request.session!.id,
          request.session!.role,
          id.data,
        );
        await client.query('COMMIT');
        return { meal };
      } catch (error) {
        await client.query('ROLLBACK');
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'DUPLICATE_INGREDIENT'
        ) {
          return reply.code(400).send({ error: 'DUPLICATE_INGREDIENT' });
        }
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/meals/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const id = idSchema.safeParse(request.params.id);
      if (!id.success) return reply.code(404).send({ error: 'MEAL_NOT_FOUND' });
      const result = await pool.query(
        `UPDATE resource r SET deleted_at = now(), updated_at = now(), version = version + 1
         FROM meal m
         WHERE r.id = m.id AND m.id = $1 AND r.instance_id = $2 AND r.deleted_at IS NULL
           AND (r.created_by = $3 OR ($4 = 'ADMIN' AND r.visibility = 'ALL_MEMBERS'))`,
        [id.data, request.session!.instanceId, request.session!.id, request.session!.role],
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'MEAL_NOT_FOUND' });
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/meals/:id/preference',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const id = idSchema.safeParse(request.params.id);
      const parsed = mealPreferenceUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const visible = await loadMeals(
        pool,
        request.session!.instanceId,
        request.session!.id,
        request.session!.role,
        id.data,
      );
      if (!visible.length) return reply.code(404).send({ error: 'MEAL_NOT_FOUND' });
      await pool.query(
        `INSERT INTO meal_preference (meal_id, member_id, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (meal_id, member_id)
         DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [id.data, request.session!.id, parsed.data.value],
      );
      const [meal] = await loadMeals(
        pool,
        request.session!.instanceId,
        request.session!.id,
        request.session!.role,
        id.data,
      );
      return { meal };
    },
  );

  app.get<{ Querystring: { start?: string; end?: string } }>(
    '/api/v1/meal-plan',
    { preHandler: requireSession },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const parsed = mealPlanRangeSchema.safeParse(request.query);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_RANGE' });
      const result = await pool.query<PlanRow>(
        `SELECT pe.id, pe.meal_id AS "mealId", m.name AS "mealName", pe.date::text,
                pe.slot, pe.slot_label AS "slotLabel", pe.portions, pe.note,
                pe.created_by AS "createdBy", u.first_name AS "createdByName",
                pe.created_at AS "createdAt", pe.updated_at AS "updatedAt"
         FROM meal_plan_entry pe
         JOIN meal m ON m.id = pe.meal_id
         JOIN resource r ON r.id = m.id
         JOIN instance_member im ON im.id = pe.created_by
         JOIN app_user u ON u.id = im.user_id
         WHERE pe.instance_id = $1 AND pe.date BETWEEN $3::date AND $4::date
           AND r.deleted_at IS NULL
           AND (r.visibility = 'ALL_MEMBERS' OR r.created_by = $2)
         ORDER BY pe.date, CASE pe.slot WHEN 'LUNCH' THEN 1 WHEN 'DINNER' THEN 2 ELSE 3 END,
                  pe.created_at`,
        [request.session!.instanceId, request.session!.id, parsed.data.start, parsed.data.end],
      );
      return {
        entries: result.rows.map(
          (row): MealPlanEntry => ({
            ...row,
            editable: mayManage(row.createdBy, request.session!.id, request.session!.role),
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          }),
        ),
      };
    },
  );

  app.post(
    '/api/v1/meal-plan',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const parsed = mealPlanCreateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const [meal] = await loadMeals(
        pool,
        request.session!.instanceId,
        request.session!.id,
        request.session!.role,
        parsed.data.mealId,
      );
      if (!meal) return reply.code(404).send({ error: 'MEAL_NOT_FOUND' });
      const inserted = await pool.query<{ id: string }>(
        `INSERT INTO meal_plan_entry
           (instance_id, meal_id, date, slot, slot_label, portions, note,
            created_by, client_mutation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (instance_id, client_mutation_id) DO UPDATE SET updated_at = meal_plan_entry.updated_at
         RETURNING id`,
        [
          request.session!.instanceId,
          parsed.data.mealId,
          parsed.data.date,
          parsed.data.slot,
          parsed.data.slotLabel ?? null,
          parsed.data.portions,
          parsed.data.note ?? null,
          request.session!.id,
          parsed.data.clientMutationId,
        ],
      );
      const entry = await loadPlanEntry(
        pool,
        inserted.rows[0]!.id,
        request.session!.instanceId,
        request.session!.id,
        request.session!.role,
      );
      return reply.code(201).send({ entry });
    },
  );

  app.put<{ Params: { id: string } }>(
    '/api/v1/meal-plan/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const id = idSchema.safeParse(request.params.id);
      const parsed = mealPlanUpdateSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const current = id.success
        ? await loadPlanEntry(
            pool,
            id.data,
            request.session!.instanceId,
            request.session!.id,
            request.session!.role,
          )
        : null;
      if (!current) return reply.code(404).send({ error: 'MEAL_PLAN_NOT_FOUND' });
      if (!current.editable) return reply.code(403).send({ error: 'MEAL_PLAN_ACTION_FORBIDDEN' });
      const [meal] = await loadMeals(
        pool,
        request.session!.instanceId,
        request.session!.id,
        request.session!.role,
        parsed.data.mealId,
      );
      if (!meal) return reply.code(404).send({ error: 'MEAL_NOT_FOUND' });
      await pool.query(
        `UPDATE meal_plan_entry SET meal_id = $1, date = $2, slot = $3, slot_label = $4,
             portions = $5, note = $6, updated_at = now()
         WHERE id = $7 AND instance_id = $8`,
        [
          parsed.data.mealId,
          parsed.data.date,
          parsed.data.slot,
          parsed.data.slotLabel ?? null,
          parsed.data.portions,
          parsed.data.note ?? null,
          id.data,
          request.session!.instanceId,
        ],
      );
      return {
        entry: await loadPlanEntry(
          pool,
          id.data,
          request.session!.instanceId,
          request.session!.id,
          request.session!.role,
        ),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/meal-plan/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const id = idSchema.safeParse(request.params.id);
      if (!id.success) return reply.code(404).send({ error: 'MEAL_PLAN_NOT_FOUND' });
      const result = await pool.query(
        `DELETE FROM meal_plan_entry pe
         USING meal m, resource r
         WHERE pe.id = $1 AND pe.instance_id = $2
           AND m.id = pe.meal_id AND r.id = m.id AND r.deleted_at IS NULL
           AND (pe.created_by = $3 OR ($4 = 'ADMIN' AND r.visibility = 'ALL_MEMBERS'))`,
        [id.data, request.session!.instanceId, request.session!.id, request.session!.role],
      );
      if (!result.rowCount) return reply.code(404).send({ error: 'MEAL_PLAN_NOT_FOUND' });
      return reply.code(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/meals/:id/to-shopping-list',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireMealsModule(request, reply, pool))) return;
      const id = idSchema.safeParse(request.params.id);
      const parsed = mealToShoppingSchema.safeParse(request.body);
      if (!id.success || !parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      const shoppingEnabled = await pool.query(
        `SELECT 1 FROM module_config
         WHERE instance_id = $1 AND module_key = 'shopping' AND enabled = true`,
        [request.session!.instanceId],
      );
      if (!shoppingEnabled.rowCount)
        return reply.code(404).send({ error: 'SHOPPING_MODULE_NOT_AVAILABLE' });
      const [meal] = await loadMeals(
        pool,
        request.session!.instanceId,
        request.session!.id,
        request.session!.role,
        id.data,
      );
      if (!meal) return reply.code(404).send({ error: 'MEAL_NOT_FOUND' });
      const ingredientById = new Map(
        meal.ingredients.map((ingredient) => [ingredient.id, ingredient]),
      );
      if (parsed.data.items.some((item) => !ingredientById.has(item.ingredientId))) {
        return reply.code(400).send({ error: 'INGREDIENT_NOT_FOUND' });
      }

      const client = await pool.connect();
      let addedCount = 0;
      try {
        await client.query('BEGIN');
        for (const item of parsed.data.items) {
          const ingredient = ingredientById.get(item.ingredientId)!;
          const quantity = (ingredient.quantity * parsed.data.portions) / meal.referencePortions;
          const inserted = await client.query(
            `INSERT INTO shopping_item
               (instance_id, name, quantity, note, source, requested_by, client_mutation_id)
             VALUES ($1, $2, $3, $4, 'MEAL', $5, $6)
             ON CONFLICT (instance_id, client_mutation_id) DO NOTHING`,
            [
              request.session!.instanceId,
              ingredient.name,
              `${formatQuantity(quantity)} ${ingredient.unit}`,
              `Depuis ${meal.name}`,
              request.session!.id,
              item.clientMutationId,
            ],
          );
          addedCount += inserted.rowCount ?? 0;
        }
        await client.query('COMMIT');
        return { addedCount };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(value);
}
