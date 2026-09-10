import { describe, expect, it } from 'vitest';

import { loadConfig } from './index.js';

const baseEnvironment = {
  DATABASE_URL: 'postgresql://familyhub:long-database-password@localhost:5432/familyhub',
  SESSION_SECRET: 'a'.repeat(32),
  SETUP_TOKEN: 'b'.repeat(32),
};

describe('loadConfig', () => {
  it('charge une configuration de développement minimale', () => {
    const config = loadConfig(baseEnvironment);
    expect(config.PORT).toBe(3001);
    expect(config.TRUST_PROXY).toBe(false);
  });

  it('refuse les secrets identiques', () => {
    expect(() =>
      loadConfig({ ...baseEnvironment, SETUP_TOKEN: baseEnvironment.SESSION_SECRET }),
    ).toThrow(/doivent être différents/);
  });

  it('impose HTTPS en production hors localhost', () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        NODE_ENV: 'production',
        FAMILYHUB_ORIGIN: 'http://familyhub.lan',
      }),
    ).toThrow(/HTTPS/);
  });

  it('refuse le mot de passe PostgreSQL d’exemple en production', () => {
    expect(() =>
      loadConfig({
        ...baseEnvironment,
        NODE_ENV: 'production',
        FAMILYHUB_ORIGIN: 'https://familyhub.example',
        DATABASE_URL: 'postgresql://familyhub:change-me@db:5432/familyhub',
      }),
    ).toThrow(/DATABASE_URL/);
  });
});
