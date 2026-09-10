import type { AppConfig } from '@familyhub/config';
import type { SessionContext } from './auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
  }

  interface FastifyRequest {
    session?: SessionContext;
  }
}
