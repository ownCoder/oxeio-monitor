using System.Drawing;
using System.Runtime.Versioning;

using oXeio.Core.Agent;

namespace oXeio.Agent.Ui;

/// <summary>
/// "আজকের সময়" — স্টাফ নিজের হিসাব নিজে দেখতে পারে।
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
        : base(fonts, "oXeio — আজকের সময়", 400, 500)
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
            ? "এই ডিভাইস"
            : options.EmpCode is { Length: > 0 } code
                ? $"{options.EmployeeName} ({code})"
                : options.EmployeeName!;

        stack.Line(who, TrayFontRole.Strong);
        stack.Line(BanglaText.WorkDate(now) + " · ঢাকা", TrayFontRole.Small, Muted);
        stack.Gap(8);

        stack.Line(BanglaText.Duration(status.ActiveToday) + " ঘণ্টা", TrayFontRole.Big);
        stack.Line("আজ পর্যন্ত গোনা হয়েছে", TrayFontRole.Small, Muted);

        stack.Rule();

        PaintMonth(stack, status, now);

        stack.Rule();

        stack.Pair("এখন", status.Paused
            ? "ট্র্যাকিং সাময়িক বন্ধ"
            : TrayTooltip.StateName(status.State));

        // ⚠️ সিঙ্কের অবস্থা সবসময় দেখানো হয়, শুধু গোলমাল হলে নয়। আগে এখানে
        //    কিছু না থাকা মানে "ঠিক আছে" ধরে নিতে হতো — অর্থাৎ সবচেয়ে জরুরি
        //    আশ্বাসটা (ডেটা পৌঁছেছে) ঠিক তখনই অদৃশ্য, যখন সেটা সত্যি।
        stack.Pair("সিঙ্ক", HealthName(status.Health));

        stack.Pair("শেষ সিঙ্ক", status.LastSyncAt is { } at
            ? BanglaText.Clock(at)
            : "এখনো হয়নি");

        stack.Pair("সারিতে জমা", BanglaText.Number(Math.Max(0, status.QueueDepth)) + "টি");

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
            $"টানা {BanglaText.Number(options.EffectiveConfig.IdleThresholdSec)} সেকেন্ড " +
            "মাউস/কি-বোর্ড না ছুঁলে গোনা থেমে যায়, আর ওই সময়টুকু পিছিয়ে বাদ দেওয়া হয়।",
            TrayFontRole.Small, Muted);

        stack.Line(
            "নেট না থাকলেও কিছু হারায় না — সারিতে জমা থাকে, সংযোগ ফিরলে নিজে থেকেই চলে যায়।",
            TrayFontRole.Small, Muted);
    }

    /// <summary>
    /// মাসের অগ্রগতি — <b>শুধু সার্ভার সংখ্যাটা বলে দেওয়ার পর</b>।
    ///
    /// ⭐⚠️ মাসের হিসাব এজেন্ট নিজে রাখে না, তাই প্রথম heartbeat আসার আগে
    /// <see cref="AgentStatus.ActiveThisMonth"/> মিথ্যা শূন্য। ওই অবস্থায়
    /// বার আর শতাংশ আঁকলে স্টাফ প্রতিবার লগইনের পর কয়েক সেকেন্ডের জন্য
    /// "০ / ২০৮ ঘণ্টা · ০%" দেখত — অর্থাৎ মনে হতো মাসের কাজ মুছে গেছে।
    /// তাই তিনটে অবস্থা: জানা নেই / জানা আছে / লক্ষ্য নেই।
    /// </summary>
    private static void PaintMonth(TextStack stack, AgentStatus status, DateTimeOffset now)
    {
        if (!status.MonthlyKnown)
        {
            stack.Pair("এ মাসে", "হিসাব আসছে…", TrayFontRole.Strong);
            stack.Gap(2);
            stack.Line(
                "মাসের যোগফল সার্ভার থেকে আসে — সব PC মিলিয়ে। " +
                "সংযোগ হওয়ামাত্রই এখানে বসবে।",
                TrayFontRole.Small, Muted);
            return;
        }

        stack.Pair("এ মাসে",
            $"{BanglaText.Duration(status.ActiveThisMonth)} / " +
            $"{BanglaText.Number((int)Math.Round(status.MonthlyTargetHours))} ঘণ্টা",
            TrayFontRole.Strong);

        stack.Gap(2);
        stack.Bar(status.MonthlyProgress, ProgressColor(status.MonthlyProgress));

        stack.Pair("অগ্রগতি", BanglaText.Percent(status.MonthlyProgress));
        stack.Pair("বাকি", BanglaText.Duration(status.MonthlyRemaining) + " ঘণ্টা");

        PaintPace(stack, status, now);
    }

    /// <summary>
    /// "এগিয়ে না পিছিয়ে" (B05b/J02)।
    ///
    /// ⭐ সার্ভার সংখ্যাটা পাঠালে সেটাই — ওটাই ড্যাশবোর্ডের সংখ্যা, আর দুই
    /// জায়গায় দুই সংখ্যা দেখলে স্টাফ ধরে নেবে একটা মিথ্যা বলছে।
    /// সার্ভার না পাঠালে <see cref="MonthlyPace"/>-এর আনুমানিক হিসাব, এবং
    /// লেবেলেই "আনুমানিক" — ⚠️ শব্দটা সরাবেন না, ওটা ছুটির দিনের জন্য
    /// আমাদের না-জানার স্বীকারোক্তি।
    ///
    /// লক্ষ্যই না থাকলে (টার্গেট ০) লাইনটা বাদ — "০ ঘণ্টা এগিয়ে" অর্থহীন।
    /// </summary>
    private static void PaintPace(TextStack stack, AgentStatus status, DateTimeOffset now)
    {
        var exact = status.Pace is not null;
        var pace = status.Pace
                   ?? MonthlyPace.Estimate(status.ActiveThisMonth, status.MonthlyTargetHours, now);

        if (pace is not { } value) return;

        var ahead = value >= TimeSpan.Zero;

        // ⚠️ চিহ্নটা লেখাতেই বলা আছে ("এগিয়ে"/"পিছিয়ে"), তাই সংখ্যাটা সবসময়
        //    ধনাত্মক রূপে। BanglaText.Duration ঋণাত্মককে শূন্য বানায়, ফলে
        //    Abs না নিলে প্রতিটা "পিছিয়ে" থাকা স্টাফ দেখত "০:০০ ঘণ্টা পিছিয়ে"।
        var text = (ahead ? "✓ " : "⚠ ") +
                   BanglaText.Duration(value.Duration()) + " ঘণ্টা " +
                   (ahead ? "এগিয়ে" : "পিছিয়ে");

        stack.Pair(exact ? "গতি" : "গতি (আনুমানিক)", text);
    }

    private static string HealthName(SyncHealth health) => health switch
    {
        SyncHealth.Ok => "ঠিক আছে",
        SyncHealth.Degraded => "একটু দেরিতে",
        SyncHealth.Failing => "পৌঁছাচ্ছে না",
        _ => "বন্ধ করা হয়েছে",
    };

    private static Color ProgressColor(double progress) =>
        progress >= 1.0
            ? Color.FromArgb(0x2E, 0x9E, 0x4F)
            : Color.FromArgb(0x4A, 0x6F, 0xA5);

    private static string DefaultDetail(SyncHealth health) => health switch
    {
        SyncHealth.Failing => TrayTooltip.SyncFailingLine,
        SyncHealth.Revoked => TrayTooltip.RevokedLine,
        _ => "সিঙ্ক একটু দেরিতে চলছে",
    };
}
