CREATE TABLE "design_target_events" (
  "id" SERIAL PRIMARY KEY,
  "target_id" INTEGER NOT NULL REFERENCES "design_targets"("id") ON DELETE CASCADE,
  "action" VARCHAR(32) NOT NULL,
  "actor_user_id" INTEGER,
  "actor_name" VARCHAR(200),
  "source" VARCHAR(40) NOT NULL,
  "before_state" JSONB,
  "after_state" JSONB NOT NULL,
  "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "design_target_events_target_id_id_idx" ON "design_target_events"("target_id", "id");
CREATE INDEX "design_target_events_recorded_at_action_idx" ON "design_target_events"("recorded_at", "action");

-- Capture changes, including raw SQL allocation/return, in the same transaction.
-- No historical backfill: previous assignments cannot be inferred from current rows.
CREATE FUNCTION record_design_target_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  before_json JSONB;
  after_json JSONB;
  event_action TEXT;
  actor_id INTEGER;
  actor_name TEXT;
  event_source TEXT;
BEGIN
  after_json := to_jsonb(NEW) - ARRAY['last_activity_at', 'updated_at'];
  IF TG_OP = 'INSERT' THEN
    event_action := 'added';
  ELSE
    before_json := to_jsonb(OLD) - ARRAY['last_activity_at', 'updated_at'];
    IF before_json = after_json THEN RETURN NEW; END IF;
    event_action := CASE
      WHEN NEW.status = 'pool' AND OLD.status <> 'pool' THEN 'returned'
      WHEN NEW.assigned_to_id IS DISTINCT FROM OLD.assigned_to_id AND NEW.assigned_to_id IS NOT NULL THEN 'assigned'
      WHEN NEW.status = 'done' AND OLD.status <> 'done' THEN 'completed'
      WHEN NEW.status = 'assigned' AND OLD.status = 'done' THEN 'undone'
      WHEN NEW.status = 'skipped' AND OLD.status <> 'skipped' THEN 'skipped'
      WHEN NEW.status = 'deleted' AND OLD.status <> 'deleted' THEN 'deleted'
      WHEN NEW.started_at IS DISTINCT FROM OLD.started_at AND NEW.started_at IS NOT NULL THEN 'started'
      WHEN NEW.checked_at IS DISTINCT FROM OLD.checked_at AND NEW.checked_at IS NOT NULL THEN 'checked'
      WHEN NEW.fixed_at IS DISTINCT FROM OLD.fixed_at AND NEW.fixed_at IS NOT NULL THEN 'fixed'
      WHEN NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at AND NEW.uploaded_at IS NOT NULL THEN 'uploaded'
      WHEN NEW.live_at IS DISTINCT FROM OLD.live_at AND NEW.live_at IS NOT NULL THEN 'live'
      WHEN NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at AND NEW.reviewed_at IS NOT NULL THEN 'reviewed'
      ELSE 'updated' END;
  END IF;
  actor_id := NULLIF(current_setting('oxeio.target_actor', true), '')::integer;
  event_source := COALESCE(NULLIF(current_setting('oxeio.target_source', true), ''), 'unattributed');
  IF actor_id IS NULL THEN
    actor_id := CASE event_action
      WHEN 'added' THEN NEW.added_by_id
      WHEN 'completed' THEN NEW.completed_by_id
      WHEN 'checked' THEN NEW.checked_by_id
      WHEN 'fixed' THEN NEW.fixed_by_id
      WHEN 'reviewed' THEN NEW.reviewed_by_id
      ELSE NULL END;
  END IF;
  IF actor_id IS NOT NULL THEN
    SELECT full_name INTO actor_name FROM users WHERE id = actor_id;
  END IF;
  INSERT INTO design_target_events(target_id, action, actor_user_id, actor_name, source, before_state, after_state, recorded_at)
  VALUES(NEW.id, event_action, actor_id, actor_name, event_source, before_json, after_json, clock_timestamp());
  RETURN NEW;
END;
$$;
CREATE TRIGGER design_target_history AFTER INSERT OR UPDATE ON design_targets
FOR EACH ROW EXECUTE FUNCTION record_design_target_event();

INSERT INTO settings(key, value) VALUES ('production.history.since', to_jsonb(CURRENT_TIMESTAMP))
ON CONFLICT (key) DO NOTHING;
