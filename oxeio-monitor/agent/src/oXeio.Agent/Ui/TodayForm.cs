using System.Drawing;
using System.Runtime.Versioning;

using oXeio.Core.Agent;
using oXeio.Core.Models;

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

    /// <summary>
    /// ⚠️ উচ্চতা ৫০০ → ৪০০। নতুন লেআউটে লেখা কম, তাই ৫০০-তে নিচে একটা বড়
    /// ফাঁকা কালো পটি পড়ে থাকত — দেখে মনে হতো কিছু লোড হতে বাকি।
    /// <see cref="OwnerDrawnForm"/> দরকার হলে নিজেই লম্বা করে নেয় (loading ও
    /// alert অবস্থায় লেখা বেশি), তাই ছোট রাখাটা নিরাপদ দিক।
    /// </summary>
    public TodayForm(TrayFonts fonts, Func<TrayOptions> options)
        : base(fonts, "oXeio — Today's hours", 400, 400)
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

        stack.Line(who, TrayFontRole.Small, Theme.Ink2);
        stack.Line(UiText.WorkDate(now) + " · Dhaka", TrayFontRole.Small, Muted);
        stack.Gap(6);

        // ⭐ অবস্থাটা সংখ্যার পাশেই — জানালার একমাত্র এটাই মিনিটে মিনিটে বদলায়।
        stack.Hero(
            UiText.Duration(status.ActiveToday),
            "hours today",
            status.Paused ? "Tracking paused" : TrayTooltip.StateName(status.State),
            StateDot(status));

        stack.Line("Counted so far — idle time already removed", TrayFontRole.Small, Muted);

        stack.Rule();

        PaintMonth(stack, status, now);

        stack.Rule();

        // ⚠️ সিঙ্কের অবস্থা সবসময় দেখানো হয়, শুধু গোলমাল হলে নয়। আগে এখানে
        //    কিছু না থাকা মানে "ঠিক আছে" ধরে নিতে হতো — অর্থাৎ সবচেয়ে জরুরি
        //    আশ্বাসটা (ডেটা পৌঁছেছে) ঠিক তখনই অদৃশ্য, যখন সেটা সত্যি।
        var bad = status.Health is SyncHealth.Failing or SyncHealth.Revoked;

        stack.Readout(
        [
            ("Sync", HealthName(status.Health), bad ? Theme.Brand : null),
            ("Last sync", status.LastSyncAt is { } at ? UiText.Clock(at) : "Not yet", null),
            ("Queued", UiText.Number(Math.Max(0, status.QueueDepth)), null),
        ]);

        // ⭐ পুরো বাক্যটা আসে কেবল যখন সত্যিই গোলমাল — তখনই মানুষের একটা
        //    বাক্য দরকার, লেবেল নয়।
        if (status.Health is SyncHealth.Failing or SyncHealth.Revoked)
        {
            stack.Alert(status.HealthDetail is { Length: > 0 } detail
                ? detail
                : DefaultDetail(status.Health));
        }
        else if (status.Health is SyncHealth.Degraded)
        {
            stack.Gap(2);
            stack.Line(
                status.HealthDetail is { Length: > 0 } slow ? slow : DefaultDetail(status.Health),
                TrayFontRole.Small, Muted);
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
    private void PaintMonth(TextStack stack, AgentStatus status, DateTimeOffset now)
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

        var pace = PaceOf(status, now);

        stack.Meter(
            status.MonthlyProgress,
            ExpectedRatio(status, pace),
            ProgressColor(status.MonthlyProgress));

        PaintLegend(stack, status, pace);
    }

    /// <summary>
    /// ⭐ মিটারের দাগ — "আজ পর্যন্ত যতটা হওয়ার কথা"।
    ///
    /// সার্ভার আলাদা করে এই সংখ্যাটা পাঠায় না, কিন্তু পাঠানোর দরকারও নেই:
    /// pace-ই তো <b>যা হয়েছে</b> বিয়োগ <b>যা হওয়ার কথা</b>। তাই উল্টো
    /// করে বের করা হয় — এতে দাগ আর "behind/ahead" সংখ্যাটা <b>একই উৎস</b>
    /// থেকে আসে, আর দুটো কখনো একে অন্যকে মিথ্যা বলতে পারে না।
    /// </summary>
    private static double? ExpectedRatio(AgentStatus status, TimeSpan? pace)
    {
        if (pace is not { } value) return null;
        if (status.MonthlyTargetHours <= 0) return null;

        var expected = status.ActiveThisMonth - value;
        if (expected <= TimeSpan.Zero) return null;

        var ratio = expected.TotalHours / status.MonthlyTargetHours;

        // মাসের শেষে প্রত্যাশা ১০০%-এ ঠেকে; তার বেশি দাগ আঁকার জায়গা নেই
        return Math.Min(1.0, ratio);
    }

    /// <summary>মিটারের নিচের লাইন — বাঁয়ে কত বাকি, ডানে এগিয়ে না পিছিয়ে।</summary>
    private void PaintLegend(TextStack stack, AgentStatus status, TimeSpan? pace)
    {
        var left = status.MonthlyRemaining <= TimeSpan.Zero
            ? "Target met"
            : UiText.Duration(status.MonthlyRemaining) + " left";

        if (pace is not { } value)
        {
            stack.Legend(left, string.Empty, Theme.Ink3);
            return;
        }

        var ahead = value >= TimeSpan.Zero;

        // ⚠️ চিহ্নটা লেখাতেই বলা আছে ("ahead"/"behind"), তাই সংখ্যাটা সবসময়
        //    ধনাত্মক রূপে। UiText.Duration ঋণাত্মককে শূন্য বানায়, ফলে
        //    Abs না নিলে প্রতিটা "behind" থাকা স্টাফ দেখত "0:00 behind"।
        var text = UiText.Duration(value.Duration()) + (ahead ? " ahead" : " behind");

        // ⚠️ সার্ভারের পাঠানো নয়, আমাদের আন্দাজ হলে সেটা লুকোনো যাবে না —
        //    শব্দটা ছুটির দিনের হিসাব নিয়ে আমাদের না-জানার স্বীকারোক্তি।
        if (status.Pace is null) text += " (estimated)";

        // ⭐ পিছিয়ে থাকা **আম্বার**, লাল নয়। লাল এই জানালায় শুধু
        //    "ডেটা সার্ভারে পৌঁছাচ্ছে না"-র জন্য — সেটা সিস্টেমের ব্যর্থতা,
        //    আর পিছিয়ে থাকা কোনো ইনসিডেন্ট নয়।
        stack.Legend(left, text, ahead ? Theme.Ok : Theme.Idle);
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
    private static TimeSpan? PaceOf(AgentStatus status, DateTimeOffset now) =>
        status.Pace
        ?? MonthlyPace.Estimate(status.ActiveThisMonth, status.MonthlyTargetHours, now);

    /// <summary>Live Board-এর ডট-ভাষাই — সবুজ চলছে · আম্বার থেমে · ধূসর লক।</summary>
    private Color StateDot(AgentStatus status) => status.Paused
        ? Theme.Ink3
        : status.State switch
        {
            SegmentState.Active => Theme.Ok,
            SegmentState.Idle => Theme.Idle,
            _ => Theme.Ink3,
        };

    private static string HealthName(SyncHealth health) => health switch
    {
        SyncHealth.Ok => "OK",
        SyncHealth.Degraded => "Running late",
        SyncHealth.Failing => "Not reaching server",
        _ => "Stopped",
    };

    /// <summary>
    /// ⭐ চলতি অবস্থায় নিরপেক্ষ <c>ink</c>, টার্গেট পূর্ণ হলে সবুজ —
    /// ড্যাশবোর্ড এই তর্ক আগেই মিটিয়েছে ([09 § ৩উ](../../../../docs/09-Build-Log.md))।
    ///
    /// ⚠️ আগে এখানে ছিল <c>#4A6FA5</c>, একটা নীল যা oXeio-র <b>কোথাও নেই</b>।
    /// </summary>
    private Color ProgressColor(double progress) =>
        progress >= 1.0 ? Theme.Ok : Theme.Ink;

    private static string DefaultDetail(SyncHealth health) => health switch
    {
        SyncHealth.Failing => TrayTooltip.SyncFailingLine,
        SyncHealth.Revoked => TrayTooltip.RevokedLine,
        _ => "Sync is running a little late",
    };
}
