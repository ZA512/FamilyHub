ALTER TABLE "message" DROP CONSTRAINT "message_body_not_blank";

CREATE TABLE "attachment" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "uploaded_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "original_filename" text NOT NULL,
  "storage_key" uuid NOT NULL DEFAULT gen_random_uuid(),
  "declared_mime" text NOT NULL,
  "detected_mime" text,
  "expected_size" integer NOT NULL,
  "actual_size" integer,
  "sha256" text,
  "status" text NOT NULL DEFAULT 'PENDING',
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz,
  CONSTRAINT "attachment_filename_valid" CHECK (
    length(trim("original_filename")) > 0 AND length("original_filename") <= 255
  ),
  CONSTRAINT "attachment_size_valid" CHECK (
    "expected_size" > 0 AND ("actual_size" IS NULL OR "actual_size" > 0)
  ),
  CONSTRAINT "attachment_status_valid" CHECK (
    "status" IN ('PENDING', 'UPLOADING', 'UPLOADED', 'READY')
  )
);

CREATE UNIQUE INDEX "attachment_storage_key_uq" ON "attachment" ("storage_key");
CREATE UNIQUE INDEX "attachment_instance_mutation_uq"
ON "attachment" ("instance_id", "client_mutation_id");
CREATE INDEX "attachment_uploader_status_idx"
ON "attachment" ("uploaded_by", "status", "created_at" DESC);

CREATE TABLE "message_attachment" (
  "message_id" uuid NOT NULL REFERENCES "message"("id") ON DELETE CASCADE,
  "attachment_id" uuid NOT NULL REFERENCES "attachment"("id") ON DELETE RESTRICT,
  "sort_order" integer NOT NULL DEFAULT 0,
  CONSTRAINT "message_attachment_pk" PRIMARY KEY ("message_id", "attachment_id"),
  CONSTRAINT "message_attachment_attachment_uq" UNIQUE ("attachment_id")
);

CREATE OR REPLACE FUNCTION enforce_message_attachment_access() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM message m
    JOIN conversation c ON c.id = m.conversation_id
    JOIN attachment a ON a.id = NEW.attachment_id
    WHERE m.id = NEW.message_id
      AND a.instance_id = c.instance_id
      AND a.uploaded_by = m.author_id
      AND a.status = 'READY'
  ) THEN
    RAISE EXCEPTION 'attachment must be ready, owned by the author and belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "message_attachment_access"
BEFORE INSERT OR UPDATE ON "message_attachment"
FOR EACH ROW EXECUTE FUNCTION enforce_message_attachment_access();
