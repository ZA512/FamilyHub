CREATE TABLE "document" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "category" text NOT NULL,
  "comment" text,
  "attachment_id" uuid NOT NULL UNIQUE REFERENCES "attachment"("id") ON DELETE RESTRICT,
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "document_title_valid" CHECK (length(trim("title")) BETWEEN 1 AND 200),
  CONSTRAINT "document_category_valid" CHECK (length(trim("category")) BETWEEN 1 AND 80),
  CONSTRAINT "document_comment_valid" CHECK ("comment" IS NULL OR length("comment") <= 2000)
);

CREATE UNIQUE INDEX "document_instance_mutation_uq"
ON "document" ("instance_id", "client_mutation_id");
CREATE INDEX "document_instance_updated_idx"
ON "document" ("instance_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "document_instance_category_idx"
ON "document" ("instance_id", lower("category"));

CREATE OR REPLACE FUNCTION enforce_document_access() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r JOIN attachment a ON a.id = NEW.attachment_id
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id
      AND r.resource_type = 'document' AND a.instance_id = NEW.instance_id
      AND a.uploaded_by = r.created_by AND a.status = 'READY'
  ) THEN
    RAISE EXCEPTION 'document, resource and ready attachment must belong to the same instance and author';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "document_access_match"
BEFORE INSERT OR UPDATE ON "document"
FOR EACH ROW EXECUTE FUNCTION enforce_document_access();
