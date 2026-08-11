using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Native;
using oXeio.Agent.Platform;
using oXeio.Agent.Security;
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
    private const string Version = "0.1.0";

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

        return RunAgent();
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
    /// <c>--preview-today [loading|failing|met]</c>
    /// </summary>
    private static int PreviewToday(string[] args)
    {
        var which = args
            .FirstOrDefault(a => a is "loading" or "failing" or "met") ?? "working";

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

    private static AgentStatus SampleStatus(string which) => which switch
    {
        "loading" => AgentStatus.Starting with
        {
            State = SegmentState.Active,
            ActiveToday = TimeSpan.FromMinutes(72),
            MonthlyKnown = false,
        },

        "failing" => AgentStatus.Starting with
        {
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
            State = SegmentState.Active,
            ActiveToday = TimeSpan.FromMinutes(4),
            ActiveThisMonth = TimeSpan.FromMinutes(39),
            MonthlyKnown = true,
            Pace = TimeSpan.FromMinutes(-4760),
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
        _host = new AgentHost(settings, Version, ConsoleSyncLog.Instance);

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
    private static readonly TimeSpan ShutdownBudget = TimeSpan.FromSeconds(4);

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
