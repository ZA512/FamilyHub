CREATE TABLE "meal" (
  "id" uuid PRIMARY KEY REFERENCES "resource"("id") ON DELETE CASCADE,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "photo_url" text,
  "reference_portions" integer NOT NULL DEFAULT 4,
  "instructions" text,
  "tags" text[] NOT NULL DEFAULT '{}',
  "comments" text,
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meal_name_not_blank" CHECK (length(trim("name")) > 0),
  CONSTRAINT "meal_reference_portions_valid" CHECK ("reference_portions" BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX "meal_instance_mutation_uq"
ON "meal" ("instance_id", "client_mutation_id");
CREATE INDEX "meal_instance_name_idx" ON "meal" ("instance_id", lower("name"));

CREATE TABLE "ingredient" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ingredient_name_not_blank" CHECK (length(trim("name")) > 0)
);

CREATE UNIQUE INDEX "ingredient_instance_normalized_uq"
ON "ingredient" ("instance_id", "normalized_name");

CREATE TABLE "meal_ingredient" (
  "meal_id" uuid NOT NULL REFERENCES "meal"("id") ON DELETE CASCADE,
  "ingredient_id" uuid NOT NULL REFERENCES "ingredient"("id") ON DELETE RESTRICT,
  "quantity" numeric(12, 3) NOT NULL,
  "unit" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  CONSTRAINT "meal_ingredient_pk" PRIMARY KEY ("meal_id", "ingredient_id"),
  CONSTRAINT "meal_ingredient_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "meal_ingredient_unit_not_blank" CHECK (length(trim("unit")) > 0)
);

CREATE TABLE "meal_preference" (
  "meal_id" uuid NOT NULL REFERENCES "meal"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "value" smallint NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meal_preference_pk" PRIMARY KEY ("meal_id", "member_id"),
  CONSTRAINT "meal_preference_value_valid" CHECK ("value" IN (-1, 0, 1))
);

CREATE INDEX "meal_preference_member_idx" ON "meal_preference" ("member_id");

CREATE TABLE "meal_plan_entry" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "meal_id" uuid NOT NULL REFERENCES "meal"("id") ON DELETE CASCADE,
  "date" date NOT NULL,
  "slot" text NOT NULL,
  "slot_label" text,
  "portions" integer NOT NULL,
  "note" text,
  "created_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "meal_plan_slot_valid" CHECK ("slot" IN ('LUNCH', 'DINNER', 'OTHER')),
  CONSTRAINT "meal_plan_other_label_required" CHECK (
    "slot" <> 'OTHER' OR COALESCE(length(trim("slot_label")), 0) > 0
  ),
  CONSTRAINT "meal_plan_portions_valid" CHECK ("portions" BETWEEN 1 AND 100)
);

CREATE UNIQUE INDEX "meal_plan_instance_mutation_uq"
ON "meal_plan_entry" ("instance_id", "client_mutation_id");
CREATE INDEX "meal_plan_instance_date_idx"
ON "meal_plan_entry" ("instance_id", "date", "slot");

CREATE OR REPLACE FUNCTION enforce_meal_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource r
    WHERE r.id = NEW.id AND r.instance_id = NEW.instance_id AND r.resource_type = 'meal'
  ) THEN
    RAISE EXCEPTION 'meal and resource must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meal_resource_same_instance"
BEFORE INSERT OR UPDATE ON "meal"
FOR EACH ROW EXECUTE FUNCTION enforce_meal_instance();

CREATE OR REPLACE FUNCTION enforce_meal_ingredient_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM meal m
    JOIN ingredient i ON i.id = NEW.ingredient_id
    WHERE m.id = NEW.meal_id AND m.instance_id = i.instance_id
  ) THEN
    RAISE EXCEPTION 'meal and ingredient must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meal_ingredient_same_instance"
BEFORE INSERT OR UPDATE ON "meal_ingredient"
FOR EACH ROW EXECUTE FUNCTION enforce_meal_ingredient_instance();

CREATE OR REPLACE FUNCTION enforce_meal_preference_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM meal m
    JOIN instance_member im ON im.id = NEW.member_id
    WHERE m.id = NEW.meal_id AND m.instance_id = im.instance_id
  ) THEN
    RAISE EXCEPTION 'meal and preference member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meal_preference_same_instance"
BEFORE INSERT OR UPDATE ON "meal_preference"
FOR EACH ROW EXECUTE FUNCTION enforce_meal_preference_instance();

CREATE OR REPLACE FUNCTION enforce_meal_plan_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM meal m
    JOIN instance_member im ON im.id = NEW.created_by
    WHERE m.id = NEW.meal_id
      AND m.instance_id = NEW.instance_id
      AND im.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'meal plan references must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "meal_plan_same_instance"
BEFORE INSERT OR UPDATE ON "meal_plan_entry"
FOR EACH ROW EXECUTE FUNCTION enforce_meal_plan_instance();
