# Telegram AI Manager — local-model release

১০ অক্টোবর ২০২৬ · Asia/Dhaka

Existing alert bot-এর private chat-এ portal account link, নিজস্ব daily report, manager/owner-এর team report এবং সাধারণ বাংলা/ইংরেজি প্রশ্নের উত্তর release 482-এ যোগ হয়। OpenAI Responses API smoke test `429 credit_balance_exhausted` ফেরত দেয়। Owner free alternative চাওয়ায় release **483 / `f21ce3c484907a9c2859444a388b02f65aca5dfb`**-তে self-hosted `qwen3:4b-instruct` ব্যবহার করা হয়েছে। কোনো নতুন API key বা payment প্রয়োজন হয়নি। VPS `.env` ও API container থেকে OpenAI key সরানো হয়েছে।

Compose `ai` profile-এ pinned Ollama image, persistent model volume, loopback-only port, ২ CPU ও ৪ GiB memory limit আছে। Bot worker existing alert token-এর `getUpdates` polling নেয়; Telegram webhook unset ছিল। Portal-এ one-time `/link CODE` flow, role-scoped `/today` ও `/team`, read-only AI answers, `/unlink`, inactive-account block আছে। Telegram-এর private chat ছাড়া office facts কোনো external AI provider-এ পাঠানো হয় না।

Backend typecheck/lint এবং চারটি focused test পাস। Synthetic Bengali model answer cold ৪০.৩ সেকেন্ড ও warm ১২.৪ সেকেন্ডে এসেছে; একই সময়ে office API health ২০০। Deployment-এর পরে API, web, PostgreSQL ও Ollama healthy, public `/health` build 483, anonymous link endpoint 401, owner Chrome-এ `/ai-manager` ও unlinked status দেখা গেছে। **Live Telegram-linked user conversation এখনো end-to-end test হয়নি**; প্রথম ব্যবহারকারীকে portal থেকে code নিয়ে existing alert bot-এ `/link CODE` পাঠাতে হবে।

Local source mirror `.release-salary/oxeio-monitor`; VPS release `/opt/oxeio-releases/telegram-ai-local-20261010`; operational instructions [telegram-ai-operations.md](../telegram-ai-operations.md)। Owner-এর action-time অনুমতির পরে OpenAI Platform-এ তৈরি চারটি key-ই revoked, browser list-এ চারটি status যাচাই হয়েছে।
