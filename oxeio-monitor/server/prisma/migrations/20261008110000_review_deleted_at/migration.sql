BEGIN;
ALTER TABLE "design_targets" ADD COLUMN "deleted_at" TIMESTAMPTZ(3);
-- Historical backfill is metadata reconstruction, not a new user action.
-- Hold the table lock until the trigger is restored before accepting writes.
ALTER TABLE "design_targets" DISABLE TRIGGER "design_target_history";

UPDATE "design_targets" AS target
SET "deleted_at" = history.recorded_at
FROM (
  SELECT target_id, MAX(recorded_at) AS recorded_at
  FROM "design_target_events"
  WHERE action = 'deleted'
  GROUP BY target_id
) AS history
WHERE target.id = history.target_id AND target.status = 'deleted';

ALTER TABLE "design_targets" ENABLE TRIGGER "design_target_history";
CREATE INDEX "design_targets_review_deleted_at_idx" ON "design_targets"("deleted_at" DESC)
WHERE status = 'deleted' AND reviewed_at IS NULL;
COMMIT;
