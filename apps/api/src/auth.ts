import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AppConfig } from '@familyhub/config';
import type { CurrentMember } from '@familyhub/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from 'pg';

export const SESSION_COOKIE = 'familyhub_session';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;

export type SessionContext = CurrentMember & {
  sessionId: string;
  csrfHash: string;
};

export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = Buffer.from(digest(left), 'hex');
  const rightDigest = Buffer.from(digest(right), 'hex');
  return timingSafeEqual(leftDigest, rightDigest);
}

export function deriveCsrfToken(sessionToken: string, config: AppConfig): string {
  return createHmac('sha256', config.SESSION_SECRET).update(sessionToken).digest('base64url');
}

function constantTimeDigestEqual(value: string, expectedDigest: string): boolean {
  const valueDigest = Buffer.from(digest(value), 'hex');
  const expected = Buffer.from(expectedDigest, 'hex');
  return valueDigest.length === expected.length && timingSafeEqual(valueDigest, expected);
}

export async function createSession(
  database: Queryable,
  memberId: string,
  config: AppConfig,
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = deriveCsrfToken(token, config);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1_000);

  await database.query(
    `INSERT INTO session (member_id, token_hash, csrf_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [memberId, digest(token), digest(csrfToken), expiresAt],
  );

  return { token, csrfToken, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, config: AppConfig): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: new URL(config.FAMILYHUB_ORIGIN).protocol === 'https:',
    sameSite: 'lax',
    maxAge: config.SESSION_TTL_HOURS * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig): void {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: new URL(config.FAMILYHUB_ORIGIN).protocol === 'https:',
    sameSite: 'lax',
  });
}

export function createSessionGuard(pool: Pool) {
  return async function requireSession(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      return reply.code(401).send({ error: 'AUTHENTICATION_REQUIRED' });
    }

    const result = await pool.query<{
      session_id: string;
      csrf_hash: string;
      member_id: string;
      user_id: string;
      instance_id: string;
      instance_name: string;
      first_name: string;
      email: string;
      role: 'ADMIN' | 'MEMBER';
    }>(
      `SELECT s.id AS session_id, s.csrf_hash, m.id AS member_id, m.user_id,
              m.instance_id, i.name AS instance_name, u.first_name, u.email, m.role
       FROM session s
       JOIN instance_member m ON m.id = s.member_id
       JOIN instance i ON i.id = m.instance_id
       JOIN app_user u ON u.id = m.user_id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND m.status = 'ACTIVE'
       LIMIT 1`,
      [digest(token)],
    );

    const row = result.rows[0];
    if (!row) {
      clearSessionCookie(reply, request.server.config);
      return reply.code(401).send({ error: 'AUTHENTICATION_REQUIRED' });
    }

    request.session = {
      sessionId: row.session_id,
      csrfHash: row.csrf_hash,
      id: row.member_id,
      userId: row.user_id,
      instanceId: row.instance_id,
      instanceName: row.instance_name,
      firstName: row.first_name,
      email: row.email,
      role: row.role,
    };
  };
}

export async function requireCsrf(request: FastifyRequest, reply: FastifyReply) {
  const csrfToken = request.headers['x-csrf-token'];
  if (
    !request.session ||
    typeof csrfToken !== 'string' ||
    !constantTimeDigestEqual(csrfToken, request.session.csrfHash)
  ) {
    return reply.code(403).send({ error: 'CSRF_TOKEN_INVALID' });
  }
}
