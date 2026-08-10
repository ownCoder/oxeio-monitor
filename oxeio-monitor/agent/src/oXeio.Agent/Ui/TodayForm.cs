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

        stack.Pair("এ মাসে",
            $"{BanglaText.Duration(status.ActiveThisMonth)} / " +
            $"{BanglaText.Number((int)Math.Round(status.MonthlyTargetHours))} ঘণ্টা",
            TrayFontRole.Strong);

        stack.Gap(2);
        stack.Bar(status.MonthlyProgress, ProgressColor(status.MonthlyProgress));

        stack.Pair("অগ্রগতি", BanglaText.Percent(status.MonthlyProgress));
        stack.Pair("বাকি", BanglaText.Duration(status.MonthlyRemaining) + " ঘণ্টা");

        stack.Rule();

        stack.Pair("এখন", status.Paused
            ? "ট্র্যাকিং সাময়িক বন্ধ"
            : TrayTooltip.StateName(status.State));

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
