CREATE TABLE spotify_connection (
  member_id uuid PRIMARY KEY REFERENCES instance_member(id) ON DELETE CASCADE,
  instance_id uuid NOT NULL REFERENCES instance(id) ON DELETE CASCADE,
  spotify_account_id text NOT NULL UNIQUE,
  spotify_display_name text,
  encrypted_refresh_token text NOT NULL,
  granted_scopes text NOT NULL,
  share_enabled boolean NOT NULL DEFAULT false,
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  sync_started_at timestamptz,
  sync_error text
);
CREATE INDEX spotify_connection_instance_idx ON spotify_connection(instance_id);

CREATE TABLE spotify_oauth_state (
  state_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES instance_member(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX spotify_oauth_state_expiry_idx ON spotify_oauth_state(expires_at);

CREATE TABLE spotify_artist (
  id text PRIMARY KEY,
  name text NOT NULL,
  spotify_uri text NOT NULL,
  spotify_url text NOT NULL
);
CREATE TABLE spotify_track (
  id text PRIMARY KEY,
  name text NOT NULL,
  spotify_uri text NOT NULL,
  spotify_url text NOT NULL,
  album_name text,
  album_image_url text,
  duration_ms integer NOT NULL,
  explicit boolean NOT NULL DEFAULT false
);
CREATE TABLE spotify_track_artist (
  track_id text NOT NULL REFERENCES spotify_track(id) ON DELETE CASCADE,
  artist_id text NOT NULL REFERENCES spotify_artist(id) ON DELETE CASCADE,
  PRIMARY KEY (track_id, artist_id)
);
CREATE INDEX spotify_track_artist_artist_idx ON spotify_track_artist(artist_id);

CREATE TABLE member_saved_track (
  member_id uuid NOT NULL REFERENCES instance_member(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES spotify_track(id) ON DELETE CASCADE,
  spotify_added_at timestamptz NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, track_id)
);
CREATE INDEX member_saved_track_track_idx ON member_saved_track(track_id);

CREATE TABLE weekly_music_mix (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES instance(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  algorithm_version integer NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX weekly_music_mix_instance_week_uq ON weekly_music_mix(instance_id, week_start);
CREATE TABLE weekly_music_mix_item (
  mix_id uuid NOT NULL REFERENCES weekly_music_mix(id) ON DELETE CASCADE,
  track_id text NOT NULL REFERENCES spotify_track(id) ON DELETE CASCADE,
  source_member_id uuid NOT NULL REFERENCES instance_member(id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (mix_id, position)
);
CREATE INDEX weekly_music_mix_item_track_idx ON weekly_music_mix_item(track_id);

INSERT INTO module_config (instance_id, module_key, enabled)
SELECT id, 'music', true FROM instance
ON CONFLICT (instance_id, module_key) DO NOTHING;
