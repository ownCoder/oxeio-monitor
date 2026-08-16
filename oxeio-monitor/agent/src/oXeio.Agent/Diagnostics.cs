using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Apps;
using oXeio.Agent.Native;
using oXeio.Agent.Platform;
using oXeio.Agent.Platform.Capture;
using oXeio.Core.Agent;
using oXeio.Core.Capture;
using oXeio.Core.Models;
using oXeio.Core.Time;
using oXeio.Core.Tracking;

namespace oXeio.Agent;

/// <summary>
/// এই মুহূর্তে এটা <b>ডায়াগনস্টিক টুল</b>, পূর্ণ এজেন্ট নয়।
///
/// উদ্দেশ্য: blueprint-এ যেসব জিনিস "আসল ডেস্কটপ ছাড়া যাচাই করা যায় না" বলা হয়েছে,
/// সেগুলো আপনি নিজের PC-তে চালিয়ে চোখে দেখে নিতে পারবেন —
/// lock/unlock ইভেন্ট আসে কি না, ঘুম ধরা পড়ে কি না, idle হিসাব ঠিক কি না।
///
/// চালান:  oXeio.Agent.exe --diagnose
/// থামান:  Ctrl+C
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Diagnostics
{
    private static readonly TimeSpan IdleThreshold = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(1);

    private static readonly MonotonicClock Clock = MonotonicClock.StartNow();
    private static readonly IdleProbe Idle = new();
    private static readonly SleepGapDetector SleepDetector = new(Tick);
    private static readonly CaptureWindow Capture = CaptureWindow.Default;

    private static IdleStateMachine _machine = null!;
    private static volatile bool _sessionSuspended;
    private static volatile bool _running = true;
    private static int _segmentCount;
    private static readonly Dictionary<SegmentState, double> Totals = new();

    public static int Run()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Banner();

        var guard = SessionGuard.Check();
        Line($"session   : id={guard.SessionId} console={guard.ConsoleSessionId} — {guard.Explanation}");
        if (!guard.CanTrack)
        {
            Line("❌ Time will not be counted in this session. Stopping.");
            return 1;
        }

        var dpi = DpiGuard.Check();
        Line(dpi.Ok
            ? $"DPI       : ✅ {dpi.Awareness} — the manifest worked"
            : $"DPI       : ❌ {dpi.Awareness} — screenshots will be blurry, check the manifest");

        var lockState = LockStateProbe.Query();
        Line($"lock state: {lockState}  (read at startup instead of waiting for an event)");

        _machine = new IdleStateMachine(
            IdleThreshold,
            Clock.Now,
            lockState == LockState.Locked ? SegmentState.Locked : SegmentState.Active);

        using var window = new MessageWindow(OnMessage);
        using var session = new SessionMonitor(window.Handle);
        using var power = new PowerMonitor(window.Handle);
        _power = power;

        var (sessionOk, sessionErr) = session.TryRegister();
        Line(sessionOk
            ? "session notifications: ✅ registered"
            : $"session notifications: ❌ failed (Win32 {sessionErr})" +
              (sessionErr == Win32.RPC_S_INVALID_BINDING
                  ? " — Terminal Services is not ready yet, a retry is needed"
                  : ""));

        var (powerOk, powerErr) = power.TryRegister();
        Line(powerOk
            ? "power notifications  : ✅ registered"
            : $"power notifications  : ❌ failed (Win32 {powerErr})");

        Line($"capture window       : {(Capture.Allows(DateTimeOffset.UtcNow) ? "open" : "closed")} (07:00–23:00)");
        Line("");

        TestCapture();
        TestAppTracking();

        Line("Running… press Ctrl+C to stop. Try not touching the mouse/keyboard for 60 seconds.");
        Line("");

        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            _running = false;
        };

        var sampler = new Thread(() => SampleLoop(power)) { IsBackground = true, Name = "oXeio-sampler" };
        sampler.Start();

        Application.Run();
        return 0;
    }

    // ── অ্যাপ/সাইট পরীক্ষা ──────────────────────────────────────────────────

    /// <summary>
    /// D01–D04 এই PC-তে কাজ করছে কি না।
    ///
    /// ⭐ <b>ব্রাউজারের address bar পড়া সবচেয়ে ভঙ্গুর অংশ</b> — UI Automation
    /// ব্রাউজারের ভার্সন, ভাষা আর accessibility সেটিংয়ের ওপর নির্ভর করে।
    /// প্রতিটা অফিস PC-তে রোল-আউটের আগে এখানেই দেখে নেওয়া যায় ডোমেইন
    /// আসছে কি না; না এলে অ্যাপের হিসাব তবু চলবে, শুধু সাইটের নাম থাকবে না।
    ///
    /// ⚠️ এখানে <b>ডোমেইনই ছাপা হয়, পুরো URL নয়</b> — কনসোলেও নিয়মটা এক
    /// ([ADR-013](../../../docs/05-Options-Decisions.md))।
    /// </summary>
    private static void TestAppTracking()
    {
        Line("── App and site tracking (D01–D04) ──────────────────");

        var config = AgentConfig.Default.AppTracking;
        Line($"config: {(config.Enabled ? "on" : "off")}, minimum {config.MinDurationSec} s");

        if (!config.Enabled)
        {
            Line("   (off — the foreground window is not even read)");
            Line("");
            return;
        }

        var service = new AppUsageService(TimeSpan.FromSeconds(config.MinDurationSec));
        var seen = new List<AppUsageRecord>();

        Line("Sampling for 10 seconds — open a site in your browser now…");

        for (var i = 0; i < 10; i++)
        {
            seen.AddRange(service.Tick(Clock.Now, SegmentState.Active));
            Thread.Sleep(1000);
        }

        // ⚠️ CloseAll-এর **আগে** পড়তে হবে — ওটা খোলা উইন্ডোটা বন্ধ করে দেয়,
        //    তারপর CurrentProcess সবসময় null। আগে উল্টো ছিল, ফলে সব কিছু
        //    ঠিকঠাক চললেও লাইনটা "পড়া গেল না" দেখাত।
        var current = service.CurrentProcess;
        seen.AddRange(service.CloseAll(Clock.Now));

        Line($"   foreground : {current ?? "(no window could be read)"}");

        // ⚠️ "UI Automation বন্ধ" পতাকাটা দিয়ে বিচার করা যায় না — ওটা টানা
        //    ২০ বার ব্যর্থ হলে ওঠে, আর ১০ সেকেন্ডে ২০ বার চেষ্টাই হয় না।
        //    তাই সত্যিই ডোমেইন এসেছে কি না, সেটাই একমাত্র নির্ভরযোগ্য প্রমাণ।
        var browser = seen.FirstOrDefault(r => r.IsBrowser == true);
        Line(browser switch
        {
            null => "   address bar: — no browser was in the foreground while sampling, not tested",
            { Domain: { } d } => $"   address bar: ✅ readable — {d}",
            _ => "   address bar: ❌ a browser was in the foreground, the domain could not be read " +
                 "(or an incognito window — then this is the correct behaviour)",
        });

        foreach (var r in seen)
        {
            // ⚠️ টাইটেল ছাপা হয় না — পড়ার সময় কেউ পাশে থাকতে পারে
            Line($"   ▸ {r.ProcessName} {r.DurationSec} s" +
                 (r.Domain is null ? "" : $"  domain: {r.Domain}"));
        }

        Line("");
    }

    // ── ক্যাপচার পরীক্ষা ────────────────────────────────────────────────────

    /// <summary>
    /// একবার ছবি তুলে দেখা — সত্যিই কাজ করছে কি না, ছবিগুলো কোথায় গেল,
    /// আর কোনোটা কালো এল কি না।
    /// </summary>
    private static void TestCapture()
    {
        var monitors = MonitorEnumerator.Enumerate();
        Line($"Monitors: {monitors.Count}");
        foreach (var m in monitors)
        {
            Line($"   ▸ {m.DeviceName}  {m.Width}×{m.Height}  " +
                 $"@{m.Bounds.Left},{m.Bounds.Top}  DPI {m.Dpi} ({m.Scale:P0})" +
                 (m.IsPrimary ? "  [primary]" : ""));
        }

        var outDir = Path.Combine(Path.GetTempPath(), "oXeio-capture-test");
        Directory.CreateDirectory(outDir);

        var dxgi = new DuplicationCapturer();
        using var service = new ScreenCaptureService(
            new FallbackCapturer(dxgi, new GdiCapturer()));

        Line($"");
        Line($"Capture engine: {service.EngineName}");

        // ⭐ DXGI ছবি দেয় শুধু তখনই যখন পর্দায় কিছু বদলায়। স্থির ডেস্কটপে ও
        //    কিছুই দেয় না — সেটা ভুল নয়, নকশা। তাই দুই অবস্থাতেই পরীক্ষা করা হয়:
        //    একবার পর্দা নড়তে নড়তে, একবার একদম স্থির অবস্থায়।
        Line("");
        Line("── 1· Screen moving (DXGI's working path) ───────────");
        var moving = RunWithMotion(service.CaptureAll);
        Report(moving, outDir, "moving", dxgi);
        ReportFailures(service);

        Line("── 2· Screen still (should fall back to GDI) ────────");
        Thread.Sleep(1200); // সব অ্যানিমেশন থামার সময়
        var still = service.CaptureAll();
        Report(still, outDir, "still", dxgi);
        ReportFailures(service);

        if (moving.Count == 0 && still.Count == 0)
            Line("❌ Not a single image could be captured");

        Line($"   Images: {outDir}");
        Line("");
    }

    /// <summary>
    /// ক্যাপচার চলাকালীন কনসোলে লেখা চালিয়ে যাওয়া, যাতে পর্দায় সত্যিই কিছু
    /// বদলায়। এটা ছাড়া DXGI-র কাজের পথটা পরীক্ষাই করা যায় না — স্থির পর্দায়
    /// ও ইচ্ছাকৃতভাবেই কিছু দেয় না।
    /// </summary>
    private static IReadOnlyList<CaptureResult> RunWithMotion(
        Func<IReadOnlyList<CaptureResult>> capture)
    {
        using var stop = new ManualResetEventSlim(false);

        var spinner = new Thread(() =>
        {
            const string frames = "|/-\\";
            for (var i = 0; !stop.IsSet; i++)
            {
                Console.Write($"\r   capturing {frames[i % frames.Length]} ");
                Thread.Sleep(40);
            }
        })
        { IsBackground = true, Name = "oXeio-motion" };

        spinner.Start();
        try
        {
            return capture();
        }
        finally
        {
            stop.Set();
            spinner.Join(500);
            Console.Write("\r                        \r");
        }
    }

    private static void Report(
        IReadOnlyList<CaptureResult> results, string outDir, string tag, DuplicationCapturer dxgi)
    {
        foreach (var r in results)
        {
            File.WriteAllBytes(
                Path.Combine(outDir, $"{tag}-monitor-{r.MonitorIndex}.webp"), r.Webp);

            var verdict = r.ProtectedContentMasked
                ? "⚠️ DRM content was left out (the OS said so)"
                : r.Degraded ? $"⚠️ {r.Quality.Reason}"
                : $"✅ black {r.Quality.BlackRatio:P0}";

            Line($"   ▸ monitor {r.MonitorIndex}: {r.Width}×{r.Height} → " +
                 $"{r.Webp.Length / 1024.0:F0} KB  ({r.Elapsed.TotalMilliseconds:F0} ms)  " +
                 $"[{r.Engine}]  {verdict}");
        }

        Line($"     DXGI: {dxgi.LastStep}");
    }

    /// <summary>যে মনিটরগুলো কোনো ছবিই দেয়নি — চুপ করে বাদ দেওয়া হয় না।</summary>
    private static void ReportFailures(ScreenCaptureService service)
    {
        foreach (var name in service.LastFailedMonitors)
            Line($"   ❌ {name}: no engine could produce an image");
    }

    // ── প্রতি সেকেন্ডের কাজ ────────────────────────────────────────────────

    private static void SampleLoop(PowerMonitor power)
    {
        var lastPrint = DateTimeOffset.MinValue;

        while (_running)
        {
            var now = Clock.Now;
            var sample = Idle.Read();

            if (!sample.Valid)
            {
                // নমুনা বাদ — কোনো ডিফল্ট বসানো হয় না
                Line($"⚠️  GetLastInputInfo failed (Win32 {sample.Win32Error}) — this second is skipped");
                Thread.Sleep(Tick);
                continue;
            }

            // ঘড়ি দেখে ঘুম ধরা — কোনো ইভেন্টের উপর ভরসা নয়
            var gap = SleepDetector.Observe(
                new SleepGapDetector.Sample(sample.BiasedMs, sample.UnbiasedMs, now));

            if (gap.Detected)
            {
                Line($"💤 Gap detected: {gap.SuspendedAt:HH:mm:ss} → {gap.ResumedAt:HH:mm:ss} " +
                     $"(asleep for ~{gap.SleptFor.TotalMinutes:F1} minutes)");
                Record(_machine.OnSuspend(gap.SuspendedAt));
                Record(_machine.OnResume(gap.ResumedAt));
            }

            if (sample.ClampedFuture)
                Line("⚠️  Last input time looked like it was in the future — clamped to zero");

            /**
             * ⚠️ ডায়াগনস্টিক মোডে <c>screenFrozen: false</c> — ইচ্ছাকৃত।
             *
             * এই মোডটা কয়েক মিনিটের, আর এখানে ক্যাপচার চলে না, তাই পর্দার
             * কোনো নমুনাই থাকে না। "জমেছে" ধরে নিলে ডায়াগনস্টিক নিজেই
             * ভুল ছবি দেখাত — অথচ এটার পুরো কাজই সত্যিটা দেখানো।
             */
            Record(_machine.Tick(
                now, sample.SinceLastInput, _sessionSuspended, screenFrozen: false));

            if (now - lastPrint >= TimeSpan.FromSeconds(5))
            {
                lastPrint = now;
                var sleptSinceBoot = TimeSpan.FromMilliseconds(
                    Math.Max(0, (double)sample.BiasedMs - sample.UnbiasedMs));

                Console.WriteLine(
                    $"  {DateTimeOffset.Now:HH:mm:ss}  state={_machine.State,-6} " +
                    $"idle={sample.SinceLastInput.TotalSeconds,6:F0}s  " +
                    $"segments={_segmentCount}  " +
                    $"slept since boot={sleptSinceBoot.TotalMinutes:F1}m");
            }

            Thread.Sleep(Tick);
        }

        Record(_machine.CloseAll(Clock.Now));
        Summary();
        power.Dispose();
        Application.Exit();
    }

    // ── উইন্ডো মেসেজ ────────────────────────────────────────────────────────

    private static PowerMonitor? _power;

    private static void OnMessage(Message m)
    {
        switch (m.Msg)
        {
            case Win32.WM_WTSSESSION_CHANGE:
            {
                var code = (int)m.WParam;
                var change = SessionMonitor.Interpret(code);
                Line($"🔔 session: {SessionMonitor.Describe(code)}" +
                     (change is null ? " (no effect on tracking)" : $" → {change}"));

                if (change == SessionChange.Suspend) _sessionSuspended = true;
                else if (change == SessionChange.Resume) _sessionSuspended = false;
                break;
            }

            case Win32.WM_POWERBROADCAST:
            {
                var signal = _power?.Interpret(m.WParam, m.LParam, Clock.Now);
                if (signal is not null) Line($"⚡ power: {signal}");

                if (signal == PowerSignal.Suspend || signal == PowerSignal.DisplayOff)
                {
                    // ঘুমাতে যাওয়ার আগে হাতে সময় ~২ সেকেন্ড, তাও সব প্রসেস মিলিয়ে।
                    // তাই এখানে শুধু সেগমেন্ট বন্ধ — কোনো নেটওয়ার্ক কল নয়।
                    Record(_machine.OnSuspend(Clock.Now));
                    SleepDetector.Reset();
                }
                else if (signal == PowerSignal.Resume)
                {
                    Record(_machine.OnResume(Clock.Now));
                    SleepDetector.Reset();
                }
                break;
            }

            case Win32.WM_TIMECHANGE:
                Line("🕐 The system clock was changed — the monotonic clock is unaffected");
                break;
        }
    }

    // ── ছোট সহায়ক ───────────────────────────────────────────────────────────

    private static void Record(IReadOnlyList<ActivitySegment> closed)
    {
        foreach (var s in closed)
        {
            _segmentCount++;
            Totals[s.State] = Totals.GetValueOrDefault(s.State) + s.DurationSec;

            Line($"   ▸ {s.State,-6} {s.StartedAt:HH:mm:ss} → {s.EndedAt:HH:mm:ss} " +
                 $"= {s.DurationSec,5}s  {(s.CountsAsWork ? "✅ counted" : "⏸ not counted")}");
        }
    }

    private static void Summary()
    {
        Line("");
        Line("── Summary ─────────────────────────────");
        foreach (var (state, seconds) in Totals.OrderByDescending(k => k.Value))
            Line($"  {state,-6} {TimeSpan.FromSeconds(seconds):hh\\:mm\\:ss}");

        var worked = Totals.GetValueOrDefault(SegmentState.Active);
        Line($"  ─────────────────────");
        Line($"  Counted as work: {TimeSpan.FromSeconds(worked):hh\\:mm\\:ss}");
    }

    private static void Banner()
    {
        Line("╭──────────────────────────────────────────────╮");
        Line("│  oXeio Agent — Win32 diagnostics             │");
        Line("│  This is not a full agent yet                │");
        Line("╰──────────────────────────────────────────────╯");
        Line("");
    }

    private static void Line(string s) => Console.WriteLine(s);
}
