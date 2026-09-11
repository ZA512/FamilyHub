CREATE TABLE "collection" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "type" text NOT NULL,
  "image_url" text,
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_name_valid" CHECK (length(trim("name")) BETWEEN 1 AND 120),
  CONSTRAINT "collection_description_valid" CHECK ("description" IS NULL OR length("description") <= 1000),
  CONSTRAINT "collection_type_valid" CHECK ("type" IN (
    'BOOKS', 'MOVIES', 'SERIES', 'CREATORS', 'MUSIC', 'RESTAURANTS',
    'GAMES', 'PLACES', 'GIFTS', 'OTHER'
  )),
  CONSTRAINT "collection_image_url_valid" CHECK (
    "image_url" IS NULL OR (length("image_url") <= 2048 AND "image_url" ~* '^https?://')
  )
);
CREATE UNIQUE INDEX "collection_instance_mutation_uq"
ON "collection" ("instance_id", "client_mutation_id");
CREATE INDEX "collection_instance_updated_idx"
ON "collection" ("instance_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "collection_instance_type_idx" ON "collection" ("instance_id", "type");

CREATE TABLE "collection_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "collection_id" uuid NOT NULL REFERENCES "collection"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "subtitle" text,
  "description" text,
  "url" text,
  "image_url" text,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "added_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "collection_item_title_valid" CHECK (length(trim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "collection_item_subtitle_valid" CHECK ("subtitle" IS NULL OR length("subtitle") <= 240),
  CONSTRAINT "collection_item_description_valid" CHECK ("description" IS NULL OR length("description") <= 2000),
  CONSTRAINT "collection_item_url_valid" CHECK (
    "url" IS NULL OR (length("url") <= 2048 AND "url" ~* '^https?://')
  ),
  CONSTRAINT "collection_item_image_url_valid" CHECK (
    "image_url" IS NULL OR (length("image_url") <= 2048 AND "image_url" ~* '^https?://')
  ),
  CONSTRAINT "collection_item_metadata_valid" CHECK (jsonb_typeof("metadata_json") = 'object')
);
CREATE UNIQUE INDEX "collection_item_instance_mutation_uq"
ON "collection_item" ("instance_id", "client_mutation_id");
CREATE INDEX "collection_item_collection_updated_idx"
ON "collection_item" ("collection_id", "updated_at" DESC, "id" DESC)
WHERE "deleted_at" IS NULL;

CREATE TABLE "collection_item_tag" (
  "item_id" uuid NOT NULL REFERENCES "collection_item"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "tag"("id") ON DELETE CASCADE,
  CONSTRAINT "collection_item_tag_pk" PRIMARY KEY ("item_id", "tag_id")
);

CREATE TABLE "collection_item_preference" (
  "item_id" uuid NOT NULL REFERENCES "collection_item"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "value" smallint NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_item_preference_pk" PRIMARY KEY ("item_id", "member_id"),
  CONSTRAINT "collection_item_preference_value_valid" CHECK ("value" IN (-1, 0, 1))
);

CREATE TABLE "collection_item_comment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id" uuid NOT NULL REFERENCES "collection_item"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "collection_item_comment_body_valid" CHECK (length(trim("body")) BETWEEN 1 AND 1000),
  CONSTRAINT "collection_item_comment_mutation_uq" UNIQUE ("item_id", "client_mutation_id")
);
CREATE INDEX "collection_item_comment_item_created_idx"
ON "collection_item_comment" ("item_id", "created_at") WHERE "deleted_at" IS NULL;

CREATE OR REPLACE FUNCTION enforce_collection_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'collection'
  ) THEN
    RAISE EXCEPTION 'collection and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "collection_instance_match"
BEFORE INSERT OR UPDATE ON "collection"
FOR EACH ROW EXECUTE FUNCTION enforce_collection_instance();

CREATE OR REPLACE FUNCTION enforce_collection_item_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM collection c JOIN instance_member m ON m.id = NEW.added_by
    WHERE c.id = NEW.collection_id
      AND c.instance_id = NEW.instance_id
      AND m.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'collection item, collection and author must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "collection_item_instance_match"
BEFORE INSERT OR UPDATE ON "collection_item"
FOR EACH ROW EXECUTE FUNCTION enforce_collection_item_instance();

CREATE OR REPLACE FUNCTION enforce_collection_item_tag_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM collection_item item JOIN tag t ON t.id = NEW.tag_id
    WHERE item.id = NEW.item_id AND item.instance_id = t.instance_id
  ) THEN
    RAISE EXCEPTION 'collection item and tag must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "collection_item_tag_same_instance"
BEFORE INSERT OR UPDATE ON "collection_item_tag"
FOR EACH ROW EXECUTE FUNCTION enforce_collection_item_tag_instance();

CREATE OR REPLACE FUNCTION enforce_collection_preference_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM collection_item item JOIN instance_member m ON m.id = NEW.member_id
    WHERE item.id = NEW.item_id AND item.instance_id = m.instance_id
  ) THEN
    RAISE EXCEPTION 'collection item and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "collection_item_preference_same_instance"
BEFORE INSERT OR UPDATE ON "collection_item_preference"
FOR EACH ROW EXECUTE FUNCTION enforce_collection_preference_instance();

CREATE OR REPLACE FUNCTION enforce_collection_comment_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM collection_item item JOIN instance_member m ON m.id = NEW.member_id
    WHERE item.id = NEW.item_id AND item.instance_id = m.instance_id
  ) THEN
    RAISE EXCEPTION 'collection item and comment author must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "collection_item_comment_same_instance"
BEFORE INSERT OR UPDATE ON "collection_item_comment"
FOR EACH ROW EXECUTE FUNCTION enforce_collection_comment_instance();
