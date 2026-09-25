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

  it('exige une configuration VAPID complète', () => {
    expect(() => loadConfig({ ...baseEnvironment, VAPID_PUBLIC_KEY: 'a'.repeat(50) })).toThrow(
      /trois paramètres VAPID/,
    );
  });

  it('valide une configuration SMTP complète', () => {
    const config = loadConfig({
      ...baseEnvironment,
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_SECURE: 'true',
      SMTP_USER: 'familyhub',
      SMTP_PASSWORD: 'secret',
      SMTP_FROM: 'FamilyHub <familyhub@example.com>',
    });
    expect(config.SMTP_PORT).toBe(465);
    expect(config.SMTP_SECURE).toBe(true);
  });

  it('refuse une configuration SMTP partielle', () => {
    expect(() =>
      loadConfig({ ...baseEnvironment, SMTP_HOST: 'smtp.example.com' }),
    ).toThrow(/SMTP_FROM/);
  });

  it('exige une configuration Spotify complète et un retour autorisé', () => {
    expect(() => loadConfig({ ...baseEnvironment, SPOTIFY_CLIENT_ID: 'client' })).toThrow(
      /quatre paramètres Spotify/,
    );
    expect(() => loadConfig({ ...baseEnvironment,
      SPOTIFY_CLIENT_ID: 'client', SPOTIFY_CLIENT_SECRET: 'secret',
      SPOTIFY_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
      SPOTIFY_REDIRECT_URI: 'http://localhost:3000/api/v1/music/spotify/callback',
    })).toThrow(/loopback/);
    const valid = loadConfig({ ...baseEnvironment,
      FAMILYHUB_ORIGIN: 'http://127.0.0.1:3000',
      SPOTIFY_CLIENT_ID: 'client', SPOTIFY_CLIENT_SECRET: 'secret',
      SPOTIFY_TOKEN_ENCRYPTION_KEY: 'a'.repeat(64),
      SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/api/v1/music/spotify/callback',
    });
    expect(valid.SPOTIFY_CLIENT_ID).toBe('client');
  });
});
