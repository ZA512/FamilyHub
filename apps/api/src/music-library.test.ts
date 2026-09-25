import { describe, expect, it } from 'vitest';

import { chooseWeeklyTracks, loadLibrary, weekStart } from './music-library.js';

describe('music privacy and weekly selection', () => {
  it('excludes another member’s private tracks from every family aggregate', async () => {
    const rows = [
      { member_id: 'me', first_name: 'Moi', share_enabled: false,
        track_id: 'mine', track_name: 'Mine', track_uri: 'spotify:track:mine', track_url: 'https://open.spotify.com/track/mine',
        album_image_url: null, added_at: new Date('2026-09-20T00:00:00Z'),
        artist_id: 'artist-private', artist_name: 'Private', artist_url: 'https://open.spotify.com/artist/artist-private' },
      { member_id: 'other', first_name: 'Jade', share_enabled: true,
        track_id: 'shared', track_name: 'Shared', track_uri: 'spotify:track:shared', track_url: 'https://open.spotify.com/track/shared',
        album_image_url: null, added_at: new Date('2026-09-21T00:00:00Z'),
        artist_id: 'artist-shared', artist_name: 'Shared Artist', artist_url: 'https://open.spotify.com/artist/artist-shared' },
    ];
    const pool = { query: async () => ({ rows }) } as unknown as Parameters<typeof loadLibrary>[0];
    const library = await loadLibrary(pool, 'household', 'me');
    expect(library.selfArtistIds.has('artist-private')).toBe(true);
    expect(library.artists.map((artist) => artist.id)).toEqual(['artist-shared']);
    expect(library.tracks.map((track) => track.id)).toEqual(['shared']);
  });

  it('keeps equal contributions, alternates members, and is stable within a week', () => {
    const candidates = ['jade', 'papa', 'lydia'].flatMap((memberId) =>
      [1, 2, 3].map((index) => ({ memberId, trackId: `${memberId}-${index}`,
        artistId: `${memberId}-artist-${index}`, addedAt: new Date('2026-09-20T00:00:00Z'),
        otherLikes: 0, recentlyUsed: false })));
    const one = chooseWeeklyTracks(candidates, '2026-09-21');
    expect(one).toEqual(chooseWeeklyTracks([...candidates].reverse(), '2026-09-21'));
    expect(one).toHaveLength(6);
    expect(new Set(one.slice(0, 3).map((item) => item.memberId)).size).toBe(3);
    for (const memberId of ['jade', 'papa', 'lydia']) {
      expect(one.filter((item) => item.memberId === memberId)).toHaveLength(2);
    }
  });

  it('uses the household timezone to find the week boundary', () => {
    expect(weekStart(new Date('2026-09-27T22:30:00Z'), 'Europe/Paris')).toBe('2026-09-28');
    expect(weekStart(new Date('2026-09-27T22:30:00Z'), 'UTC')).toBe('2026-09-21');
  });

  it('keeps a member with one saved track and relaxes the two-track target equally', () => {
    const make = (memberId: string, trackId: string, artistId: string) => ({
      memberId, trackId, artistId, addedAt: new Date('2026-09-20T00:00:00Z'),
      otherLikes: 0, recentlyUsed: false,
    });
    const result = chooseWeeklyTracks([
      make('jade', 'jade-only', 'one'),
      make('papa', 'papa-one', 'one'),
      make('papa', 'papa-two', 'two'),
    ], '2026-09-21');
    expect(result).toHaveLength(2);
    expect(result.map((item) => item.memberId).sort()).toEqual(['jade', 'papa']);
  });
});
