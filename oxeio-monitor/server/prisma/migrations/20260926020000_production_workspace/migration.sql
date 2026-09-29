ALTER TABLE design_targets ADD COLUMN priority INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN due_at TIMESTAMPTZ(3), ADD COLUMN assignment_reason VARCHAR(500);
ALTER TABLE design_targets ADD CONSTRAINT target_priority_range CHECK (priority BETWEEN 0 AND 2);
CREATE TABLE design_previews (
  id SERIAL PRIMARY KEY, target_id INTEGER NOT NULL REFERENCES design_targets(id) ON DELETE CASCADE,
  version INTEGER NOT NULL, filename VARCHAR(120) NOT NULL, mime VARCHAR(32) NOT NULL,
  sha256 VARCHAR(64) NOT NULL, image BYTEA NOT NULL, author_id INTEGER NOT NULL,
  author_name VARCHAR(200) NOT NULL, note VARCHAR(1000) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT preview_image_size CHECK (octet_length(image) BETWEEN 1 AND 2097152)
);
CREATE UNIQUE INDEX design_previews_target_id_version_key ON design_previews(target_id, version);
CREATE UNIQUE INDEX design_previews_target_id_sha256_key ON design_previews(target_id, sha256);
CREATE TABLE design_comments (
  id SERIAL PRIMARY KEY, preview_id INTEGER NOT NULL REFERENCES design_previews(id) ON DELETE CASCADE,
  author_id INTEGER NOT NULL, author_name VARCHAR(200) NOT NULL, text VARCHAR(2000) NOT NULL,
  x DOUBLE PRECISION, y DOUBLE PRECISION, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ(3), resolved_by_id INTEGER,
  CONSTRAINT comment_position CHECK ((x IS NULL AND y IS NULL) OR (x IS NOT NULL AND y IS NOT NULL AND x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1))
);
CREATE INDEX design_comments_preview_id_id_idx ON design_comments(preview_id, id);
CREATE TABLE sales_imports (
  id SERIAL PRIMARY KEY, sha256 VARCHAR(64) NOT NULL, name VARCHAR(120) NOT NULL,
  actor_id INTEGER NOT NULL, created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX sales_imports_sha256_key ON sales_imports(sha256);
CREATE TABLE product_sales (
  id SERIAL PRIMARY KEY, import_id INTEGER NOT NULL REFERENCES sales_imports(id) ON DELETE CASCADE,
  period VARCHAR(7) NOT NULL, live_asin VARCHAR(20) NOT NULL, units INTEGER NOT NULL,
  royalty DECIMAL(14,2) NOT NULL, currency VARCHAR(3) NOT NULL,
  target_id INTEGER REFERENCES design_targets(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX product_sales_period_live_asin_currency_key ON product_sales(period, live_asin, currency);
CREATE INDEX product_sales_target_id_idx ON product_sales(target_id);
CREATE TABLE product_costs (
  id SERIAL PRIMARY KEY, target_id INTEGER NOT NULL REFERENCES design_targets(id) ON DELETE CASCADE,
  amount DECIMAL(14,2) NOT NULL CHECK (amount >= 0), currency VARCHAR(3) NOT NULL,
  note VARCHAR(500) NOT NULL, actor_id INTEGER NOT NULL,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX product_costs_target_id_currency_key ON product_costs(target_id, currency);
