CREATE TABLE "idea" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "category" text NOT NULL DEFAULT 'GENERAL',
  "status" text NOT NULL DEFAULT 'PROPOSED',
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "idea_title_valid" CHECK (length(trim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "idea_description_valid" CHECK ("description" IS NULL OR length("description") <= 2000),
  CONSTRAINT "idea_category_valid" CHECK ("category" IN (
    'OUTING', 'MOVIE', 'PURCHASE', 'ACTIVITY', 'PROJECT', 'RESTAURANT', 'DESTINATION', 'GENERAL'
  )),
  CONSTRAINT "idea_status_valid" CHECK ("status" IN ('PROPOSED', 'RETAINED', 'REJECTED', 'REALIZED'))
);
CREATE UNIQUE INDEX "idea_instance_mutation_uq"
ON "idea" ("instance_id", "client_mutation_id");
CREATE INDEX "idea_instance_updated_idx"
ON "idea" ("instance_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "idea_instance_status_idx" ON "idea" ("instance_id", "status");

CREATE TABLE "idea_reaction" (
  "idea_id" uuid NOT NULL REFERENCES "idea"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "value" smallint NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "idea_reaction_pk" PRIMARY KEY ("idea_id", "member_id"),
  CONSTRAINT "idea_reaction_value_valid" CHECK ("value" IN (-1, 1))
);

CREATE TABLE "idea_comment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idea_id" uuid NOT NULL REFERENCES "idea"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "idea_comment_body_valid" CHECK (length(trim("body")) BETWEEN 1 AND 1000),
  CONSTRAINT "idea_comment_mutation_uq" UNIQUE ("idea_id", "client_mutation_id")
);
CREATE INDEX "idea_comment_idea_created_idx"
ON "idea_comment" ("idea_id", "created_at") WHERE "deleted_at" IS NULL;

CREATE TABLE "idea_conversion" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "idea_id" uuid NOT NULL REFERENCES "idea"("id") ON DELETE CASCADE,
  "target_type" text NOT NULL,
  "target_id" uuid NOT NULL,
  "converted_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "idea_conversion_target_valid" CHECK ("target_type" IN ('TASK', 'EVENT', 'COLLECTION_ITEM')),
  CONSTRAINT "idea_conversion_idea_uq" UNIQUE ("idea_id"),
  CONSTRAINT "idea_conversion_mutation_uq" UNIQUE ("idea_id", "client_mutation_id")
);

CREATE OR REPLACE FUNCTION enforce_idea_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'idea'
  ) THEN
    RAISE EXCEPTION 'idea and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "idea_instance_match"
BEFORE INSERT OR UPDATE ON "idea"
FOR EACH ROW EXECUTE FUNCTION enforce_idea_instance();

CREATE OR REPLACE FUNCTION enforce_idea_member_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM idea i JOIN instance_member member ON member.id = NEW.member_id
    WHERE i.id = NEW.idea_id AND i.instance_id = member.instance_id
  ) THEN
    RAISE EXCEPTION 'idea relation and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "idea_reaction_same_instance"
BEFORE INSERT OR UPDATE ON "idea_reaction"
FOR EACH ROW EXECUTE FUNCTION enforce_idea_member_instance();

CREATE TRIGGER "idea_comment_same_instance"
BEFORE INSERT OR UPDATE ON "idea_comment"
FOR EACH ROW EXECUTE FUNCTION enforce_idea_member_instance();

CREATE OR REPLACE FUNCTION enforce_idea_conversion_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM idea i JOIN instance_member member ON member.id = NEW.converted_by
    WHERE i.id = NEW.idea_id AND i.instance_id = member.instance_id
  ) THEN
    RAISE EXCEPTION 'idea conversion and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "idea_conversion_same_instance"
BEFORE INSERT OR UPDATE ON "idea_conversion"
FOR EACH ROW EXECUTE FUNCTION enforce_idea_conversion_instance();
