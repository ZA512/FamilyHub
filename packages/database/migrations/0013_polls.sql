CREATE TABLE "poll" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "question" text NOT NULL,
  "description" text,
  "allow_multiple" boolean NOT NULL DEFAULT false,
  "anonymous" boolean NOT NULL DEFAULT false,
  "ends_at" timestamptz,
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "poll_question_valid" CHECK (length(trim("question")) BETWEEN 1 AND 300),
  CONSTRAINT "poll_description_valid" CHECK ("description" IS NULL OR length("description") <= 1500),
  CONSTRAINT "poll_end_valid" CHECK ("ends_at" IS NULL OR "ends_at" > "created_at")
);
CREATE UNIQUE INDEX "poll_instance_mutation_uq"
ON "poll" ("instance_id", "client_mutation_id");
CREATE INDEX "poll_instance_updated_idx"
ON "poll" ("instance_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "poll_instance_end_idx" ON "poll" ("instance_id", "ends_at");

CREATE TABLE "poll_option" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "poll_id" uuid NOT NULL REFERENCES "poll"("id") ON DELETE CASCADE,
  "position" smallint NOT NULL,
  "label" text NOT NULL,
  CONSTRAINT "poll_option_position_valid" CHECK ("position" BETWEEN 0 AND 11),
  CONSTRAINT "poll_option_label_valid" CHECK (length(trim("label")) BETWEEN 1 AND 160),
  CONSTRAINT "poll_option_position_uq" UNIQUE ("poll_id", "position")
);

CREATE TABLE "poll_vote" (
  "option_id" uuid NOT NULL REFERENCES "poll_option"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "poll_vote_pk" PRIMARY KEY ("option_id", "member_id")
);
CREATE INDEX "poll_vote_member_idx" ON "poll_vote" ("member_id");

CREATE OR REPLACE FUNCTION enforce_poll_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'poll'
  ) THEN
    RAISE EXCEPTION 'poll and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "poll_instance_match"
BEFORE INSERT OR UPDATE ON "poll"
FOR EACH ROW EXECUTE FUNCTION enforce_poll_instance();

CREATE OR REPLACE FUNCTION enforce_poll_vote_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM poll_option option
    JOIN poll p ON p.id = option.poll_id
    JOIN instance_member member ON member.id = NEW.member_id
    WHERE option.id = NEW.option_id AND p.instance_id = member.instance_id
  ) THEN
    RAISE EXCEPTION 'poll vote and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "poll_vote_same_instance"
BEFORE INSERT OR UPDATE ON "poll_vote"
FOR EACH ROW EXECUTE FUNCTION enforce_poll_vote_instance();
