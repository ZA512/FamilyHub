ALTER TABLE "message"
ADD COLUMN "deleted_at" timestamptz,
ADD COLUMN "deleted_by" uuid REFERENCES "instance_member"("id") ON DELETE RESTRICT,
ADD CONSTRAINT "message_deletion_complete" CHECK (
  ("deleted_at" IS NULL AND "deleted_by" IS NULL)
  OR ("deleted_at" IS NOT NULL AND "deleted_by" IS NOT NULL)
),
ADD CONSTRAINT "message_deletion_by_author" CHECK (
  "deleted_by" IS NULL OR "deleted_by" = "author_id"
);
