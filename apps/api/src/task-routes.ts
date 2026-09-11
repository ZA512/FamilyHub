import {
  taskCompleteSchema,
  taskCreateSchema,
  taskStatusUpdateSchema,
  type FamilyTask,
  type TaskCompletion,
  type TaskKind,
  type TaskReopenPolicy,
  type TaskStatus,
} from '@familyhub/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';

const taskIdSchema = z.string().uuid();

type TaskRow = {
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
  dueAt: Date | null;
  periodStartAt: Date | null;
  periodEndAt: Date | null;
  recurrenceIntervalDays: number | null;
  frequencyHint: string | null;
  reopenPolicy: TaskReopenPolicy;
  reopenDelayHours: number | null;
  nextAvailableAt: Date | null;
  visibility: 'PRIVATE' | 'ALL_MEMBERS';
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type CompletionRow = {
  id: string;
  taskId: string;
  completedBy: string;
  completedByName: string;
  completedAt: Date;
  comment: string | null;
  scheduledFor: Date | null;
};

const readableTask = `
  r.instance_id = $1
  AND r.deleted_at IS NULL
  AND (
    r.visibility = 'ALL_MEMBERS'
    OR r.created_by = $2
    OR EXISTS (
      SELECT 1 FROM resource_acl_user rau
      WHERE rau.resource_id = r.id AND rau.member_id = $2
    )
    OR EXISTS (
      SELECT 1
      FROM resource_acl_group rag
      JOIN group_membership gm ON gm.group_id = rag.group_id
      WHERE rag.resource_id = r.id AND gm.member_id = $2
    )
  )
`;

const selectTask = `
  SELECT t.id, t.title, t.description, t.kind, t.status,
         t.assignee_id AS "assigneeId", assignee.first_name AS "assigneeName",
         r.created_by AS "createdBy", creator.first_name AS "createdByName",
         t.claimable, t.due_at AS "dueAt", t.period_start_at AS "periodStartAt",
         t.period_end_at AS "periodEndAt",
         t.recurrence_interval_days AS "recurrenceIntervalDays",
         t.frequency_hint AS "frequencyHint", t.reopen_policy AS "reopenPolicy",
         t.reopen_delay_hours AS "reopenDelayHours",
         t.next_available_at AS "nextAvailableAt", r.visibility,
         t.version, t.created_at AS "createdAt", t.updated_at AS "updatedAt"
  FROM family_task t
  JOIN resource r ON r.id = t.id
  JOIN instance_member creator_member ON creator_member.id = r.created_by
  JOIN app_user creator ON creator.id = creator_member.user_id
  LEFT JOIN instance_member assignee_member ON assignee_member.id = t.assignee_id
  LEFT JOIN app_user assignee ON assignee.id = assignee_member.user_id
`;

async function requireTasksModule(
  request: FastifyRequest,
  reply: FastifyReply,
  pool: Pool,
): Promise<boolean> {
  if (!request.session) return false;
  const result = await pool.query(
    `SELECT 1 FROM module_config
     WHERE instance_id = $1 AND module_key = 'tasks' AND enabled = true`,
    [request.session.instanceId],
  );
  if (!result.rowCount) {
    await reply.code(404).send({ error: 'MODULE_NOT_AVAILABLE' });
    return false;
  }
  return true;
}

function serializeCompletion(row: CompletionRow): TaskCompletion {
  return {
    id: row.id,
    completedBy: row.completedBy,
    completedByName: row.completedByName,
    completedAt: row.completedAt.toISOString(),
    comment: row.comment,
    scheduledFor: row.scheduledFor?.toISOString() ?? null,
  };
}

function serializeTask(row: TaskRow, completions: TaskCompletion[] = []): FamilyTask {
  return {
    ...row,
    dueAt: row.dueAt?.toISOString() ?? null,
    periodStartAt: row.periodStartAt?.toISOString() ?? null,
    periodEndAt: row.periodEndAt?.toISOString() ?? null,
    nextAvailableAt: row.nextAvailableAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    completions,
  };
}

async function loadTask(
  client: Pool | PoolClient,
  taskId: string,
  instanceId: string,
  memberId: string,
  lock = false,
): Promise<TaskRow | null> {
  const result = await client.query<TaskRow>(
    `${selectTask}
     WHERE t.id = $3 AND ${readableTask}
     ${lock ? 'FOR UPDATE OF t' : ''}`,
    [instanceId, memberId, taskId],
  );
  return result.rows[0] ?? null;
}

function mayActOnTask(
  task: TaskRow,
  memberId: string,
  role: 'ADMIN' | 'MEMBER',
): boolean {
  return (
    role === 'ADMIN' ||
    task.createdBy === memberId ||
    task.assigneeId === memberId ||
    (task.kind === 'OPEN_CHORE' && task.claimable)
  );
}

function nextPlannedDate(dueAt: Date, intervalDays: number, completedAt: Date): Date {
  const next = new Date(dueAt);
  do {
    next.setUTCDate(next.getUTCDate() + intervalDays);
  } while (next <= completedAt);
  return next;
}

export async function reopenAvailableTasks(pool: Pool, instanceId: string): Promise<void> {
  await pool.query(
    `UPDATE family_task
     SET status = 'OPEN', next_available_at = NULL, version = version + 1, updated_at = now()
     WHERE instance_id = $1 AND status = 'DONE' AND reopen_policy = 'AFTER_DELAY'
       AND next_available_at <= now()`,
    [instanceId],
  );
}

function advancePeriod(
  startAt: Date,
  endAt: Date | null,
  intervalDays: number,
  completedAt: Date,
): { startAt: Date; endAt: Date | null } {
  const start = new Date(startAt);
  const end = endAt ? new Date(endAt) : null;
  do {
    start.setUTCDate(start.getUTCDate() + intervalDays);
    end?.setUTCDate(end.getUTCDate() + intervalDays);
  } while ((end ?? start) <= completedAt);
  return { startAt: start, endAt: end };
}

export async function registerTaskRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/tasks', { preHandler: requireSession }, async (request, reply) => {
    if (!(await requireTasksModule(request, reply, pool))) return;

    await reopenAvailableTasks(pool, request.session!.instanceId);

    const result = await pool.query<TaskRow>(
      `${selectTask}
       WHERE ${readableTask}
       ORDER BY
         (t.status IN ('OPEN', 'IN_PROGRESS')) DESC,
         t.due_at ASC NULLS LAST,
         t.created_at DESC`,
      [request.session?.instanceId, request.session?.id],
    );
    const taskIds = result.rows.map((task) => task.id);
    const completions = taskIds.length
      ? await pool.query<CompletionRow>(
          `SELECT c.id, c.task_id AS "taskId", c.completed_by AS "completedBy",
                  performer.first_name AS "completedByName", c.completed_at AS "completedAt",
                  c.comment, c.scheduled_for AS "scheduledFor"
           FROM task_completion c
           JOIN instance_member performer_member ON performer_member.id = c.completed_by
           JOIN app_user performer ON performer.id = performer_member.user_id
           WHERE c.task_id = ANY($1::uuid[])
           ORDER BY c.completed_at DESC`,
          [taskIds],
        )
      : { rows: [] as CompletionRow[] };
    const byTask = new Map<string, TaskCompletion[]>();
    for (const completion of completions.rows) {
      const entries = byTask.get(completion.taskId) ?? [];
      if (entries.length < 10) entries.push(serializeCompletion(completion));
      byTask.set(completion.taskId, entries);
    }
    return { tasks: result.rows.map((task) => serializeTask(task, byTask.get(task.id) ?? [])) };
  });

  app.post(
    '/api/v1/tasks',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireTasksModule(request, reply, pool))) return;
      const parsed = taskCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'INVALID_REQUEST', details: parsed.error.flatten() });
      }
      if (
        parsed.data.visibility === 'PRIVATE' &&
        parsed.data.assigneeId &&
        parsed.data.assigneeId !== request.session?.id
      ) {
        return reply.code(400).send({ error: 'PRIVATE_TASK_ASSIGNEE_INVALID' });
      }

      if (parsed.data.assigneeId) {
        const assignee = await pool.query(
          `SELECT 1 FROM instance_member
           WHERE id = $1 AND instance_id = $2 AND status = 'ACTIVE'`,
          [parsed.data.assigneeId, request.session?.instanceId],
        );
        if (!assignee.rowCount) return reply.code(400).send({ error: 'ASSIGNEE_INVALID' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM family_task WHERE instance_id = $1 AND client_mutation_id = $2`,
          [request.session?.instanceId, parsed.data.clientMutationId],
        );
        let taskId = existing.rows[0]?.id;
        if (!taskId) {
          const resource = await client.query<{ id: string }>(
            `INSERT INTO resource (id, instance_id, resource_type, created_by, visibility)
             VALUES ($1, $2, 'task', $3, $4)
             RETURNING id`,
            [
              parsed.data.clientMutationId,
              request.session?.instanceId,
              request.session?.id,
              parsed.data.visibility,
            ],
          );
          taskId = resource.rows[0]?.id;
          if (!taskId) throw new Error('Task resource creation returned no row.');
          await client.query(
            `INSERT INTO family_task
               (id, instance_id, title, description, kind, assignee_id, claimable,
                due_at, period_start_at, period_end_at, recurrence_interval_days,
                frequency_hint, reopen_policy, reopen_delay_hours, client_mutation_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              taskId,
              request.session?.instanceId,
              parsed.data.title,
              parsed.data.description ?? null,
              parsed.data.kind,
              parsed.data.assigneeId ?? null,
              parsed.data.claimable,
              parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
              parsed.data.periodStartAt ? new Date(parsed.data.periodStartAt) : null,
              parsed.data.periodEndAt ? new Date(parsed.data.periodEndAt) : null,
              parsed.data.recurrenceIntervalDays ?? null,
              parsed.data.frequencyHint ?? null,
              parsed.data.reopenPolicy,
              parsed.data.reopenDelayHours ?? null,
              parsed.data.clientMutationId,
            ],
          );

          if (parsed.data.assigneeId && parsed.data.assigneeId !== request.session?.id) {
            await client.query(
              `INSERT INTO notification
                 (instance_id, recipient_member_id, actor_member_id, type, module_key,
                  title, body, resource_type, resource_id)
               VALUES ($1, $2, $3, 'TASK_ASSIGNED', 'tasks',
                       'Nouvelle tâche attribuée', $4, 'task', $5)`,
              [
                request.session?.instanceId,
                parsed.data.assigneeId,
                request.session?.id,
                `${request.session?.firstName} vous attribue : ${parsed.data.title}`,
                taskId,
              ],
            );
          }
        }

        const task = await loadTask(
          client,
          taskId,
          request.session!.instanceId,
          request.session!.id,
        );
        if (!task) throw new Error('Task creation returned no readable row.');
        await client.query('COMMIT');
        return reply.code(201).send({ task: serializeTask(task) });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/tasks/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireTasksModule(request, reply, pool))) return;
      const taskId = taskIdSchema.safeParse(request.params.id);
      const parsed = taskStatusUpdateSchema.safeParse(request.body);
      if (!taskId.success) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
      if (!parsed.success || !['IN_PROGRESS', 'CANCELLED'].includes(parsed.data.status)) {
        return reply.code(400).send({ error: 'INVALID_REQUEST' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const task = await loadTask(
          client,
          taskId.data,
          request.session!.instanceId,
          request.session!.id,
          true,
        );
        if (!task) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
        }
        if (!mayActOnTask(task, request.session!.id, request.session!.role)) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'TASK_ACTION_FORBIDDEN' });
        }
        if (
          (parsed.data.status === 'IN_PROGRESS' && task.status !== 'OPEN') ||
          (parsed.data.status === 'CANCELLED' &&
            task.status !== 'OPEN' &&
            task.status !== 'IN_PROGRESS')
        ) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'TASK_STATE_INVALID' });
        }
        if (
          parsed.data.status === 'CANCELLED' &&
          request.session?.role !== 'ADMIN' &&
          task.createdBy !== request.session?.id
        ) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'TASK_ACTION_FORBIDDEN' });
        }
        const claim = parsed.data.status === 'IN_PROGRESS' && task.claimable && !task.assigneeId;
        await client.query(
          `UPDATE family_task
           SET status = $1, assignee_id = CASE WHEN $2 THEN $3 ELSE assignee_id END,
               version = version + 1, updated_at = now()
           WHERE id = $4`,
          [parsed.data.status, claim, request.session?.id, task.id],
        );
        const updated = await loadTask(
          client,
          task.id,
          request.session!.instanceId,
          request.session!.id,
        );
        await client.query('COMMIT');
        return { task: serializeTask(updated!) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/tasks/:id/complete',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireTasksModule(request, reply, pool))) return;
      const taskId = taskIdSchema.safeParse(request.params.id);
      const parsed = taskCompleteSchema.safeParse(request.body);
      if (!taskId.success) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const task = await loadTask(
          client,
          taskId.data,
          request.session!.instanceId,
          request.session!.id,
          true,
        );
        if (!task) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
        }
        if (!mayActOnTask(task, request.session!.id, request.session!.role)) {
          await client.query('ROLLBACK');
          return reply.code(403).send({ error: 'TASK_ACTION_FORBIDDEN' });
        }
        if (task.status === 'CANCELLED') {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'TASK_CANCELLED' });
        }

        const existingCompletion = await client.query<{ id: string }>(
          `SELECT id FROM task_completion
           WHERE task_id = $1 AND client_mutation_id = $2`,
          [task.id, parsed.data.clientMutationId],
        );
        if (task.status === 'DONE' && !existingCompletion.rowCount) {
          await client.query('ROLLBACK');
          return reply.code(409).send({ error: 'TASK_ALREADY_DONE' });
        }

        const completion = existingCompletion.rowCount
          ? existingCompletion
          : await client.query<{ id: string }>(
              `INSERT INTO task_completion
                 (task_id, completed_by, comment, scheduled_for, client_mutation_id)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id`,
              [
                task.id,
                request.session?.id,
                parsed.data.comment ?? null,
                task.dueAt,
                parsed.data.clientMutationId,
              ],
            );

        if (!existingCompletion.rowCount && completion.rowCount) {
          const completedAt = new Date();
          let status: TaskStatus = 'DONE';
          let dueAt = task.dueAt;
          let periodStartAt = task.periodStartAt;
          let periodEndAt = task.periodEndAt;
          let nextAvailableAt: Date | null = null;
          let assigneeId = task.assigneeId;

          if (task.kind !== 'OPEN_CHORE' && task.recurrenceIntervalDays && task.dueAt) {
            status = 'OPEN';
            dueAt = nextPlannedDate(task.dueAt, task.recurrenceIntervalDays, completedAt);
          } else if (
            task.kind !== 'OPEN_CHORE' &&
            task.recurrenceIntervalDays &&
            task.periodStartAt
          ) {
            status = 'OPEN';
            const period = advancePeriod(
              task.periodStartAt,
              task.periodEndAt,
              task.recurrenceIntervalDays,
              completedAt,
            );
            periodStartAt = period.startAt;
            periodEndAt = period.endAt;
          } else if (task.kind === 'OPEN_CHORE' && task.reopenPolicy === 'IMMEDIATE') {
            status = 'OPEN';
            if (task.claimable) assigneeId = null;
          } else if (task.kind === 'OPEN_CHORE' && task.reopenPolicy === 'AFTER_DELAY') {
            nextAvailableAt = new Date(
              completedAt.getTime() + (task.reopenDelayHours ?? 1) * 60 * 60 * 1000,
            );
          }

          await client.query(
            `UPDATE family_task
             SET status = $1, due_at = $2, period_start_at = $3, period_end_at = $4,
                 next_available_at = $5, assignee_id = $6,
                 version = version + 1, updated_at = now()
             WHERE id = $7`,
            [status, dueAt, periodStartAt, periodEndAt, nextAvailableAt, assigneeId, task.id],
          );
        }

        const updated = await loadTask(
          client,
          task.id,
          request.session!.instanceId,
          request.session!.id,
        );
        const history = await client.query<CompletionRow>(
          `SELECT c.id, c.task_id AS "taskId", c.completed_by AS "completedBy",
                  performer.first_name AS "completedByName", c.completed_at AS "completedAt",
                  c.comment, c.scheduled_for AS "scheduledFor"
           FROM task_completion c
           JOIN instance_member performer_member ON performer_member.id = c.completed_by
           JOIN app_user performer ON performer.id = performer_member.user_id
           WHERE c.task_id = $1 ORDER BY c.completed_at DESC LIMIT 10`,
          [task.id],
        );
        await client.query('COMMIT');
        return { task: serializeTask(updated!, history.rows.map(serializeCompletion)) };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/tasks/:id/reopen',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (!(await requireTasksModule(request, reply, pool))) return;
      const taskId = taskIdSchema.safeParse(request.params.id);
      if (!taskId.success) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
      const task = await loadTask(
        pool,
        taskId.data,
        request.session!.instanceId,
        request.session!.id,
      );
      if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND' });
      if (request.session?.role !== 'ADMIN' && task.createdBy !== request.session?.id) {
        return reply.code(403).send({ error: 'TASK_ACTION_FORBIDDEN' });
      }
      await pool.query(
        `UPDATE family_task
         SET status = 'OPEN', next_available_at = NULL,
             assignee_id = CASE WHEN claimable THEN NULL ELSE assignee_id END,
             version = version + 1, updated_at = now()
         WHERE id = $1`,
        [task.id],
      );
      const updated = await loadTask(
        pool,
        task.id,
        request.session!.instanceId,
        request.session!.id,
      );
      return { task: serializeTask(updated!) };
    },
  );
}
