# 03 · Project Map

কোথায় কী কোড থাকবে, কোন মডিউল কার উপর নির্ভর করে, কোন ফিচার কোন ফাইলে।

---

## ১. সিস্টেম কম্পোনেন্ট ম্যাপ

```
┌─────────────────────────── CLIENT SIDE (১২টি PC) ───────────────────────────┐
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
│                        SERVER (VPS · hub.oxeio.com)                              │
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
│    PostgreSQL 16        /data/storage/                                    │
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
> ⚠️ কয়েকটা সারিতে ✅-র বদলে ⚠️ — কোড আছে, কিন্তু **মাঠে একবারও চালানো
> হয়নি** (তালিকাটা [README](../README.md)-এ এক জায়গায়)।
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
│   │   │   ├── Tracking/ScreenActivity.cs  ✅ ⭐⭐ G46 — পর্দা সত্যিই বদলাচ্ছে?
│   │   │   │   #  ⚠️⚠️ `StaleAfter` (৩ মি.) — নমুনা টাটকা না হলে কোনো উত্তরই
│   │   │   │   #     নয়। এটা না থাকায় একটা অচলাবস্থা হয়েছিল: জমেছে → IDLE →
│   │   │   │   #     স্ক্রিনশট বন্ধ → নতুন নমুনা নেই → চিরকাল জমে (09 § ৩৫)
│   │   │   ├── Tracking/ScreenSampling.cs  ✅ ⭐⭐ কখন ছাপ নেওয়া হবে
│   │   │   │   #  ⚠️ `Allowed()`-এ ইচ্ছাকৃতভাবে **SegmentState নেই** — যে
│   │   │   │   #     তথ্য দিয়ে সিদ্ধান্ত, তার উৎস সিদ্ধান্তের ফলের উপর
│   │   │   │   #     নির্ভর করলে বেরোনোর পথ থাকে না
│   │   │   ├── Agent/HeartbeatUrgency.cs   ✅ ⭐ অবস্থা বদলালে beat সাথে সাথে
│   │   │   │   #  ⚠️ ছাদ `MinGap` ৩ সে. — নইলে দোদুল্যমান অবস্থায় সার্ভারে ঢেউ
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
│   │   │   ├── Agent/                      ✅ ⭐ কনট্র্যাক্ট স্তর — ২৬টা ফাইল
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
│   │   │   ├── ScreenFingerprint.cs      ✅ ⭐ G46 — ১৬×১৬ ধূসর ছাপ, মেশিন ছাড়ে না
│   │   │   │   #  ⚠️ নমুনা নেওয়া হয় **ক্যাপচার লুপে** (`SampleScreen`, ৬০ সে. ·
│   │   │   │   #     জমে থাকলে ৫ সে.), স্ক্রিনশটের স্লটে নয় — এক থ্রেডই
│   │   │   │   #     ক্যাপচার ইঞ্জিনের মালিক (দুই থ্রেড = DXGI সংঘর্ষ)
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
│   │   ├── make-icon.py                    ✅ ⭐ favicon.svg → oxeio.ico, ৯টা মাপ
│   │   │   #  ⚠️ প্রতিটা মাপ **আলাদা করে** আঁকা, একটা বড় ছবি ছোট করে নয় —
│   │   │   #     ১৬px-এ X-এর ডাঁটি নইলে ধূসর হয়ে মিলিয়ে যেত
│   │   ├── oxeio.ico                       ✅ উপরের স্ক্রিপ্টের **ফল**, হাতে আঁকা নয়
│   │   │   #  ⚠️ TrayIconPainter-এর নিয়ম "রিপোতে .ico বাইনারি নেই" — ব্যতিক্রমটা
│   │   │   #     টেকে কারণ উৎসটা রিপোতেই; বদলাতে হলে স্ক্রিপ্ট বদলাবেন
│   │   ├── Package.wxs                     ✅ ডাবল-ক্লিক ইনস্টল · রেজিস্ট্রি · টাস্ক
│   │   │   #    ⚠️ StartWatchdog — ইনস্টল শেষে চালুও করে (G78)
│   │   └── build.ps1                       ✅ publish → wix build · ঠিকানা ডিফল্টেই বেক
│   ├── tests/oXeio.Core.Tests/             ✅ ৩৮৩টি ইউনিট টেস্ট (net8.0)
│   └── tests/oXeio.Agent.Tests/            ✅ ১০৬টি — Win32 মডিউলের জন্য (net8.0-windows)
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
│   │   # prisma/parse-staff.ts        ✅ ⭐ তালিকা যাচাই — ভুল বেতন/তারিখ ঢোকার আগেই থামায় (২২ টেস্ট)
│   │   # prisma/check-staff.ts        ✅ `npm run check:staff` — DB ছাড়াই তালিকা পরীক্ষা, কিছু লেখে না
│   │   # prisma/holidays.data.ts      ✅ ⭐ R7 — বাংলাদেশের ছুটি ২০২৬–২৭, ৫১টা সারি (৭৭ টেস্ট)
│   │   #    ⭐⭐ `approximate` ঘর — চাঁদ/তিথি-নির্ভর ৩৩টা তারিখ নামের শেষে
│   │   #       "(সম্ভাব্য)" নিয়ে DB-তে যায়, যাতে মালিক পর্দায় দেখতে পান
│   │   #    ⭐ `planHolidaySeedRun()` — seed কখনো বদলায়/মোছে না, শুধু বসায়;
│   │   #       চলতি ও অতীত মাস `SEED_HOLIDAYS_PAST=true` ছাড়া আটকে থাকে
│   │   #       (ওতে target_sec · pace_sec · পে-রোলের d÷D নড়ত — সরাসরি টাকা)
│   │   #    ⚠️ `APPROX_SUFFIX` স্ট্রিংটার **যমজ কপি** `src/reports/reports.range.ts`-এ —
│   │   #       `prisma/` ↔ `src/` import দুই দিকেই ভাঙে, তাই দুটো এক আছে কি না
│   │   #       `test/holidays.spec.ts` পাহারা দেয়
│   │   ├── admin/                      ✅ স্টাফ · ডিভাইস · policy · সরকারি ছুটি · audit (E10, E11)
│   │   │                                  ✅ ⭐ R1 `month-close.*` · R2 `leave.*`
│   │   ├── agent/                          ✅ ⭐ এজেন্ট → সার্ভার (৯টি endpoint)
│   │   ├── alerts/                     ✅ G01–G08 · G32 overlap · ৬ ঘণ্টার throttle · SMTP + টেলিগ্রাম
│   │   ├── dashboard/                  ✅ E01 Live Board · E04 টাইমলাইন · E05 ঘণ্টা
│   │   ├── digest/                     ✅ **তিনটে প্রেরক, এক মডিউল** — দৈনিক (F07) · সাপ্তাহিক (R3) · ঘণ্টার স্ন্যাপশট
│   │   │   ├── digest.{job,math,service}.ts   ✅ F07 — রোজ সন্ধ্যা ৬:৩০
│   │   │   ├── weekly.rules.ts                ✅ ⭐ R3 — সপ্তাহের গণিত, খাঁটি ফাংশন
│   │   │   ├── weekly.service.ts              ⚠️ ⭐ গ্রুপ-চ্যাটে চলে যাওয়া আটকানোর প্রহরী
│   │   │   │   #  `WEEKLY_DIGEST_ALLOW_GROUP` না দিলে গ্রুপ chat id-তে যাবেই না —
│   │   │   │   #  সাপ্তাহিক সারাংশে **সবার** নাম ও ঘণ্টা থাকে, তাই ভুল চ্যাটে
│   │   │   │   #  একবার গেলে সেটা আর ফেরানো যায় না
│   │   │   ├── weekly.job.ts                  ⚠️ শুক্র সন্ধ্যা (`WEEKLY_DIGEST_DAY/HOUR`)
│   │   │   ├── snapshot.rules.ts              ✅ ⭐⭐ ঘণ্টার স্ন্যাপশট — খাঁটি
│   │   │   │   #  ⚠️⚠️ মালিক চেয়েছিলেন "কেউ ১০ মি. idle হলেই খবর"; হিসাবে
│   │   │   │   #     দাঁড়াত দিনে ৬০–১৮০টা বার্তা, তাই ঘণ্টায় একটা (09 § ৩৩)
│   │   │   │   #  ⭐ কাজ করা মানুষের নাম লেখা হয় না, শুধু গোনা — নইলে
│   │   │   │   #     বার্তাটাই এত লম্বা হতো যে কেউ পড়ত না
│   │   │   ├── snapshot.service.ts            ✅ DashboardService.live() ডাকে
│   │   │   │   #  ⚠️ নিজে কিছু গোনে না — Live Board যা দেখায় ঠিক সেটাই যায়
│   │   │   └── snapshot.job.ts                ✅ প্রতি ঘণ্টায়, ৯টা–৭টা
│   │   │   #  ⚠️ **সাপ্তাহিক জব:** মাঠে একবারও চলেনি — আসল বটে একটাও সাপ্তাহিক বার্তা যায়নি
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
│   │   ├── deposits/                       ✅ ⭐⭐ **R21** — সিকিউরিটি মানি (ADR-028)
│   │   │   ├── deposit.math.ts             #   খাঁটি হিসাব — মাসের ক্রম, নোটিশের দিন
│   │   │   ├── deposits.service.ts         #   ⭐ খাতা **লিখে রাখে**, গোনে না
│   │   │   └── deposits.controller.ts      #   @Roles(owner) ক্লাস-লেভেলে
│   │   │   #  ⚠️ ম্যানেজারও নয় — জামানত সরাসরি বেতনের অংশ
│   │   │   #  ⭐ কর্মী নিজেরটা `/me/deposit`-এ দেখেন
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
│   └── test/                               ✅ Vitest + supertest — **১২৮৬টি টেস্ট, ৬৭টি ফাইল**
│       #  ⚠️ ৪৪টি ফাইল DB ছাড়াই চলে; ২৩টি `*.e2e.spec.ts`
│       #     (২৩০ টেস্ট) Postgres ছাড়া চলে না — [README § টেস্ট](../README.md)
│       ├── *.e2e.spec.ts                   #   auth · agent · endpoints
│       ├── *.math.spec.ts                  #   payroll · progress · summary · digest · …
│       ├── holidays.spec.ts                ✅ ⭐ ৭৭ — তালিকা যাচাই · seed পরিকল্পনা ·
│       │                                   #   "(সম্ভাব্য)" চিহ্নের দুই কপি এক আছে কি না
│       ├── weekly-digest.spec.ts           ✅ ⭐ ৭৭ — R3-এর গণিত ও গ্রুপ-চ্যাট প্রহরী
│       ├── tracking-start.spec.ts          ✅ ২৭ — `elapsedWindow()`: ট্র্যাকিং শুরুর
│       │                                   #   আগের দিন কারো ব্যর্থতা নয়
│       ├── reports.target.spec.ts          ✅ ২৩ — রিপোর্টের দৈনিক টার্গেটও এখন
│       │                                   #   পলিসির `expected_workdays` ভাগ করে
│       ├── trend-expectation.spec.ts       ✅ ১৫ — ৭ দিনের ফিতের প্রত্যাশা এখন
│       │                                   #   ক্যালেন্ডার দেখে, `daily_summary` সারি গুনে নয়
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
│   ├── vite.config.ts                      ✅ ⭐ R12 — ভেতরে হাতে লেখা rollup প্লাগইন যা
│   │                                          `sw.js` বানায়। ⚠️ **বিল্ড-গার্ড:** precache
│   │                                          তালিকায় `/api` ঢুকলে বিল্ড থেমে যায়
│   ├── public/                             ✅ ⭐ R12 — manifest + ছ-টা আইকন
│   │   ├── manifest.webmanifest            ✅ standalone · scope / · theme #000000
│   │   │                                      ⚠️ Content-Type Caddyfile-এ হাতে বসানো —
│   │   │                                      Go-র builtin তালিকায় `.webmanifest` নেই
│   │   ├── favicon.svg · favicon.ico       ✅ ⚠️ ico আসল মাল্টি-সাইজ ICONDIR (১৬/৩২/৪৮),
│   │   │                                      PNG-কে নাম বদলে নয়
│   │   └── icons/                          ✅ 192 · 512 · maskable-512 · apple-touch-180
│   │                                          ⚠️ শেষ দুটোয় **alpha চ্যানেলই নেই** — iOS
│   │                                          স্বচ্ছ অংশ কালো করে, আর Android mask করে
│   └── src/
│       ├── api/client.ts                   ✅ cookie · CSRF হেডার · গ্লোবাল 401
│       ├── api/{dashboard,activity,screenshots,reports,admin,alerts}.ts
│       │                                   ✅ ⭐ টাইপগুলো **সার্ভারের সোর্স পড়ে** লেখা, অনুমান নয়
│       ├── api/useApi.ts                   ✅ useApi · usePolling (ট্যাব লুকোলে থামে)
│       ├── lib/format.ts                   ✅ ⚠️ তারিখ সবসময় ঢাকার কর্মদিবস
│       │                                      ⭐ **ফরম্যাটের একমাত্র জায়গা** — পেজে নয়
│       ├── pages/settings/LeaveTab.tsx     ✅ ⭐⭐ R2 — ছুটির খাতা (owner-only)।
│       │                                      ⭐⭐ ছুটি **টার্গেট** কমায়, বেতনের `d ÷ D`
│       │                                      নয় — সবেতন। ⚠️ শুক্রবার/সরকারি ছুটির দিনে
│       │                                      লেখা সারি কিছুই বদলায় না, আর সেটা **নিজেই
│       │                                      বলে দেয়** — নইলে খাতা এমন ছাড়ের দাবি করত
│       │                                      যা সে দেয়নি
│       ├── pages/settings/DepositsTab.tsx  ✅ ⭐⭐ R21 — জামানত (owner-only)।
│       │   #  ⚠️ ফাইলটা settings/-এই আছে, কিন্তু পর্দাটা **সেটিংসে নয়** —
│       │   #     সাইডবারের `DepositsPage.tsx` এটাকে মুড়ে দেখায় (09 § ৩ঃ)
│       │   #  মোট জমা উপরে একবার · সারি ধরে তালিকা · নিয়মের মোডাল
│       │   #  ⚠️ নিষ্পত্তির ডায়ালগে নোটিশের হিসাব **দেখানো হয়**, কিন্তু
│       │   #     বোতাম বদলানো হয় না — সিদ্ধান্তটা মালিকের (ADR-028)
│       ├── pages/settings/MonthsTab.tsx    ✅ ⭐ R1 — মাস বন্ধ/খোলা।
│       │                                      ⚠️ তালিকা **মাস ধরে**, বন্ধ-রেকর্ড ধরে নয় —
│       │                                      প্রশ্নটা "কোনটা এখনো বাকি", আর অনুপস্থিতি
│       │                                      দিয়ে সেটা বোঝা যায় না
│       ├── pages/live/TopApps.tsx          ✅ ⭐ "Where today went" — দলের অ্যাপ-সময়।
│       │                                      ⚠️ **এক হিউ, স্বচ্ছতার ধাপে** — অবস্থার
│       │                                      রং (ok/idle/attention) পরিচয় বোঝাতে
│       │                                      ব্যবহার করলে অ্যালার্টের লাল আর চার্টের
│       │                                      লাল এক হয়ে যেত
│       ├── pages/live/OpenAlerts.tsx       ✅ না-দেখা অ্যালার্ট, **owner-only**।
│       │                                      ⚠️ খালি অবস্থা সবুজ নয়, নিরপেক্ষ —
│       │                                      "কিছু নেই" আর "সব ভালো" এক নয়
│       ├── pwa-sw.ts                       ✅ ⭐⭐ সার্ভিস ওয়ার্কার। **কোনো API উত্তর
│       │                                      ক্যাশ করে না** — `/api` `fetch`-এ সবার আগে
│       │                                      বাদ, আর রানটাইমে কোথাও `cache.put` নেই
│       │                                      (ক্যাশ `install`-এ একবার লেখা, পরে read-only)
│       ├── pwa.ts                          ✅ রেজিস্ট্রেশন · skipWaiting · ঘণ্টায় একবার
│       │                                      আপডেট-খোঁজা (ট্যাব দৃশ্যমান হলে)
│       ├── auth/AuthContext.tsx            ✅ সেশন · useIdleLogout (I09)
│       │                                   ⚠️ `offline` — "সার্ভারে পৌঁছাইনি" আর "সেশন
│       │                                      শেষ" আলাদা; নইলে ফোনে নেট গেলেই লগইন পর্দা
│       ├── components/Layout.tsx           ✅ কালো টপবার · নেভ · থিম
│       │                                   ⭐ `lg`-এর উপরে **সাইডবার**, নিচে আড়াআড়ি
│       │                                      সারি। ⚠️ ফোনে সাইডবার নয় — হয় কনটেন্টের
│       │                                      ২০০px যেত, নয় একটা drawer লাগত
│       │                                   ⚠️ গ্লোবাল সার্চ সরানো (G127)
│       ├── components/                     ✅ Page · States · Card · ProgressRing ·
│       │                                      StatusDot · DatePicker · Table · Duration ·
│       │                                      EmployeePicker · ThemeToggle · GlobalSearch
│       ├── pages/LoginPage.tsx             ✅ + TOTP দ্বিতীয় ধাপ (I06)
│       ├── pages/ChangePasswordPage.tsx    ✅ বাধ্যতামূলক প্রথম-বদল (G33)
│       ├── pages/LiveBoardPage.tsx         ✅ ⭐ হোম — E01 টাইল · চার্ট · দলের টেবিল
│       │   #  ⚠️⚠️ মানুষের **কার্ড এখানে আর নেই** — ১৭ আগস্ট `WorklogPage`-এ
│       │   #     সরানো (09 § ৩ফ)। সাথে স্ক্রিনশটের লাইটবক্স আর
│       │   #     `getLatestShots` polling-ও উঠেছে — ওটা ছবি না দেখিয়েও
│       │   #     প্রতি কলে একটা করে audit সারি লিখত (I08)
│       ├── pages/WorklogPage.tsx            ✅ ⭐⭐ E01 কার্ড — "এখন কে কাজ করছে"
│       │   #  ⚠️ owner + manager, আর শর্তটার **নাম আছে** (`mayOpenWorklog`),
│       │   #     `!isStaff` নয় — শর্ত তিন জায়গায় থাকে (নেভ · রুট · পর্দা),
│       │   #     আর G134-এ নাম না থাকায় ম্যানেজার নেভে দেখতেন, চাপলে "কিছু নেই"
│       │   └── live/TeamCards.tsx           ✅ ট্যাব · কার্ডের গ্রিড · লেজেন্ড · লাইটবক্স
│       │       #  ⚠️ কম্পোনেন্টে **তোলা** হয়েছে, কেটে-বসানো নয় — দুই কপি
│       │       #     থাকলে একদিন একটা বদলাত আর অন্যটা নয়
│       ├── pages/EmployeeDetailPage.tsx    ✅ E04 টাইমলাইন · E05 চার্ট · D07 · D08
│       │   └── employee/DayShots.tsx       ✅ ওই দিনের ছবি — ⚠️ সবার শেষে, সংখ্যা আগে
│       ├── pages/GalleryPage.tsx           ✅ E06 গ্রিড + লাইটবক্স + কি-বোর্ড নেভ
│       ├── pages/MonthlyPage.tsx           ✅ E07 হিটম্যাপ
│       ├── pages/ReportsPage.tsx           ✅ F01–F06 · ⭐ পে-রোল ট্যাব owner ছাড়া **বানানোই হয় না**
│       ├── pages/AlertsPage.tsx            ✅ ⭐ G01–G07 · K04 — অ্যালার্ট ও হেলথ
│   │   ├── DepositsPage.tsx                ✅ ⭐ R21 জামানত — সাইডবারে, Settings-এ নয় (09 § ৩ঃ)
│       │   #  ⚠️ `api/alerts.ts` অনেক আগে লেখা, কিন্তু কোনো পাতা ছোঁয়নি
│       ├── pages/settings/                 ✅ E09 · E10 · E11 · D06 — পুরোটা owner-only
│       │   └── AgentVersionsTab.tsx        ✅ ⭐ H04 — নতুন বিল্ড বিলি করা
│       ├── pages/security/                 ✅ I06 2FA চালু/বন্ধ · রিকভারি কোড
│       ├── pages/employee/Adjustments.tsx  ✅ B14 · J08 — সংশোধনের তালিকা ও ফর্ম
│       └── pages/MyDataPage.tsx            ✅ ⭐ J05 — tray-র "My data" এখানে নামে
│           #  ⚠️ কোনো বোতাম নেই — একটা বসালেই approval workflow-র প্রথম ধাপ
│   └── test/                               ✅ **৭৩টি, ২ ফাইল**
│       ├── format.spec.ts                  ✅ ৬৪টি — ওয়েবের প্রথম টেস্ট
│       └── onTheClock.spec.ts              ✅ ৯টি — **Worklog**-এর দুই ট্যাব (`live/TeamCards.tsx`); বোর্ডের "Working now" টাইলও একই `isWorking()` ডাকে, তাই সংখ্যা দুটো কখনো আলাদা হয় না;
│           #  ⚠️ কেউ যেন **কোনো ট্যাবেই না পড়ে নীরবে উধাও** হয়ে না যায়
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
│   ├── vps-update.sh                       ✅ ⭐ পরের প্রতিটা হালনাগাদ — pull · migration · রিবিল্ড · স্বাস্থ্য
│   │                                          ⚠️ seed চালায় না — ওটা কর্মীর নাম/বেতন/তারিখ চাপা দিত
│   └── vps-harden.sh                       ⚠️ R6-এর অর্ধেক — fail2ban + security-only auto-update
│                                              ⚠️ **একবারও চালানো হয়নি**, কোনো মেশিনে নয়
│                                              ⚠️ বাকি অর্ধেক এখনো হয়নি: Caddy-তে `/api/v1/auth/*` rate limit
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
        └──▶ **exports: DashboardService** ⭐ প্রথম বাইরের গ্রাহক (১৭ আগস্ট)
  DigestModule ─▶ DashboardModule ──▶ live()          ✅
        #  ⚠️⚠️ ঘণ্টার স্ন্যাপশট নিজে কিছু **গোনে না** — Live Board যা
        #     দেখায় ঠিক সেটাই টেলিগ্রামে যায়। দুই জায়গায় দুই হিসাব হলে
        #     পর্দা এক কথা বলত আর টেলিগ্রাম অন্য কথা, আর কোনটা সত্যি
        #     তা বলার উপায় থাকত না
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
| মাসিক টার্গেট + pace (কর্মদিবস × ৮ঘ, ফ্ল্যাট ২০৮ নয়) | `TrayIcon` · `TodayForm` | `summary/proration.ts` · `reports/reports.range.ts` (`dailyTargetSec`) · `agent/progress.service` ✅ | `components/ProgressRing.tsx` |
| ✅ ~~একই টার্গেট, দুই হার~~ **মিলেছে** | — | চারটে পথই এখন **একই `prorate()` ডাকে**, একই সূত্র দু'জায়গায় লেখা নয়: tray · `/me` · `reports/` · `dashboard.service.ts`-এর লাইভ কার্ড। ⚠️ আগে কার্ড **ক্যালেন্ডার কর্মদিবস** ভাগ করত (২৭ কর্মদিবসের আগস্টে ৭ঘ ৪২মি/দিন) আর tray পলিসির ধ্রুবক (৮.০০ঘ) — একই কর্মী, একই মাস, দুই সংখ্যা (G88)। মাঠে যাচাই: কার্ড এখন ৮.০০ঘ/দিন · ২০৮ঘ/মাস | `WorklogPage` → `live/TeamCards.tsx` → `live/PersonCard.tsx` (কার্ড) · বোর্ডে টার্গেট দেখা যায় টাইলের sub-এ ও `TeamTable`-এর বারে · `api/dashboard.ts` |
| **R7** ছুটির ক্যালেন্ডার (২০২৬–২৭) | — | `prisma/holidays.data.ts` → `seed.ts` ✅ · `admin/holidays.service` ✅ | `settings/HolidaysSection.tsx` |
| **R1** মাস বন্ধ করা (payroll lock) | — | `admin/month-close.{service,controller}.ts` ✅ · `month_closure` টেবিল · `summary.service.ts`-এর গার্ড · `adjustments`-এ `assertMonthOpen()` | `settings/MonthsTab.tsx` ✅ |
| **R2** ছুটির খাতা | — | `admin/leave.{service,controller}.ts` ✅ · `leaves` টেবিল · `countLeaveWorkdays()` → `prorate()` · `elapsedWorkdays()` · `proratedExpectedSec()`। ⭐⭐ ছুটি **টার্গেট** কমায়, `d ÷ D` নয় — অর্থাৎ সবেতন | `settings/LeaveTab.tsx` ✅ |
| ⭐ **Worklog** — কার্ড নিজের পাতায় *(১৭ আগস্ট)* | — | `dashboard/live.controller` (একই API) | `WorklogPage.tsx` ✅ **সাইডবারে** · ভেতরটা `live/TeamCards.tsx`। ⚠️ Live Board থেকে **সরানো**, নকল নয় — কার্ড পাতার সবার নিচে ছিল, অথচ "এখন কে কাজ করছে" প্রশ্নটাই সবচেয়ে বেশিবার করা। ⭐ সাথে বোর্ডের `getLatestShots` polling-ও উঠল — ওটা ছবি না দেখিয়েও প্রতি কলে একটা করে audit সারি লিখত (I08) |
| **R21** সিকিউরিটি মানি (জামানত) | — | `deposits/` ✅ · তিনটে টেবিল (`deposit_policy` · `security_deposits` · `deposit_settlements`) · `payroll.service`-এ `securityDeposit`/`netPayable` · `GET /me/deposit`। ⭐⭐ খাতা **লিখে রাখা** হয়, গোনা হয় না — অঙ্ক বদলালে পুরোনো কিস্তি নড়ে না | `DepositsPage.tsx` ✅ **সাইডবারে**, সেটিংসে নয় (09 § ৩ঃ) · ভেতরটা `settings/DepositsTab.tsx` · `MyDataPage.tsx`-এ কর্মীর নিজের কার্ড ✅ |
| **R3** সাপ্তাহিক টেলিগ্রাম সারাংশ | — | `digest/weekly.{rules,service,job}.ts` ⚠️ কোড ও ৭৭ টেস্ট আছে, মাঠে চলেনি। ⭐ টোকেন ও chat id এখন **পর্দা থেকেই** বসানো যায় (`alerts/telegram.settings.ts`) | `settings/NotificationsTab.tsx` ✅ |
| ট্র্যাকিং শুরুর জানালা | — | `summary/summary.math.ts` → `elapsedWindow()` ✅ — tray · Monthly · ডাইজেস্ট · রিপোর্ট **এক সংজ্ঞা** (এজেন্ট বসার আগের না-দেখা দিন কারো ঘাটতি নয়)। ⚠️ ৭ দিনের ফিতে (`trendDayExpectation`) **ইচ্ছাকৃতভাবে আজকের দিনটা রাখে** — ভিন্ন প্রশ্ন, ফাংশনের নোটে লেখা | `MonthlyPage` · `live/WeekAndMonth.tsx` |
| অ্যাপ/সাইট ট্র্যাকিং | `ForegroundWindowProbe` `BrowserUrlReader` | `agent/ingest.service` ✅ · `activity/` (D05 ক্যাটাগরি) ✅ | `EmployeeDetailPage.tsx` |
| লাইভ স্ট্যাটাস | heartbeat ✅ · `HeartbeatUrgency` — অবস্থা বদলালে beat **সাথে সাথে** (ছিল ০–১৫ সে.) | `dashboard/live.controller` ✅ · `dashboard.math.ts` → `decideLiveStatus()` | `LiveBoardPage.tsx` ও `WorklogPage.tsx` — দুটোই ১৫ সে. (ছিল ৩০)। ⚠️ ছন্দ দুটো আলাদা হলে একই মুহূর্তে দুই পাতায় দুই সংখ্যা দেখা যেত |
| ⚠️⚠️ **তিনটে স্ট্যাটাস, চারটে নয়** *(১৭ আগস্ট)* | — | `LiveStatus = 'active' \| 'idle' \| 'offline'`। 🔴 `agent_down` **তুলে দেওয়া** — বোর্ড কোনোদিনই বলতে পারত না এজেন্ট "মরেছে" নাকি "PC বন্ধ", আর দুবার সৎ কর্মীকে লাল দেখিয়েছে (09 § ৩৬)। ⭐ আসল ফল্ট ধরে `AgentDownCheck` (G01), আর সেটা **অ্যালার্টে** যায় — যেখানে ব্যাখ্যা আঁটে | `StatusDot.tsx` তিনটে চিপ · "Agents up" টাইল ও "· N down" ট্যাব **সরানো** |
| ⭐⭐ **G46** নকল ইনপুট (জিগলার) | `ScreenActivity` · `ScreenSampling` · `ScreenFingerprint` (১৬×১৬ ধূসর, মেশিন ছাড়ে না) | `alerts/synthetic-input.{rules,check}.ts` — সার্ভারেও আলাদা পাহারা | — |
| ⭐ **ঘণ্টার স্ন্যাপশট** টেলিগ্রামে | — | `digest/snapshot.{rules,service,job}.ts` ✅ প্রতি ঘণ্টায় ৯টা–৭টা · দৈনিক ডাইজেস্টও এখন টেলিগ্রামে | — |
| ব্র্যান্ড আইকন | `Ui/BrandIcon.cs` → দুই বংশের জানালাতেই · `<ApplicationIcon>` দুই exe-তে | — | `installer/oxeio.ico` ← `make-icon.py` ← `web/public/favicon.svg` |
| মাসিক হিটম্যাপ | — | `summary/` · `day-close.job` ✅ | `MonthlyPage.tsx` |
| রিপোর্ট | — | `reports/` ✅ · `payroll/` ✅ | `ReportsPage.tsx` |
| Watchdog | `oXeio.Watchdog` (লগঅন Scheduled Task, সার্ভিস নয়) | `alerts/` ✅ | `live/OpenAlerts.tsx` · `AlertsPage.tsx` — ⚠️ এজেন্টের গোলযোগ **কর্মীর কার্ডে নয়** (কার্ড এখন Worklog-এ), **অ্যালার্টে** (ADR-030) |
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
| **Python + Pillow** *(বিল্ড-টাইম)* | `installer/make-icon.py` → `oxeio.ico`। ⚠️ কেবল আইকন **নতুন করে বানাতে** লাগে; `.ico` রিপোতে আছে বলে সাধারণ বিল্ডে দরকার নেই। ⚠️⚠️ cairosvg/Inkscape ইচ্ছাকৃতভাবে বাদ — SVG parse না করে আকৃতিটা (তিনটে path) সরাসরি আঁকা হয়, নইলে বিল্ড অন্য কারো মেশিনে ভাঙত |

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
| স্ক্রিনশট | `/data/storage/screenshots\YYYY\MM\DD\emp-XXX\` |
| ব্যাকআপ | `/data/backups/` → rclone রিমোট (R5) |
| লগ | `/data/logs/` |
