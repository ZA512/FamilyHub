import { randomBytes } from 'node:crypto';

import type { AppConfig } from '@familyhub/config';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool } from 'pg';
import { z } from 'zod';

import { createSessionGuard, digest, requireCsrf } from './auth.js';
import { getWeeklyMix, loadLibrary, weekStart } from './music-library.js';
import {
  encryptRefreshToken, exchangeCode, purgeOrphanedMusic, refreshAccessToken, SPOTIFY_SCOPES,
  SpotifyFailure, spotifyApi, spotifyConfigured, synchronizeMember,
} from './music-spotify.js';

const idParams = z.object({ id: z.string().min(1).max(100) });
const memberParams = z.object({ id: z.string().uuid() });
const playBody = z.object({ uris: z.array(z.string().regex(/^spotify:track:[A-Za-z0-9]+$/)).min(1).max(100) });
const shareBody = z.object({ shareEnabled: z.boolean() });
const callbackQuery = z.object({ state: z.string().min(20).max(200),
  code: z.string().max(2048).optional(), error: z.string().max(100).optional() });

function sendMusicError(error: unknown, reply: FastifyReply) {
  if (error instanceof SpotifyFailure) return reply.code(error.status).send({ error: error.code });
  throw error;
}

async function clearCurrentMix(pool: Pool, instanceId: string, timeZone: string, memberId?: string) {
  await pool.query(`DELETE FROM weekly_music_mix mix WHERE instance_id=$1
    AND (week_start >= $2::date OR ($3::uuid IS NOT NULL AND EXISTS (
      SELECT 1 FROM weekly_music_mix_item i WHERE i.mix_id=mix.id AND i.source_member_id=$3)))`,
    [instanceId, weekStart(new Date(), timeZone), memberId ?? null]);
}

export async function registerMusicRoutes(app: FastifyInstance, pool: Pool, config: AppConfig) {
  const requireSession = createSessionGuard(pool);

  app.get('/api/v1/music/spotify/status', { preHandler: requireSession }, async (request) => {
    const result = await pool.query<{
      spotify_display_name: string | null; share_enabled: boolean; connected_at: Date;
      last_sync_at: Date | null; last_successful_sync_at: Date | null;
      sync_started_at: Date | null; sync_error: string | null;
    }>(`SELECT spotify_display_name, share_enabled, connected_at, last_sync_at,
              last_successful_sync_at, sync_started_at, sync_error
       FROM spotify_connection WHERE member_id=$1 AND instance_id=$2`,
      [request.session!.id, request.session!.instanceId]);
    const row = result.rows[0];
    return { configured: spotifyConfigured(config), connection: row ? {
      displayName: row.spotify_display_name, shareEnabled: row.share_enabled,
      connectedAt: row.connected_at.toISOString(), lastSyncAt: row.last_sync_at?.toISOString() ?? null,
      lastSuccessfulSyncAt: row.last_successful_sync_at?.toISOString() ?? null,
      syncing: Boolean(row.sync_started_at && Date.now() - row.sync_started_at.getTime() < 30 * 60_000),
      syncError: row.sync_error,
    } : null };
  });

  app.post('/api/v1/music/spotify/connect', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!spotifyConfigured(config)) return reply.code(503).send({ error: 'SPOTIFY_NOT_CONFIGURED' });
    const state = randomBytes(32).toString('base64url');
    await pool.query('DELETE FROM spotify_oauth_state WHERE expires_at < now()');
    await pool.query(`INSERT INTO spotify_oauth_state (state_hash, member_id, session_id, expires_at)
      VALUES ($1,$2,$3,now()+interval '10 minutes')`,
    [digest(state), request.session!.id, request.session!.sessionId]);
    const url = new URL('https://accounts.spotify.com/authorize');
    url.search = new URLSearchParams({ client_id: config.SPOTIFY_CLIENT_ID!, response_type: 'code',
      redirect_uri: config.SPOTIFY_REDIRECT_URI!, scope: SPOTIFY_SCOPES, state,
      show_dialog: 'true' }).toString();
    return { authorizationUrl: url.toString() };
  });

  app.get('/api/v1/music/spotify/callback', { preHandler: requireSession, logLevel: 'silent' }, async (request, reply) => {
    const parsed = callbackQuery.safeParse(request.query);
    if (!parsed.success) return reply.redirect('/music?spotify=invalid_state');
    const state = await pool.query<{ member_id: string; session_id: string }>(
      `DELETE FROM spotify_oauth_state WHERE state_hash=$1 AND expires_at>now()
       RETURNING member_id, session_id`, [digest(parsed.data.state)]);
    if (!state.rows[0] || state.rows[0].member_id !== request.session!.id ||
        state.rows[0].session_id !== request.session!.sessionId) {
      return reply.redirect('/music?spotify=invalid_state');
    }
    if (parsed.data.error || !parsed.data.code) return reply.redirect('/music?spotify=cancelled');
    try {
      const tokens = await exchangeCode(config, parsed.data.code);
      const profile = await spotifyApi<{ account_id?: string; id?: string; display_name?: string | null }>(
        tokens.access_token, '/me');
      const accountId = profile.account_id ?? profile.id;
      if (!accountId || !tokens.refresh_token ||
          !SPOTIFY_SCOPES.split(' ').every((scope) => (tokens.scope ?? SPOTIFY_SCOPES).split(' ').includes(scope))) {
        throw new SpotifyFailure('AUTHORIZATION_FAILED', 403);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query<{ spotify_account_id: string }>(
          'SELECT spotify_account_id FROM spotify_connection WHERE member_id=$1 FOR UPDATE', [request.session!.id]);
        if (existing.rows[0] && existing.rows[0].spotify_account_id !== accountId) {
          await client.query('DELETE FROM member_saved_track WHERE member_id=$1', [request.session!.id]);
        }
        await client.query(
          `INSERT INTO spotify_connection (member_id, instance_id, spotify_account_id, spotify_display_name,
             encrypted_refresh_token, granted_scopes, share_enabled)
           VALUES ($1,$2,$3,$4,$5,$6,false)
           ON CONFLICT (member_id) DO UPDATE SET spotify_account_id=EXCLUDED.spotify_account_id,
             spotify_display_name=EXCLUDED.spotify_display_name,
             encrypted_refresh_token=EXCLUDED.encrypted_refresh_token,
             granted_scopes=EXCLUDED.granted_scopes, share_enabled=false, sync_error=NULL,
             connected_at=now(), sync_started_at=NULL, last_sync_at=NULL, last_successful_sync_at=NULL`,
          [request.session!.id, request.session!.instanceId, accountId,
            profile.display_name ?? null, encryptRefreshToken(tokens.refresh_token, config),
            tokens.scope ?? SPOTIFY_SCOPES]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      await clearCurrentMix(pool, request.session!.instanceId, config.FAMILYHUB_TIMEZONE, request.session!.id);
      void synchronizeMember(pool, config, request.session!.id, true).catch((error: unknown) => {
        app.log.warn({ code: error instanceof SpotifyFailure ? error.code : 'SYNC_FAILED' }, 'Spotify initial sync failed');
      });
      return reply.redirect('/music?spotify=connected');
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error && error.code === '23505'
        ? 'account_in_use' : 'connection_failed';
      app.log.warn({ code }, 'Spotify connection failed');
      return reply.redirect(`/music?spotify=${code}`);
    }
  });

  app.patch('/api/v1/music/settings', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = shareBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const result = await pool.query(
      'UPDATE spotify_connection SET share_enabled=$3 WHERE member_id=$1 AND instance_id=$2 RETURNING member_id',
      [request.session!.id, request.session!.instanceId, parsed.data.shareEnabled]);
    if (!result.rowCount) return reply.code(409).send({ error: 'NOT_CONNECTED' });
    await clearCurrentMix(pool, request.session!.instanceId, config.FAMILYHUB_TIMEZONE, request.session!.id);
    return { shareEnabled: parsed.data.shareEnabled };
  });

  app.post('/api/v1/music/spotify/disconnect', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM member_saved_track WHERE member_id=$1', [request.session!.id]);
      await client.query('DELETE FROM spotify_connection WHERE member_id=$1 AND instance_id=$2',
        [request.session!.id, request.session!.instanceId]);
      await client.query('DELETE FROM spotify_oauth_state WHERE member_id=$1', [request.session!.id]);
      await client.query(`DELETE FROM weekly_music_mix mix WHERE instance_id=$1
        AND (week_start >= $2::date OR EXISTS (
          SELECT 1 FROM weekly_music_mix_item i WHERE i.mix_id=mix.id AND i.source_member_id=$3))`,
        [request.session!.instanceId, weekStart(new Date(), config.FAMILYHUB_TIMEZONE), request.session!.id]);
      await purgeOrphanedMusic(client);
      await client.query('COMMIT');
      return reply.code(204).send();
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.post('/api/v1/music/spotify/sync', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    if (!spotifyConfigured(config)) return reply.code(503).send({ error: 'SPOTIFY_NOT_CONFIGURED' });
    try {
      return await synchronizeMember(pool, config, request.session!.id);
    } catch (error) {
      return sendMusicError(error, reply);
    }
  });

  app.get('/api/v1/music/overview', { preHandler: requireSession }, async (request) => {
    const data = await loadLibrary(pool, request.session!.instanceId, request.session!.id);
    const discoveries = data.artists.filter((artist) => !data.selfArtistIds.has(artist.id))
      .sort((a, b) => b.totalTracks - a.totalTracks || b.memberIds.length - a.memberIds.length ||
        b.lastAddedAt.localeCompare(a.lastAddedAt)).slice(0, 6);
    const common = data.artists.filter((artist) => artist.memberIds.length >= 2).slice(0, 6);
    const recent = data.artists.filter((artist) =>
      Date.now() - Date.parse(artist.firstAddedAt) <= 14 * 86_400_000).slice(0, 6);
    const newForMembers = data.artists.flatMap((artist) => artist.memberFirstAddedAt.map((item) => ({
      artistId: artist.id, artistName: artist.name, memberId: item.memberId,
      memberName: data.members.find((member) => member.id === item.memberId)?.firstName ?? '',
      addedAt: item.addedAt,
    }))).filter((item) => Date.now() - Date.parse(item.addedAt) <= 14 * 86_400_000)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 6);
    return { discoveries, common, recent, members: data.members,
      newForMembers,
      activity: [
        ...recent.slice(0, 3).map((artist) => `${artist.name} est nouveau dans la famille.`),
      ] };
  });

  app.get('/api/v1/music/artists', { preHandler: requireSession }, async (request) => {
    const data = await loadLibrary(pool, request.session!.instanceId, request.session!.id);
    return { artists: data.artists, members: data.members };
  });

  app.get<{ Params: { id: string } }>('/api/v1/music/artists/:id', { preHandler: requireSession }, async (request, reply) => {
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: 'NOT_FOUND' });
    const data = await loadLibrary(pool, request.session!.instanceId, request.session!.id);
    const artist = data.artists.find((item) => item.id === parsed.data.id);
    if (!artist) return reply.code(404).send({ error: 'NOT_FOUND' });
    const tracks = data.tracks.filter((item) => item.artistIds.includes(artist.id))
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 30);
    return { artist, tracks, members: data.members };
  });

  app.get<{ Params: { id: string } }>('/api/v1/music/members/:id', { preHandler: requireSession }, async (request, reply) => {
    const parsed = memberParams.safeParse(request.params);
    if (!parsed.success) return reply.code(404).send({ error: 'NOT_FOUND' });
    const member = await pool.query<{ id: string; first_name: string; share_enabled: boolean }>(
      `SELECT m.id, u.first_name, c.share_enabled FROM instance_member m
       JOIN app_user u ON u.id=m.user_id
       JOIN spotify_connection c ON c.member_id=m.id
       WHERE m.id=$1 AND m.instance_id=$2 AND m.status='ACTIVE' AND (c.share_enabled OR m.id=$3)`,
      [parsed.data.id, request.session!.instanceId, request.session!.id]);
    if (!member.rows[0]) return reply.code(404).send({ error: 'NOT_FOUND' });
    const data = await loadLibrary(pool, request.session!.instanceId, request.session!.id);
    return { member: { id: member.rows[0].id, firstName: member.rows[0].first_name },
      discoveries: data.artists.filter((artist) => artist.memberIds.includes(parsed.data.id) &&
        !data.selfArtistIds.has(artist.id)),
      common: data.artists.filter((artist) => artist.memberIds.includes(parsed.data.id) &&
        data.selfArtistIds.has(artist.id)), members: data.members };
  });

  app.get('/api/v1/music/weekly-mix', { preHandler: requireSession }, async (request) =>
    getWeeklyMix(pool, request.session!.instanceId, config.FAMILYHUB_TIMEZONE));

  app.get('/api/v1/music/spotify/devices', { preHandler: requireSession }, async (request, reply) => {
    try {
      const token = await refreshAccessToken(pool, config, request.session!.id);
      const result = await spotifyApi<{ devices: { id: string | null; name: string;
        is_active: boolean; is_restricted: boolean }[] }>(token, '/me/player/devices');
      return { devices: result.devices.filter((item) => item.id && !item.is_restricted).map((item) => ({
        id: item.id, name: item.name, isActive: item.is_active })) };
    } catch (error) { return sendMusicError(error, reply); }
  });

  app.post('/api/v1/music/spotify/play', { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = playBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const ids = parsed.data.uris.map((uri) => uri.slice('spotify:track:'.length));
    const accessible = await pool.query<{ count: string }>(
      `SELECT count(DISTINCT t.id)::text AS count FROM spotify_track t
       JOIN member_saved_track s ON s.track_id=t.id
       JOIN instance_member m ON m.id=s.member_id AND m.instance_id=$1 AND m.status='ACTIVE'
       JOIN spotify_connection c ON c.member_id=m.id
       WHERE t.id=ANY($3::text[]) AND (c.share_enabled OR m.id=$2)`,
      [request.session!.instanceId, request.session!.id, ids]);
    if (Number(accessible.rows[0]?.count) !== new Set(ids).size) {
      return reply.code(403).send({ error: 'TRACK_NOT_ACCESSIBLE' });
    }
    try {
      const token = await refreshAccessToken(pool, config, request.session!.id);
      const result = await spotifyApi<{ devices: { id: string | null; name: string;
        is_active: boolean; is_restricted: boolean }[] }>(token, '/me/player/devices');
      const device = result.devices.find((item) => item.id && item.is_active && !item.is_restricted);
      if (!device?.id) return reply.code(409).send({ error: 'NO_ACTIVE_DEVICE' });
      await spotifyApi<void>(token, `/me/player/play?device_id=${encodeURIComponent(device.id)}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uris: parsed.data.uris }),
      });
      return { deviceName: device.name };
    } catch (error) { return sendMusicError(error, reply); }
  });

  if (spotifyConfigured(config)) {
    const timer = setInterval(() => {
      void pool.query<{ member_id: string }>(
        `SELECT member_id FROM spotify_connection WHERE
         (last_sync_at IS NULL OR last_sync_at < now()-interval '6 hours')
         AND (sync_started_at IS NULL OR sync_started_at < now()-interval '30 minutes')
         ORDER BY last_sync_at NULLS FIRST LIMIT 10`).then(async ({ rows }) => {
        for (const row of rows) {
          try { await synchronizeMember(pool, config, row.member_id, true); }
          catch (error) { app.log.warn({ code: error instanceof SpotifyFailure ? error.code : 'SYNC_FAILED' }, 'Scheduled Spotify sync failed'); }
        }
      }).catch(() => undefined);
    }, 60 * 60_000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }
}
