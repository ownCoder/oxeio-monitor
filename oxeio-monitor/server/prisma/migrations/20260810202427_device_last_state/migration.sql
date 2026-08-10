-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "last_state" "SegmentState",
ADD COLUMN     "last_state_at" TIMESTAMPTZ(3);
