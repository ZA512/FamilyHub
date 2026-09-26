import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import type { AppConfig } from '@familyhub/config';
import type { Pool, PoolClient } from 'pg';
import { weekStart } from './music-library.js';

export const SPOTIFY_SCOPES = 'user-library-read user-read-playback-state user-modify-playback-state';

export type SpotifyTrack = {
  id: string;
  uri: string;
  name: string;
  external_urls?: { spotify?: string };
  duration_ms: number;
  explicit: boolean;
  album?: { name?: string; images?: { url: string }[] };
  artists: { id: string; uri: string; name: string; external_urls?: { spotify?: string } }[];
};
export type SavedTrack = { added_at: string; track: SpotifyTrack | null };

export async function purgeOrphanedMusic(client: PoolClient) {
  await client.query(`DELETE FROM spotify_track t WHERE NOT EXISTS (
    SELECT 1 FROM member_saved_track s WHERE s.track_id=t.id) AND NOT EXISTS (
    SELECT 1 FROM weekly_music_mix_item i WHERE i.track_id=t.id) AND NOT EXISTS (
    SELECT 1 FROM music_recommendation r WHERE r.track_id=t.id AND r.expires_at>now())`);
  await client.query(`DELETE FROM spotify_artist a WHERE NOT EXISTS (
    SELECT 1 FROM spotify_track_artist ta WHERE ta.artist_id=a.id) AND NOT EXISTS (
    SELECT 1 FROM music_recommendation r WHERE r.artist_id=a.id AND r.expires_at>now())`);
}

export class SpotifyFailure extends Error {
  constructor(public code: string, public status = 503) {
    super(code);
  }
}

export function spotifyConfigured(config: AppConfig): boolean {
  return Boolean(config.SPOTIFY_CLIENT_ID && config.SPOTIFY_CLIENT_SECRET &&
    config.SPOTIFY_TOKEN_ENCRYPTION_KEY && config.SPOTIFY_REDIRECT_URI);
}

export function encryptRefreshToken(token: string, config: AppConfig): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config.SPOTIFY_TOKEN_ENCRYPTION_KEY!, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptRefreshToken(value: string, config: AppConfig): string {
  const [iv, tag, ciphertext] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext || iv.length !== 12 || tag.length !== 16) {
    throw new SpotifyFailure('CONNECTION_INVALID');
  }
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config.SPOTIFY_TOKEN_ENCRYPTION_KEY!, 'hex'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

type TokenResponse = { access_token: string; refresh_token?: string; scope?: string };

async function tokenRequest(config: AppConfig, fields: Record<string, string>): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${config.SPOTIFY_CLIENT_ID}:${config.SPOTIFY_CLIENT_SECRET}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(fields),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new SpotifyFailure('SPOTIFY_UNAVAILABLE');
  }
  if (!response.ok) {
    const body = response.status === 400 ? await response.json().catch(() => null) as { error?: string } | null : null;
    if (body?.error === 'invalid_grant') throw new SpotifyFailure('SPOTIFY_REAUTHORIZE', 401);
    throw new SpotifyFailure(response.status === 400 ? 'AUTHORIZATION_FAILED' : 'SPOTIFY_UNAVAILABLE', response.status);
  }
  const data = await response.json() as TokenResponse;
  if (!data.access_token) throw new SpotifyFailure('SPOTIFY_UNAVAILABLE');
  return data;
}

export function exchangeCode(config: AppConfig, code: string) {
  return tokenRequest(config, { grant_type: 'authorization_code', code,
    redirect_uri: config.SPOTIFY_REDIRECT_URI! });
}

const pendingRefreshes = new Map<string, Promise<string>>();

async function refreshAccessTokenOnce(pool: Pool, config: AppConfig, memberId: string): Promise<string> {
  const result = await pool.query<{ encrypted_refresh_token: string }>(
    'SELECT encrypted_refresh_token FROM spotify_connection WHERE member_id = $1', [memberId]);
  if (!result.rows[0]) throw new SpotifyFailure('NOT_CONNECTED', 409);
  let token: TokenResponse;
  try {
    token = await tokenRequest(config, { grant_type: 'refresh_token',
      refresh_token: decryptRefreshToken(result.rows[0].encrypted_refresh_token, config) });
  } catch (error) {
    if (error instanceof SpotifyFailure && error.code === 'SPOTIFY_REAUTHORIZE') {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const deleted = await client.query<{ member_id: string }>(
          `DELETE FROM spotify_connection WHERE member_id=$1 AND encrypted_refresh_token=$2
           RETURNING member_id`, [memberId, result.rows[0].encrypted_refresh_token]);
        if (deleted.rowCount) {
          await client.query('DELETE FROM member_saved_track WHERE member_id=$1', [memberId]);
          await client.query('DELETE FROM spotify_oauth_state WHERE member_id=$1', [memberId]);
          await client.query(`DELETE FROM weekly_music_mix mix WHERE EXISTS (
            SELECT 1 FROM weekly_music_mix_item i WHERE i.mix_id=mix.id AND i.source_member_id=$1)`, [memberId]);
          await purgeOrphanedMusic(client);
        }
        await client.query('COMMIT');
      } catch (cleanupError) {
        await client.query('ROLLBACK');
        throw cleanupError;
      } finally { client.release(); }
    }
    throw error;
  }
  if (token.refresh_token) {
    await pool.query('UPDATE spotify_connection SET encrypted_refresh_token = $2 WHERE member_id = $1',
      [memberId, encryptRefreshToken(token.refresh_token, config)]);
  }
  return token.access_token;
}

export function refreshAccessToken(pool: Pool, config: AppConfig, memberId: string): Promise<string> {
  const pending = pendingRefreshes.get(memberId);
  if (pending) return pending;
  const next = refreshAccessTokenOnce(pool, config, memberId);
  pendingRefreshes.set(memberId, next);
  void next.finally(() => {
    if (pendingRefreshes.get(memberId) === next) pendingRefreshes.delete(memberId);
  }).catch(() => undefined);
  return next;
}

export async function spotifyApi<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`https://api.spotify.com/v1${path}`, {
        ...init,
        headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new SpotifyFailure('SPOTIFY_UNAVAILABLE');
    }
    if (response.status === 429) {
      const body = await response.json().catch(() => null) as { error?: { reason?: string } } | null;
      const reason = body?.error?.reason;
      if (reason === 'QUOTA_EXCEEDED') throw new SpotifyFailure('SPOTIFY_QUOTA_EXCEEDED', 429);
      const seconds = Number(response.headers.get('retry-after') ?? '1');
      if (attempt === 2 || !Number.isFinite(seconds) || seconds > 30) {
        throw new SpotifyFailure('SPOTIFY_RATE_LIMITED', 429);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(1, seconds) * 1000));
      continue;
    }
    if (response.status === 401) throw new SpotifyFailure('SPOTIFY_REAUTHORIZE', 401);
    if (response.status === 403) throw new SpotifyFailure('SPOTIFY_FORBIDDEN', 403);
    if (response.status === 404) throw new SpotifyFailure('NO_ACTIVE_DEVICE', 404);
    if (!response.ok) throw new SpotifyFailure('SPOTIFY_UNAVAILABLE', response.status);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
  throw new SpotifyFailure('SPOTIFY_RATE_LIMITED', 429);
}

async function persistSavedTracks(client: PoolClient, memberId: string, tracks: SavedTrack[]) {
  const ids: string[] = [];
  const imageUrl = (value: string | undefined) => {
    if (!value) return null;
    try { return new URL(value).protocol === 'https:' ? value : null; }
    catch { return null; }
  };
  for (const item of tracks) {
    const track = item.track;
    if (!track?.id || !/^[A-Za-z0-9]+$/.test(track.id) ||
        track.uri !== `spotify:track:${track.id}` || !Number.isFinite(Date.parse(item.added_at))) continue;
    ids.push(track.id);
    await client.query(
      `INSERT INTO spotify_track (id, name, spotify_uri, spotify_url, album_name, album_image_url, duration_ms, explicit)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, spotify_url=EXCLUDED.spotify_url,
         album_name=EXCLUDED.album_name, album_image_url=EXCLUDED.album_image_url,
         duration_ms=EXCLUDED.duration_ms, explicit=EXCLUDED.explicit`,
      [track.id, track.name, track.uri, `https://open.spotify.com/track/${track.id}`,
        track.album?.name ?? null, imageUrl(track.album?.images?.[0]?.url),
        track.duration_ms ?? 0, track.explicit ?? false]);
    await client.query('DELETE FROM spotify_track_artist WHERE track_id=$1', [track.id]);
    for (const artist of track.artists ?? []) {
      if (!artist.id || !/^[A-Za-z0-9]+$/.test(artist.id)) continue;
      await client.query(
        `INSERT INTO spotify_artist (id, name, spotify_uri, spotify_url) VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, spotify_url=EXCLUDED.spotify_url`,
        [artist.id, artist.name, `spotify:artist:${artist.id}`,
          `https://open.spotify.com/artist/${artist.id}`]);
      await client.query(
        'INSERT INTO spotify_track_artist (track_id, artist_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [track.id, artist.id]);
    }
    await client.query(
      `INSERT INTO member_saved_track (member_id, track_id, spotify_added_at)
       VALUES ($1,$2,$3) ON CONFLICT (member_id, track_id)
       DO UPDATE SET spotify_added_at=EXCLUDED.spotify_added_at, last_seen_at=now()`,
      [memberId, track.id, item.added_at]);
  }
  await client.query('DELETE FROM member_saved_track WHERE member_id=$1 AND NOT (track_id = ANY($2::text[]))',
    [memberId, ids]);
}

export async function synchronizeMember(pool: Pool, config: AppConfig, memberId: string, force = false) {
  // Keep PostgreSQL's microseconds; node-postgres converts timestamptz to a millisecond Date.
  const lock = await pool.query<{ member_id: string; instance_id: string; share_enabled: boolean;
    connected_at: string; sync_started_at: string; last_successful_sync_at: Date | null }>(
    `UPDATE spotify_connection SET sync_started_at=now(), sync_error=NULL
     WHERE member_id=$1 AND (sync_started_at IS NULL OR sync_started_at < now()-interval '30 minutes')
       AND ($2::boolean OR last_sync_at IS NULL OR last_sync_at < now()-interval '15 minutes')
     RETURNING member_id, instance_id, share_enabled, connected_at::text AS connected_at,
       sync_started_at::text AS sync_started_at,
       last_successful_sync_at`, [memberId, force]);
  if (!lock.rowCount) throw new SpotifyFailure('SYNC_COOLDOWN', 409);
  const lease = lock.rows[0]!;
  try {
    const token = await refreshAccessToken(pool, config, memberId);
    const tracks: SavedTrack[] = [];
    let offset = 0;
    for (;;) {
      const page = await spotifyApi<{ items: SavedTrack[]; next: string | null }>(
        token, `/me/tracks?limit=50&offset=${offset}`);
      if (!Array.isArray(page.items)) throw new SpotifyFailure('SPOTIFY_UNAVAILABLE');
      tracks.push(...page.items);
      if (!page.next) break;
      offset += page.items.length;
      if (!page.items.length || offset > 100_000) throw new SpotifyFailure('SPOTIFY_UNAVAILABLE');
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const connected = await client.query(
        'SELECT member_id FROM spotify_connection WHERE member_id=$1 AND connected_at=$2 AND sync_started_at=$3 FOR UPDATE',
        [memberId, lease.connected_at, lease.sync_started_at]);
      if (!connected.rowCount) throw new SpotifyFailure('NOT_CONNECTED', 409);
      await persistSavedTracks(client, memberId, tracks);
      await client.query(`UPDATE spotify_connection SET last_sync_at=now(), last_successful_sync_at=now(),
        sync_started_at=NULL, sync_error=NULL WHERE member_id=$1`, [memberId]);
      await client.query(`DELETE FROM weekly_music_mix mix WHERE mix.instance_id=(
          SELECT instance_id FROM spotify_connection WHERE member_id=$1)
        AND EXISTS (SELECT 1 FROM weekly_music_mix_item i WHERE i.mix_id=mix.id
          AND i.source_member_id=$1 AND NOT EXISTS (
            SELECT 1 FROM member_saved_track s WHERE s.member_id=$1 AND s.track_id=i.track_id))`, [memberId]);
      if (!lease.last_successful_sync_at && lease.share_enabled) {
        await client.query('DELETE FROM weekly_music_mix WHERE instance_id=$1 AND week_start=$2',
          [lease.instance_id, weekStart(new Date(), config.FAMILYHUB_TIMEZONE)]);
      }
      await purgeOrphanedMusic(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { count: tracks.length };
  } catch (error) {
    const code = error instanceof SpotifyFailure ? error.code : 'SYNC_FAILED';
    await pool.query(`UPDATE spotify_connection SET last_sync_at=now(), sync_started_at=NULL, sync_error=$2
      WHERE member_id=$1 AND connected_at=$3 AND sync_started_at=$4`,
      [memberId, code, lease.connected_at, lease.sync_started_at]);
    throw error;
  }
}
