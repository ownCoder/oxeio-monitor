CREATE TABLE "design_task_items" (
  "id" SERIAL NOT NULL,
  "target_id" INTEGER NOT NULL,
  "text" VARCHAR(200) NOT NULL,
  "position" INTEGER NOT NULL,
  "created_by_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  "completed_by_id" INTEGER,
  CONSTRAINT "design_task_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "design_task_items_text_check" CHECK (length(btrim("text")) BETWEEN 1 AND 200),
  CONSTRAINT "design_task_items_position_check" CHECK ("position" BETWEEN 1 AND 50),
  CONSTRAINT "design_task_items_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "design_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "design_task_items_target_id_position_key" ON "design_task_items"("target_id", "position");
CREATE INDEX "design_task_items_target_id_completed_at_idx" ON "design_task_items"("target_id", "completed_at");
