CREATE TYPE "member_role" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "member_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "visibility" AS ENUM ('PRIVATE', 'ALL_MEMBERS', 'GROUPS', 'SELECTED_USERS');

CREATE TABLE "instance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "locale" text DEFAULT 'fr' NOT NULL,
  "timezone" text DEFAULT 'Europe/Paris' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE "app_user" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "first_name" text NOT NULL,
  "last_name" text,
  "phone" text,
  "birth_date" text,
  "timezone" text DEFAULT 'Europe/Paris' NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "app_user_email_uq" ON "app_user" ("email");

CREATE TABLE "instance_member" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "app_user"("id") ON DELETE CASCADE,
  "role" "member_role" DEFAULT 'MEMBER' NOT NULL,
  "status" "member_status" DEFAULT 'ACTIVE' NOT NULL,
  "joined_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "instance_member_instance_user_uq" ON "instance_member" ("instance_id", "user_id");
CREATE INDEX "instance_member_instance_idx" ON "instance_member" ("instance_id");

CREATE TABLE "member_group" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "is_system" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "member_group_instance_name_uq" ON "member_group" ("instance_id", "name");

CREATE TABLE "group_membership" (
  "group_id" uuid NOT NULL REFERENCES "member_group"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "group_membership_pk" PRIMARY KEY ("group_id", "member_id")
);

CREATE TABLE "module_config" (
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "module_key" text NOT NULL,
  "enabled" boolean NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "module_config_pk" PRIMARY KEY ("instance_id", "module_key")
);

CREATE TABLE "session" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "csrf_hash" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "last_seen_at" timestamptz DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "session_token_hash_uq" ON "session" ("token_hash");
CREATE INDEX "session_member_idx" ON "session" ("member_id");
CREATE INDEX "session_expiry_idx" ON "session" ("expires_at");

CREATE TABLE "resource" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "resource_type" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE RESTRICT,
  "visibility" "visibility" DEFAULT 'PRIVATE' NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  "deleted_at" timestamptz
);
CREATE INDEX "resource_instance_type_idx" ON "resource" ("instance_id", "resource_type");
CREATE INDEX "resource_creator_idx" ON "resource" ("created_by");

CREATE TABLE "resource_acl_group" (
  "resource_id" uuid NOT NULL REFERENCES "resource"("id") ON DELETE CASCADE,
  "group_id" uuid NOT NULL REFERENCES "member_group"("id") ON DELETE CASCADE,
  CONSTRAINT "resource_acl_group_pk" PRIMARY KEY ("resource_id", "group_id")
);

CREATE TABLE "resource_acl_user" (
  "resource_id" uuid NOT NULL REFERENCES "resource"("id") ON DELETE CASCADE,
  "member_id" uuid NOT NULL REFERENCES "instance_member"("id") ON DELETE CASCADE,
  CONSTRAINT "resource_acl_user_pk" PRIMARY KEY ("resource_id", "member_id")
);

CREATE TABLE "admin_audit_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "actor_member_id" uuid REFERENCES "instance_member"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" uuid,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX "admin_audit_instance_created_idx" ON "admin_audit_log" ("instance_id", "created_at");

CREATE OR REPLACE FUNCTION enforce_group_membership_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM member_group g
    JOIN instance_member m ON m.id = NEW.member_id
    WHERE g.id = NEW.group_id AND g.instance_id = m.instance_id
  ) THEN
    RAISE EXCEPTION 'group and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "group_membership_same_instance"
BEFORE INSERT OR UPDATE ON "group_membership"
FOR EACH ROW EXECUTE FUNCTION enforce_group_membership_instance();

CREATE OR REPLACE FUNCTION enforce_resource_acl_group_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM resource r
    JOIN member_group g ON g.id = NEW.group_id
    WHERE r.id = NEW.resource_id AND r.instance_id = g.instance_id
  ) THEN
    RAISE EXCEPTION 'resource and group must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "resource_acl_group_same_instance"
BEFORE INSERT OR UPDATE ON "resource_acl_group"
FOR EACH ROW EXECUTE FUNCTION enforce_resource_acl_group_instance();

CREATE OR REPLACE FUNCTION enforce_resource_acl_user_instance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM resource r
    JOIN instance_member m ON m.id = NEW.member_id
    WHERE r.id = NEW.resource_id AND r.instance_id = m.instance_id
  ) THEN
    RAISE EXCEPTION 'resource and member must belong to the same instance';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "resource_acl_user_same_instance"
BEFORE INSERT OR UPDATE ON "resource_acl_user"
FOR EACH ROW EXECUTE FUNCTION enforce_resource_acl_user_instance();
