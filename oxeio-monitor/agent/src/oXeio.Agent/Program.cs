using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Native;
using oXeio.Agent.Platform;
using oXeio.Agent.Security;
using oXeio.Agent.Storage;
using oXeio.Agent.Sync;
using oXeio.Agent.Ui;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent;

/// <summary>
/// দুটো রূপ আছে:
///
/// <list type="bullet">
/// <item><b>কিছু না দিলে</b> — পূর্ণ এজেন্ট। tray আইকন দেখা যায়, কনসোল নয়।</item>
/// <item><c>--diagnose</c> — Win32 ও ক্যাপচার যাচাইয়ের টুল, কনসোলে ফল লেখে।</item>
/// </list>
///
/// ⚠️ প্রজেক্ট <c>WinExe</c>, তাই কনসোল আপনাআপনি থাকে না। এটা ইচ্ছাকৃত:
/// <c>Exe</c> হলে প্রতিবার লগঅনে প্রতিটা PC-তে একটা কালো কনসোল উইন্ডো
/// খুলে বসে থাকত, আর স্টাফ সেটা বন্ধ করে দিলে এজেন্টও মরত।
/// <c>--diagnose</c>-এ কনসোলটা হাতে জুড়ে নেওয়া হয়।
/// </summary>
[SupportedOSPlatform("windows")]
internal static partial class Program
{
    /**
     * ⭐ ভার্সনটা **assembly থেকে** পড়া হয়, হাতে লেখা নয়।
     *
     * ⚠️ আগে এখানে `const string Version = "0.1.0"` ছিল, আর MSI-র ভার্সন
     * আসত `installer/build.ps1`-এর আলাদা একটা চলক থেকে। দুটোর মধ্যে কোনো
     * যোগ ছিল না — MSI ০.২.০ বিলি করলেও এজেন্ট heartbeat-এ নিজেকে ০.১.০
     * বলত। সার্ভার ওই মান দেখেই আপডেট অফারের সিদ্ধান্ত নেয় (G59), তাই
     * আপডেট হয়ে যাওয়া মেশিনকেও একই আপডেট বারবার অফার করা হতো আর H04-এর
     * রোলআউট কোনোদিন শেষ হতো না।
     *
     * এখন উৎস একটাই: `agent/Directory.Build.props`।
     */
    private static readonly string Version = ReadVersion();

    /// <summary>
    /// ⚠️ `InformationalVersion`-এ SDK প্রায়ই `+<commit>` জুড়ে দেয়
    /// (SourceLink)। সেটা সার্ভারে পাঠালে ভার্সন-তুলনা ভাঙত, কারণ
    /// `rollout.ts` SemVer ধরে পড়ে — তাই `+`-এর পরেরটা ছেঁটে ফেলা হয়।
    ///
    /// ⚠️ কিছুই না পেলে `"0.0.0"` — খালি স্ট্রিং নয়। খালি পাঠালে
    /// সার্ভার সেটাকে "ভার্সন বলেনি" ধরে আগেরটা রেখে দিত (G59), আর তখন
    /// সমস্যাটা আরও গভীরে লুকাত।
    /// </summary>
    private static string ReadVersion() =>
        TrimBuildMetadata(
            typeof(Program).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()
                ?.InformationalVersion);

    /// <summary>
    /// ⚠️ এটা অনুমান নয়, মেপে দেখা: এই রিপোতে assembly-র
    /// <c>ProductVersion</c> আসে <c>0.1.0+ef685e42b940…</c> রূপে। ওই
    /// পুরোটা সার্ভারে পাঠালে <c>rollout.ts</c>-এর SemVer তুলনা ভাঙত, আর
    /// আপডেটের সিদ্ধান্ত এলোমেলো হতো।
    /// </summary>
    internal static string TrimBuildMetadata(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "0.0.0";

        var plus = raw.IndexOf('+', StringComparison.Ordinal);
        var trimmed = (plus < 0 ? raw : raw[..plus]).Trim();

        return trimmed.Length == 0 ? "0.0.0" : trimmed;
    }

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Any(a => a.Equals("--diagnose", StringComparison.OrdinalIgnoreCase)))
        {
            AttachOrAllocConsole();
            return Diagnostics.Run();
        }

        if (args.Any(a => a.Equals("--prepare-data-dir", StringComparison.OrdinalIgnoreCase)))
        {
            AttachOrAllocConsole();
            return PrepareDataDir();
        }

        if (args.Any(a => a.Equals("--preview-today", StringComparison.OrdinalIgnoreCase)))
        {
            return PreviewToday(args);
        }

        if (args.Any(a => a.Equals("--preview-signin", StringComparison.OrdinalIgnoreCase)))
        {
            return PreviewSignIn(args);
        }

        return RunAgent();
    }

    /// <summary>
    /// সাইন-ইন জানালাটা নকল উত্তর দিয়ে খুলে দেখা — <c>--preview-today</c>-র
    /// মতোই একটা ডেভ টুল। কোনো সার্ভার লাগে না, কিছুই জমা হয় না।
    ///
    /// ⭐ কেন দরকার: জানালার চারটে অবস্থা আছে, আর আসল সার্ভারে সেগুলো
    /// দেখতে হলে যথাক্রমে একটা ভুল পাসওয়ার্ড, একটা 2FA-ওয়ালা অ্যাকাউন্ট,
    /// একটা owner অ্যাকাউন্ট আর একটা বন্ধ নেটওয়ার্ক লাগত।
    ///
    /// <c>--preview-signin [wrong|totp|forbidden|offline]</c>
    /// </summary>
    private static int PreviewSignIn(string[] args)
    {
        var which = args.FirstOrDefault(
            a => a is "wrong" or "totp" or "forbidden" or "offline") ?? "ok";

        var totpAsked = false;

        using var form = new SignInForm(
            "https://oxeio.office.local",
            (email, _, totp, _) =>
            {
                var result = which switch
                {
                    "wrong" => new EnrollmentResult(
                        EnrollmentStatus.SignInRejected, "Email or password is incorrect."),

                    "forbidden" => new EnrollmentResult(
                        EnrollmentStatus.SignInRejected,
                        "This account is not linked to a staff record. Sign in with the staff account for this PC."),

                    "offline" => new EnrollmentResult(
                        EnrollmentStatus.ServerUnreachable,
                        "Could not reach the server: connection refused"),

                    // ⚠️ প্রথম দফায় কোড চায়, দ্বিতীয় দফায় মেনে নেয় —
                    //    দুটো ধাপই দেখা যায়
                    "totp" when !totpAsked && string.IsNullOrWhiteSpace(totp) => Ask(),

                    _ => new EnrollmentResult(
                        EnrollmentStatus.Enrolled,
                        $"Enrolment succeeded — {email}", 1, "OX-001"),
                };

                return Task.FromResult(result);

                EnrollmentResult Ask()
                {
                    totpAsked = true;
                    return new EnrollmentResult(
                        EnrollmentStatus.NeedsTotp,
                        "Enter the 6-digit code from your authenticator app.");
                }
            });

        /**
         * ⚠️ অবস্থা চাওয়া হলে জানালাটা নিজে থেকেই একবার "Sign in" চাপে,
         * যাতে ভুল-পাসওয়ার্ড বা 2FA-র চেহারাটাও ছবিতে তোলা যায়
         * (`--preview-today`-তে অবস্থাগুলো ডেটা দিয়ে আসে, এখানে একটা
         * ক্লিক লাগে)।
         *
         * ⚠️ প্রথমে `SendKeys` দিয়ে চেষ্টা করা হয়েছিল — **কাজ করেনি**, আর
         * নীরবে: কি-স্ট্রোকটা ফোরগ্রাউন্ড জানালায় যায়, আর সেটা আমাদের
         * জানালা কি না তার কোনো নিশ্চয়তা নেই। বোতামটা `Controls` থেকে
         * খুঁজে সরাসরি `PerformClick()` করাই একমাত্র নিশ্চিত পথ, আর তাতে
         * ইনপুট-সিস্টেম জড়ায়ই না।
         */
        if (which != "ok")
        {
            form.Shown += (_, _) => form.Controls
                .OfType<Button>()
                .FirstOrDefault()
                ?.PerformClick();
        }

        Application.Run(form);

        Console.WriteLine(form.Result is { } r ? $"result: {r.Status} — {r.Message}" : "closed");
        return 0;
    }

    /// <summary>
    /// "Today's hours" জানালাটা নমুনা ডেটায় খুলে দেখা — <c>--diagnose</c>-এর মতোই
    /// একটা ডেভ টুল, কিছুই জমা হয় না, সার্ভারে কিছু যায় না।
    ///
    /// ⭐ কেন দরকার: জানালার চারটে অবস্থা আছে (মাস জানা নেই · স্বাভাবিক ·
    /// সার্ভারে পৌঁছাচ্ছে না · টার্গেট পূর্ণ), আর সেগুলো আসল ডেটায় দেখতে হলে
    /// যথাক্রমে একটা নতুন লগঅন, আধ ঘণ্টার কাজ, নেট বিচ্ছিন্ন করা আর একটা
    /// পুরো মাস লাগত। ডিজাইন বদলে প্রতিবার সেটা করা যায় না।
    ///
    /// <c>--preview-today [loading|failing|met|signin]</c>
    ///
    /// ⚠️ <c>signin</c> — G79-এর অবস্থা (সাইন ইন হয়নি)। এটা আসল ডেটায়
    /// দেখতে হলে একটা তাজা ইনস্টল আর সাইন ইন <b>না</b> করে বসে থাকা লাগত।
    /// </summary>
    private static int PreviewToday(string[] args)
    {
        var which = args
            .FirstOrDefault(a => a is "loading" or "failing" or "met" or "signin") ?? "working";

        using var fonts = new TrayFonts();

        var options = new TrayOptions
        {
            AgentVersion = Version,
            ServerUrl = "http://localhost:3000",
            DeviceId = 58,
            EmployeeName = "Sumaiya",
            EmpCode = "OX-07",
        };

        using var form = new TodayForm(fonts, () => options);
        form.Apply(SampleStatus(which));

        // ⚠️ জায়গা ঠিক হয় **দেখানোর পরে** — নইলে হ্যান্ডল তৈরি হওয়ার আগে
        //    Width এখনো WinForms-এর ডিফল্ট, আর হিসাবটা ওই ভুল মাপ ধরে করে
        //    জানালাটা পর্দার ডান কিনারা পেরিয়ে চলে যায়। TrayIcon-ও একই
        //    ক্রমে ডাকে (Show → PositionNearTray → Activate)।
        form.Shown += (_, _) => form.PositionNearTray();

        Application.Run(form);
        return 0;
    }

    /// <summary>
    /// ⚠️ প্রতিটা নমুনায় <c>Enrolled</c> স্পষ্ট করে বসানো — কারণ
    /// <see cref="AgentStatus.Starting"/>-এ সেটা <c>false</c> (চালু হওয়ার
    /// মুহূর্তে ক্রেডেনশিয়াল পড়াই হয়নি)। না বসালে **সব প্রিভিউ** "Not
    /// signed in" দেখাত, আর tray-র নকশা দেখার পুরো ব্যবস্থাটাই অকেজো হতো।
    /// </summary>
    private static AgentStatus SampleStatus(string which) => which switch
    {
        // ⭐ G79-এর অবস্থাটা — লাল বিন্দু, "Not signed in", আর গোনা বন্ধ।
        //    নকশাটা দেখার একমাত্র উপায় এটাই, কারণ আসল অবস্থাটা তৈরি করতে
        //    হলে একটা তাজা ইনস্টল আর সাইন ইন **না** করে বসে থাকা লাগত।
        "signin" => AgentStatus.Starting with
        {
            State = SegmentState.Active,
            MonthlyKnown = false,
            Enrolled = false,
        },

        "loading" => AgentStatus.Starting with
        {
            Enrolled = true,
            State = SegmentState.Active,
            ActiveToday = TimeSpan.FromMinutes(72),
            MonthlyKnown = false,
        },

        "failing" => AgentStatus.Starting with
        {
            Enrolled = true,
            State = SegmentState.Idle,
            ActiveToday = TimeSpan.FromMinutes(348),
            ActiveThisMonth = TimeSpan.FromMinutes(5780),
            MonthlyKnown = true,
            Pace = TimeSpan.FromMinutes(980),
            QueueDepth = 2481,
            Health = SyncHealth.Failing,
            LastSyncAt = DateTimeOffset.UtcNow.AddHours(-2),
        },

        "met" => AgentStatus.Starting with
        {
            Enrolled = true,
            State = SegmentState.Locked,
            ActiveToday = TimeSpan.FromMinutes(446),
            ActiveThisMonth = TimeSpan.FromMinutes(12675),
            MonthlyKnown = true,
            Pace = TimeSpan.FromMinutes(195),
            LastSyncAt = DateTimeOffset.UtcNow.AddMinutes(-1),
        },

        // ⚠️ ডিফল্টটা ইচ্ছাকৃতভাবে মালিকের আসল অবস্থা (১১ আগস্ট): মাসের
        //    শুরুতে সামান্য কাজ, অর্থাৎ মিটারের ভরাট ০.৩% — ঠিক সেই কেসটা
        //    যেখানে ভরাটটা গোল হয়ে শূন্য হয়ে যেতে পারত।
        _ => AgentStatus.Starting with
        {
            Enrolled = true,
            State = SegmentState.Active,
            ActiveToday = TimeSpan.FromMinutes(7),
            ActiveThisMonth = TimeSpan.FromMinutes(42),
            MonthlyKnown = true,
            Pace = TimeSpan.FromMinutes(-4757),
            DailyTarget = TimeSpan.FromHours(8),
            ActiveLast7 = TimeSpan.FromMinutes(750),
            Last7Target = TimeSpan.FromHours(48),

            // ⚠️ আসল মান, আজকের রান থেকে নেওয়া — মনগড়া নয়। শূন্যটাও ইচ্ছাকৃত:
            //    "০% ব্যস্ত" ঘরটা পর্দায় কেমন দেখায় সেটাই দেখার জিনিস।
            RecentBusy = [41, 16, 0, 35, 72, 7],

            LatestShotThumb = Path.Combine(
                OutboxPaths.Default.State, "last-shot.webp"),
            LatestShotAt = DateTimeOffset.UtcNow.AddMinutes(-2),
            LatestShotMonitors = 2,

            LastSyncAt = DateTimeOffset.UtcNow.AddMinutes(-1),
        },
    };

    /// <summary>
    /// MSI ইনস্টল করার সময় একবার, অ্যাডমিন অধিকারে।
    ///
    /// ⭐ <b>কেন ইনস্টলারকে এটা করতে হয়:</b> ProgramData-র ডিফল্ট ACL-এ সাধারণ
    /// ইউজার শুধু <b>নিজের বানানো</b> ফাইল বদলাতে পারে। ইনস্টলার (অ্যাডমিন)
    /// ফোল্ডারটা বানিয়ে ফেলে রেখে গেলে স্টাফের অ্যাকাউন্টে চলা এজেন্ট
    /// ওখানে SQLite কিউ লিখতেই পারত না — প্রতিটা INSERT-এ
    /// <c>SQLITE_READONLY</c>, আর এজেন্ট চুপচাপ কিছুই জমাত না।
    ///
    /// তাই ফোল্ডারটা <see cref="AgentDataDirectory.Ensure"/> দিয়েই বানানো হয়,
    /// যেটা Users-কে Modify দেয়। ACL-এর নিয়ম একটাই জায়গায় থাকে — WiX-এ
    /// আলাদা করে লিখলে দুটো সংজ্ঞা একদিন আলাদা হয়ে যেত।
    /// </summary>
    private static int PrepareDataDir()
    {
        var path = AgentDataDirectory.Default;

        if (!AgentDataDirectory.TryEnsure(path, out var error))
        {
            Console.Error.WriteLine($"❌ Could not create {path}: {error}");
            return 4;
        }

        Console.WriteLine($"✅ Data folder ready: {path}");
        return 0;
    }

    private static int RunAgent()
    {
        var settings = AgentSettings.Load(out var source);
        if (settings is null)
        {
            // ⚠️ চুপ করে বন্ধ হওয়া যাবে না। ইনস্টলার কনফিগ না লিখলে বা ভুল
            //    লিখলে এজেন্ট নীরবে কিছুই করত না, আর কেউ সপ্তাহখানেক পরে
            //    আবিষ্কার করত যে ওই PC-র কোনো ডেটাই নেই।
            Complain(
                "oXeio agent could not start",
                $"Server address not found.\n\nLooked in: {source}\n\n" +
                $"The installer is supposed to write this. Please tell office IT.");
            return 2;
        }

        using var window = new MessageWindow(OnMessage);
        using var session = new SessionMonitor(window.Handle);
        using var power = new PowerMonitor(window.Handle);

        _power = power;

        /*
         * H08 — ⚠️⚠️ এখানে আগে `ConsoleSyncLog.Instance` ছিল, আর প্রজেক্ট
         * `WinExe` — **কনসোলই নেই**। অর্থাৎ এজেন্টের প্রতিটা লগ লাইন
         * শূন্যে যেত: এনরোলমেন্ট ব্যর্থ, টোকেন বাতিল, ৪২২ প্রত্যাখ্যান —
         * কিছুরই কোনো চিহ্ন থাকত না। অথচ রানবুক সমস্যা হলে `agent.log`
         * পড়তে বলত, আর ফাইলটা কোনোদিন লেখাই হয়নি।
         */
        var paths = OutboxPaths.Default;
        var log = new FileLog(paths.Logs);
        log.Startup(Version, settings.ServerUrl, paths.Root);

        _host = new AgentHost(settings, Version, log);

        if (!_host.TryStart(window.Handle, out var error))
        {
            Complain("oXeio agent could not start", error ?? "Reason unknown");
            return 3;
        }

        session.TryRegister();
        power.TryRegister();

        Application.Run();

        // ⭐⚠️ <b>ApplicationExit ইভেন্টে এই কাজটা করা যায় না</b>, যদিও দেখতে
        //    সেটাই স্বাভাবিক জায়গা। ইভেন্ট হ্যান্ডলার হয় <c>async void</c> —
        //    প্রথম <c>await</c>-এই সে ফিরে আসে, WinForms ধরে নেয় কাজ শেষ,
        //    <c>Application.Run()</c> ফেরে, <c>Main</c> ফেরে, প্রসেস মরে।
        //    ফলে DisposeAsync-এর বাকি অংশ — খোলা সেগমেন্ট বন্ধ করা,
        //    <c>agent_stop</c> ইভেন্ট, শেষ drain — <b>কখনোই</b> চলত না।
        //    Run() ফেরার পর সিঙ্ক্রোনাসভাবে অপেক্ষা করাই একমাত্র নির্ভরযোগ্য পথ।
        Shutdown();
        return 0;
    }

    /// <summary>
    /// বন্ধ হওয়ার সময় হাতে যতটুকু আছে ততটুকুই — তার বেশি নয়।
    ///
    /// ⚠️ Windows শাটডাউনে সব প্রসেস মিলিয়ে বাজেট কয়েক সেকেন্ড। ছাদ না দিলে
    /// একটা ঝুলে যাওয়া drain-এর জন্য Windows আমাদের জোর করে মারত, আর তখন
    /// <c>agent_stop</c> ইভেন্টটাও যেত না — অর্থাৎ ঠিক যে জিনিসটার জন্য এই
    /// অপেক্ষা, সেটাই হারাত।
    /// </summary>
    private static void Shutdown()
    {
        var host = Interlocked.Exchange(ref _host, null);
        if (host is null) return;

        try
        {
            var closing = host.DisposeAsync().AsTask();
            if (!closing.Wait(ShutdownBudget))
            {
                // ⚠️ ছুড়ে দেওয়া হয় না, শুধু ছেড়ে দেওয়া হয়। এখানে ব্যতিক্রম
                //    মানে exit code বদলে যাওয়া, আর watchdog সেটাকে ক্র্যাশ
                //    ধরে এজেন্টকে আবার চালু করত — শাটডাউনের ঠিক মাঝখানে।
                return;
            }
        }
        catch (Exception)
        {
            // বন্ধ হচ্ছে — অভিযোগ শোনার কেউ নেই
        }
    }

    /// <summary>Windows-এর ~৫ সেকেন্ডের চেয়ে কম, যাতে আমরা নিজেরাই আগে সরে যাই।</summary>
    internal static readonly TimeSpan ShutdownBudget = TimeSpan.FromSeconds(4);

    private static AgentHost? _host;
    private static PowerMonitor? _power;

    /// <summary>
    /// ⚠️ এই হ্যান্ডলার UI থ্রেডে চলে। এখানে কোনো নেটওয়ার্ক বা ডিস্কের কাজ
    /// করা যাবে না — করলে লক/আনলকের সময় পুরো ডেস্কটপ আটকে যেত।
    /// </summary>
    private static void OnMessage(Message m)
    {
        switch (m.Msg)
        {
            case Win32.WM_WTSSESSION_CHANGE:
                _host?.OnSessionChange((int)m.WParam);
                break;

            case Win32.WM_POWERBROADCAST:
                _host?.OnPower(_power?.Interpret(m.WParam, m.LParam, DateTimeOffset.UtcNow));
                break;

            // G02 — logoff আর PC-বন্ধ আলাদা করার একমাত্র জায়গা।
            // ⚠️ এখানে শুধু কিউয়ে ফেলা হয়; পাঠানোর চেষ্টা করলে ডেস্কটপ আটকে
            //    যেত আর Windows দুজনকেই মেরে ফেলত।
            case Win32.WM_ENDSESSION:
                _host?.OnSessionEnd(SessionMonitor.InterpretEndSession(m.WParam, m.LParam));
                break;
        }
    }

    // ── কনসোল ও বার্তা ──────────────────────────────────────────────────────

    private const uint AttachParentProcess = 0xFFFFFFFF;

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AttachConsole(uint processId);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool AllocConsole();

    /// <summary>
    /// টার্মিনাল থেকে চালালে সেটার কনসোলেই লেখা, নইলে নতুন একটা।
    /// দুটোই ব্যর্থ হলে চুপচাপ এগিয়ে যাওয়া — আউটপুট না দেখা গেলেও
    /// ডায়াগনস্টিক চলতে বাধা নেই।
    /// </summary>
    private static void AttachOrAllocConsole()
    {
        if (!AttachConsole(AttachParentProcess)) AllocConsole();
    }

    private static void Complain(string title, string body)
    {
        // ⚠️ MessageBox ব্যবহার করা হয় শুধু **চালু হতেই না পারার** ক্ষেত্রে।
        //    স্বাভাবিক চলার সময় কোনো পপ-আপ নেই — tray আইকনই একমাত্র মুখ।
        try
        {
            MessageBox.Show(body, title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        catch (Exception)
        {
            // কোনো ডেস্কটপ নেই (সার্ভিস/সেশন ০) — দেখানোর কিছু নেই
        }
    }
}
