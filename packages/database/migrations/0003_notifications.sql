CREATE TABLE "notification" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "recipient_member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "actor_member_id" uuid REFERENCES "instance_member"("id") ON DELETE SET NULL,
  "type" text NOT NULL,
  "module_key" text,
  "title" text NOT NULL,
  "body" text,
  "resource_type" text,
  "resource_id" uuid,
  "read_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "notification_title_not_blank" CHECK (length(trim("title")) > 0)
);

CREATE INDEX "notification_recipient_state_idx"
ON "notification" ("recipient_member_id", "read_at", "created_at" DESC);

CREATE INDEX "notification_instance_created_idx"
ON "notification" ("instance_id", "created_at" DESC);

CREATE OR REPLACE FUNCTION enforce_notification_members_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM instance_member m
    WHERE m.id = NEW.recipient_member_id AND m.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'notification and recipient must belong to the same instance';
  END IF;

  IF NEW.actor_member_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM instance_member m
    WHERE m.id = NEW.actor_member_id AND m.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'notification and actor must belong to the same instance';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "notification_members_same_instance"
BEFORE INSERT OR UPDATE ON "notification"
FOR EACH ROW EXECUTE FUNCTION enforce_notification_members_instance();
