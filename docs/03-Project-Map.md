# 03 · Project Map

কোথায় কী কোড থাকবে, কোন মডিউল কার উপর নির্ভর করে, কোন ফিচার কোন ফাইলে।

---

## ১. সিস্টেম কম্পোনেন্ট ম্যাপ

```
┌─────────────────────────── CLIENT SIDE (১৫টি PC) ───────────────────────────┐
│                                                                              │
│  oXeio.Agent.exe (tray, user session)       oXeio.Watchdog.exe (logon task)  │
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

> ⚠️ **watchdog কোনো Windows Service নয়।** `oXeio.Watchdog/Program.cs`-এ
> `ServiceBase` নেই; ওটা `--install-task` দিয়ে বসানো একটা **লগঅন Scheduled Task**
> (`Deployment/WatchdogTask.xml`-এ `<LogonTrigger>`)। কেন এই পার্থক্যটা গুরুত্বপূর্ণ —
> [09-Build-Log](09-Build-Log.md)।

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
│   │   │   ├── Agent/CertificatePin.cs     ✅ ⭐ I01 — পিন মিলল কি না
│   │   │   │   #  ⚠️ পিন **আর** চেইন, দুটোই — কলব্যাক বসালে .NET-এর
│   │   │   │   #     নিজের যাচাই বন্ধ হয়ে যায়
│   │   │   ├── Time/MonotonicClock.cs      ✅ ঘড়ি বদলালেও অটুট
│   │   │   ├── Time/DhakaTime.cs           ✅ সার্ভারের dhaka-time.ts-এর প্রতিরূপ
│   │   │   ├── Tracking/IdleStateMachine.cs ✅ ⭐ সিস্টেমের হৃদয়
│   │   │   ├── Tracking/IdleMath.cs        ✅ wraparound + ভবিষ্যৎ-টাইমস্ট্যাম্প ক্ল্যাম্প
│   │   │   ├── Tracking/SleepGapDetector.cs ✅ ইভেন্ট ছাড়াই ঘুম ধরা
│   │   │   ├── Tracking/CaptureWindow.cs   ✅ ০৭:০০–২৩:০০
│   │   │   ├── Agent/TrackingGate.cs       ✅ ⭐ গোনা হবে কি না — সাইন ইন ও revoke
│   │   │   ├── Agent/SignOutGate.cs        ✅ ⭐ সাইন আউট করা যাবে কি না, আর কী হারাবে (১২ টেস্ট)
│   │   │   │   #  ⚠️ পাঁচটা জায়গা এটাই মানে: TrackLoop · AppUsageLoop ·
│   │   │   │   #     CaptureGate · TodayForm · TrayTooltip। আগে শর্তটা
│   │   │   │   #     দুবার লেখা ছিল, আর একবার বাদই পড়ে গিয়েছিল (G79)
│   │   │   ├── Capture/SlotScheduler.cs    ✅ ৫ মিনিট স্লট + র‍্যান্ডম
│   │   │   ├── Capture/FrameQuality.cs     ✅ ছবি কালো/এক-রঙা কি না
│   │   │   ├── Capture/PixelCopy.cs        ✅ RowPitch সামলানো + ঘূর্ণন
│   │   │   ├── Capture/EngineFallbackPolicy.cs ✅ কতবার ব্যর্থে কত বিরতি
│   │   │   ├── Apps/AppUsageTracker.cs    ✅ ⭐ D01–D04-এর চারটে নিয়ম
│   │   │   ├── Apps/DomainParser.cs       ✅ ফুল URL → শুধু ডোমেইন (ADR-013)
│   │   │   ├── Agent/                      ✅ ⭐ কনট্র্যাক্ট স্তর — ২০টা ফাইল
│   │   │   │   #  IOutboxStore · ISyncClient · SyncOutcome · RetryPolicy
│   │   │   │   #  OutboxBudget · BatchNarrowing · SyncHealthPolicy · AgentStatus
│   │   │   │   #  ConfigChange ⭐ দুই কনফিগের **পার্থক্য** — যা বদলায়নি তাতে
│   │   │   │   #    হাত না পড়ে (নইলে Settings-এ save চাপলেই সবার সেগমেন্ট কাটা)
│   │   │   ├── Watchdog/                   ✅ RestartLadder · WatchdogPolicy · AgentHeartbeat
│   │   │   └── Models/                     ✅ SegmentState, ActivitySegment
│   │   │   # ⚠️ Native/ ইচ্ছাকৃতভাবে এখানে **নয়** — Win32 ঢুকলে নিয়মগুলো
│   │   │   #    আর ইউনিট টেস্টে যাচাই করা যেত না। ওগুলো oXeio.Agent-এ।
│   │   │
│   │   ├── oXeio.Agent/                    # 🔨 net8.0-windows10.0.17763.0
│   │   │   ├── app.manifest                ✅ PerMonitorV2 DPI
│   │   │   ├── Program.cs                  ✅ এজেন্ট চালু করে · --diagnose = টুল
│   │   │   ├── AgentHost.cs                ✅ ⭐ সব মডিউল এখানে জোড়া লাগে
│   │   │   ├── AgentSettings.cs            ✅ সার্ভারের ঠিকানা (MSI লিখে দেয়)
│   │   │   ├── Diagnostics.cs              ✅ Win32 ও ক্যাপচার যাচাইয়ের টুল
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
│   │   │   ├── Platform/LivenessBeacon.cs  ✅ ⭐ agent.lock + agent.alive — watchdog-এর চোখ
│   │   │   ├── Platform/Capture/
│   │   │   │   ├── MonitorEnumerator.cs    ✅ প্রতিবার নতুন করে গোনা
│   │   │   │   ├── DuplicationCapturer.cs  ✅ ⭐ প্রধান ইঞ্জিন — DXGI (ADR-012c)
│   │   │   │   ├── GdiCapturer.cs          ✅ BitBlt + GetDIBits (ফলব্যাক)
│   │   │   │   ├── FallbackCapturer.cs     ✅ DXGI → GDI শৃঙ্খল
│   │   │   │   ├── WebpEncoder.cs          ✅ SkiaSharp q70, ≤১৯২০px
│   │   │   │   └── ScreenCaptureService.cs ✅ সব মনিটর + গুণমান যাচাই
│   │   │   ├── Storage/                    ✅ SQLite outbox — lease/ack, WAL, OutboxCodec
│   │   │   ├── Sync/                       ✅ HttpSyncClient · SyncWorker · SyncWire
│   │   │   ├── Security/                   ✅ MachineIdentity · DPAPI টোকেন · enrollment
│   │   │   ├── Ui/                         ✅ TrayIcon · TodayForm · AboutForm (J07)
│   │   │   │   └── SignInForm.cs           ✅ ⭐ স্টাফ নিজের পাসওয়ার্ড দিয়ে সাইন ইন
│   │   │   │      #  ⚠️ পাসওয়ার্ড কোথাও জমা হয় না — এখানেই টোকেনে বদলায়
│   │   │   │   #  TrayTheme  — Midnight রং, web/src/index.css-এর টোকেনের জোড়া।
│   │   │   │   #    ⚠️ হাতে লেখা ধ্রুবক — CSS এজেন্টের বিল্ডে আসে না
│   │   │   │   #  WebpImage — WebP → Bitmap। GDI+ WebP **চেনে না**, তাই ডিকোডও
│   │   │   │   #    SkiaSharp দিয়ে (এনকোডার আগে থেকেই ওটা ব্যবহার করে)
│   │   │   │   #  ⚙️ --preview-today [loading|failing|met] — জানালা দেখার টুল
│   │   │   └── Apps/                       ✅ ForegroundWindowProbe · BrowserUrlReader
│   │   │       #  AppUsageService — উইন্ডো বদলালে তবেই address bar পড়ে
│   │   │
│   │   └── oXeio.Watchdog/                 ✅ আলাদা প্রসেস — শুধু Core-এর উপর নির্ভর
│   │       ├── WatchdogLoop.cs             ✅ ৩০ সে. চেক, restart storm ঠেকানো (H01)
│   │       ├── Platform/                   ✅ heartbeat · instance lock · rolling log
│   │       └── Deployment/                 ✅ Task Scheduler XML (H02)
│   ├── installer/                          ✅ WiX → bin/oXeioAgent-<version>.msi (৬২ MB)
│   │   #  ⚠️ নামে ভার্সন, আর পুরোনো বিল্ড মোছা হয় না — ১২ আগস্ট একই
│   │   #     নামে তিনটে বাইনারি বেরিয়ে গিয়েছিল (§ ৩থ)
│   │   ├── Package.wxs                     ✅ ডাবল-ক্লিক ইনস্টল · রেজিস্ট্রি · টাস্ক
│   │   │   #    ⚠️ StartWatchdog — ইনস্টল শেষে চালুও করে (G78)
│   │   └── build.ps1                       ✅ publish → wix build · ঠিকানা ডিফল্টেই বেক
│   ├── tests/oXeio.Core.Tests/             ✅ ৩২২টি ইউনিট টেস্ট (net8.0)
│   └── tests/oXeio.Agent.Tests/            ✅ ৯৭টি — Win32 মডিউলের জন্য (net8.0-windows)
│
├── server/                                 # ── Node 22 + NestJS 11 ──
│   ├── src/
│   │   ├── main.ts  app.module.ts          ✅ prefix, helmet, CSRF, pino
│   │   ├── prisma/                         ✅ গ্লোবাল PrismaService
│   │   ├── health/                         ✅ GET /health (@Public)
│   │   ├── audit/                          ✅ audit_log-এ লেখা
│   │   ├── auth/                           ✅ ⭐ ৪টি গ্লোবাল গার্ড
│   │   │   # temp-password.ts               ✅ ⭐ দ্ব্যর্থহীন অস্থায়ী পাসওয়ার্ড — টাইপ করা যায় (G83)
│   │   │   # login-throttle.config.ts       ✅ তালার মাপ .env থেকে · =0 দিলে বন্ধ (G83)
│   │   │   ├── auth.controller.ts          #   login · logout · me · change-password
│   │   │   ├── token.service.ts            #   jose · httpOnly cookie · sliding
│   │   │   ├── password.service.ts         #   argon2id
│   │   │   ├── login-throttle.service.ts   #   ব্রুট-ফোর্স (I11)
│   │   │   └── guards/                     #   jwt · csrf · must-change-pw · roles
│   │   ├── users/                          ✅ reset-password · portal-account
│   │   ├── activity/                   ✅ ক্যাটাগরি ম্যাচার + রুল ক্যাশ (D05)
│   │   # scripts/sample-data.cjs      ⚙️ শুধু ডেমোর জন্য — manifest ধরে --undo করে
│   │   # prisma/staff.local.json      🔒 আসল নাম ও বেতন — gitignore, কখনো কমিট নয় (G70)
│   │   # prisma/staff.example.json    ✅ নমুনা — ফাইল না থাকলে seed এটা দিয়ে চলে
│   │   # prisma/parse-staff.ts        ✅ ⭐ তালিকা যাচাই — ভুল বেতন/তারিখ ঢোকার আগেই থামায় (১৮ টেস্ট)
│   │   # prisma/check-staff.ts        ✅ `npm run check:staff` — DB ছাড়াই তালিকা পরীক্ষা, কিছু লেখে না
│   │   ├── admin/                      ✅ স্টাফ · ডিভাইস · policy · ছুটি · audit (E10, E11)
│   │   ├── agent/                          ✅ ⭐ এজেন্ট → সার্ভার (৯টি endpoint)
│   │   ├── alerts/                     ✅ G01–G08 · G32 overlap · ৬ ঘণ্টার throttle · SMTP + টেলিগ্রাম
│   │   ├── dashboard/                  ✅ E01 Live Board · E04 টাইমলাইন · E05 ঘণ্টা
│   │   ├── digest/                     ✅ F07 সন্ধ্যা ৬:৩০-এর ডাইজেস্ট
│   │   ├── ops/                        ✅ K02 এনক্রিপটেড ব্যাকআপ · K03 কপি · K04 হেলথ
│   │   ├── reports/                    ✅ F01–F06 · Excel · PDF
│   │   ├── screenshots/                ✅ E06 গ্যালারি · I07 signed URL · I08 audit
│   │   ├── summary/                    ✅ K05 দিন-ক্লোজ · K06 rollup · K01 retention
│   │   │   ├── agent.controller.ts
│   │   │   ├── device-auth.guard.ts        #   Bearer → sha256 → device
│   │   │   ├── clock-drift.service.ts      #   ⭐ drift সংশোধন + অ্যালার্ট
│   │   │   ├── ingest.service.ts           #   ⭐ মধ্যরাত-স্প্লিট · dedupe · session
│   │   │   ├── screenshot-ingest.service.ts
│   │   │   ├── enrollment.service.ts  ⭐ দুটো পথ: কোড (H05) ও **স্টাফের লগইন**
│   │   │   │   #  ⚠️ লগইনের পথে যাচাই `AuthService.login()`-এই — throttle,
│   │   │   │   #     2FA আর audit তিনটেই বিনামূল্যে আসে
│   │   │   ├── agent-config.service.ts  update.service.ts
│   │   │   ├── device-rate-limit.service.ts
│   │   │   └── util/dhaka-time.ts  util/derive-uuid.ts
│   │   ├── payroll/                        ✅ ⭐ owner-only — বেতন ও ঘাটতি (ADR-023)
│   │   │   ├── payroll.math.ts             #   খাঁটি হিসাব, সব পয়সায়
│   │   │   ├── payroll.service.ts          #   monthly_salary পড়ে **শুধু এখানেই**
│   │   │   └── payroll.controller.ts       #   @Roles(owner) ক্লাস-লেভেলে
│   │   ├── me/                             ✅ ⭐ **J05** — কর্মীর নিজের ডেটা
│   │   │   #  ⚠️ পথে কোনো `:id` নেই — আইডি আসে **সেশন থেকে**, তাই ওয়েব
│   │   │   #     থেকে সহকর্মীর ডেটা চাওয়ার উপায়ই নেই
│   │   │   #  ⚠️ সংখ্যা `ProgressService` থেকেই — tray আর ওয়েব যেন এক বলে
│   │   ├── adjustments/                    ✅ ⭐ owner-এর ঘণ্টা সংশোধন (ADR-011e)
│   │   │   #  লেখা ও বাতিল দুটোই (G35/B14) · স্টাফ নিজেরটা পড়ে (J08)
│   │   └── scripts/recover-owner.ts        ✅ ⭐ owner-lockout — ফেরার একমাত্র পথ
│   │       #  ⚠️ `src/`-এর ভেতরেই, নইলে prod ইমেজে (dist + prod-deps) পৌঁছাত না
│   │       #  সিদ্ধান্তগুলো `auth/owner-recovery.ts`-এ — CLI শুধু argv ও পর্দা
│   │   # ⚠️ পরিকল্পনার employees/ devices/ timeline/ monthly/ jobs/ আলাদা মডিউল
│   │   #    হয়নি; কাজটা উপরের ✅ মডিউলগুলোর ভেতরে — স্টাফ ও ডিভাইস admin/-এ ·
│   │   #    টাইমলাইন ও live dashboard/-এ · মাসিক হিসাব summary/ ও payroll/-এ ·
│   │   #    cron জব `*.job.ts` হয়ে summary/ · ops/ · digest/-এ
│   ├── prisma/schema.prisma  migrations/  seed.ts   ✅
│   └── test/                               ✅ Vitest + supertest — ৭৪৬টি টেস্ট, ৩৭টি ফাইল
│       ├── *.e2e.spec.ts                   #   auth · agent · endpoints
│       ├── *.math.spec.ts                  #   payroll · progress · summary · digest · …
│       └── setup/harness.ts  setup/global-setup.ts
│
├── web/                                    # ── React 19 + Vite + Tailwind v4 ──
│   ├── Dockerfile                          ✅ node build → Caddy। ⚠️ এটা না থাকায়
│   │                                          ড্যাশবোর্ড চালানোর একমাত্র পথ ছিল হাতে
│   │                                          `npm run dev` — রিবুট হলেই পাতা উধাও
│   ├── Caddyfile                           ✅ ⭐ /api/* → `api:3000`, বাকি সব SPA fallback।
│   │                                          ব্রাউজারের চোখে **একটাই origin**, তাই
│   │                                          CORS-এর প্রশ্নই ওঠে না (cookie SameSite=Strict)
│   ├── .dockerignore                       ✅ ⚠️ হোস্টের (Windows) node_modules ইমেজে গেলে
│   │                                          alpine-এ ভুল প্ল্যাটফর্মের esbuild নিয়ে ভাঙত
│   └── src/
│       ├── api/client.ts                   ✅ cookie · CSRF হেডার · গ্লোবাল 401
│       ├── api/{dashboard,activity,screenshots,reports,admin,alerts}.ts
│       │                                   ✅ ⭐ টাইপগুলো **সার্ভারের সোর্স পড়ে** লেখা, অনুমান নয়
│       ├── api/useApi.ts                   ✅ useApi · usePolling (ট্যাব লুকোলে থামে)
│       ├── lib/format.ts                   ✅ ⚠️ তারিখ সবসময় ঢাকার কর্মদিবস
│       │                                      ⭐ **ফরম্যাটের একমাত্র জায়গা** — পেজে নয়
│       ├── auth/AuthContext.tsx            ✅ সেশন · useIdleLogout (I09)
│       ├── components/Layout.tsx           ✅ কালো টপবার · নেভ · সার্চ · থিম
│       ├── components/                     ✅ Page · States · Card · ProgressRing ·
│       │                                      StatusDot · DatePicker · Table · Duration ·
│       │                                      EmployeePicker · ThemeToggle · GlobalSearch
│       ├── pages/LoginPage.tsx             ✅ + TOTP দ্বিতীয় ধাপ (I06)
│       ├── pages/ChangePasswordPage.tsx    ✅ বাধ্যতামূলক প্রথম-বদল (G33)
│       ├── pages/LiveBoardPage.tsx         ✅ ⭐ হোম — E01 · E02 রিং · E03 থাম্বনেইল
│       ├── pages/EmployeeDetailPage.tsx    ✅ E04 টাইমলাইন · E05 চার্ট · D07 · D08
│       │   └── employee/DayShots.tsx       ✅ ওই দিনের ছবি — ⚠️ সবার শেষে, সংখ্যা আগে
│       ├── pages/GalleryPage.tsx           ✅ E06 গ্রিড + লাইটবক্স + কি-বোর্ড নেভ
│       ├── pages/MonthlyPage.tsx           ✅ E07 হিটম্যাপ
│       ├── pages/ReportsPage.tsx           ✅ F01–F06 · ⭐ পে-রোল ট্যাব owner ছাড়া **বানানোই হয় না**
│       ├── pages/AlertsPage.tsx            ✅ ⭐ G01–G07 · K04 — অ্যালার্ট ও হেলথ
│       │   #  ⚠️ `api/alerts.ts` অনেক আগে লেখা, কিন্তু কোনো পাতা ছোঁয়নি
│       ├── pages/settings/                 ✅ E09 · E10 · E11 · D06 — পুরোটা owner-only
│       │   └── AgentVersionsTab.tsx        ✅ ⭐ H04 — নতুন বিল্ড বিলি করা
│       ├── pages/security/                 ✅ I06 2FA চালু/বন্ধ · রিকভারি কোড
│       ├── pages/employee/Adjustments.tsx  ✅ B14 · J08 — সংশোধনের তালিকা ও ফর্ম
│       └── pages/MyDataPage.tsx            ✅ ⭐ J05 — tray-র "My data" এখানে নামে
│           #  ⚠️ কোনো বোতাম নেই — একটা বসালেই approval workflow-র প্রথম ধাপ
│   └── test/format.spec.ts                 ✅ ৬৪টি — ওয়েবের প্রথম টেস্ট
│       # ⚠️ `environment: 'node'`, jsdom নয় — এখানকার কিছুরই DOM লাগে না
│       # ⚠️ ব্রাউজারে লগইন করে দেখা হয়নি ([09 § ৩ঈ](09-Build-Log.md))
│
├── (রেপো রুটে) docs/                       # ← এই ডকুমেন্টগুলো — oxeio-monitor-এর **বাইরে**
│   ├── monitoring-policy-template.md       # স্টাফের সই করার পলিসি
│   └── mockup/                             # dashboard-mockup.html · tray-today-mockup.html
├── docker-compose.yml                      ✅ চারটে সার্ভিস: postgres · api · web · migrate
│   #  api-তে healthcheck (`/api/v1/health` + db:up); web তার উপর নির্ভর করে
│   #  ⚠️ **migrate একটা one-shot সার্ভিস**, `profiles: [setup]`-এ — `up -d`-তে চলে না:
│   #       docker compose --profile setup run --rm migrate
│   #     ইচ্ছাকৃত (মাইগ্রেশন সচেতন ধাপ), কিন্তু এই ধাপটা **রানবুকে ছিলই না**,
│   #     ফলে `up -d` করলে ডাটাবেসে একটাও টেবিল বসত না
│   #  ⚠️ prisma/ হোস্ট থেকে read-only mount — `staff.local.json`-এ নাম ও বেতন
├── .env.example                            ✅ সার্ভার যত চলক পড়ে সবগুলো — পুরো SMTP
│                                              সেট ও ALERT_EMAIL_TO আগে বাদ ছিল
├── deploy/
│   ├── README.md                           # রোলআউট নির্দেশিকা — সার্ট · TLS · ফায়ারওয়াল · পিনিং
│   ├── make-cert.ps1                       # self-signed সার্ট + পিন (certs/)
│   ├── defender-exclusions.ps1             # AV exception স্ক্রিপ্ট
│   ├── vps-setup.sh                        ✅ VPS প্রথমবার দাঁড় করানো (ADR-026)
│   └── vps-update.sh                       ✅ ⭐ পরের প্রতিটা হালনাগাদ — pull · migration · রিবিল্ড · স্বাস্থ্য
│                                              ⚠️ seed চালায় না — ওটা কর্মীর নাম/বেতন/তারিখ চাপা দিত
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
  DashboardModule ─▶ Prisma (read-only)              ✅
  ReportsModule ─▶ Summary ──▶ monthly_summary       ✅
  SummaryModule ─▶ cron (K05/K06) · OpsModule ─▶ cron ✅
  AlertsModule ◀── জব ও Agent (ইভেন্ট-ভিত্তিক)         ✅
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
| র‍্যান্ডম স্ক্রিনশট | `SlotScheduler` `ScreenCapturer` | `agent/screenshot-ingest` ✅ → `screenshots/` ✅ | `GalleryPage.tsx` |
| **A07** ছবির সাথে অ্যাপ ও টাইটেল | `AgentHost.CaptureSlotAsync` → `_apps?.Current` ✅ ⭐ Win32-কে **নতুন করে জিজ্ঞেস করা হয় না** — app-usage টিক যা শেষবার পড়েছে সেটাই, নইলে ছবির নাম আর `app_usage`-এর সারি আলাদা হতে পারত। ⚠️ অ্যাপ ট্র্যাকিং বন্ধ থাকলে `_apps`-ই তৈরি হয় না, তাই ঘর দুটো খালি | `screenshot-ingest` ✅ | `GalleryPage` · `DayShots` |
| Idle/Active টাইম | `IdleStateMachine` `SegmentBuilder` | `agent/ingest.service` ✅ | `employee/TimelineBar.tsx` |
| মধ্যরাতে দিন বদল | `SegmentBuilder` | `agent/util/dhaka-time` ✅ | — |
| Clock drift | `MonotonicClock` | `agent/clock-drift.service` ✅ | — |
| অফলাইন কাজ → dedupe | `LocalQueue` `SyncClient` | `agent/util/derive-uuid` ✅ | — |
| মাসিক ২০৮ঘ টার্গেট + pace | `TrayIcon` · `TodayForm` | `summary/` · `agent/progress.service` ✅ | `components/ProgressRing.tsx` |
| অ্যাপ/সাইট ট্র্যাকিং | `ForegroundWindowProbe` `BrowserUrlReader` | `agent/ingest.service` ✅ · `activity/` (D05 ক্যাটাগরি) ✅ | `EmployeeDetailPage.tsx` |
| লাইভ স্ট্যাটাস | heartbeat ✅ | `dashboard/live.controller` ✅ | `LiveBoardPage.tsx` |
| মাসিক হিটম্যাপ | — | `summary/` · `day-close.job` ✅ | `MonthlyPage.tsx` |
| রিপোর্ট | — | `reports/` ✅ · `payroll/` ✅ | `ReportsPage.tsx` |
| Watchdog | `oXeio.Watchdog` (লগঅন Scheduled Task, সার্ভিস নয়) | `alerts/` ✅ | `LiveBoardPage` badge |
| Retention | — | `summary/retention.job` ✅ রাত ২টার cron + `POST /ops/retention/run` (K01) | `settings/` |
| স্টাফের নিজস্ব ভিউ | `TodayForm` (tray) ✅ | `me/` ✅ — `GET /me` · `GET /me/days` | `MyDataPage.tsx` ✅ tray-র "My data" এখানেই নামে |
| **ঘণ্টা সংশোধন** (ADR-011e) | — | `adjustments/` ✅ লেখা ও বাতিল দুটোই (G35/B14) | `pages/employee/Adjustments.tsx` ✅ |
| **কনফিগ পৌঁছানো** (E09/K07) | `ConfigChange` · `AgentHost.ReloadConfigAsync`/`ApplyConfig` ✅ | `agent-config.service` · `agent.controller` (`reload_config`) ✅ | `settings/PoliciesTab.tsx` ✅ |

⭐ **কনফিগ-লুপে দুটো সিদ্ধান্ত**, দুটোই আলাদা করে লেখার মতো —
১· কনফিগ **আনা** হয় দুটো কারণে: সার্ভার স্পষ্ট করে `reload_config` বললে,
**অথবা** heartbeat-এর `configVersion` নিজেরটার সাথে না মিললে। শুধু কমান্ডের
উপর নির্ভর করলে রিবুটের পর এজেন্ট চিরকাল পুরোনো কনফিগে চলত।
২· ⚠️ **প্রয়োগ হয় `TrackLoop`-এ, heartbeat থ্রেডে নয়** — ট্র্যাকিংয়ের
অবজেক্টগুলো ওই থ্রেডের। বাইরে থেকে ছুঁলে এক সেকেন্ডের হিসাব দুই কনফিগে
ভাগ হয়ে যেত। তাই আনা কনফিগ `_pendingConfig`-এ অপেক্ষা করে।

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
| ~~`SixLabors.ImageSharp`~~ | ❌ **বদলে `SkiaSharp`** (+ `.NativeAssets.Win32`) — ImageSharp v4+ বাণিজ্যিক ব্যবহারে লাইসেন্স চায় (`Capture/WebpEncoder.cs` § ১১)। এনকোড **ও** ডিকোড দুটোই ওকে দিয়ে — GDI+ WebP চেনে না, তাই `Ui/WebpImage.cs`-ও এটাই ব্যবহার করে |
| `Microsoft.Data.Sqlite` | লোকাল queue |
| ~~`Polly`~~ | ❌ **লাগেনি** — `Core/Agent/RetryPolicy.cs` খাঁটি ফাংশন হিসেবে backoff দেয়, তাই শিডিউলার ছাড়াই ইউনিট টেস্ট করা যায় |
| ~~`Serilog`~~ | ❌ **লাগেনি** — কোনো csproj-এ নেই। যা আছে তা হাতে লেখা: watchdog-এর `Platform/RollingLog.cs`, এজেন্টের `Storage/FileLog.cs` (H08 — `logs\agent.log`, ৭ দিন / ৫০ MB, সিদ্ধান্তটা `Core/Agent/LogRetention.cs`-এ) ও `Storage/DropLog.cs`। ⚠️ আগে `ISyncLog`-এর একমাত্র বাস্তবায়ন ছিল `ConsoleSyncLog`, আর প্রজেক্ট `WinExe` — কনসোল না থাকায় **প্রতিটা লাইন শূন্যে যেত**। [09-Build-Log](09-Build-Log.md) § ৩ঝ |
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
| API | compose-এ `3000:3000` → `http://<server-ip>:3000/api/v1`। TLS চালু করলে ম্যাপিং হয় `443:3000` (`deploy/README` § ৪) |
| Web | `${WEB_PORT:-8080}` → `http://<server-ip>:8080/`। ⭐ API একই origin-এ (`/api/v1`) — Caddy প্রক্সি করে, তাই আলাদা পোর্ট ব্রাউজারকে দেখতে হয় না |
| Postgres | `localhost:5432` (শুধু ভেতরে) |
| এজেন্ট ডেটা | `%ProgramData%\oXeio\` |
| স্ক্রিনশট | `D:\oXeio\storage\screenshots\YYYY\MM\DD\emp-XXX\` |
| ব্যাকআপ | `D:\oXeio\backups\` → `E:\` (এক্সটার্নাল) |
| লগ | `D:\oXeio\logs\` |
