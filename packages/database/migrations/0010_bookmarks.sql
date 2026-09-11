CREATE TABLE "tag" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tag_name_valid" CHECK (length(trim("name")) BETWEEN 1 AND 40)
);
CREATE UNIQUE INDEX "tag_instance_normalized_uq" ON "tag" ("instance_id", "normalized_name");

CREATE TABLE "bookmark" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "url" text NOT NULL,
  "normalized_url" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "personal_comment" text,
  "favicon_url" text,
  "og_image_url" text,
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bookmark_url_valid" CHECK (length("url") <= 2048 AND "url" ~* '^https?://'),
  CONSTRAINT "bookmark_title_valid" CHECK (length(trim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "bookmark_description_valid" CHECK ("description" IS NULL OR length("description") <= 1000),
  CONSTRAINT "bookmark_comment_valid" CHECK ("personal_comment" IS NULL OR length("personal_comment") <= 1000)
);
CREATE UNIQUE INDEX "bookmark_instance_mutation_uq"
ON "bookmark" ("instance_id", "client_mutation_id");
CREATE INDEX "bookmark_instance_updated_idx" ON "bookmark" ("instance_id", "updated_at" DESC, "id" DESC);

CREATE TABLE "resource_tag" (
  "resource_id" uuid NOT NULL REFERENCES "resource"("id") ON DELETE CASCADE,
  "tag_id" uuid NOT NULL REFERENCES "tag"("id") ON DELETE CASCADE,
  CONSTRAINT "resource_tag_pk" PRIMARY KEY ("resource_id", "tag_id")
);

CREATE TABLE "favorite" (
  "resource_id" uuid NOT NULL REFERENCES "resource"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "favorite_pk" PRIMARY KEY ("resource_id", "member_id")
);

CREATE TABLE "bookmark_reaction" (
  "bookmark_id" uuid NOT NULL REFERENCES "bookmark"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "reaction" text NOT NULL DEFAULT 'USEFUL',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "bookmark_reaction_pk" PRIMARY KEY ("bookmark_id", "member_id", "reaction"),
  CONSTRAINT "bookmark_reaction_valid" CHECK ("reaction" = 'USEFUL')
);

CREATE OR REPLACE FUNCTION enforce_bookmark_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'bookmark'
  ) THEN
    RAISE EXCEPTION 'bookmark and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookmark_instance_match"
BEFORE INSERT OR UPDATE ON "bookmark"
FOR EACH ROW EXECUTE FUNCTION enforce_bookmark_instance();

CREATE OR REPLACE FUNCTION enforce_resource_tag_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r JOIN tag t ON t.id = NEW.tag_id
    WHERE r.id = NEW.resource_id AND r.instance_id = t.instance_id
  ) THEN
    RAISE EXCEPTION 'resource and tag must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "resource_tag_same_instance"
BEFORE INSERT OR UPDATE ON "resource_tag"
FOR EACH ROW EXECUTE FUNCTION enforce_resource_tag_instance();

CREATE OR REPLACE FUNCTION enforce_member_resource_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r JOIN instance_member m ON m.id = NEW.member_id
    WHERE r.id = NEW.resource_id AND r.instance_id = m.instance_id
  ) THEN
    RAISE EXCEPTION 'resource and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "favorite_same_instance"
BEFORE INSERT OR UPDATE ON "favorite"
FOR EACH ROW EXECUTE FUNCTION enforce_member_resource_instance();

CREATE OR REPLACE FUNCTION enforce_bookmark_reaction_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bookmark b JOIN instance_member m ON m.id = NEW.member_id
    WHERE b.id = NEW.bookmark_id AND b.instance_id = m.instance_id
  ) THEN
    RAISE EXCEPTION 'bookmark and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "bookmark_reaction_same_instance"
BEFORE INSERT OR UPDATE ON "bookmark_reaction"
FOR EACH ROW EXECUTE FUNCTION enforce_bookmark_reaction_instance();
