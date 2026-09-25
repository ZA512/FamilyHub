import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { loadConfig } from '../../../packages/config/src/index.js';
import { decryptRefreshToken, encryptRefreshToken, refreshAccessToken, synchronizeMember } from './music-spotify.js';

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

describe('Spotify synchronization lease', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves PostgreSQL microseconds when checking the connection and clearing the lease', async () => {
    const connectedAt = '2026-09-25 15:56:22.307456+00';
    const startedAt = '2026-09-25 15:56:22.308789+00';
    const queries: { sql: string; values: unknown[] | undefined }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => url.includes('/api/token') ? { access_token: 'access' } : { items: [], next: null },
    })));
    const client = { query: vi.fn(async (sql: string, values?: unknown[]) => {
      queries.push({ sql, values });
      if (sql.includes('FOR UPDATE')) {
        return { rowCount: values?.[1] === connectedAt && values?.[2] === startedAt ? 1 : 0, rows: [] };
      }
      return { rowCount: 1, rows: [] };
    }), release: vi.fn() };
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.startsWith('UPDATE spotify_connection SET sync_started_at')) {
        expect(sql).toContain('connected_at::text AS connected_at');
        expect(sql).toContain('sync_started_at::text AS sync_started_at');
        return { rowCount: 1, rows: [{ member_id: 'member-id', instance_id: 'instance-id',
          share_enabled: false, connected_at: connectedAt, sync_started_at: startedAt,
          last_successful_sync_at: null }] };
      }
      if (sql.startsWith('SELECT encrypted_refresh_token')) {
        return { rows: [{ encrypted_refresh_token: encryptRefreshToken('refresh', config) }] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    }), connect: vi.fn(async () => client) } as unknown as Pool;

    await expect(synchronizeMember(pool, config, 'member-id', true)).resolves.toEqual({ count: 0 });
    expect(queries.find(({ sql }) => sql.includes('FOR UPDATE'))?.values).toEqual([
      'member-id', connectedAt, startedAt,
    ]);
    expect(queries.at(-1)?.sql).toBe('COMMIT');
  });

  it('records a failed import against the precise connection lease', async () => {
    const connectedAt = '2026-09-25 15:56:22.307456+00';
    const startedAt = '2026-09-25 15:56:22.308789+00';
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/api/token') ? {
      ok: true, status: 200, json: async () => ({ access_token: 'access' }),
    } : { ok: false, status: 403 }));
    const pool = { query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('UPDATE spotify_connection SET sync_started_at')) {
        return { rowCount: 1, rows: [{ member_id: 'member-id', instance_id: 'instance-id',
          share_enabled: false, connected_at: connectedAt, sync_started_at: startedAt,
          last_successful_sync_at: null }] };
      }
      if (sql.startsWith('SELECT encrypted_refresh_token')) {
        return { rows: [{ encrypted_refresh_token: encryptRefreshToken('refresh', config) }] };
      }
      if (sql.startsWith('UPDATE spotify_connection SET last_sync_at')) {
        expect(values).toEqual(['member-id', 'SPOTIFY_FORBIDDEN', connectedAt, startedAt]);
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`Unexpected pool query: ${sql}`);
    }) } as unknown as Pool;

    await expect(synchronizeMember(pool, config, 'member-id', true)).rejects.toMatchObject({
      code: 'SPOTIFY_FORBIDDEN',
    });
    expect(pool.query).toHaveBeenCalledTimes(3);
  });
});
