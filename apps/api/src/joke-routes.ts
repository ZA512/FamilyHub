import type { AdminJokesResponse, JokeModerationResponse } from '@familyhub/contracts';
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, requireCsrf } from './auth.js';
import { jokeCatalog, readJokeState } from './daily-joke.js';

const moderationSchema = z.object({ enabled: z.boolean() }).strict();

export async function registerJokeRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/jokes/daily', { preHandler: requireSession }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { dailyJoke } = await readJokeState(pool, request.session!.instanceId);
    return { dailyJoke };
  });

  app.get('/api/v1/admin/jokes', { preHandler: requireSession }, async (request, reply) => {
    if (request.session!.role !== 'ADMIN') return reply.code(403).send({ error: 'ADMIN_REQUIRED' });
    reply.header('Cache-Control', 'no-store');
    const { disabledIds, dailyJoke } = await readJokeState(pool, request.session!.instanceId);
    return {
      jokes: jokeCatalog.map((joke) => ({ ...joke, enabled: !disabledIds.has(joke.id) })),
      dailyJoke,
    } satisfies AdminJokesResponse;
  });

  app.patch(
    '/api/v1/admin/jokes/:id',
    { preHandler: [requireSession, requireCsrf] },
    async (request, reply) => {
      if (request.session!.role !== 'ADMIN')
        return reply.code(403).send({ error: 'ADMIN_REQUIRED' });
      const parsed = moderationSchema.safeParse(request.body);
      const id = (request.params as { id: string }).id;
      const joke = jokeCatalog.find((entry) => entry.id === id);
      if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
      if (!joke) return reply.code(404).send({ error: 'JOKE_NOT_FOUND' });

      const instanceId = request.session!.instanceId;
      if (parsed.data.enabled) {
        await pool.query('DELETE FROM disabled_joke WHERE instance_id = $1 AND joke_id = $2', [
          instanceId,
          id,
        ]);
      } else {
        await pool.query(
          `INSERT INTO disabled_joke (instance_id, joke_id, disabled_by)
         VALUES ($1, $2, $3) ON CONFLICT (instance_id, joke_id) DO NOTHING`,
          [instanceId, id, request.session!.id],
        );
      }
      reply.header('Cache-Control', 'no-store');
      const { dailyJoke } = await readJokeState(pool, instanceId);
      return {
        joke: { ...joke, enabled: parsed.data.enabled },
        dailyJoke,
      } satisfies JokeModerationResponse;
    },
  );
}
