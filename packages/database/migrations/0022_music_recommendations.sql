CREATE TABLE music_recommendation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES instance(id) ON DELETE CASCADE,
  sender_member_id uuid NOT NULL REFERENCES instance_member(id) ON DELETE CASCADE,
  recipient_member_id uuid NOT NULL REFERENCES instance_member(id) ON DELETE CASCADE,
  kind text NOT NULL,
  artist_id text REFERENCES spotify_artist(id) ON DELETE CASCADE,
  track_id text REFERENCES spotify_track(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT music_recommendation_distinct_members CHECK (sender_member_id <> recipient_member_id),
  CONSTRAINT music_recommendation_target_valid CHECK (
    (kind = 'ARTIST' AND artist_id IS NOT NULL AND track_id IS NULL)
    OR (kind = 'TRACK' AND track_id IS NOT NULL AND artist_id IS NULL)
  )
);

CREATE UNIQUE INDEX music_recommendation_artist_uq
ON music_recommendation(sender_member_id, recipient_member_id, artist_id)
WHERE artist_id IS NOT NULL;

CREATE UNIQUE INDEX music_recommendation_track_uq
ON music_recommendation(sender_member_id, recipient_member_id, track_id)
WHERE track_id IS NOT NULL;

CREATE INDEX music_recommendation_recipient_created_idx
ON music_recommendation(recipient_member_id, created_at DESC);

CREATE INDEX music_recommendation_expiry_idx
ON music_recommendation(expires_at);

CREATE OR REPLACE FUNCTION enforce_music_recommendation_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM instance_member sender
    JOIN instance_member recipient ON recipient.id = NEW.recipient_member_id
    WHERE sender.id = NEW.sender_member_id
      AND sender.instance_id = NEW.instance_id
      AND recipient.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'music recommendation members must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER music_recommendation_members_same_instance
BEFORE INSERT OR UPDATE ON music_recommendation
FOR EACH ROW EXECUTE FUNCTION enforce_music_recommendation_instance();

CREATE OR REPLACE FUNCTION cleanup_music_recommendation_notification() RETURNS trigger AS $$
BEGIN
  DELETE FROM notification
  WHERE resource_type = 'music_recommendation' AND resource_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER music_recommendation_notification_cleanup
AFTER DELETE ON music_recommendation
FOR EACH ROW EXECUTE FUNCTION cleanup_music_recommendation_notification();
