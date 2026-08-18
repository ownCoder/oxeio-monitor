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
    /// <summary>শেষ ৩০ মিনিট = ৬টা ৫-মিনিটের ঘর (<c>AgentHost.BusyBlocks</c>-এর সমান)।</summary>
    private const int BusyBlockCount = 6;

    /// <summary>থাম্বনেইলের প্রস্থ, ৯৬ DPI-তে। জানালার ভেতরের চওড়া ৩৬৮px।</summary>
    private const int ThumbWidth = 220;

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
        //
        // ⚠️⚠️ সাইন ইন না করা থাকলে **"Working" লেখা যাবে না**। আগে ঠিক
        //    সেটাই হতো: সবুজ বিন্দু আর "Working", অথচ গোনাও হচ্ছিল না,
        //    সার্ভারেও কিছু যাচ্ছিল না। স্টাফ দেখত সব ঠিক আছে, তাই সাইন ইন
        //    করার কথাই মাথায় আসত না — আর দিনের শেষে তার ঘণ্টা শূন্য।
        stack.Hero(
            // ⭐ হিরো সংখ্যাটাই একমাত্র সেকেন্ডসহ (মালিকের চাওয়া, ১৮ আগস্ট) —
            //    নিচের টার্গেট-বারগুলো H:MM-ই থাকে।
            UiText.DurationLong(status.ActiveToday),
            "hours today",
            HeroState(status),
            StateDot(status));

        stack.Line(
            status.Enrolled
                ? "Counted so far — idle time already removed"
                : TrackingGate.Explain(TrackingGate.Verdict.NotEnrolled),
            TrayFontRole.Small,
            // ⚠️ Brand (লাল), Idle (আম্বার) নয়। আম্বার এই জানালায় ইতিমধ্যেই
            //    "থেমে আছে/পিছিয়ে আছে" বোঝায় — অস্থায়ী অবস্থা। সাইন ইন না
            //    করা মানে **কিছুই গোনা হচ্ছে না**, ঠিক revoke-এর মতোই আটকে
            //    থাকা, আর সেটার রং এখানে বরাবরই লাল।
            status.Enrolled ? Muted : Theme.Brand);

        stack.Rule();

        PaintTargets(stack, status, now);

        stack.Rule();

        PaintBusy(stack, status);

        stack.Rule();

        PaintLatestShot(stack, status);

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
    /// <summary>
    /// তিনটে টার্গেট — আজ · গত ৭ দিন · এই মাস। তিনটেই একই আকৃতির বার।
    ///
    /// ⭐ ক্রমটা ছোট থেকে বড়: মানুষ আগে জানতে চায় "আজ কেমন গেল", তারপর
    /// "সপ্তাহটা", তারপর "মাসটা"। উল্টো করলে সবচেয়ে দূরের সংখ্যাটা আগে
    /// চোখে পড়ত, অথচ আজকের কাজে ওটা দিয়ে কিছু করার নেই।
    ///
    /// ⚠️ <b>একমাত্র চুক্তি মাসিক ২০৮ ঘণ্টা</b> (§ ৪ · O8)। আজ ও ৭ দিনের
    /// টার্গেট নিছক দেখানোর জিনিস — বেতন বা কাটাকাটির সাথে এদের সম্পর্ক নেই।
    /// </summary>
    private void PaintTargets(TextStack stack, AgentStatus status, DateTimeOffset now)
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

        // ── আজ ────────────────────────────────────────────────────────────
        // ⚠️ টার্গেট শূন্য মানে ছুটি — বার নয়, একটা বাক্য। ছুটির দিনে
        //    খালি বার দেখালে সেটা "আজও ৮ ঘণ্টা বাকি" বলে তাড়া দিত।
        if (status.DailyTarget is { } daily && daily == TimeSpan.Zero)
        {
            stack.TargetRow(
                "Today", UiText.Duration(status.ActiveToday), null, Theme.Ink,
                note: "Day off — anything you do today still counts toward the month.");
        }
        else
        {
            stack.TargetRow(
                "Today",
                status.DailyTarget is { } t
                    ? $"{UiText.Duration(status.ActiveToday)} / {UiText.Duration(t)}"
                    : UiText.Duration(status.ActiveToday),
                status.DailyProgress,
                ProgressFill);
        }

        stack.Gap(6);

        // ── গত ৭ দিন ──────────────────────────────────────────────────────
        stack.TargetRow(
            "Last 7 days",
            status.ActiveLast7 is { } worked && status.Last7Target is { } target
                ? $"{UiText.Duration(worked)} / {UiText.Duration(target)}"
                : "—",
            status.Last7Progress,
            ProgressFill);

        stack.Gap(6);

        // ── এই মাস ────────────────────────────────────────────────────────
        var pace = PaceOf(status, now);

        stack.TargetRow(
            "This month",
            $"{UiText.Duration(status.ActiveThisMonth)} / " +
            $"{UiText.Number((int)Math.Round(status.MonthlyTargetHours))} hours",
            status.MonthlyProgress,
            ProgressFill,
            expected: ExpectedRatio(status, pace));

        PaintLegend(stack, status, pace);
    }

    /// <summary>
    /// "প্রতি ৫ মিনিটে কতটা হাত চলেছে" — মালিকের চাওয়া, তবে <b>কতবার নয়</b>।
    ///
    /// ⭐⚠️ কতবার কি-বোর্ড চাপা হয়েছে সেটা এই সিস্টেম জানতেই পারে না, আর
    /// জানার চেষ্টাও করবে না: তার জন্য low-level hook লাগত, যেটা কীলগিং
    /// (04-Features § L) আর G46-এ স্পষ্টভাবে প্রত্যাখ্যাত। এখানে যা দেখা যায়
    /// তা হলো <b>কত শতাংশ সময়</b> হাত চলেছে — সংখ্যাটা প্রতিটা সেগমেন্টের
    /// <c>input_score</c>, যা আগে থেকেই সার্ভারে যাচ্ছিল।
    /// </summary>
    private void PaintBusy(TextStack stack, AgentStatus status)
    {
        stack.Pair("Keyboard & mouse", "last 30 min", TrayFontRole.Body);
        stack.Gap(4);

        stack.BusyBlocks(status.RecentBusy, BusyBlockCount);

        stack.Line(
            status.RecentBusy.Count == 0
                ? "Each block is 5 minutes. The first one appears after five minutes of tracking."
                : "Each block is 5 minutes — how much of it your keyboard or mouse moved. " +
                  "What you typed is never recorded.",
            TrayFontRole.Small, Muted);
    }

    /// <summary>
    /// শেষ যে ছবিটা গেছে — স্টাফ নিজের চোখে দেখুক ঠিক কী পাঠানো হয়েছে।
    ///
    /// ⭐ এটাই এই জানালার মূল কথার সবচেয়ে সরাসরি রূপ: নজরদারি লুকোনো নয়।
    /// ⚠️ থাম্বনেইল, তাই পড়া যায় না — উদ্দেশ্য "কী ছবি গেছে" বোঝানো,
    /// ছবিটা আবার পড়া নয়। পুরোটা দেখতে হলে "My data" পাতা আছে (J05)।
    /// </summary>
    private void PaintLatestShot(TextStack stack, AgentStatus status)
    {
        var when = status.LatestShotAt is { } at ? UiText.Clock(at) : null;

        stack.Pair(
            "Latest screenshot",
            when ?? "None yet",
            TrayFontRole.Body);

        if (when is null)
        {
            stack.Gap(2);
            stack.Line(
                "Pictures are taken once every 5 minutes, at a random moment, and only " +
                "between 07:00 and 23:00 while you are working.",
                TrayFontRole.Small, Muted);
            return;
        }

        stack.Gap(4);

        if (!stack.Thumbnail(status.LatestShotThumb, ThumbWidth))
        {
            stack.Line("The preview could not be loaded — the picture itself was still sent.",
                TrayFontRole.Small, Muted);
            return;
        }

        if (status.LatestShotMonitors > 1)
        {
            stack.Line(
                $"Screen 1 of {UiText.Number(status.LatestShotMonitors)} — every screen is captured.",
                TrayFontRole.Small, Muted);
        }
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

    /// <summary>
    /// সংখ্যার পাশের পিলটায় যা লেখা থাকে।
    ///
    /// ⚠️ ক্রমটা <see cref="TrackingGate"/>-এর ক্রমেই — সাইন-ইন ও revoke
    /// আগে, তারপর pause, তারপর চলতি অবস্থা। উল্টো হলে বাতিল ডিভাইসেও
    /// "Idle" লেখা থাকত, যেন এখুনি আবার শুরু হয়ে যাবে।
    /// </summary>
    private static string HeroState(AgentStatus status) =>
        TrackingGate.Check(status.Enrolled, status.Health is SyncHealth.Revoked) switch
        {
            TrackingGate.Verdict.NotEnrolled => "Not signed in",
            TrackingGate.Verdict.Revoked => "Stopped",
            _ => status.Paused ? "Tracking paused" : TrayTooltip.StateName(status.State),
        };

    /// <summary>Live Board-এর ডট-ভাষাই — সবুজ চলছে · আম্বার থেমে · ধূসর লক।</summary>
    private Color StateDot(AgentStatus status)
    {
        // ⚠️ সবুজ বিন্দুটা "সব ঠিকঠাক চলছে"-র প্রতিশ্রুতি। সাইন ইন না করা
        //    থাকলে সেটা মিথ্যে, তাই রংটাই আগে বদলায় — লেখা পড়ার আগেই।
        if (!status.Enrolled) return Theme.Brand;

        return status.Paused
            ? Theme.Ink3
            : status.State switch
            {
                SegmentState.Active => Theme.Ok,
                SegmentState.Idle => Theme.Idle,
                _ => Theme.Ink3,
            };
    }

    private static string HealthName(SyncHealth health) => health switch
    {
        SyncHealth.Ok => "OK",
        SyncHealth.Degraded => "Running late",
        SyncHealth.Failing => "Not reaching server",
        _ => "Stopped",
    };

    /// <summary>
    /// ⭐ অগ্রগতির ভরাট <b>সবুজ</b> (<c>Theme.Ok</c>) — মালিকের চাওয়া
    /// (১৮ আগস্ট): "কাজ হচ্ছে = সবুজ"।
    ///
    /// ⚠️ আগে ছিল চলতি অবস্থায় নিরপেক্ষ <c>ink</c>, শুধু টার্গেট পূর্ণে সবুজ
    /// ([09 § ৩উ](../../../../docs/09-Build-Log.md))। মালিক প্রথমে ওয়েবে,
    /// তারপর এই জানালাতেও ভরাটটা সবুজ চেয়েছেন — দুই পর্দা এক থাকুক।
    /// (আরও আগে ছিল <c>#4A6FA5</c>, একটা নীল যা oXeio-র কোথাও নেই।)
    /// </summary>
    private Color ProgressFill => Theme.Ok;

    private static string DefaultDetail(SyncHealth health) => health switch
    {
        SyncHealth.Failing => TrayTooltip.SyncFailingLine,
        SyncHealth.Revoked => TrayTooltip.RevokedLine,
        _ => "Sync is running a little late",
    };
}
