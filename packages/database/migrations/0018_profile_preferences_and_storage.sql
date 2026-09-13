ALTER TABLE "attachment"
ADD COLUMN "upload_purpose" text DEFAULT 'RESOURCE' NOT NULL;

ALTER TABLE "attachment"
ADD CONSTRAINT "attachment_upload_purpose_valid"
CHECK ("upload_purpose" IN ('RESOURCE', 'AVATAR'));

CREATE TABLE "member_profile_preference" (
  "member_id" uuid PRIMARY KEY REFERENCES "instance_member"("id") ON DELETE CASCADE,
  "avatar_attachment_id" uuid UNIQUE REFERENCES "attachment"("id") ON DELETE SET NULL,
  "birthday_event_id" uuid UNIQUE REFERENCES "calendar_event"("id") ON DELETE SET NULL,
  "locale" text DEFAULT 'fr' NOT NULL,
  "visibility" text DEFAULT 'ALL_MEMBERS' NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "member_profile_preference_locale_valid"
    CHECK ("locale" IN ('fr', 'en')),
  CONSTRAINT "member_profile_preference_visibility_valid"
    CHECK ("visibility" IN ('ALL_MEMBERS', 'PRIVATE'))
);
