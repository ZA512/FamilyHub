CREATE TABLE "collection_item_recommendation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "item_id" uuid NOT NULL REFERENCES "collection_item"("id") ON DELETE CASCADE,
  "sender_member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "recipient_member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_item_recommendation_distinct_members"
    CHECK ("sender_member_id" <> "recipient_member_id"),
  CONSTRAINT "collection_item_recommendation_unique"
    UNIQUE ("item_id", "sender_member_id", "recipient_member_id")
);

CREATE INDEX "collection_item_recommendation_recipient_created_idx"
ON "collection_item_recommendation" ("recipient_member_id", "created_at" DESC);

CREATE INDEX "collection_item_recommendation_sender_item_idx"
ON "collection_item_recommendation" ("sender_member_id", "item_id");

CREATE OR REPLACE FUNCTION enforce_collection_item_recommendation_instance()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM collection_item item
    JOIN instance_member sender ON sender.id = NEW.sender_member_id
    JOIN instance_member recipient ON recipient.id = NEW.recipient_member_id
    WHERE item.id = NEW.item_id
      AND item.instance_id = NEW.instance_id
      AND sender.instance_id = NEW.instance_id
      AND recipient.instance_id = NEW.instance_id
  ) THEN
    RAISE EXCEPTION 'collection recommendation participants and item must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "collection_item_recommendation_same_instance"
BEFORE INSERT OR UPDATE ON "collection_item_recommendation"
FOR EACH ROW EXECUTE FUNCTION enforce_collection_item_recommendation_instance();

CREATE OR REPLACE FUNCTION cleanup_collection_item_recommendation_notification()
RETURNS trigger AS $$
BEGIN
  DELETE FROM notification
  WHERE resource_type = 'collection_item_recommendation'
    AND resource_id = OLD.id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "collection_item_recommendation_notification_cleanup"
AFTER DELETE ON "collection_item_recommendation"
FOR EACH ROW EXECUTE FUNCTION cleanup_collection_item_recommendation_notification();
