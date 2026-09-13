import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard } from './auth.js';

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export type AuditLogEntry = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: Record<string, unknown>;
  actorName: string | null;
  createdAt: string;
};

type AuditLogRow = Omit<AuditLogEntry, 'createdAt'> & { createdAt: Date };

export async function registerAdminRoutes(app: FastifyInstance, pool: Pool) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/admin/audit-log', { preHandler: requireSession }, async (request, reply) => {
    if (request.session?.role !== 'ADMIN') return reply.code(403).send({ error: 'ADMIN_REQUIRED' });
    const parsed = auditQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });

    const result = await pool.query<AuditLogRow>(
      `SELECT l.id, l.action, l.target_type AS "targetType",
                l.target_id AS "targetId", l.details,
                u.first_name AS "actorName", l.created_at AS "createdAt"
         FROM admin_audit_log l
         LEFT JOIN instance_member m ON m.id = l.actor_member_id
         LEFT JOIN app_user u ON u.id = m.user_id
         WHERE l.instance_id = $1
         ORDER BY l.created_at DESC, l.id DESC
         LIMIT $2`,
      [request.session.instanceId, parsed.data.limit],
    );
    return {
      entries: result.rows.map((entry) => ({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  });
}
