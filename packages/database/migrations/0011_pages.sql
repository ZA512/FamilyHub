CREATE TABLE "page" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "content_json" jsonb NOT NULL,
  "content_text" text NOT NULL DEFAULT '',
  "folder" text,
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "page_title_valid" CHECK (length(trim("title")) BETWEEN 1 AND 160),
  CONSTRAINT "page_content_text_valid" CHECK (length("content_text") <= 100000),
  CONSTRAINT "page_folder_valid" CHECK ("folder" IS NULL OR length(trim("folder")) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX "page_instance_mutation_uq" ON "page" ("instance_id", "client_mutation_id");
CREATE INDEX "page_instance_updated_idx" ON "page" ("instance_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "page_instance_folder_idx" ON "page" ("instance_id", "folder");

CREATE TABLE "page_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "page_id" uuid NOT NULL REFERENCES "page"("id") ON DELETE CASCADE,
  "revision_number" integer NOT NULL,
  "title" text NOT NULL,
  "content_json" jsonb NOT NULL,
  "content_text" text NOT NULL DEFAULT '',
  "folder" text,
  "visibility" "visibility" NOT NULL,
  "group_ids" uuid[] NOT NULL DEFAULT '{}',
  "member_ids" uuid[] NOT NULL DEFAULT '{}',
  "tags" text[] NOT NULL DEFAULT '{}',
  "linked_page_ids" uuid[] NOT NULL DEFAULT '{}',
  "edited_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "page_revision_number_valid" CHECK ("revision_number" > 0),
  CONSTRAINT "page_revision_page_number_uq" UNIQUE ("page_id", "revision_number")
);
CREATE INDEX "page_revision_page_created_idx"
ON "page_revision" ("page_id", "created_at" DESC);

CREATE TABLE "page_link" (
  "source_page_id" uuid NOT NULL REFERENCES "page"("id") ON DELETE CASCADE,
  "target_page_id" uuid NOT NULL REFERENCES "page"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "page_link_pk" PRIMARY KEY ("source_page_id", "target_page_id"),
  CONSTRAINT "page_link_not_self" CHECK ("source_page_id" <> "target_page_id")
);
CREATE INDEX "page_link_target_idx" ON "page_link" ("target_page_id");

CREATE OR REPLACE FUNCTION enforce_page_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'page'
  ) THEN
    RAISE EXCEPTION 'page and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "page_instance_match"
BEFORE INSERT OR UPDATE ON "page"
FOR EACH ROW EXECUTE FUNCTION enforce_page_instance();

CREATE OR REPLACE FUNCTION enforce_page_link_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM page source_page
    JOIN page target_page ON target_page.id = NEW.target_page_id
    WHERE source_page.id = NEW.source_page_id
      AND source_page.instance_id = target_page.instance_id
  ) THEN
    RAISE EXCEPTION 'linked pages must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "page_link_same_instance"
BEFORE INSERT OR UPDATE ON "page_link"
FOR EACH ROW EXECUTE FUNCTION enforce_page_link_instance();
