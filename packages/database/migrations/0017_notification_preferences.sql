CREATE TABLE "notification_preference" (
  "member_id" uuid PRIMARY KEY NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "level" text DEFAULT 'ALL' NOT NULL,
  "muted_modules" text[] DEFAULT ARRAY[]::text[] NOT NULL,
  "quiet_start" time,
  "quiet_end" time,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "notification_preference_level_valid" CHECK ("level" IN ('ALL', 'IMPORTANT'))
);

CREATE INDEX "notification_preference_instance_idx"
ON "notification_preference" ("instance_id");

CREATE OR REPLACE FUNCTION enforce_notification_preference_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM instance_member m
    WHERE m.id = NEW.member_id AND m.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'notification preference and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "notification_preference_member_same_instance"
BEFORE INSERT OR UPDATE ON "notification_preference"
FOR EACH ROW EXECUTE FUNCTION enforce_notification_preference_instance();

CREATE TABLE "device_subscription" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "endpoint" text NOT NULL,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "user_agent" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "device_subscription_endpoint_uq" UNIQUE ("endpoint")
);

CREATE INDEX "device_subscription_member_idx"
ON "device_subscription" ("member_id");

CREATE TABLE "notification_delivery" (
  "notification_id" uuid NOT NULL REFERENCES "notification"("id") ON DELETE CASCADE,
  "subscription_id" uuid NOT NULL REFERENCES "device_subscription"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("notification_id", "subscription_id")
);

CREATE OR REPLACE FUNCTION publish_familyhub_notification() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('familyhub_notification', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "notification_publish_after_insert"
AFTER INSERT ON "notification"
FOR EACH ROW EXECUTE FUNCTION publish_familyhub_notification();
