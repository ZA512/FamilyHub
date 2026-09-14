ALTER TABLE "family_task"
DROP CONSTRAINT "family_task_scheduled_fields";

CREATE INDEX "task_completion_member_date_idx"
ON "task_completion" ("completed_by", "completed_at" DESC);
