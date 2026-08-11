# oXeio Employee Monitoring & Time Tracking System

> ১৫ জন স্টাফের Windows PC-তে র‍্যান্ডম স্ক্রিনশট, নিখুঁত টাইম ট্র্যাকিং ও অ্যাপ/ওয়েবসাইট মনিটরিং —
> সম্পূর্ণ নিজস্ব (self-hosted), অফিসের সার্ভারে, বাইরের কারো হাতে ডেটা যাবে না।

| | |
|---|---|
| **স্ট্যাটাস** | 🔨 সব স্তর দাঁড়িয়েছে — এজেন্ট · সার্ভার (~৪৫ endpoint) · ড্যাশবোর্ড (৬ পাতা)। **৯১৩ টেস্ট** (সার্ভার ৫৮৬ · এজেন্ট ৩২৭)। ⚠️ কী মাঠে চলেছে আর কী শুধু বিল্ড পাস করেছে — [09 § ৩ঈ](docs/09-Build-Log.md) |
| **প্রতিষ্ঠান** | oXeio |
| **স্টাফ** | ১৫ জন · সব Windows PC |
| **ট্র্যাকিং** | **কোনো শিফট নেই** — দিনের যেকোনো সময় active থাকলেই গোনা হয় (২৪ ঘণ্টা) |
| **টার্গেট** | **মাসে ২০৮ ঘণ্টা** প্রকৃত কাজ (২৬ দিন × ৮ ঘণ্টার সমান) |
| **স্ক্রিনশট** | প্রতি ৫ মিনিটে র‍্যান্ডম · শুধু **০৭:০০ – ২৩:০০** · ৯০ দিন পর অটো ডিলিট |
| **সার্ভার** | অফিসের PC — 24 GB RAM, 1 TB NVMe, Windows |
| **আনুমানিক সময়** | ৭ সপ্তাহ (MVP ৩ সপ্তাহে) |

> ⚠️ **"তৈরি" আর "চালিয়ে দেখা" এক নয়।** এজেন্ট আসল মেশিনে চলেছে (ক্যাপচার,
> অ্যাপ-ট্র্যাকিং, MSI, watchdog); ড্যাশবোর্ড ও রিপোর্ট দেখা হয়েছে **নমুনা
> ডেটায়**; আর ব্যাকআপ, TLS, 2FA, ইমেইল/টেলিগ্রাম — কোড আছে, **একবারও
> চলেনি**। তিন ভাগে সাজানো তালিকা → [09-Build-Log § ৩ঈ](docs/09-Build-Log.md)

---

## 📚 ডকুমেন্টেশন

| # | ফাইল | কী আছে |
|---|---|---|
| 01 | [Planning](docs/01-Planning.md) | লক্ষ্য, স্কোপ, ফেজ, টাইমলাইন, বাজেট, ঝুঁকি, রোলআউট প্ল্যান |
| 02 | [Workflow](docs/02-Workflow.md) | ডেটা ফ্লো, দৈনিক অপারেশন, ইউজার জার্নি, ডেভ ওয়ার্কফ্লো, অনবোর্ডিং, ইনসিডেন্ট হ্যান্ডলিং |
| 03 | [Project Map](docs/03-Project-Map.md) | কম্পোনেন্ট ম্যাপ, রেপো স্ট্রাকচার, মডিউল ডিপেন্ডেন্সি, ফিচার→ফাইল ম্যাপিং |
| 04 | [Features](docs/04-Features.md) | পূর্ণ ফিচার ক্যাটালগ — প্রায়োরিটি, ফেজ, acceptance criteria |
| 05 | [Options & Decisions](docs/05-Options-Decisions.md) | প্রতিটা টেকনিক্যাল সিদ্ধান্তের বিকল্প, তুলনা ও কারণ (ADR) |
| 06 | [Research](docs/06-Research.md) | প্রতিযোগী বিশ্লেষণ, Windows API গবেষণা, আইনি দিক, ৩ বছরের খরচ |
| 07 | [Technical Spec](docs/07-Technical-Spec.md) | DB স্কিমা, API কনট্রাক্ট, এজেন্ট state machine, সার্ভার সেটআপ |
| 08 | [Gap Analysis](docs/08-Gap-Analysis.md) | প্ল্যানে যা বাদ পড়েছিল এবং যা যোগ হলো (৪৭টি, তিন দফায়) |
| 09 | [Build Log](docs/09-Build-Log.md) | ⭐ **এখন পর্যন্ত কী হয়েছে, কী আটকে আছে, পরের ধাপ** |
| 🎨 | [UI Mockup](docs/mockup/dashboard-mockup.html) | ৭টি স্ক্রিনের ক্লিকযোগ্য ডিজাইন মকআপ |

**নতুন হলে পড়ার ক্রম:** `09 → 01 → মকআপ → 04 → 07`

## 📂 কোড

`oxeio-monitor/`

- **`server/`** NestJS 11 + Prisma 6 · ১৯ মডেল · ~৪৫ endpoint · **৫৮৬ টেস্ট**
  agent ingest · dashboard · activity (ক্যাটাগরি) · screenshots · reports (Excel/PDF) ·
  admin · alerts · ops (ব্যাকআপ/হেলথ) · summary (nightly jobs) · digest · payroll
- **`agent/`** C# .NET 8 · **৩২৭ টেস্ট** · `oXeio.Core` (নিয়ম, শূন্য Win32) +
  `oXeio.Agent` (DXGI ক্যাপচার · idle/lock/sleep · অ্যাপ ও ডোমেইন · SQLite outbox ·
  tray) + `oXeio.Watchdog`। `--diagnose` দিয়ে যেকোনো PC-তে যাচাই করা যায়।
- **`web/`** React 19 + Vite + Tailwind v4 · Live Board · Employee Detail ·
  গ্যালারি · Monthly হিটম্যাপ · Reports · Settings · Security
- **`installer/`** WiX 7 → সাইলেন্ট MSI · **`deploy/`** TLS ও Defender স্ক্রিপ্ট

---

## ▶️ কীভাবে চালাবেন

### এক· ডাটাবেস (একবার)

```bash
cd oxeio-monitor && docker compose up -d
```

প্রথমবার হলে স্কিমা ও seed:

```bash
cd oxeio-monitor/server && npm run prisma:deploy && npm run seed
```

⚠️ `npx prisma migrate deploy` **সরাসরি চালাবেন না** — `P1012 · Environment
variable not found: DATABASE_URL` দিয়ে থেমে যাবে। `.env` আছে এক ফোল্ডার
উপরে (`oxeio-monitor/.env`), তাই স্ক্রিপ্টগুলো `dotenv -e ../.env --` দিয়ে
মোড়া। উপরের `npm run` ফর্মটাই সেই মোড়কসহ চলে।

⚠️ `.env` লাগবে — `oxeio-monitor/.env.example` কপি করে `DATABASE_URL`,
`JWT_SECRET` (৩২+ অক্ষর) আর `SEED_OWNER_*` বসান।

⚠️ **আসল কর্মী তালিকা রিপোতে নেই** (নাম ও বেতন — ওটা তাঁদের তথ্য)।
`server/prisma/staff.example.json` দেখে `staff.local.json` বানান; না বানালে
seed নমুনা নাম ও বেতন ০ দিয়ে চলে।

### দুই· সার্ভার

```bash
cd oxeio-monitor && npm --prefix server run start:dev
```

### তিন· ড্যাশবোর্ড (আলাদা টার্মিনাল)

```bash
cd oxeio-monitor && npm --prefix web run dev
```

`http://localhost:5173` — লগইন `.env`-এর `SEED_OWNER_*` দিয়ে।
⚠️ সরাসরি `:3000`-এ যাবেন না: সেশন cookie `SameSite=Strict`, তাই লগইন সফল
দেখাবে কিন্তু পরের রিকোয়েস্টেই ৪০১। proxy-র কারণে ব্রাউজারের চোখে সবই এক origin।

⚠️ প্রথম লগইনে **পাসওয়ার্ড বদলাতে বাধ্য করবে** (G33) — এটা ঠিক আচরণ।

### চার· এজেন্ট একটা PC-তে

বসানোর আগে যাচাই — এতে কিছু জমা হয় না, শুধু কনসোলে ফল লেখে:

```bash
cd oxeio-monitor/agent && dotnet run --project src/oXeio.Agent -- --diagnose
```

ঠিক থাকলে MSI বানান:

```bash
cd oxeio-monitor/agent/installer && pwsh -File build.ps1
```

এনরোলমেন্ট কোড ড্যাশবোর্ডে: **Settings → Devices → Enrolment code**।
⚠️ কোডটা **একবারই** দেখানো হয়, ২৪ ঘণ্টায় মেয়াদ শেষ।

```bash
msiexec /i oXeioAgent.msi /qn SERVERURL="https://<server>:3000" ENROLLMENTCODE="<code>"
```

### টেস্ট

```bash
cd oxeio-monitor/server && npm test
```

```bash
cd oxeio-monitor/agent && dotnet test
```

---

## 🎯 এক নজরে সিস্টেম

```
১৫টি Windows PC                    অফিসের সার্ভার PC              ব্রাউজার
┌──────────────┐                 ┌──────────────────┐         ┌─────────────┐
│ oXeio Agent  │  HTTPS/LAN      │  API + Postgres  │  HTTPS  │  Dashboard  │
│  • স্ক্রিনশট  │ ──────────────▶ │  + Screenshot    │ ◀────── │  Owner +    │
│  • টাইম      │  (offline হলে   │    storage       │         │  Manager    │
│  • অ্যাপ      │   queue-তে জমা) │  + Nightly jobs  │         └─────────────┘
└──────────────┘                 └──────────────────┘
```

**মূল নিয়ম চারটি:**
1. স্ক্রিনশট — প্রতি ৫ মিনিটের স্লটে ১টা, **সময়টা র‍্যান্ডম** (কেউ আগে থেকে জানবে না)
2. টাইম — **১ মিনিট** কি-বোর্ড/মাউস নিষ্ক্রিয় হলে টাইমার **hold**, নড়লেই আবার **চালু**
3. হিসাব — **সময়ের কোনো বাঁধন নেই।** সকাল ৭টা হোক বা রাত ১০টা, শুক্রবার হোক বা সোমবার — কেউ active থাকলেই গোনা হয়। একমাত্র মাপকাঠি **মাসে ২০৮ ঘণ্টা**। কে কখন এল, কখন লাঞ্চ করল — কিছুই ট্র্যাক হয় না
3b. **কোনো অনুমোদন ব্যবস্থা নেই** — মিটিং claim নেই, ছুটির আবেদন নেই, স্টাফের চাপার মতো কোনো বাটন নেই। মাত্র ৩টি স্টেট: ACTIVE · IDLE · LOCKED
4. ডেটা — ৯০ দিন পর স্ক্রিনশট **অটো ডিলিট**, সব কিছু অফিসের ভেতরেই থাকে

**🎨 ডিজাইন দেখুন:** [dashboard-mockup.html](docs/mockup/dashboard-mockup.html) — ৭টি স্ক্রিনের ক্লিকযোগ্য মকআপ

---

## ⚖️ রোলআউটের আগে বাধ্যতামূলক

এই সিস্টেম চালুর আগে **অবশ্যই**:
1. লিখিত Monitoring Policy তৈরি ও প্রত্যেক স্টাফের স্বাক্ষর
2. সবাইকে জানিয়ে ব্রিফিং মিটিং
3. স্টাফ নিজের ডেটা দেখার অ্যাক্সেস চালু

বিস্তারিত: [01-Planning § রোলআউট](docs/01-Planning.md) এবং [06-Research § আইনি](docs/06-Research.md)

---

## 🚫 যা এই সিস্টেম কখনোই করবে না

কীলগিং · ক্লিপবোর্ড ক্যাপচার · ফাইলের ভেতরের লেখা পড়া · ফুল URL সংরক্ষণ ·
ওয়েবক্যাম/মাইক্রোফোন · ব্যক্তিগত ল্যাপটপ · গোপন ইনস্টলেশন ·
রাত ১১টা–সকাল ৭টার স্ক্রিনশট · কে কখন লাঞ্চ করল · কোনো অনুমোদন ব্যবস্থা
