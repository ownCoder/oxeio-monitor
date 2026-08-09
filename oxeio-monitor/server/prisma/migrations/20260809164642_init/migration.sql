-- CreateEnum
CREATE TYPE "SegmentState" AS ENUM ('active', 'idle', 'locked');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'manager', 'employee');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "Productivity" AS ENUM ('productive', 'neutral', 'unproductive');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('process', 'domain', 'title_regex');

-- CreateEnum
CREATE TYPE "DayType" AS ENUM ('worked', 'no_activity', 'holiday');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('logoff', 'shutdown', 'timeout', 'day_rollover');

-- CreateEnum
CREATE TYPE "AdjustmentCause" AS ENUM ('agent_down', 'server_down', 'agent_crash', 'pc_replaced', 'data_loss', 'other');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "RolloutStage" AS ENUM ('canary', 'partial', 'all', 'halted');

-- CreateTable
CREATE TABLE "work_policies" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "monthly_target_hours" DECIMAL(6,2) NOT NULL DEFAULT 208,
    "expected_workdays" INTEGER NOT NULL DEFAULT 26,
    "weekly_off_day" SMALLINT,
    "screenshot_from" VARCHAR(5),
    "screenshot_to" VARCHAR(5),
    "idle_threshold_sec" INTEGER NOT NULL DEFAULT 60,
    "slot_minutes" INTEGER NOT NULL DEFAULT 5,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "work_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees" (
    "id" SERIAL NOT NULL,
    "emp_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "policy_id" INTEGER,
    "joined_on" DATE,
    "left_on" DATE,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "policy_signed_at" TIMESTAMPTZ(3),
    "policy_doc_path" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "employee_id" INTEGER,
    "totp_secret" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_pw" BOOLEAN NOT NULL DEFAULT true,
    "pw_changed_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" SERIAL NOT NULL,
    "hostname" TEXT NOT NULL,
    "windows_username" TEXT NOT NULL,
    "employee_id" INTEGER,
    "machine_guid" TEXT NOT NULL,
    "os_version" TEXT,
    "agent_version" TEXT,
    "token_hash" TEXT NOT NULL,
    "monitors" INTEGER NOT NULL DEFAULT 1,
    "status" "DeviceStatus" NOT NULL DEFAULT 'active',
    "last_seen_at" TIMESTAMPTZ(3),
    "last_drift_sec" INTEGER NOT NULL DEFAULT 0,
    "max_drift_sec" INTEGER NOT NULL DEFAULT 0,
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollment_codes" (
    "id" SERIAL NOT NULL,
    "code_hash" TEXT NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "created_by" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "used_by_device_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_sessions" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "device_id" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),
    "end_reason" "SessionEndReason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_segments" (
    "id" BIGSERIAL NOT NULL,
    "session_id" BIGINT NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "device_id" INTEGER NOT NULL,
    "client_uuid" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "state" "SegmentState" NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "input_score" SMALLINT,
    "counts_as_work" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "activity_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "screenshots" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "device_id" INTEGER NOT NULL,
    "client_uuid" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "slot_start" TIMESTAMPTZ(3) NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL,
    "monitor_index" SMALLINT NOT NULL DEFAULT 0,
    "file_path" TEXT NOT NULL,
    "thumb_path" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "size_bytes" INTEGER,
    "active_app" TEXT,
    "active_title" TEXT,
    "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "screenshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_usage" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "device_id" INTEGER NOT NULL,
    "client_uuid" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_sec" INTEGER NOT NULL,
    "process_name" TEXT NOT NULL,
    "app_name" TEXT,
    "window_title" TEXT,
    "domain" TEXT,
    "category_id" INTEGER,
    "is_browser" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "app_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_categories" (
    "id" SERIAL NOT NULL,
    "match_type" "MatchType" NOT NULL,
    "pattern" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "category" "Productivity" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "app_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" BIGSERIAL NOT NULL,
    "device_id" INTEGER,
    "employee_id" INTEGER,
    "client_uuid" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "meta" JSONB,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "time_adjustments" (
    "id" BIGSERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "delta_sec" INTEGER NOT NULL,
    "cause" "AdjustmentCause" NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence_alert_id" BIGINT,
    "beyond_evidence" BOOLEAN NOT NULL DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" INTEGER,
    "revoke_reason" TEXT,

    CONSTRAINT "time_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "user_id" INTEGER,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip_address" INET,
    "meta" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" SERIAL NOT NULL,
    "holiday_date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'public',

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "employee_id" INTEGER,
    "device_id" INTEGER,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "meta" JSONB,
    "channels_sent" TEXT[],
    "acknowledged_by" INTEGER,
    "acknowledged_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_versions" (
    "version" TEXT NOT NULL,
    "msi_path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "release_notes" TEXT,
    "rollout_stage" "RolloutStage" NOT NULL DEFAULT 'canary',
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "released_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "daily_summary" (
    "employee_id" INTEGER NOT NULL,
    "work_date" DATE NOT NULL,
    "first_activity_at" TIMESTAMPTZ(3),
    "last_activity_at" TIMESTAMPTZ(3),
    "active_sec" INTEGER NOT NULL DEFAULT 0,
    "idle_sec" INTEGER NOT NULL DEFAULT 0,
    "worked_sec" INTEGER NOT NULL DEFAULT 0,
    "adjustment_sec" INTEGER NOT NULL DEFAULT 0,
    "credited_sec" INTEGER NOT NULL DEFAULT 0,
    "earliest_hour" SMALLINT,
    "latest_hour" SMALLINT,
    "productive_sec" INTEGER NOT NULL DEFAULT 0,
    "unproductive_sec" INTEGER NOT NULL DEFAULT 0,
    "productivity_pct" DECIMAL(5,2),
    "screenshot_count" INTEGER NOT NULL DEFAULT 0,
    "day_type" "DayType",
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_summary_pkey" PRIMARY KEY ("employee_id","work_date")
);

-- CreateTable
CREATE TABLE "monthly_summary" (
    "employee_id" INTEGER NOT NULL,
    "year_month" CHAR(7) NOT NULL,
    "worked_sec" INTEGER NOT NULL DEFAULT 0,
    "adjustment_sec" INTEGER NOT NULL DEFAULT 0,
    "credited_sec" INTEGER NOT NULL DEFAULT 0,
    "target_sec" INTEGER NOT NULL DEFAULT 748800,
    "expected_sec" INTEGER NOT NULL DEFAULT 0,
    "pace_sec" INTEGER NOT NULL DEFAULT 0,
    "expected_workdays" INTEGER NOT NULL,
    "workdays_elapsed" INTEGER NOT NULL DEFAULT 0,
    "days_with_work" INTEGER NOT NULL DEFAULT 0,
    "avg_daily_sec" INTEGER NOT NULL DEFAULT 0,
    "overtime_sec" INTEGER NOT NULL DEFAULT 0,
    "shortfall_sec" INTEGER NOT NULL DEFAULT 0,
    "target_met" BOOLEAN NOT NULL DEFAULT false,
    "target_met_at" TIMESTAMPTZ(3),
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monthly_summary_pkey" PRIMARY KEY ("employee_id","year_month")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_emp_code_key" ON "employees"("emp_code");

-- CreateIndex
CREATE UNIQUE INDEX "employees_email_key" ON "employees"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "devices_machine_guid_key" ON "devices"("machine_guid");

-- CreateIndex
CREATE UNIQUE INDEX "devices_hostname_windows_username_key" ON "devices"("hostname", "windows_username");

-- CreateIndex
CREATE UNIQUE INDEX "enrollment_codes_code_hash_key" ON "enrollment_codes"("code_hash");

-- CreateIndex
CREATE INDEX "work_sessions_employee_id_work_date_idx" ON "work_sessions"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "activity_segments_client_uuid_key" ON "activity_segments"("client_uuid");

-- CreateIndex
CREATE INDEX "activity_segments_employee_id_work_date_state_idx" ON "activity_segments"("employee_id", "work_date", "state");

-- CreateIndex
CREATE INDEX "activity_segments_started_at_idx" ON "activity_segments"("started_at");

-- CreateIndex
CREATE UNIQUE INDEX "screenshots_client_uuid_key" ON "screenshots"("client_uuid");

-- CreateIndex
CREATE INDEX "screenshots_employee_id_work_date_idx" ON "screenshots"("employee_id", "work_date");

-- CreateIndex
CREATE UNIQUE INDEX "screenshots_device_id_slot_start_monitor_index_key" ON "screenshots"("device_id", "slot_start", "monitor_index");

-- CreateIndex
CREATE UNIQUE INDEX "app_usage_client_uuid_key" ON "app_usage"("client_uuid");

-- CreateIndex
CREATE INDEX "app_usage_employee_id_work_date_idx" ON "app_usage"("employee_id", "work_date");

-- CreateIndex
CREATE INDEX "app_usage_domain_idx" ON "app_usage"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "events_client_uuid_key" ON "events"("client_uuid");

-- CreateIndex
CREATE INDEX "events_employee_id_occurred_at_idx" ON "events"("employee_id", "occurred_at");

-- CreateIndex
CREATE INDEX "time_adjustments_employee_id_work_date_idx" ON "time_adjustments"("employee_id", "work_date");

-- CreateIndex
CREATE INDEX "audit_log_user_id_occurred_at_idx" ON "audit_log"("user_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_holiday_date_key" ON "holidays"("holiday_date");

-- CreateIndex
CREATE INDEX "alerts_created_at_idx" ON "alerts"("created_at");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "work_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollment_codes" ADD CONSTRAINT "enrollment_codes_used_by_device_id_fkey" FOREIGN KEY ("used_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "work_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_segments" ADD CONSTRAINT "activity_segments_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "screenshots" ADD CONSTRAINT "screenshots_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_usage" ADD CONSTRAINT "app_usage_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_usage" ADD CONSTRAINT "app_usage_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_usage" ADD CONSTRAINT "app_usage_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "app_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_adjustments" ADD CONSTRAINT "time_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_adjustments" ADD CONSTRAINT "time_adjustments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_adjustments" ADD CONSTRAINT "time_adjustments_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_adjustments" ADD CONSTRAINT "time_adjustments_evidence_alert_id_fkey" FOREIGN KEY ("evidence_alert_id") REFERENCES "alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_summary" ADD CONSTRAINT "daily_summary_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_summary" ADD CONSTRAINT "monthly_summary_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
