-- অ্যালার্ট auto-resolution (এজেন্ট ফিরে এলে খোলা agent_down নিজে বন্ধ)।
-- nullable, কোনো default নয়: NULL = এখনো মেটেনি — "unset" আলাদা করে রাখা যায়।
ALTER TABLE "alerts"
  ADD COLUMN "resolved_at" TIMESTAMPTZ(3);

ALTER TABLE "alerts"
  ADD COLUMN "resolved_reason" TEXT;
