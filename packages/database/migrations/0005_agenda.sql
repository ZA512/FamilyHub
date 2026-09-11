CREATE TABLE "calendar_event" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "event_type" text DEFAULT 'EVENT' NOT NULL,
  "start_at" timestamptz NOT NULL,
  "end_at" timestamptz NOT NULL,
  "all_day" boolean DEFAULT false NOT NULL,
  "location" text,
  "recurrence" text DEFAULT 'NONE' NOT NULL,
  "recurrence_interval" integer DEFAULT 1 NOT NULL,
  "recurrence_until" timestamptz,
  "recurrence_timezone" text DEFAULT 'Europe/Paris' NOT NULL,
  "reminder_minutes" integer,
  "client_mutation_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_event_title_not_blank" CHECK (length(trim("title")) > 0),
  CONSTRAINT "calendar_event_type_valid" CHECK (
    "event_type" IN ('EVENT', 'APPOINTMENT', 'BIRTHDAY', 'REMINDER')
  ),
  CONSTRAINT "calendar_event_dates_valid" CHECK ("end_at" > "start_at"),
  CONSTRAINT "calendar_event_recurrence_valid" CHECK (
    "recurrence" IN ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY')
    AND "recurrence_interval" BETWEEN 1 AND 365
    AND ("recurrence_until" IS NULL OR "recurrence_until" >= "start_at")
  ),
  CONSTRAINT "calendar_event_reminder_valid" CHECK (
    "reminder_minutes" IS NULL OR "reminder_minutes" BETWEEN 0 AND 525600
  )
);

CREATE UNIQUE INDEX "calendar_event_instance_mutation_uq"
ON "calendar_event" ("instance_id", "client_mutation_id");

CREATE INDEX "calendar_event_instance_range_idx"
ON "calendar_event" ("instance_id", "start_at", "end_at");

CREATE INDEX "calendar_event_instance_recurrence_idx"
ON "calendar_event" ("instance_id", "recurrence", "recurrence_until")
WHERE "recurrence" <> 'NONE';

CREATE TABLE "calendar_event_participant" (
  "event_id" uuid NOT NULL REFERENCES "calendar_event"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "response" text DEFAULT 'PENDING' NOT NULL,
  "responded_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "calendar_event_participant_pk" PRIMARY KEY ("event_id", "member_id"),
  CONSTRAINT "calendar_event_participant_response_valid" CHECK (
    "response" IN ('YES', 'NO', 'MAYBE', 'PENDING')
  )
);

CREATE INDEX "calendar_event_participant_member_idx"
ON "calendar_event_participant" ("member_id", "response");

CREATE OR REPLACE FUNCTION enforce_calendar_event_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'calendar_event'
  ) THEN
    RAISE EXCEPTION 'calendar event and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_event_instance_match"
BEFORE INSERT OR UPDATE ON "calendar_event"
FOR EACH ROW EXECUTE FUNCTION enforce_calendar_event_instance();

CREATE OR REPLACE FUNCTION enforce_calendar_participant_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM calendar_event e
    JOIN resource r ON r.id = e.id
    JOIN instance_member m ON m.id = NEW.member_id
    WHERE e.id = NEW.event_id AND e.instance_id = m.instance_id AND m.status = 'ACTIVE'
      AND (r.visibility <> 'PRIVATE' OR r.created_by = NEW.member_id)
  ) THEN
    RAISE EXCEPTION 'calendar event and participant must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "calendar_event_participant_instance_match"
BEFORE INSERT OR UPDATE ON "calendar_event_participant"
FOR EACH ROW EXECUTE FUNCTION enforce_calendar_participant_instance();
