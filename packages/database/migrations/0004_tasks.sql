CREATE TABLE "family_task" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "kind" text NOT NULL,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "assignee_id" uuid REFERENCES "instance_member"("id") ON DELETE SET NULL,
  "claimable" boolean DEFAULT false NOT NULL,
  "due_at" timestamptz,
  "period_start_at" timestamptz,
  "period_end_at" timestamptz,
  "recurrence_interval_days" integer,
  "frequency_hint" text,
  "reopen_policy" text DEFAULT 'NONE' NOT NULL,
  "reopen_delay_hours" integer,
  "next_available_at" timestamptz,
  "client_mutation_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "family_task_title_not_blank" CHECK (length(trim("title")) > 0),
  CONSTRAINT "family_task_kind_valid" CHECK ("kind" IN ('SCHEDULED', 'OPEN_CHORE', 'SEASONAL')),
  CONSTRAINT "family_task_status_valid" CHECK ("status" IN ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED')),
  CONSTRAINT "family_task_reopen_policy_valid" CHECK ("reopen_policy" IN ('NONE', 'IMMEDIATE', 'AFTER_DELAY', 'MANUAL')),
  CONSTRAINT "family_task_scheduled_fields" CHECK (
    "kind" <> 'SCHEDULED' OR ("assignee_id" IS NOT NULL AND "due_at" IS NOT NULL)
  ),
  CONSTRAINT "family_task_open_chore_undated" CHECK (
    "kind" <> 'OPEN_CHORE' OR ("due_at" IS NULL AND "period_start_at" IS NULL AND "period_end_at" IS NULL)
  ),
  CONSTRAINT "family_task_period_valid" CHECK (
    "period_end_at" IS NULL OR "period_start_at" IS NULL OR "period_end_at" >= "period_start_at"
  ),
  CONSTRAINT "family_task_recurrence_valid" CHECK (
    "recurrence_interval_days" IS NULL OR "recurrence_interval_days" BETWEEN 1 AND 365
  ),
  CONSTRAINT "family_task_reopen_fields" CHECK (
    ("kind" = 'OPEN_CHORE' OR "reopen_policy" = 'NONE')
    AND ("reopen_policy" <> 'AFTER_DELAY' OR "reopen_delay_hours" BETWEEN 1 AND 8760)
  )
);

CREATE UNIQUE INDEX "family_task_instance_mutation_uq"
ON "family_task" ("instance_id", "client_mutation_id");

CREATE INDEX "family_task_instance_state_idx"
ON "family_task" ("instance_id", "status", "due_at", "created_at");

CREATE INDEX "family_task_assignee_state_idx"
ON "family_task" ("assignee_id", "status")
WHERE "assignee_id" IS NOT NULL;

CREATE TABLE "task_completion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "family_task"("id") ON DELETE CASCADE,
  "completed_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "completed_at" timestamptz DEFAULT now() NOT NULL,
  "comment" text,
  "scheduled_for" timestamptz,
  "client_mutation_id" uuid NOT NULL
);

CREATE UNIQUE INDEX "task_completion_task_mutation_uq"
ON "task_completion" ("task_id", "client_mutation_id");

CREATE INDEX "task_completion_task_date_idx"
ON "task_completion" ("task_id", "completed_at" DESC);

CREATE OR REPLACE FUNCTION enforce_family_task_instances() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'task'
  ) THEN
    RAISE EXCEPTION 'task and resource must belong to the same instance';
  END IF;

  IF NEW.assignee_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM instance_member m
    WHERE m.id = NEW.assignee_id AND m.instance_id = NEW.instance_id AND m.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'task and assignee must belong to the same instance';
  END IF;

  IF EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.visibility = 'PRIVATE'
      AND NEW.assignee_id IS NOT NULL AND NEW.assignee_id <> r.created_by
  ) THEN
    RAISE EXCEPTION 'a private task may only be assigned to its creator';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "family_task_instances_match"
BEFORE INSERT OR UPDATE ON "family_task"
FOR EACH ROW EXECUTE FUNCTION enforce_family_task_instances();

CREATE OR REPLACE FUNCTION enforce_task_completion_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM family_task t
    JOIN instance_member m ON m.id = NEW.completed_by
    WHERE t.id = NEW.task_id AND t.instance_id = m.instance_id AND m.status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'task and completing member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_completion_instance_match"
BEFORE INSERT OR UPDATE ON "task_completion"
FOR EACH ROW EXECUTE FUNCTION enforce_task_completion_instance();
