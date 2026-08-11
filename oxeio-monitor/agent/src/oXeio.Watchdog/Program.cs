using System.Runtime.Versioning;

using oXeio.Core.Watchdog;
using oXeio.Watchdog.Deployment;
using oXeio.Watchdog.Native;
using oXeio.Watchdog.Platform;

namespace oXeio.Watchdog;

/// <summary>
/// oXeio এজেন্টের পাহারাদার (H01) — কোনো UI নেই, কোনো উইন্ডো নেই, শুধু একটা লুপ।
///
/// <b>চালানোর ধরন</b>
/// <code>
/// oXeio.Watchdog.exe                      পাহারা শুরু (Task Scheduler এভাবেই চালায়)
/// oXeio.Watchdog.exe --install-task       H02 — লগঅন টাস্ক বসায় (অ্যাডমিন লাগে)
/// oXeio.Watchdog.exe --uninstall-task     টাস্ক মুছে দেয়
/// oXeio.Watchdog.exe --print-task-xml     টাস্কের XML দেখায় (কিছু বদলায় না)
/// oXeio.Watchdog.exe --agent &lt;path&gt;      এজেন্টের exe অন্য জায়গায় হলে
/// oXeio.Watchdog.exe --data &lt;dir&gt;        %ProgramData%\oXeio ছাড়া অন্য ফোল্ডার
/// </code>
///
/// এক্সিট কোড: ০ স্বাভাবিক · ১ এই সেশনে পাহারা সম্ভব নয় · ২ আরেকটা watchdog
/// আগে থেকেই চলছে · ৩ ডেটা ফোল্ডার তৈরি করা গেল না · ৪ টাস্ক বসানো যায়নি।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Program
{
    private static int Main(string[] args)
    {
        var agentPath = ValueOf(args, "--agent");
        var dataDir = ValueOf(args, "--data");

        if (Has(args, "--install-task") || Has(args, "--uninstall-task") || Has(args, "--print-task-xml"))
            return RunOneShot(args);

        return Supervise(dataDir, agentPath);
    }

    // ── পাহারা ──────────────────────────────────────────────────────────────

    private static int Supervise(string? dataDir, string? agentPath)
    {
        var paths = dataDir is null ? AgentPaths.Default : new AgentPaths(dataDir);

        if (!paths.EnsureDirectory())
        {
            // লগ লেখার জায়গাই নেই, তাই লগে কিছু লেখা যাবে না — এক্সিট কোডই
            // একমাত্র সংকেত। ইনস্টলারকে %ProgramData%\oXeio-তে Users গ্রুপকে
            // Modify দিতে হবে (AgentPaths-এর মন্তব্য দেখুন)।
            return 3;
        }

        var log = new RollingLog(paths.Log);

        // ⚠️ Session 0-তে থাকলে এখানেই শেষ। ওখান থেকে চালু করা প্রতিটা এজেন্ট
        //    সাথে সাথেই বন্ধ হয়ে যেত, অর্থাৎ watchdog নিশ্চিত-ব্যর্থ প্রসেস
        //    বানানোর যন্ত্র হয়ে দাঁড়াত।
        var session = SessionCheck.Check();
        if (session.SessionId == 0)
        {
            log.Write($"❌ {session.Explanation}");
            return 1;
        }

        log.Write($"Session {session.SessionId} (console {session.ConsoleSessionId}) — {session.Explanation}");

        // ⚠️ দুটো watchdog চললে একজনের চালু করা এজেন্টকে অন্যজন "অচেনা" ভেবে
        //    গোলমাল বাধাত, আর দুই মই আলাদা আলাদা গুনে ঝড়টাই দ্বিগুণ করত।
        //    Task Scheduler-এর IgnoreNew প্রথম বাধা; এটা দ্বিতীয় ও নিশ্চিত বাধা।
        using var self = InstanceLock.TryAcquire(paths.WatchdogLock);
        if (self is null)
        {
            log.Write("⚠️ Another watchdog is already running — this one is exiting");
            return 2;
        }

        using var stop = new ManualResetEvent(false);

        // Windows শাটডাউনে বা টাস্ক থামালে যেন লগে শেষ লাইনটা লেখা যায়।
        AppDomain.CurrentDomain.ProcessExit += (_, _) =>
        {
            try { stop.Set(); } catch (ObjectDisposedException) { }
        };

        new WatchdogLoop(paths, log, agentPath).Run(stop, AgentLiveness.CheckInterval);
        return 0;
    }

    // ── এক-শটের CLI ─────────────────────────────────────────────────────────

    private static int RunOneShot(string[] args)
    {
        // WinExe-র নিজের কনসোল নেই। অ্যাডমিন elevated prompt থেকে চালালে
        // আউটপুটটা সেখানেই দেখানো হয়। ⚠️ প্রথম Console ব্যবহারের আগেই ডাকতে হবে।
        Kernel32.AttachConsole(Kernel32.AttachParentProcess);

        var output = Console.Out;
        var exe = Path.Combine(AppContext.BaseDirectory, "oXeio.Watchdog.exe");

        if (Has(args, "--print-task-xml"))
        {
            output.WriteLine(TaskInstaller.RenderXml(exe));
            return 0;
        }

        if (Has(args, "--uninstall-task"))
            return TaskInstaller.Uninstall(output);

        return TaskInstaller.Install(exe, output);
    }

    // ── ছোট সহায়ক ───────────────────────────────────────────────────────────

    private static bool Has(string[] args, string flag) =>
        Array.Exists(args, a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));

    /// <summary><c>--নাম মান</c> জোড়া থেকে মান। না থাকলে null।</summary>
    private static string? ValueOf(string[] args, string name)
    {
        for (var i = 0; i < args.Length - 1; i++)
        {
            if (string.Equals(args[i], name, StringComparison.OrdinalIgnoreCase))
                return args[i + 1];
        }

        return null;
    }
}
