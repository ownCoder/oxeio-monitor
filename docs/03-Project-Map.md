# 03 · Project Map

কোথায় কী কোড থাকবে, কোন মডিউল কার উপর নির্ভর করে, কোন ফিচার কোন ফাইলে।

---

## ১. সিস্টেম কম্পোনেন্ট ম্যাপ

```
┌─────────────────────────── CLIENT SIDE (১৫টি PC) ───────────────────────────┐
│                                                                              │
│  oXeio.Agent.exe (tray, user session)          oXeio.Watchdog.exe (service)  │
│  ┌────────────────────────────────────┐        ┌──────────────────────────┐  │
│  │ TrackerEngine   — state machine    │        │ ProcessGuard  ৩০ সে. চেক │  │
│  │ IdleMonitor     — GetLastInputInfo │◀──────▶│ AgentUpdater  MSI আপডেট  │  │
│  │ ScreenCapturer  — DXGI→GDI + WebP  │        │ CrashReporter            │  │
│  │ WindowWatcher   — foreground app   │        └──────────────────────────┘  │
│  │ SyncClient      — HTTP + retry     │                                      │
│  │ LocalQueue      — SQLite + files   │        oXeio.Core.dll (shared)       │
│  │ TrayUI          — মেনু, নোটিফিকেশন │        Win32 API · Models · Crypto    │
│  └────────────────────────────────────┘                                      │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ HTTPS
┌────────────────────────────────▼─────────────────────────────────────────────┐
│                        SERVER (অফিসের PC)                                    │
│                                                                              │
│  Caddy (TLS) → NestJS API                                                    │
│  ┌──────────────┬──────────────┬──────────────┬──────────────┐               │
│  │ IngestModule │ AuthModule   │ QueryModule  │ ReportModule │               │
│  │ এজেন্টের ডেটা │ JWT + role   │ ড্যাশবোর্ড    │ Excel/PDF    │               │
│  ├──────────────┼──────────────┼──────────────┼──────────────┤               │
│  │ JobsModule   │ StorageModule│ AlertModule  │ AdminModule  │               │
│  │ cron         │ ছবি + থাম্ব   │ mail/telegram│ CRUD+settings│               │
│  └──────────────┴──────────────┴──────────────┴──────────────┘               │
│         │                    │                                               │
│    PostgreSQL 16        D:\oXeio\storage\                                    │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │ HTTPS
┌────────────────────────────────▼─────────────────────────────────────────────┐
│  React SPA — Live · Timeline · Gallery · Attendance · Reports · Settings     │
│              + Employee self-view (স্টাফের নিজের ডেটা)                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## ২. রেপো স্ট্রাকচার

> **অবস্থান:** `oXeio Office/oxeio-monitor/`
> নিচের গাছে **✅ = কোড আছে ও চলছে**, **⏳ = এখনো পরিকল্পনা**।
> সর্বশেষ অবস্থা ও কী কী যাচাই হয়েছে: [09-Build-Log](09-Build-Log.md)

```
oxeio-monitor/
│
├── agent/                                  # ── C# .NET 8 ──
│   ├── src/
│   │   ├── oXeio.Core/                     # ⭐ **নিয়ম** — net8.0, শূন্য Win32
│   │   │   ├── Time/MonotonicClock.cs      ✅ ঘড়ি বদলালেও অটুট
│   │   │   ├── Time/DhakaTime.cs           ✅ সার্ভারের dhaka-time.ts-এর প্রতিরূপ
│   │   │   ├── Tracking/IdleStateMachine.cs ✅ ⭐ সিস্টেমের হৃদয়
│   │   │   ├── Tracking/IdleMath.cs        ✅ wraparound + ভবিষ্যৎ-টাইমস্ট্যাম্প ক্ল্যাম্প
│   │   │   ├── Tracking/SleepGapDetector.cs ✅ ইভেন্ট ছাড়াই ঘুম ধরা
│   │   │   ├── Tracking/CaptureWindow.cs   ✅ ০৭:০০–২৩:০০
│   │   │   ├── Capture/SlotScheduler.cs    ✅ ৫ মিনিট স্লট + র‍্যান্ডম
│   │   │   ├── Capture/FrameQuality.cs     ✅ ছবি কালো/এক-রঙা কি না
│   │   │   ├── Capture/PixelCopy.cs        ✅ RowPitch সামলানো + ঘূর্ণন
│   │   │   ├── Capture/EngineFallbackPolicy.cs ✅ কতবার ব্যর্থে কত বিরতি
│   │   │   ├── Agent/                      ✅ ⭐ কনট্র্যাক্ট স্তর — ১৬টা ফাইল
│   │   │   │   #  IOutboxStore · ISyncClient · SyncOutcome · RetryPolicy
│   │   │   │   #  OutboxBudget · AgentStatus · রেকর্ড টাইপ
│   │   │   ├── Watchdog/                   ✅ RestartLadder · WatchdogPolicy · AgentHeartbeat
│   │   │   └── Models/                     ✅ SegmentState, ActivitySegment
│   │   │   # ⚠️ Native/ ইচ্ছাকৃতভাবে এখানে **নয়** — Win32 ঢুকলে নিয়মগুলো
│   │   │   #    আর ইউনিট টেস্টে যাচাই করা যেত না। ওগুলো oXeio.Agent-এ।
│   │   │
│   │   ├── oXeio.Agent/                    # 🔨 net8.0-windows10.0.17763.0
│   │   │   ├── app.manifest                ✅ PerMonitorV2 DPI
│   │   │   ├── Program.cs                  ✅ আপাতত ডায়াগনস্টিক টুল
│   │   │   ├── Native/{Win32,Structs}.cs   ✅ ধ্রুবক ও লেআউট
│   │   │   ├── Native/Kernel32.cs          ✅ GetTickCount64, QueryUnbiasedInterruptTime
│   │   │   ├── Native/User32.cs            ✅ GetLastInputInfo, power notifications
│   │   │   ├── Native/Wtsapi32.cs          ✅ session notifications + lock query
│   │   │   ├── Native/ComCall.cs           ✅ vtable-স্লট ধরে COM কল
│   │   │   ├── Native/{D3D11,Dxgi}.cs      ✅ স্লট ও IID — হেডারের লাইন নম্বর সহ
│   │   │   ├── Platform/SessionGuard.cs    ✅ Session 0-তে চললে সময় গোনা বন্ধ
│   │   │   ├── Platform/IdleProbe.cs       ✅ কাঁচা সংখ্যা → IdleMath
│   │   │   ├── Platform/LockStateProbe.cs  ✅ ইভেন্ট ছাড়াই লক অবস্থা
│   │   │   ├── Platform/MessageWindow.cs   ✅ লুকানো top-level (message-only নয়)
│   │   │   ├── Platform/SessionMonitor.cs  ✅ lock/logoff/RDP disconnect
│   │   │   ├── Platform/PowerMonitor.cs    ✅ suspend/resume/display
│   │   │   ├── Platform/DpiGuard.cs        ✅ ম্যানিফেস্ট কার্যকর হয়েছে কি না
│   │   │   ├── Platform/Capture/
│   │   │   │   ├── MonitorEnumerator.cs    ✅ প্রতিবার নতুন করে গোনা
│   │   │   │   ├── DuplicationCapturer.cs  ✅ ⭐ প্রধান ইঞ্জিন — DXGI (ADR-012c)
│   │   │   │   ├── GdiCapturer.cs          ✅ BitBlt + GetDIBits (ফলব্যাক)
│   │   │   │   ├── FallbackCapturer.cs     ✅ DXGI → GDI শৃঙ্খল
│   │   │   │   ├── WebpEncoder.cs          ✅ SkiaSharp q70, ≤১৯২০px
│   │   │   │   └── ScreenCaptureService.cs ✅ সব মনিটর + গুণমান যাচাই
│   │   │   ├── Storage/                    ✅ SQLite outbox — lease/ack, WAL, বাজেট
│   │   │   ├── Sync/                       ✅ HttpSyncClient · SyncWire · rate gate
│   │   │   ├── Security/                   ✅ MachineIdentity · DPAPI টোকেন · enrollment
│   │   │   ├── Ui/                         ✅ TrayIcon · TodayForm · AboutForm (J07)
│   │   │   └── Apps/                       ⏳ WindowWatcher · BrowserUrlReader
│   │   │
│   │   └── oXeio.Watchdog/                 ✅ আলাদা প্রসেস — শুধু Core-এর উপর নির্ভর
│   │       ├── WatchdogLoop.cs             ✅ ৩০ সে. চেক, restart storm ঠেকানো (H01)
│   │       ├── Platform/                   ✅ heartbeat · instance lock · rolling log
│   │       └── Deployment/                 ✅ Task Scheduler XML (H02)
│   ├── installer/                          ⏳ WiX → oXeioAgent.msi
│   └── tests/oXeio.Core.Tests/             ✅ ১৯৯টি ইউনিট টেস্ট
│
├── server/                                 # ── Node 22 + NestJS 11 ──
│   ├── src/
│   │   ├── main.ts  app.module.ts          ✅ prefix, helmet, CSRF, pino
│   │   ├── prisma/                         ✅ গ্লোবাল PrismaService
│   │   ├── health/                         ✅ GET /health (@Public)
│   │   ├── audit/                          ✅ audit_log-এ লেখা
│   │   ├── auth/                           ✅ ⭐ ৪টি গ্লোবাল গার্ড
│   │   │   ├── auth.controller.ts          #   login · logout · me · change-password
│   │   │   ├── token.service.ts            #   jose · httpOnly cookie · sliding
│   │   │   ├── password.service.ts         #   argon2id
│   │   │   ├── login-throttle.service.ts   #   ব্রুট-ফোর্স (I11)
│   │   │   └── guards/                     #   jwt · csrf · must-change-pw · roles
│   │   ├── users/                          ✅ reset-password · portal-account
│   │   ├── agent/                          ✅ ⭐ এজেন্ট → সার্ভার (৯টি endpoint)
│   │   │   ├── agent.controller.ts
│   │   │   ├── device-auth.guard.ts        #   Bearer → sha256 → device
│   │   │   ├── clock-drift.service.ts      #   ⭐ drift সংশোধন + অ্যালার্ট
│   │   │   ├── ingest.service.ts           #   ⭐ মধ্যরাত-স্প্লিট · dedupe · session
│   │   │   ├── screenshot-ingest.service.ts
│   │   │   ├── enrollment.service.ts  agent-config.service.ts  update.service.ts
│   │   │   ├── device-rate-limit.service.ts
│   │   │   └── util/dhaka-time.ts  util/derive-uuid.ts
│   │   ├── payroll/                        ✅ ⭐ owner-only — বেতন ও ঘাটতি (ADR-023)
│   │   │   ├── payroll.math.ts             #   খাঁটি হিসাব, সব পয়সায়
│   │   │   ├── payroll.service.ts          #   monthly_salary পড়ে **শুধু এখানেই**
│   │   │   └── payroll.controller.ts       #   @Roles(owner) ক্লাস-লেভেলে
│   │   ├── employees/  devices/            ⏳ CRUD
│   │   ├── screenshots/                    ⏳ গ্যালারি, থাম্বনেইল, signed URL
│   │   ├── timeline/                       ⏳ segment → টাইমলাইন
│   │   ├── monthly/                        ⏳ ⭐ মাসিক ২০৮ঘ, pace, shortfall, OT
│   │   ├── adjustments/                    ⏳ ⭐ owner-এর ঘণ্টা সংশোধন (ADR-011e)
│   │   ├── reports/  alerts/  admin/       ⏳
│   │   └── jobs/                           ⏳ cron
│   │       ├── summary.job.ts              #   প্রতি ১৫ মি.
│   │       ├── day-close.job.ts            #   ০০:১৫ (আগের দিন)
│   │       ├── retention.job.ts            #   ০২:০০
│   │       ├── backup.job.ts               #   ০২:৩০
│   │       └── health.job.ts               #   ডিস্ক, এজেন্ট চুপ
│   ├── prisma/schema.prisma  migrations/  seed.ts   ✅
│   └── test/                               ✅ Vitest + supertest — ৬০টি টেস্ট (৫১ e2e + ৯ ইউনিট)
│       ├── auth.e2e.spec.ts  agent.e2e.spec.ts
│       └── setup/harness.ts  setup/global-setup.ts
│
├── web/                                    # ── React 19 + Vite ──
│   └── src/
│       ├── api/client.ts                   ✅ cookie · CSRF হেডার · গ্লোবাল 401
│       ├── api/auth.ts                     ✅
│       ├── auth/AuthContext.tsx            ✅ সেশনের অবস্থা
│       ├── components/Layout.tsx           ✅ কালো টপবার + নেভ
│       ├── components/Brand.tsx  Field.tsx ✅
│       ├── pages/LoginPage.tsx             ✅
│       ├── pages/ChangePasswordPage.tsx    ✅ বাধ্যতামূলক প্রথম-বদল (G33)
│       ├── pages/HomePage.tsx              ✅ প্লেসহোল্ডার
│       ├── pages/
│       │   ├── LiveBoard.tsx               ⏳ ⭐ হোম — ১৫টা কার্ড
│       │   ├── EmployeeDetail.tsx          ⏳ টাইমলাইন + চার্ট
│       │   ├── Gallery.tsx                 ⏳ স্ক্রিনশট গ্রিড + লাইটবক্স
│       │   ├── Monthly.tsx                 ⏳ মাসিক হিটম্যাপ
│       │   ├── Reports.tsx  Settings.tsx   ⏳
│       │   └── MyData.tsx                  ⏳ স্টাফের নিজের ভিউ
│       ├── components/
│       │   ├── TimelineBar.tsx             ⏳ ⭐ active/idle রঙিন বার
│       │   ├── StatusCard.tsx  ScreenshotGrid.tsx  ⏳
│       │   └── TargetRing.tsx              ⏳ মাসিক ২০৮ঘ প্রগ্রেস রিং
│       └── hooks/  lib/                    ⏳
│
├── docs/                                   # ← এই ডকুমেন্টগুলো
│   └── monitoring-policy-template.md       # স্টাফের সই করার পলিসি
├── ops/
│   ├── docker-compose.yml  Caddyfile
│   ├── av-exclusion.ps1                    # AV exception স্ক্রিপ্ট
│   └── deploy-agent.ps1                    # সাইলেন্ট MSI ডিপ্লয়
└── (রেপো রুটে) .github/workflows/ci.yml   ✅ server · web · docker — তিনটি job
```

---

## ৩. মডিউল নির্ভরতা

```
oXeio.Core  ◀── সবাই এর উপর নির্ভর করে
    ▲
    ├── oXeio.Agent
    │     TrackerEngine ──▶ IdleMonitor, SegmentBuilder, CaptureWindow
    │           │
    │           ├──▶ SlotScheduler ──▶ ScreenCapturer ──▶ WebpEncoder
    │           ├──▶ WindowWatcher ──▶ BrowserUrlReader
    │           └──▶ LocalQueue ──▶ SyncClient ──▶ [Server API]
    │
    └── oXeio.Watchdog ──▶ ProcessGuard ──▶ [Agent process]

Server:
  AgentModule ──▶ DeviceAuthGuard ──▶ Prisma          ✅  (device token, আলাদা জগৎ)
        │           ClockDrift ──▶ Alert
        └──▶ Ingest ──▶ dhaka-time, derive-uuid ──▶ Prisma
  AuthModule  ──▶ Token(jose), Password(argon2), Throttle, Audit   ✅
        └──▶ ৪টি গ্লোবাল গার্ড ──▶ [বাকি সব কন্ট্রোলার]
  UsersModule ──▶ AuthModule                          ✅
  AuditModule ◀── Auth, (পরে) Screenshots, Reports    ✅  (গ্লোবাল)
  QueryModule  ──▶ Prisma (read-only)                 ⏳
  ReportModule ──▶ Monthly ──▶ monthly_summary        ⏳
  JobsModule   ──▶ সব মডিউল (cron)                    ⏳
  AlertModule  ◀── Jobs, Agent (ইভেন্ট-ভিত্তিক)        ⏳
```

**নিয়ম:**
- `Core` কখনো `Agent`-এর উপর নির্ভর করবে না; `Agent`(server) কখনো `Report`-এর উপর নয়।
- **দুটো অথেনটিকেশন জগৎ কখনো মেশে না** — ড্যাশবোর্ড চলে JWT cookie + CSRF-এ,
  এজেন্ট চলে device token-এ। তাই `AgentController` ক্লাস-লেভেলে `@Public()`,
  আর তার নিজের `DeviceAuthGuard` আলাদা করে বসানো।

---

## ৪. ডেটা মডেল সম্পর্ক

```
shifts ──1:N──▶ employees ──1:N──▶ devices
                    │
                    ├──1:N──▶ work_sessions ──1:N──▶ activity_segments  ⭐
                    ├──1:N──▶ screenshots
                    ├──1:N──▶ app_usage ──N:1──▶ app_categories
                    ├──1:N──▶ events
                    └──1:1(per date)──▶ daily_summary  ⭐ (rollup)

holidays ──(date lookup)──▶ daily_summary
users ──1:N──▶ audit_log
settings (key-value)   ·   agent_versions   ·   alerts
```

---

## ৫. ফিচার → কোড ম্যাপিং

| ফিচার | Agent | Server | Web |
|---|---|---|---|
| র‍্যান্ডম স্ক্রিনশট | `SlotScheduler` `ScreenCapturer` | `agent/screenshot-ingest` ✅ → `screenshots/` ⏳ | `Gallery.tsx` |
| Idle/Active টাইম | `IdleMonitor` `SegmentBuilder` | `agent/ingest.service` ✅ | `TimelineBar.tsx` |
| মধ্যরাতে দিন বদল | `SegmentBuilder` | `agent/util/dhaka-time` ✅ | — |
| Clock drift | `MonotonicClock` | `agent/clock-drift.service` ✅ | — |
| অফলাইন কাজ → dedupe | `LocalQueue` `SyncClient` | `agent/util/derive-uuid` ✅ | — |
| মাসিক ২০৮ঘ টার্গেট + pace | `TrackerEngine` `TrayIcon` | `monthly/` ⏳ | `TargetRing.tsx` |
| অ্যাপ/সাইট ট্র্যাকিং | `WindowWatcher` `BrowserUrlReader` | `agent/ingest.service` ✅ (ক্যাটাগরি ⏳) | `EmployeeDetail.tsx` |
| লাইভ স্ট্যাটাস | heartbeat ✅ | `timeline/live` ⏳ | `LiveBoard.tsx` |
| মাসিক হিটম্যাপ | — | `monthly/` `day-close.job` | `MonthHeatmap.tsx` |
| রিপোর্ট | — | `reports/` | `Reports.tsx` |
| Watchdog | `oXeio.Watchdog` | `alerts/` | `LiveBoard` badge |
| Retention | — | `retention.job` | `Settings.tsx` |
| স্টাফের নিজস্ব ভিউ | `MyDayWindow` | role=employee | `MyData.tsx` |
| **ঘণ্টা সংশোধন** (ADR-011e) | — | `adjustments/` | `EmployeeDetail.tsx` + `MyData.tsx` |

---

## ৬. ফেজ → ডেলিভারেবল ম্যাপিং

| ফেজ | Agent | Server | Web |
|---|---|---|---|
| **1** Foundation | — | prisma, auth, ingest, docker | লগইন শেল |
| **2** Agent Core | Core, Tracking, Capture, Sync, Queue | drift, dedupe | — |
| **3** MVP ⭐ | TrayIcon | timeline, live | LiveBoard, EmployeeDetail, Gallery |
| **4** Activity | Apps/* | categories | চার্ট |
| **5** Reports | MyDayWindow | monthly, reports | MonthHeatmap, Reports, MyData |
| **6** Hardening | Watchdog, installer, updater | jobs, alerts, health | Settings |
| **7** Rollout | deploy স্ক্রিপ্ট | — | — |

---

## ৭. প্রধান নির্ভরশীল লাইব্রেরি

### Agent (C#)
| প্যাকেজ | কেন |
|---|---|
| `.NET 8` (self-contained) | স্টাফের PC-তে রানটাইম ইনস্টল করতে হবে না |
| ~~`SharpDX.DXGI`~~ | ❌ **লাগেনি** — SharpDX ২০১৯ থেকে পরিত্যক্ত। DXGI/D3D11-এর যে নয়টা মেথড দরকার, সেগুলো `Native/{ComCall,D3D11,Dxgi}.cs`-এ হাতে লেখা, শূন্য নির্ভরতা |
| `SixLabors.ImageSharp` | WebP এনকোডিং + রিসাইজ |
| `Microsoft.Data.Sqlite` | লোকাল queue |
| ~~`Polly`~~ | ❌ **লাগেনি** — `Core/Agent/RetryPolicy.cs` খাঁটি ফাংশন হিসেবে backoff দেয়, তাই শিডিউলার ছাড়াই ইউনিট টেস্ট করা যায় |
| `Serilog` | লগ |
| `WiX Toolset v4` | MSI ইনস্টলার |

### Server (Node)
| প্যাকেজ | কেন |
|---|---|
| `@nestjs/core` | মডিউলার স্ট্রাকচার, guard, DI |
| `prisma` | টাইপ-সেফ ORM + migration |
| `sharp` | থাম্বনেইল |
| `exceljs` · `pdfmake` | রিপোর্ট |
| `@nestjs/schedule` | cron |
| `argon2` · `jose` | পাসওয়ার্ড + JWT |
| `nodemailer` | অ্যালার্ট ইমেইল |
| `pino` | লগ |

### Web (React)
`react` · `vite` · `tailwindcss` · `@tanstack/react-query` · `recharts` · `react-router` · `date-fns` · `yet-another-react-lightbox`

---

## ৮. পোর্ট ও পাথ

| জিনিস | মান |
|---|---|
| API | `https://192.168.0.50:8443` · লোকাল ডেভে `http://localhost:3000/api/v1` |
| Web | একই origin (`/`), API `/api/v1` |
| Postgres | `localhost:5432` (শুধু ভেতরে) |
| এজেন্ট ডেটা | `%ProgramData%\oXeio\` |
| স্ক্রিনশট | `D:\oXeio\storage\screenshots\YYYY\MM\DD\emp-XXX\` |
| ব্যাকআপ | `D:\oXeio\backups\` → `E:\` (এক্সটার্নাল) |
| লগ | `D:\oXeio\logs\` |
