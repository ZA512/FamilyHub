import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { loadConfig } from '@familyhub/config';
import { decryptRefreshToken, encryptRefreshToken, refreshAccessToken } from './music-spotify.js';

const config = loadConfig({
  DATABASE_URL: 'postgresql://familyhub:long-database-password@localhost:5432/familyhub',
  SESSION_SECRET: 'a'.repeat(32), SETUP_TOKEN: 'b'.repeat(32),
  FAMILYHUB_ORIGIN: 'http://127.0.0.1:3000',
  SPOTIFY_CLIENT_ID: 'client', SPOTIFY_CLIENT_SECRET: 'secret',
  SPOTIFY_TOKEN_ENCRYPTION_KEY: '1'.repeat(64),
  SPOTIFY_REDIRECT_URI: 'http://127.0.0.1:3000/api/v1/music/spotify/callback',
});

describe('Spotify credential encryption', () => {
  it('uses unique authenticated ciphertext and rejects tampering', () => {
    const first = encryptRefreshToken('refresh-secret', config);
    const second = encryptRefreshToken('refresh-secret', config);
    expect(first).not.toBe(second);
    expect(first).not.toContain('refresh-secret');
    expect(decryptRefreshToken(first, config)).toBe('refresh-secret');
    const pieces = first.split('.');
    pieces[1] = 'A'.repeat(pieces[1]!.length);
    expect(() => decryptRefreshToken(pieces.join('.'), config)).toThrow();
  });
});

describe('Spotify refresh token expiry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('removes an invalid refresh token and its imported music', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }),
    }));
    const queries: string[] = [];
    const encrypted = encryptRefreshToken('expired-token', config);
    const client = { query: vi.fn(async (sql: string) => {
      queries.push(sql);
      return { rowCount: sql.startsWith('DELETE FROM spotify_connection') ? 1 : 0, rows: [] };
    }), release: vi.fn() };
    const pool = { query: vi.fn(async () => ({ rows: [{ encrypted_refresh_token: encrypted }] })),
      connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(refreshAccessToken(pool, config, 'member-id')).rejects.toMatchObject({
      code: 'SPOTIFY_REAUTHORIZE', status: 401,
    });
    expect(queries.some((sql) => sql.includes('DELETE FROM member_saved_track'))).toBe(true);
    expect(queries.some((sql) => sql.includes('DELETE FROM spotify_connection'))).toBe(true);
    expect(queries.at(-1)).toBe('COMMIT');
  });
});
