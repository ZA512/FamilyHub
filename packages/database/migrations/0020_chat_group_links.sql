ALTER TABLE "conversation"
ADD COLUMN "source_group_id" uuid REFERENCES "member_group"("id") ON DELETE SET NULL;

ALTER TABLE "conversation"
ADD CONSTRAINT "conversation_source_group_type_valid"
CHECK ("source_group_id" IS NULL OR "type" = 'GROUP');

CREATE INDEX "conversation_source_group_idx"
ON "conversation" ("source_group_id") WHERE "source_group_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_conversation_source_group_instance() RETURNS trigger AS $$
BEGIN
  IF NEW.source_group_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member_group g
    WHERE g.id = NEW.source_group_id AND g.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'conversation and source group must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "conversation_source_group_same_instance"
BEFORE INSERT OR UPDATE ON "conversation"
FOR EACH ROW EXECUTE FUNCTION enforce_conversation_source_group_instance();
