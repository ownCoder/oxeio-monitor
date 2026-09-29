
CREATE TABLE office_entries (
 id SERIAL PRIMARY KEY, kind VARCHAR(32) NOT NULL CHECK (kind IN ('brief_template','brief','blocker','checklist_template','submission','sop','asset','lifecycle_template','lifecycle','coaching')),
 title VARCHAR(120) NOT NULL CHECK (length(trim(title))>0), content JSONB NOT NULL CHECK (jsonb_typeof(content)='object' AND octet_length(content::text)<=20000),
 employee_id INTEGER REFERENCES employees(id) ON DELETE RESTRICT,
 target_id INTEGER REFERENCES design_targets(id) ON DELETE RESTRICT,
 created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TIMESTAMPTZ(3)
);
CREATE INDEX office_entries_kind_updated_at_idx ON office_entries(kind,updated_at);
CREATE INDEX office_entries_employee_id_idx ON office_entries(employee_id);
CREATE INDEX office_entries_target_id_idx ON office_entries(target_id);
CREATE UNIQUE INDEX office_asset_tag_unique ON office_entries ((lower(content->>'tag'))) WHERE kind='asset';
CREATE TABLE office_events (
 id SERIAL PRIMARY KEY, entry_id INTEGER NOT NULL REFERENCES office_entries(id) ON DELETE RESTRICT,
 actor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT, actor_name VARCHAR(254) NOT NULL,
 action VARCHAR(20) NOT NULL, version INTEGER NOT NULL, snapshot JSONB NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX office_events_entry_id_id_idx ON office_events(entry_id,id);
CREATE TABLE office_acknowledgements (
 entry_id INTEGER NOT NULL REFERENCES office_entries(id) ON DELETE RESTRICT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(entry_id,user_id,version)
);
