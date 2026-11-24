# Telegram AI Manager — reply delay fix

১০ অক্টোবর ২০২৬ · Asia/Dhaka

Owner portal account existing alert bot-এ `/link CODE` দিয়ে যুক্ত করেন। `/help` ও `/team` উত্তর দেয়, কিন্তু `hi`/`hello`-তে reply প্রায় ৯০ সেকেন্ড পরে fallback আসে। Live evidence: API log-এ `Local AI request failed`, Ollama `/api/chat` ৯০ সেকেন্ডে cancel; ১১ জনের team facts model-এ পাঠানো হচ্ছিল। Link record ও Telegram polling সচল ছিল।

**Release 486 / `46a64bf78cea99b9dcdeee88157cbd988ee2f5b8`** এখন greetings, `/team`, team report overview, বেশি/কম completed design বা accepted skip, এবং report সংখ্যা কী বোঝায়—এসব verified server facts থেকে সরাসরি উত্তর দেয়। সাধারণ open-ended প্রশ্নের payload-এ পুরো team table-এর বদলে aggregate summary বা উল্লেখ করা staff-এর তথ্য পাঠানো হয়। Local free model `qwen3:1.7b` ব্যবহার হয়; OpenAI key বা credit লাগে না। 1.7B model দ্রুত হলেও কিছু open-ended উত্তরের মান দুর্বল হতে পারে—গুরুত্বপূর্ণ সিদ্ধান্তে portal report মিলিয়ে নিতে হবে।

Focused backend tests **৭/৭**, typecheck ও lint পাস। Live API-only release-এ public health build 486/`46a64bf`, API/web/Ollama/PostgreSQL healthy, linked account count ১। Deployed service-এর synthetic runtime check-এ `hello` **১ ms**, report-number explanation তাৎক্ষণিক; model timeout হয়নি। User-এর Telegram chat-এ নতুন message পাঠিয়ে end-to-end reply এখনও যাচাই করা হয়নি। Existing link অক্ষত; আবার `/link` করার দরকার নেই।

Source mirror `.release-salary/oxeio-monitor`; VPS evidence `/opt/oxeio-releases/telegram-ai-reply-20261010`, `/opt/oxeio-releases/telegram-ai-reply-v2-20261010`, `/opt/oxeio-releases/telegram-ai-reply-v3-20261010`। কোনো database migration, seed বা web image rebuild হয়নি।
