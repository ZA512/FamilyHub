import { loadConfig } from '@familyhub/config';

import { buildApp } from './app.js';

const config = loadConfig();
const app = await buildApp(config);

const shutdown = async (signal: NodeJS.Signals) => {
  app.log.info({ signal }, 'Arrêt de FamilyHub.');
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
