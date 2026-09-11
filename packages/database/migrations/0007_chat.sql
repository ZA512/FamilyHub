CREATE TABLE "conversation" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "title" text,
  "direct_key" text,
  "created_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "deleted_at" timestamptz,
  CONSTRAINT "conversation_type_valid" CHECK ("type" IN ('DIRECT', 'GROUP', 'TOPIC')),
  CONSTRAINT "conversation_title_valid" CHECK (
    "type" = 'DIRECT' OR COALESCE(length(trim("title")), 0) > 0
  )
);

CREATE UNIQUE INDEX "conversation_instance_mutation_uq"
ON "conversation" ("instance_id", "client_mutation_id");
CREATE UNIQUE INDEX "conversation_direct_key_uq"
ON "conversation" ("instance_id", "direct_key") WHERE "direct_key" IS NOT NULL AND "deleted_at" IS NULL;
CREATE INDEX "conversation_instance_updated_idx"
ON "conversation" ("instance_id", "updated_at" DESC) WHERE "deleted_at" IS NULL;

CREATE TABLE "conversation_member" (
  "conversation_id" uuid NOT NULL REFERENCES "conversation"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "joined_at" timestamptz NOT NULL DEFAULT now(),
  "last_read_at" timestamptz,
  "muted" boolean NOT NULL DEFAULT false,
  CONSTRAINT "conversation_member_pk" PRIMARY KEY ("conversation_id", "member_id")
);

CREATE INDEX "conversation_member_member_idx"
ON "conversation_member" ("member_id", "conversation_id");

CREATE TABLE "message" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "conversation_id" uuid NOT NULL REFERENCES "conversation"("id") ON DELETE CASCADE,
  "author_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "body" text NOT NULL,
  "reply_to_id" uuid REFERENCES "message"("id") ON DELETE SET NULL,
  "client_mutation_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "message_body_not_blank" CHECK (length(trim("body")) > 0),
  CONSTRAINT "message_body_length" CHECK (length("body") <= 4000)
);

CREATE UNIQUE INDEX "message_conversation_mutation_uq"
ON "message" ("conversation_id", "client_mutation_id");
CREATE INDEX "message_conversation_created_idx"
ON "message" ("conversation_id", "created_at" DESC, "id" DESC);

CREATE TABLE "message_reaction" (
  "message_id" uuid NOT NULL REFERENCES "message"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "emoji" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "message_reaction_pk" PRIMARY KEY ("message_id", "member_id", "emoji"),
  CONSTRAINT "message_reaction_emoji_valid" CHECK ("emoji" IN ('👍', '❤️', '😂', '😮', '😢', '👏'))
);

CREATE OR REPLACE FUNCTION enforce_conversation_member_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation c
    JOIN instance_member im ON im.id = NEW.member_id
    WHERE c.id = NEW.conversation_id AND c.instance_id = im.instance_id
  ) THEN
    RAISE EXCEPTION 'conversation and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "conversation_member_same_instance"
BEFORE INSERT OR UPDATE ON "conversation_member"
FOR EACH ROW EXECUTE FUNCTION enforce_conversation_member_instance();

CREATE OR REPLACE FUNCTION enforce_message_membership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM conversation_member cm
    WHERE cm.conversation_id = NEW.conversation_id AND cm.member_id = NEW.author_id
  ) THEN
    RAISE EXCEPTION 'message author must be a conversation member';
  END IF;
  IF NEW.reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM message parent
    WHERE parent.id = NEW.reply_to_id AND parent.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'reply target must belong to the same conversation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "message_author_membership"
BEFORE INSERT OR UPDATE ON "message"
FOR EACH ROW EXECUTE FUNCTION enforce_message_membership();

CREATE OR REPLACE FUNCTION enforce_message_reaction_membership() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM message m
    JOIN conversation_member cm ON cm.conversation_id = m.conversation_id
    WHERE m.id = NEW.message_id AND cm.member_id = NEW.member_id
  ) THEN
    RAISE EXCEPTION 'reaction author must be a conversation member';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "message_reaction_membership"
BEFORE INSERT OR UPDATE ON "message_reaction"
FOR EACH ROW EXECUTE FUNCTION enforce_message_reaction_membership();
