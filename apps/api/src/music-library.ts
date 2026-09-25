import { createHash } from 'node:crypto';

import type { Pool } from 'pg';

type LibraryRow = {
  member_id: string; first_name: string; share_enabled: boolean;
  track_id: string; track_name: string; track_uri: string; track_url: string;
  album_image_url: string | null; added_at: Date;
  artist_id: string; artist_name: string; artist_url: string;
};
export type MusicTrack = { id: string; name: string; uri: string; url: string;
  imageUrl: string | null; addedAt: string; memberIds: string[]; artistIds: string[] };
export type MusicArtist = { id: string; name: string; url: string; imageUrl: string | null;
  memberIds: string[]; totalTracks: number; lastAddedAt: string; firstAddedAt: string;
  memberCounts: { memberId: string; count: number }[];
  memberFirstAddedAt: { memberId: string; addedAt: string }[] };
export type MusicMember = { id: string; firstName: string; shareEnabled: boolean };

export async function loadLibrary(pool: Pool, instanceId: string, viewerId: string) {
  const result = await pool.query<LibraryRow>(
    `SELECT m.id AS member_id, u.first_name, c.share_enabled,
            t.id AS track_id, t.name AS track_name, t.spotify_uri AS track_uri,
            t.spotify_url AS track_url, t.album_image_url,
            s.spotify_added_at AS added_at,
            a.id AS artist_id, a.name AS artist_name, a.spotify_url AS artist_url
     FROM member_saved_track s
     JOIN instance_member m ON m.id=s.member_id AND m.instance_id=$1 AND m.status='ACTIVE'
     JOIN app_user u ON u.id=m.user_id
     JOIN spotify_connection c ON c.member_id=m.id AND c.instance_id=$1
     JOIN spotify_track t ON t.id=s.track_id
     JOIN spotify_track_artist ta ON ta.track_id=t.id
     JOIN spotify_artist a ON a.id=ta.artist_id
     WHERE c.share_enabled OR m.id=$2`, [instanceId, viewerId]);
  const members = new Map<string, MusicMember>();
  const selfArtistIds = new Set<string>();
  const artists = new Map<string, { artist: MusicArtist; tracks: Map<string, Set<string>>; memberTracks: Map<string, Set<string>> }>();
  const tracks = new Map<string, MusicTrack>();
  for (const row of result.rows) {
    members.set(row.member_id, { id: row.member_id, firstName: row.first_name, shareEnabled: row.share_enabled });
    if (row.member_id === viewerId) selfArtistIds.add(row.artist_id);
    if (!row.share_enabled) continue;
    let entry = artists.get(row.artist_id);
    if (!entry) {
      entry = { artist: { id: row.artist_id, name: row.artist_name, url: row.artist_url,
        imageUrl: row.album_image_url, memberIds: [], totalTracks: 0,
        firstAddedAt: row.added_at.toISOString(), lastAddedAt: row.added_at.toISOString(),
        memberCounts: [], memberFirstAddedAt: [] },
        tracks: new Map(), memberTracks: new Map() };
      artists.set(row.artist_id, entry);
    }
    if (!entry.artist.imageUrl && row.album_image_url) entry.artist.imageUrl = row.album_image_url;
    const added = row.added_at.toISOString();
    if (added < entry.artist.firstAddedAt) entry.artist.firstAddedAt = added;
    if (added > entry.artist.lastAddedAt) entry.artist.lastAddedAt = added;
    if (!entry.tracks.has(row.track_id)) entry.tracks.set(row.track_id, new Set());
    entry.tracks.get(row.track_id)!.add(row.member_id);
    if (!entry.memberTracks.has(row.member_id)) entry.memberTracks.set(row.member_id, new Set());
    entry.memberTracks.get(row.member_id)!.add(row.track_id);
    const firstForMember = entry.artist.memberFirstAddedAt.find((item) => item.memberId === row.member_id);
    if (!firstForMember) entry.artist.memberFirstAddedAt.push({ memberId: row.member_id, addedAt: added });
    else if (added < firstForMember.addedAt) firstForMember.addedAt = added;
    let track = tracks.get(row.track_id);
    if (!track) {
      track = { id: row.track_id, name: row.track_name, uri: row.track_uri, url: row.track_url,
        imageUrl: row.album_image_url, addedAt: added, memberIds: [], artistIds: [] };
      tracks.set(row.track_id, track);
    }
    if (!track.memberIds.includes(row.member_id)) track.memberIds.push(row.member_id);
    if (!track.artistIds.includes(row.artist_id)) track.artistIds.push(row.artist_id);
    if (added > track.addedAt) track.addedAt = added;
  }
  const artistList = [...artists.values()].map(({ artist, tracks: trackMap, memberTracks }) => ({
    ...artist, totalTracks: [...memberTracks.values()].reduce((sum, set) => sum + set.size, 0),
    memberIds: [...memberTracks.keys()],
    memberCounts: [...memberTracks].map(([memberId, set]) => ({ memberId, count: set.size })),
    uniqueTracks: trackMap.size,
  }));
  artistList.sort((a, b) => b.memberIds.length - a.memberIds.length ||
    b.totalTracks - a.totalTracks || b.lastAddedAt.localeCompare(a.lastAddedAt));
  return { artists: artistList, tracks: [...tracks.values()], members: [...members.values()], selfArtistIds };
}

export function weekStart(now = new Date(), timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)?.value ?? '01';
  const date = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

type Candidate = { memberId: string; trackId: string; artistId: string; addedAt: Date;
  otherLikes: number; recentlyUsed: boolean };

export function chooseWeeklyTracks(candidates: Candidate[], week: string): { memberId: string; trackId: string }[] {
  const byMember = new Map<string, Candidate[]>();
  for (const item of candidates) {
    if (!byMember.has(item.memberId)) byMember.set(item.memberId, []);
    byMember.get(item.memberId)!.push(item);
  }
  if (!byMember.size) return [];
  const quota = Math.min(2, ...[...byMember.values()].map((items) => new Set(items.map((item) => item.trackId)).size));
  const chosen = new Map<string, Candidate[]>();
  const globalArtists = new Set<string>();
  const globalTracks = new Set<string>();
  for (const [memberId, items] of [...byMember].sort(([a], [b]) => a.localeCompare(b))) {
    const picked: Candidate[] = [];
    const usedTracks = new Set<string>();
    const usedArtists = new Set<string>();
    for (let index = 0; index < quota; index++) {
      const options = items.filter((item) => !usedTracks.has(item.trackId));
      const uniqueArtist = options.filter((item) => !usedArtists.has(item.artistId));
      const artistPool = uniqueArtist.length ? uniqueArtist : options;
      const globallyUnique = artistPool.filter((item) => !globalTracks.has(item.trackId));
      const pool = globallyUnique.length ? globallyUnique : artistPool;
      pool.sort((a, b) => {
        const score = (item: Candidate) => {
          const ageDays = Math.max(0, (Date.parse(`${week}T00:00:00Z`) - item.addedAt.getTime()) / 86_400_000);
          return Math.max(0, 60 - ageDays) - item.otherLikes * 15 -
            (item.recentlyUsed ? 100 : 0) - (globalArtists.has(item.artistId) ? 18 : 0);
        };
        const hash = (item: Candidate) => createHash('sha256').update(`${week}:${item.memberId}:${item.trackId}`).digest('hex');
        return score(b) - score(a) || hash(a).localeCompare(hash(b));
      });
      const selected = pool[0];
      if (!selected) break;
      picked.push(selected);
      usedTracks.add(selected.trackId);
      usedArtists.add(selected.artistId);
      globalArtists.add(selected.artistId);
      globalTracks.add(selected.trackId);
    }
    chosen.set(memberId, picked);
  }
  const memberOrder = [...chosen.keys()].sort((a, b) =>
    createHash('sha256').update(`${week}:${a}`).digest('hex').localeCompare(
      createHash('sha256').update(`${week}:${b}`).digest('hex')));
  const result: { memberId: string; trackId: string }[] = [];
  for (let round = 0; round < quota; round++) {
    for (const memberId of memberOrder) {
      const selected = chosen.get(memberId)?.[round];
      if (selected) result.push({ memberId, trackId: selected.trackId });
    }
  }
  return result;
}

export async function getWeeklyMix(pool: Pool, instanceId: string, timeZone: string) {
  const week = weekStart(new Date(), timeZone);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`music:${instanceId}:${week}`]);
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM weekly_music_mix WHERE instance_id=$1 AND week_start=$2', [instanceId, week]);
    let existingId = existing.rows[0]?.id;
    if (existingId) {
      const currentMembers = await client.query<{ ids: string[] }>(
        `SELECT COALESCE(array_agg(DISTINCT s.member_id ORDER BY s.member_id), '{}') AS ids
         FROM member_saved_track s
         JOIN spotify_connection c ON c.member_id=s.member_id AND c.instance_id=$1 AND c.share_enabled
         JOIN instance_member m ON m.id=s.member_id AND m.status='ACTIVE'`, [instanceId]);
      const mixMembers = await client.query<{ ids: string[]; invalid_count: string }>(
        `SELECT COALESCE(array_agg(DISTINCT i.source_member_id ORDER BY i.source_member_id), '{}') AS ids,
                count(*) FILTER (WHERE c.member_id IS NULL OR s.track_id IS NULL OR m.status<>'ACTIVE')::text AS invalid_count
         FROM weekly_music_mix_item i
         LEFT JOIN spotify_connection c ON c.member_id=i.source_member_id AND c.instance_id=$1 AND c.share_enabled
         LEFT JOIN instance_member m ON m.id=i.source_member_id
         LEFT JOIN member_saved_track s ON s.member_id=i.source_member_id AND s.track_id=i.track_id
         WHERE i.mix_id=$2`, [instanceId, existingId]);
      if (JSON.stringify(currentMembers.rows[0]?.ids) !== JSON.stringify(mixMembers.rows[0]?.ids) ||
          Number(mixMembers.rows[0]?.invalid_count) > 0) {
        await client.query('DELETE FROM weekly_music_mix WHERE id=$1', [existingId]);
        existingId = undefined;
      }
    }
    if (!existingId) {
      const candidateRows = await client.query<{
        member_id: string; track_id: string; artist_id: string; spotify_added_at: Date;
        other_likes: string; recently_used: boolean;
      }>(
        `SELECT s.member_id, s.track_id, min(ta.artist_id) AS artist_id, s.spotify_added_at,
                (SELECT count(*) FROM member_saved_track other
                 JOIN spotify_connection oc ON oc.member_id=other.member_id AND oc.share_enabled
                 JOIN instance_member om ON om.id=other.member_id AND om.instance_id=$1 AND om.status='ACTIVE'
                 WHERE other.track_id=s.track_id AND other.member_id<>s.member_id)::text AS other_likes,
                EXISTS (SELECT 1 FROM weekly_music_mix_item old
                  JOIN weekly_music_mix mix ON mix.id=old.mix_id
                  WHERE old.track_id=s.track_id AND mix.instance_id=$1 AND mix.week_start >= ($2::date - interval '8 weeks')) AS recently_used
         FROM member_saved_track s
         JOIN spotify_connection c ON c.member_id=s.member_id AND c.instance_id=$1 AND c.share_enabled
         JOIN instance_member m ON m.id=s.member_id AND m.status='ACTIVE'
         JOIN spotify_track_artist ta ON ta.track_id=s.track_id
         GROUP BY s.member_id, s.track_id, s.spotify_added_at`, [instanceId, week]);
      const picks = chooseWeeklyTracks(candidateRows.rows.map((row) => ({
        memberId: row.member_id, trackId: row.track_id, artistId: row.artist_id,
        addedAt: row.spotify_added_at, otherLikes: Number(row.other_likes), recentlyUsed: row.recently_used,
      })), week);
      const created = await client.query<{ id: string }>(
        'INSERT INTO weekly_music_mix (instance_id, week_start) VALUES ($1,$2) RETURNING id', [instanceId, week]);
      for (const [position, pick] of picks.entries()) {
        await client.query(`INSERT INTO weekly_music_mix_item (mix_id, track_id, source_member_id, position)
          VALUES ($1,$2,$3,$4)`, [created.rows[0]!.id, pick.trackId, pick.memberId, position]);
      }
    }
    await client.query('COMMIT');
    const items = await pool.query<{
      id: string; name: string; uri: string; url: string; image_url: string | null;
      member_id: string; first_name: string; position: number;
    }>(
      `SELECT t.id, t.name, t.spotify_uri AS uri, t.spotify_url AS url,
              t.album_image_url AS image_url, m.id AS member_id, u.first_name, i.position
       FROM weekly_music_mix_item i
       JOIN weekly_music_mix mix ON mix.id=i.mix_id
       JOIN spotify_track t ON t.id=i.track_id
       JOIN instance_member m ON m.id=i.source_member_id AND m.status='ACTIVE'
       JOIN spotify_connection c ON c.member_id=m.id AND c.share_enabled
       JOIN app_user u ON u.id=m.user_id
       WHERE mix.instance_id=$1 AND mix.week_start=$2 ORDER BY i.position`, [instanceId, week]);
    return { weekStart: week, items: items.rows.map((row) => ({
      id: row.id, name: row.name, uri: row.uri, url: row.url, imageUrl: row.image_url,
      sourceMemberId: row.member_id, sourceMemberName: row.first_name,
    })) };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
