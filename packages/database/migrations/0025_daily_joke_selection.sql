CREATE TABLE "daily_joke_selection" (
  "instance_id" uuid PRIMARY KEY REFERENCES "instance"("id") ON DELETE CASCADE,
  "selected_date" date NOT NULL,
  "joke_id" text NOT NULL,
  "previous_joke_id" text
);
