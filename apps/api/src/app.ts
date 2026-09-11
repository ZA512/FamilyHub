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

import { registerRoutes } from './routes.js';

export async function buildApp(config: AppConfig) {
  const app = Fastify({
    logger: { level: config.LOG_LEVEL },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 1_048_576,
  });
  const pool = createPool(config.DATABASE_URL);

  app.decorate('config', config);
  app.decorateRequest('session', undefined);

  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: true, max: 200, timeWindow: '1 minute' });
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

  await registerRoutes(app, pool, config);

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
