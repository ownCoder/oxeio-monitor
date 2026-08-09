using System.Runtime.Versioning;
using System.Windows.Forms;

using oXeio.Agent.Native;
using oXeio.Agent.Platform;
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
/// চালান:  dotnet run --project src/oXeio.Agent
/// থামান:  Ctrl+C
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Program
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

    [STAThread]
    private static int Main()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Banner();

        var guard = SessionGuard.Check();
        Line($"session   : id={guard.SessionId} console={guard.ConsoleSessionId} — {guard.Explanation}");
        if (!guard.CanTrack)
        {
            Line("❌ এই সেশনে সময় গোনা হবে না। থামছি।");
            return 1;
        }

        var lockState = LockStateProbe.Query();
        Line($"lock state: {lockState}  (ইভেন্টের অপেক্ষা না করে শুরুতেই জেনে নেওয়া)");

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
            ? "session notifications: ✅ রেজিস্টার হয়েছে"
            : $"session notifications: ❌ ব্যর্থ (Win32 {sessionErr})" +
              (sessionErr == Win32.RPC_S_INVALID_BINDING
                  ? " — Terminal Services এখনো প্রস্তুত নয়, রিট্রাই দরকার"
                  : ""));

        var (powerOk, powerErr) = power.TryRegister();
        Line(powerOk
            ? "power notifications  : ✅ রেজিস্টার হয়েছে"
            : $"power notifications  : ❌ ব্যর্থ (Win32 {powerErr})");

        Line($"capture window       : {(Capture.Allows(DateTimeOffset.UtcNow) ? "খোলা" : "বন্ধ")} (০৭:০০–২৩:০০)");
        Line("");
        Line("চলছে… Ctrl+C দিয়ে থামান। ৬০ সেকেন্ড মাউস/কি-বোর্ড না ছুঁয়ে দেখুন।");
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
                Line($"⚠️  GetLastInputInfo ব্যর্থ (Win32 {sample.Win32Error}) — এই সেকেন্ড বাদ");
                Thread.Sleep(Tick);
                continue;
            }

            // ঘড়ি দেখে ঘুম ধরা — কোনো ইভেন্টের উপর ভরসা নয়
            var gap = SleepDetector.Observe(
                new SleepGapDetector.Sample(sample.BiasedMs, sample.UnbiasedMs, now));

            if (gap.Detected)
            {
                Line($"💤 ফাঁক ধরা পড়ল: {gap.SuspendedAt:HH:mm:ss} → {gap.ResumedAt:HH:mm:ss} " +
                     $"(ঘুমিয়ে ছিল ~{gap.SleptFor.TotalMinutes:F1} মিনিট)");
                Record(_machine.OnSuspend(gap.SuspendedAt));
                Record(_machine.OnResume(gap.ResumedAt));
            }

            if (sample.ClampedFuture)
                Line("⚠️  শেষ ইনপুটের সময় ভবিষ্যতে দেখাচ্ছিল — শূন্যে আটকানো হলো");

            Record(_machine.Tick(now, sample.SinceLastInput, _sessionSuspended));

            if (now - lastPrint >= TimeSpan.FromSeconds(5))
            {
                lastPrint = now;
                var sleptSinceBoot = TimeSpan.FromMilliseconds(
                    Math.Max(0, (double)sample.BiasedMs - sample.UnbiasedMs));

                Console.WriteLine(
                    $"  {DateTimeOffset.Now:HH:mm:ss}  state={_machine.State,-6} " +
                    $"idle={sample.SinceLastInput.TotalSeconds,6:F0}s  " +
                    $"segments={_segmentCount}  " +
                    $"বুট থেকে ঘুম={sleptSinceBoot.TotalMinutes:F1}মি");
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
                     (change is null ? " (ট্র্যাকিংয়ে প্রভাব নেই)" : $" → {change}"));

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
                Line("🕐 সিস্টেমের ঘড়ি বদলানো হয়েছে — monotonic ঘড়ি অপ্রভাবিত");
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
                 $"= {s.DurationSec,5}s  {(s.CountsAsWork ? "✅ গোনা হলো" : "⏸ গোনা হয়নি")}");
        }
    }

    private static void Summary()
    {
        Line("");
        Line("── সারাংশ ──────────────────────────────");
        foreach (var (state, seconds) in Totals.OrderByDescending(k => k.Value))
            Line($"  {state,-6} {TimeSpan.FromSeconds(seconds):hh\\:mm\\:ss}");

        var worked = Totals.GetValueOrDefault(SegmentState.Active);
        Line($"  ─────────────────────");
        Line($"  কাজ হিসেবে গোনা হলো: {TimeSpan.FromSeconds(worked):hh\\:mm\\:ss}");
    }

    private static void Banner()
    {
        Line("╭──────────────────────────────────────────────╮");
        Line("│  oXeio Agent — Win32 ডায়াগনস্টিক             │");
        Line("│  এটা এখনো পূর্ণ এজেন্ট নয়                    │");
        Line("╰──────────────────────────────────────────────╯");
        Line("");
    }

    private static void Line(string s) => Console.WriteLine(s);
}
