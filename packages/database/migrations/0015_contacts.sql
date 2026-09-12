CREATE TABLE "contact" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "first_name" text NOT NULL,
  "last_name" text,
  "phone" text,
  "email" text,
  "address" text,
  "notes" text,
  "client_mutation_id" uuid NOT NULL,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "contact_first_name_valid" CHECK (length(trim("first_name")) BETWEEN 1 AND 80),
  CONSTRAINT "contact_last_name_valid" CHECK ("last_name" IS NULL OR length("last_name") <= 80),
  CONSTRAINT "contact_phone_valid" CHECK ("phone" IS NULL OR length("phone") <= 40),
  CONSTRAINT "contact_email_valid" CHECK ("email" IS NULL OR length("email") <= 254),
  CONSTRAINT "contact_address_valid" CHECK ("address" IS NULL OR length("address") <= 500),
  CONSTRAINT "contact_notes_valid" CHECK ("notes" IS NULL OR length("notes") <= 2000)
);

CREATE UNIQUE INDEX "contact_instance_mutation_uq"
ON "contact" ("instance_id", "client_mutation_id");
CREATE INDEX "contact_instance_updated_idx"
ON "contact" ("instance_id", "updated_at" DESC, "id" DESC);
CREATE INDEX "contact_instance_name_idx"
ON "contact" ("instance_id", lower("last_name"), lower("first_name"));

CREATE OR REPLACE FUNCTION enforce_contact_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'contact'
  ) THEN
    RAISE EXCEPTION 'contact and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contact_instance_match"
BEFORE INSERT OR UPDATE ON "contact"
FOR EACH ROW EXECUTE FUNCTION enforce_contact_instance();
