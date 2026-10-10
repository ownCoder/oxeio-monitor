CREATE TABLE "telegram_ai_accounts" (
    "user_id" INTEGER NOT NULL,
    "chat_id" TEXT,
    "telegram_user_id" TEXT,
    "code_hash" TEXT,
    "code_expires_at" TIMESTAMPTZ(3),
    "linked_at" TIMESTAMPTZ(3),
    CONSTRAINT "telegram_ai_accounts_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "telegram_ai_accounts_chat_id_key" ON "telegram_ai_accounts"("chat_id");
CREATE UNIQUE INDEX "telegram_ai_accounts_telegram_user_id_key" ON "telegram_ai_accounts"("telegram_user_id");
CREATE UNIQUE INDEX "telegram_ai_accounts_code_hash_key" ON "telegram_ai_accounts"("code_hash");
ALTER TABLE "telegram_ai_accounts" ADD CONSTRAINT "telegram_ai_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
