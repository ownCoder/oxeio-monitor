using System.Drawing;
using System.Runtime.Versioning;

using oXeio.Core.Agent;

namespace oXeio.Agent.Ui;

/// <summary>
/// "Today's hours" — স্টাফ নিজের হিসাব নিজে দেখতে পারে।
///
/// এই জানালাটাই সিস্টেমটাকে সৎ করে: যে সংখ্যা দিয়ে তার বেতন হিসাব হবে, সেটা
/// তার নিজের পর্দায় সবসময় দেখা যায়, প্রশাসকের কাছে জিজ্ঞাসা না করেই।
///
/// ⚠️ এখানে কোনো বাটন নেই — না বিরতি, না মিটিং, না "সময় দাবি করুন"। কোনো একটা
/// বসালেই সেটা approval workflow-র প্রথম ধাপ হয়ে যেত, আর এই সিস্টেমে কোনো
/// approval নেই।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class TodayForm : OwnerDrawnForm
{
    private readonly Func<TrayOptions> _options;
    private AgentStatus _status = AgentStatus.Starting;

    public TodayForm(TrayFonts fonts, Func<TrayOptions> options)
        : base(fonts, "oXeio — Today's hours", 400, 500)
    {
        _options = options;
    }

    /// <summary>
    /// নতুন স্ট্যাটাস। ⚠️ শুধু UI থ্রেড থেকে ডাকা যাবে — <see cref="TrayIcon"/>
    /// ইতিমধ্যেই সেটা নিশ্চিত করে ডাকে।
    /// </summary>
    public void Apply(AgentStatus status)
    {
        if (status is null) return;

        // record-এর মান-সমতা: একই মান এলে আঁকার দরকার নেই। জানালা খোলা রেখে
        // দিলে সেকেন্ডে একবার করে অকারণ রি-পেইন্ট হতো।
        if (_status == status) return;

        _status = status;

        if (IsDisposed || !IsHandleCreated) return;
        Invalidate();
    }

    protected override void PaintBody(TextStack stack)
    {
        var status = _status;
        var options = _options();
        var now = DateTimeOffset.UtcNow;

        var who = string.IsNullOrWhiteSpace(options.EmployeeName)
            ? "This device"
            : options.EmpCode is { Length: > 0 } code
                ? $"{options.EmployeeName} ({code})"
                : options.EmployeeName!;

        stack.Line(who, TrayFontRole.Strong);
        stack.Line(UiText.WorkDate(now) + " · Dhaka", TrayFontRole.Small, Muted);
        stack.Gap(8);

        stack.Line(UiText.Duration(status.ActiveToday) + " hours", TrayFontRole.Big);
        stack.Line("Counted so far today", TrayFontRole.Small, Muted);

        stack.Rule();

        PaintMonth(stack, status, now);

        stack.Rule();

        stack.Pair("Now", status.Paused
            ? "Tracking paused"
            : TrayTooltip.StateName(status.State));

        // ⚠️ সিঙ্কের অবস্থা সবসময় দেখানো হয়, শুধু গোলমাল হলে নয়। আগে এখানে
        //    কিছু না থাকা মানে "ঠিক আছে" ধরে নিতে হতো — অর্থাৎ সবচেয়ে জরুরি
        //    আশ্বাসটা (ডেটা পৌঁছেছে) ঠিক তখনই অদৃশ্য, যখন সেটা সত্যি।
        stack.Pair("Sync", HealthName(status.Health));

        stack.Pair("Last sync", status.LastSyncAt is { } at
            ? UiText.Clock(at)
            : "Not yet");

        stack.Pair("Queued", UiText.Number(Math.Max(0, status.QueueDepth)));

        if (status.Health is SyncHealth.Failing or SyncHealth.Revoked or SyncHealth.Degraded)
        {
            stack.Gap(4);
            stack.Line(
                status.HealthDetail is { Length: > 0 } detail ? detail : DefaultDetail(status.Health),
                TrayFontRole.Small,
                status.Health == SyncHealth.Degraded ? Muted : Color.FromArgb(0xC6, 0x28, 0x28));
        }

        stack.Rule();

        // ⚠️ এই দুটো লাইন নিছক সাজসজ্জা নয়। "সময় কোথায় গেল" প্রশ্নের উত্তর
        //    আগেভাগে দেওয়া না থাকলে স্টাফ ধরে নেয় সিস্টেম তার ঘণ্টা খেয়ে ফেলছে।
        stack.Line(
            $"Counting stops after {UiText.Number(options.EffectiveConfig.IdleThresholdSec)} seconds " +
            "without mouse or keyboard, and that idle time is removed from the total.",
            TrayFontRole.Small, Muted);

        stack.Line(
            "Nothing is lost without internet — it waits in the queue and is sent " +
            "automatically once the connection is back.",
            TrayFontRole.Small, Muted);
    }

    /// <summary>
    /// মাসের অগ্রগতি — <b>শুধু সার্ভার সংখ্যাটা বলে দেওয়ার পর</b>।
    ///
    /// ⭐⚠️ মাসের হিসাব এজেন্ট নিজে রাখে না, তাই প্রথম heartbeat আসার আগে
    /// <see cref="AgentStatus.ActiveThisMonth"/> মিথ্যা শূন্য। ওই অবস্থায়
    /// বার আর শতাংশ আঁকলে স্টাফ প্রতিবার লগইনের পর কয়েক সেকেন্ডের জন্য
    /// "0 / 208 hours · 0%" দেখত — অর্থাৎ মনে হতো মাসের কাজ মুছে গেছে।
    /// তাই তিনটে অবস্থা: জানা নেই / জানা আছে / লক্ষ্য নেই।
    /// </summary>
    private static void PaintMonth(TextStack stack, AgentStatus status, DateTimeOffset now)
    {
        if (!status.MonthlyKnown)
        {
            stack.Pair("This month", "Loading…", TrayFontRole.Strong);
            stack.Gap(2);
            stack.Line(
                "The monthly total comes from the server — every PC added together. " +
                "It appears here as soon as the connection is made.",
                TrayFontRole.Small, Muted);
            return;
        }

        stack.Pair("This month",
            $"{UiText.Duration(status.ActiveThisMonth)} / " +
            $"{UiText.Number((int)Math.Round(status.MonthlyTargetHours))} hours",
            TrayFontRole.Strong);

        stack.Gap(2);
        stack.Bar(status.MonthlyProgress, ProgressColor(status.MonthlyProgress));

        stack.Pair("Progress", UiText.Percent(status.MonthlyProgress));
        stack.Pair("Remaining", UiText.Duration(status.MonthlyRemaining) + " hours");

        PaintPace(stack, status, now);
    }

    /// <summary>
    /// "এগিয়ে না পিছিয়ে" (B05b/J02)।
    ///
    /// ⭐ সার্ভার সংখ্যাটা পাঠালে সেটাই — ওটাই ড্যাশবোর্ডের সংখ্যা, আর দুই
    /// জায়গায় দুই সংখ্যা দেখলে স্টাফ ধরে নেবে একটা মিথ্যা বলছে।
    /// সার্ভার না পাঠালে <see cref="MonthlyPace"/>-এর আনুমানিক হিসাব, এবং
    /// লেবেলেই "estimated" — ⚠️ শব্দটা সরাবেন না, ওটা ছুটির দিনের জন্য
    /// আমাদের না-জানার স্বীকারোক্তি।
    ///
    /// লক্ষ্যই না থাকলে (টার্গেট ০) লাইনটা বাদ — "0:00 hours ahead" অর্থহীন।
    /// </summary>
    private static void PaintPace(TextStack stack, AgentStatus status, DateTimeOffset now)
    {
        var exact = status.Pace is not null;
        var pace = status.Pace
                   ?? MonthlyPace.Estimate(status.ActiveThisMonth, status.MonthlyTargetHours, now);

        if (pace is not { } value) return;

        var ahead = value >= TimeSpan.Zero;

        // ⚠️ চিহ্নটা লেখাতেই বলা আছে ("Ahead"/"Behind"), তাই সংখ্যাটা সবসময়
        //    ধনাত্মক রূপে। UiText.Duration ঋণাত্মককে শূন্য বানায়, ফলে
        //    Abs না নিলে প্রতিটা "Behind" থাকা স্টাফ দেখত "0:00 hours behind"।
        var text = (ahead ? "✓ " : "⚠ ") +
                   UiText.Duration(value.Duration()) + " hours " +
                   (ahead ? "ahead" : "behind");

        stack.Pair(exact ? "Pace" : "Pace (estimated)", text);
    }

    private static string HealthName(SyncHealth health) => health switch
    {
        SyncHealth.Ok => "OK",
        SyncHealth.Degraded => "Running late",
        SyncHealth.Failing => "Not reaching server",
        _ => "Stopped",
    };

    private static Color ProgressColor(double progress) =>
        progress >= 1.0
            ? Color.FromArgb(0x2E, 0x9E, 0x4F)
            : Color.FromArgb(0x4A, 0x6F, 0xA5);

    private static string DefaultDetail(SyncHealth health) => health switch
    {
        SyncHealth.Failing => TrayTooltip.SyncFailingLine,
        SyncHealth.Revoked => TrayTooltip.RevokedLine,
        _ => "Sync is running a little late",
    };
}
