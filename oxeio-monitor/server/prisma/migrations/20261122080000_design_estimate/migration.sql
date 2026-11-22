ALTER TABLE "design_targets"
  ADD COLUMN "work_type" VARCHAR(24),
  ADD COLUMN "estimated_minutes" INTEGER;

ALTER TABLE "design_targets"
  ADD CONSTRAINT "design_targets_work_type_check"
    CHECK ("work_type" IS NULL OR "work_type" IN ('typography', 'graphic', 'illustration', 'seasonal', 'other')),
  ADD CONSTRAINT "design_targets_estimated_minutes_check"
    CHECK ("estimated_minutes" IS NULL OR "estimated_minutes" BETWEEN 5 AND 1440);
