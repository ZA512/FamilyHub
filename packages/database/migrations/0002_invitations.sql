CREATE TABLE "invite" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "role" "member_role" DEFAULT 'MEMBER' NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "consumed_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "invite_token_hash_uq" ON "invite" ("token_hash");
CREATE UNIQUE INDEX "invite_instance_email_active_uq"
ON "invite" ("instance_id", "email")
WHERE "consumed_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "invite_instance_email_idx" ON "invite" ("instance_id", "email");
CREATE INDEX "invite_expiry_idx" ON "invite" ("expires_at");

CREATE OR REPLACE FUNCTION enforce_invite_creator_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM instance_member m
    WHERE m.id = NEW.created_by AND m.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'invite and creator must belong to the same instance';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invite_creator_same_instance"
BEFORE INSERT OR UPDATE ON "invite"
FOR EACH ROW EXECUTE FUNCTION enforce_invite_creator_instance();
