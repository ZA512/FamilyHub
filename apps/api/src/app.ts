import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { AppConfig } from '@familyhub/config';
import { createPool } from '@familyhub/database';
import Fastify from 'fastify';

import { digest, SESSION_COOKIE } from './auth.js';
import { registerRoutes } from './routes.js';
import {
  DEFAULT_API_RATE_LIMIT_PER_MINUTE,
  readApiRateLimit,
  type RuntimeSettings,
} from './runtime-settings.js';

const IP_RATE_LIMIT_PATHS = [
  '/api/v1/setup',
  '/api/v1/auth/login',
  '/api/v1/invitations/inspect',
  '/api/v1/invitations/accept',
  '/api/v1/uploads/',
];

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });
  const pool = createPool(config.DATABASE_URL);
  const runtimeSettings: RuntimeSettings = {
    apiRateLimitPerMinute: DEFAULT_API_RATE_LIMIT_PER_MINUTE,
  };

  app.decorate('config', config);
  app.decorateRequest('session', undefined);
  app.addContentTypeParser('application/octet-stream', (_request, payload, done) => {
    done(null, payload);
  });

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(helmet, { contentSecurityPolicy: false });
  try {
    const result = await pool.query<{ api_rate_limit: unknown }>(
      `SELECT settings -> 'apiRateLimitPerMinute' AS api_rate_limit
       FROM module_config WHERE module_key = 'settings' LIMIT 1`,
    );
    runtimeSettings.apiRateLimitPerMinute = readApiRateLimit(result.rows[0]?.api_rate_limit);
  } catch (error) {
    app.log.warn({ error }, 'Could not load runtime settings; safe defaults are active.');
  }
  await app.register(rateLimit, {
    global: true,
    max: () => runtimeSettings.apiRateLimitPerMinute,
    timeWindow: '1 minute',
    allowList: (request) =>
      !request.url.startsWith('/api/v1/') || request.url.startsWith('/api/v1/health/'),
    keyGenerator: (request) => {
      if (IP_RATE_LIMIT_PATHS.some((path) => request.url.startsWith(path))) {
        return `ip:${request.ip}`;
      }
      const sessionToken = request.cookies[SESSION_COOKIE];
      return sessionToken ? `session:${digest(sessionToken)}` : `ip:${request.ip}`;
    },
    errorResponseBuilder: (_request, context) => ({
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Trop de requêtes. Réessayez dans quelques instants.',
      retryAfter: context.after,
    }),
  });
  await app.register(websocket, {
    options: { maxPayload: 65_536, perMessageDeflate: false },
  });

  if (config.NODE_ENV === 'development') {
    await app.register(cors, { origin: config.FAMILYHUB_ORIGIN, credentials: true });
  }

  app.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && origin !== config.FAMILYHUB_ORIGIN) {
      return reply.code(403).send({ error: 'ORIGIN_NOT_ALLOWED' });
    }
  });

  await registerRoutes(app, pool, config, runtimeSettings);

  const webRoot = resolve(import.meta.dirname, '../../web/dist');
  try {
    await access(webRoot);
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      wildcard: false,
      setHeaders(response, filePath) {
        const assetsRoot = resolve(webRoot, 'assets');
        if (filePath.startsWith(assetsRoot)) {
          response.header('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          response.header('Cache-Control', 'no-cache');
        }
      },
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  } catch {
    app.log.warn({ webRoot }, 'Frontend bundle not found; API-only mode enabled.');
  }

  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
