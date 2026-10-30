CREATE TABLE "disabled_joke" (
  "instance_id" uuid NOT NULL REFERENCES "instance"("id") ON DELETE CASCADE,
  "joke_id" text NOT NULL,
  "disabled_by" uuid REFERENCES "instance_member"("id") ON DELETE SET NULL,
  "disabled_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("instance_id", "joke_id")
);
