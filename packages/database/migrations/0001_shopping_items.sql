CREATE TABLE "shopping_item" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "quantity" text,
  "note" text,
  "source" text DEFAULT 'MANUAL' NOT NULL,
  "requested_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "purchased_by" uuid REFERENCES "instance_member"("id") ON DELETE SET NULL,
  "purchased_at" timestamptz,
  "client_mutation_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz,
  CONSTRAINT "shopping_item_name_not_blank" CHECK (length(trim("name")) > 0),
  CONSTRAINT "shopping_item_purchase_consistent" CHECK (
    ("purchased_at" IS NULL AND "purchased_by" IS NULL)
    OR ("purchased_at" IS NOT NULL AND "purchased_by" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "shopping_item_instance_mutation_uq"
ON "shopping_item" ("instance_id", "client_mutation_id");

CREATE INDEX "shopping_item_instance_state_idx"
ON "shopping_item" ("instance_id", "purchased_at", "created_at");

CREATE OR REPLACE FUNCTION enforce_shopping_item_member_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM instance_member m
    WHERE m.id = NEW.requested_by AND m.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'shopping item and requester must belong to the same instance';
  END IF;

  IF NEW.purchased_by IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM instance_member m
    WHERE m.id = NEW.purchased_by AND m.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'shopping item and purchaser must belong to the same instance';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shopping_item_members_same_instance"
BEFORE INSERT OR UPDATE ON "shopping_item"
FOR EACH ROW EXECUTE FUNCTION enforce_shopping_item_member_instance();
