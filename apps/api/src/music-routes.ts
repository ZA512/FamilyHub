import { randomBytes } from 'node:crypto';

import type { AppConfig } from '@familyhub/config';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Pool, PoolClient } from 'pg';
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
const recommendationBody = z.object({
  targetType: z.enum(['ARTIST', 'TRACK']),
  targetId: z.string().regex(/^[A-Za-z0-9]+$/).max(100),
  recipientIds: z.array(z.string().uuid()).min(1).max(20)
    .refine((ids) => new Set(ids).size === ids.length),
});
const callbackQuery = z.object({ state: z.string().min(20).max(200),
  code: z.string().max(2048).optional(), error: z.string().max(100).optional() });

type MusicRecommendationRow = {
  id: string; kind: 'ARTIST' | 'TRACK'; senderName: string;
  targetId: string; targetName: string; spotifyUrl: string;
  spotifyUri: string | null; imageUrl: string | null; artistId: string | null;
  createdAt: Date;
};

async function purgeMusicRecommendations(client: Pool | PoolClient, instanceId?: string,
  recipientIds?: string[]) {
  await client.query(
    `DELETE FROM music_recommendation
     WHERE expires_at<=now() AND ($1::uuid IS NULL OR instance_id=$1)`,
    [instanceId ?? null],
  );
  await client.query(
    `DELETE FROM music_recommendation recommendation
     WHERE recommendation.id IN (
       SELECT ranked.id FROM (
         SELECT id, row_number() OVER (
           PARTITION BY recipient_member_id ORDER BY created_at DESC, id DESC
         ) AS position
         FROM music_recommendation
         WHERE ($1::uuid IS NULL OR instance_id=$1)
           AND ($2::uuid[] IS NULL OR recipient_member_id=ANY($2::uuid[]))
       ) ranked
       WHERE ranked.position>12
     )`,
    [instanceId ?? null, recipientIds ?? null],
  );
}

async function loadMusicRecommendations(pool: Pool, instanceId: string, recipientId: string) {
  await purgeMusicRecommendations(pool, instanceId, [recipientId]);
  const result = await pool.query<MusicRecommendationRow>(
    `SELECT r.id, r.kind, sender_user.first_name AS "senderName",
            CASE WHEN r.kind='ARTIST' THEN artist.id ELSE track.id END AS "targetId",
            CASE WHEN r.kind='ARTIST' THEN artist.name ELSE track.name END AS "targetName",
            CASE WHEN r.kind='ARTIST' THEN artist.spotify_url ELSE track.spotify_url END AS "spotifyUrl",
            CASE WHEN r.kind='TRACK' THEN track.spotify_uri END AS "spotifyUri",
            COALESCE(track.album_image_url, artist_artwork.album_image_url) AS "imageUrl",
            CASE WHEN r.kind='ARTIST' THEN artist.id ELSE track_artist.artist_id END AS "artistId",
            r.created_at AS "createdAt"
     FROM music_recommendation r
     JOIN instance_member sender ON sender.id=r.sender_member_id
     JOIN app_user sender_user ON sender_user.id=sender.user_id
     LEFT JOIN spotify_artist artist ON artist.id=r.artist_id
     LEFT JOIN spotify_track track ON track.id=r.track_id
     LEFT JOIN LATERAL (
       SELECT linked_artist.id AS artist_id
       FROM spotify_track_artist relation
       JOIN spotify_artist linked_artist ON linked_artist.id=relation.artist_id
       WHERE relation.track_id=track.id
       ORDER BY linked_artist.name, linked_artist.id LIMIT 1
     ) track_artist ON true
     LEFT JOIN LATERAL (
       SELECT artwork_track.album_image_url
       FROM spotify_track_artist relation
       JOIN spotify_track artwork_track ON artwork_track.id=relation.track_id
       WHERE relation.artist_id=artist.id AND artwork_track.album_image_url IS NOT NULL
       ORDER BY artwork_track.id LIMIT 1
     ) artist_artwork ON true
     WHERE r.instance_id=$1 AND r.recipient_member_id=$2 AND r.expires_at>now()
     ORDER BY r.created_at DESC LIMIT 12`,
    [instanceId, recipientId],
  );
  return result.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}

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

  app.get('/api/v1/music/recommendation-recipients', { preHandler: requireSession }, async (request) => {
    const result = await pool.query<{ id: string; firstName: string }>(
      `SELECT member.id, member_user.first_name AS "firstName"
       FROM instance_member member
       JOIN app_user member_user ON member_user.id=member.user_id
       WHERE member.instance_id=$1 AND member.status='ACTIVE' AND member.id<>$2
       ORDER BY member_user.first_name, member.id`,
      [request.session!.instanceId, request.session!.id],
    );
    return { members: result.rows };
  });

  app.post('/api/v1/music/recommendations', {
    preHandler: [requireSession, requireCsrf],
    config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const parsed = recommendationBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_REQUEST' });
    const session = request.session!;
    if (parsed.data.recipientIds.includes(session.id)) {
      return reply.code(400).send({ error: 'INVALID_RECIPIENT' });
    }
    const recipients = await pool.query<{ id: string }>(
      `SELECT id FROM instance_member
       WHERE instance_id=$1 AND status='ACTIVE' AND id<>$2 AND id=ANY($3::uuid[])`,
      [session.instanceId, session.id, parsed.data.recipientIds],
    );
    if (recipients.rowCount !== parsed.data.recipientIds.length) {
      return reply.code(400).send({ error: 'INVALID_RECIPIENT' });
    }
    const target = parsed.data.targetType === 'ARTIST' ? await pool.query<{ name: string }>(
      `SELECT artist.name FROM spotify_artist artist
       WHERE artist.id=$3 AND EXISTS (
         SELECT 1 FROM spotify_track_artist relation
         JOIN member_saved_track saved ON saved.track_id=relation.track_id
         JOIN instance_member owner ON owner.id=saved.member_id
         JOIN spotify_connection connection ON connection.member_id=owner.id
         WHERE relation.artist_id=artist.id AND owner.instance_id=$1 AND owner.status='ACTIVE'
           AND (connection.share_enabled OR owner.id=$2)
       )`,
      [session.instanceId, session.id, parsed.data.targetId],
    ) : await pool.query<{ name: string }>(
      `SELECT track.name FROM spotify_track track
       WHERE track.id=$3 AND EXISTS (
         SELECT 1 FROM member_saved_track saved
         JOIN instance_member owner ON owner.id=saved.member_id
         JOIN spotify_connection connection ON connection.member_id=owner.id
         WHERE saved.track_id=track.id AND owner.instance_id=$1 AND owner.status='ACTIVE'
           AND (connection.share_enabled OR owner.id=$2)
       )`,
      [session.instanceId, session.id, parsed.data.targetId],
    );
    if (!target.rows[0]) return reply.code(404).send({ error: 'MUSIC_TARGET_NOT_FOUND' });

    const targetColumn = parsed.data.targetType === 'ARTIST' ? 'artist_id' : 'track_id';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO music_recommendation
           (instance_id, sender_member_id, recipient_member_id, kind, ${targetColumn})
         SELECT $1, $2, recipient.id, $3, $4
         FROM instance_member recipient
         WHERE recipient.instance_id=$1 AND recipient.status='ACTIVE'
           AND recipient.id=ANY($5::uuid[]) AND recipient.id<>$2
         ON CONFLICT (sender_member_id, recipient_member_id, ${targetColumn})
           WHERE ${targetColumn} IS NOT NULL
         DO UPDATE SET created_at=now(), expires_at=now()+interval '30 days'
         RETURNING id`,
        [session.instanceId, session.id, parsed.data.targetType, parsed.data.targetId,
          parsed.data.recipientIds],
      );
      await purgeMusicRecommendations(client, session.instanceId, parsed.data.recipientIds);
      const recommendationIds = inserted.rows.map((row) => row.id);
      await client.query(
        `DELETE FROM notification WHERE resource_type='music_recommendation'
           AND resource_id=ANY($1::uuid[])`,
        [recommendationIds],
      );
      const targetDescription = parsed.data.targetType === 'ARTIST' ?
        `l’artiste « ${target.rows[0].name} »` : `le titre « ${target.rows[0].name} »`;
      await client.query(
        `INSERT INTO notification
           (instance_id, recipient_member_id, actor_member_id, type, module_key,
            title, body, resource_type, resource_id)
         SELECT recommendation.instance_id, recommendation.recipient_member_id,
                recommendation.sender_member_id, 'MUSIC_RECOMMENDATION', 'music',
                'Nouvelle recommandation musicale', concat($2::text, ' vous recommande ', $3::text),
                'music_recommendation', recommendation.id
         FROM music_recommendation recommendation
         WHERE recommendation.id=ANY($1::uuid[])`,
        [recommendationIds, session.firstName, targetDescription],
      );
      await client.query('COMMIT');
      return reply.code(201).send({ count: inserted.rowCount ?? 0 });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  });

  app.get('/api/v1/music/overview', { preHandler: requireSession }, async (request) => {
    const [data, recommendations] = await Promise.all([
      loadLibrary(pool, request.session!.instanceId, request.session!.id),
      loadMusicRecommendations(pool, request.session!.instanceId, request.session!.id),
    ]);
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
    return { discoveries, common, recent, recommendations, members: data.members,
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
       WHERE t.id=ANY($3::text[]) AND (
         EXISTS (
           SELECT 1 FROM member_saved_track s
           JOIN instance_member m ON m.id=s.member_id AND m.instance_id=$1 AND m.status='ACTIVE'
           JOIN spotify_connection c ON c.member_id=m.id
           WHERE s.track_id=t.id AND (c.share_enabled OR m.id=$2)
         ) OR EXISTS (
           SELECT 1 FROM music_recommendation recommendation
           WHERE recommendation.instance_id=$1 AND recommendation.recipient_member_id=$2
             AND recommendation.track_id=t.id AND recommendation.expires_at>now()
         )
       )`,
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

  const recommendationCleanupTimer = setInterval(() => {
    void purgeMusicRecommendations(pool).catch((error) =>
      app.log.warn({ error }, 'Expired music recommendation cleanup failed'));
  }, 60 * 60_000);
  recommendationCleanupTimer.unref();
  app.addHook('onClose', async () => clearInterval(recommendationCleanupTimer));

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
