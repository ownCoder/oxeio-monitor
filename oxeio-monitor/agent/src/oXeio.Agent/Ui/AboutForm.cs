using System.Runtime.Versioning;

using oXeio.Core.Agent;

namespace oXeio.Agent.Ui;

/// <summary>
/// "সম্পর্কে" — সংস্করণ, ডিভাইস আইডি, সার্ভার।
///
/// সাথে একটা ছোট তালিকা: এই এজেন্ট যা <b>করে না</b>। ওটা সাজসজ্জা নয় — লিখিত
/// মনিটরিং পলিসিতে যা প্রতিশ্রুতি দেওয়া আছে, সেটা স্টাফের নিজের মেশিনে দুই
/// ক্লিকে যাচাই করার জায়গা। এই জানালার তালিকা আর পলিসি ডকুমেন্ট আলাদা হয়ে
/// গেলে বুঝতে হবে কোথাও একটা প্রতিশ্রুতি ভাঙা হয়েছে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class AboutForm : OwnerDrawnForm
{
    private readonly Func<TrayOptions> _options;

    public AboutForm(TrayFonts fonts, Func<TrayOptions> options)
        : base(fonts, "oXeio — সম্পর্কে", 420, 490)
    {
        _options = options;
    }

    /// <summary>
    /// এনরোলমেন্টের পর ডিভাইস আইডি বসলে নতুন করে আঁকা। UI থ্রেড থেকে।
    ///
    /// ⚠️ নাম <c>Refresh</c> রাখা যায় না — <c>Control.Refresh()</c> ইতিমধ্যেই
    /// আছে। ঢেকে দিলে বেস-ক্লাসের রেফারেন্স দিয়ে ডাকলে অন্য কোড চলত।
    /// </summary>
    public void RedrawContent()
    {
        if (IsDisposed || !IsHandleCreated) return;
        Invalidate();
    }

    protected override void PaintBody(TextStack stack)
    {
        var options = _options();
        var config = options.EffectiveConfig;

        stack.Line("oXeio মনিটর", TrayFontRole.Strong);
        stack.Gap(6);

        stack.Pair("সংস্করণ", BanglaText.Digits(options.AgentVersion));
        stack.Pair("ডিভাইস আইডি", options.DeviceId is { } id
            ? BanglaText.Number(id)
            : "এখনো এনরোল হয়নি");

        if (!string.IsNullOrWhiteSpace(options.EmployeeName))
        {
            stack.Pair("কর্মী", options.EmpCode is { Length: > 0 } code
                ? $"{options.EmployeeName} ({code})"
                : options.EmployeeName!);
        }

        stack.Gap(4);

        // ⚠️ URL পুরোটা এক লাইনে না ধরলে TextStack নিজেই ভেঙে দুই লাইনে নেয় —
        //    তাই Pair নয়, Line। Pair-এ ডান অর্ধেকে আটকে গেলে পড়া যেত না।
        stack.Line("সার্ভার", TrayFontRole.Small, Muted);
        stack.Line(options.ServerUrl);

        stack.Rule();

        stack.Line("এই এজেন্ট যা করে না", TrayFontRole.Strong);
        stack.Gap(4);

        foreach (var promise in Promises(config))
        {
            stack.Line("•  " + promise, TrayFontRole.Small);
        }

        stack.Rule();

        stack.Line(
            "ট্রে-র আইকনটি সবসময় দেখা যাবে — এটি লুকানোর কোনো সেটিং নেই। " +
            "মনিটরিং চললে তা গোপন রাখা হয় না।",
            TrayFontRole.Small, Muted);
    }

    private static IEnumerable<string> Promises(AgentConfig config)
    {
        yield return "কি-স্ট্রোক রেকর্ড করে না";
        yield return "ক্লিপবোর্ড পড়ে না";
        yield return "সম্পূর্ণ URL রাখে না — শুধু ডোমেইন";
        yield return "ক্যামেরা বা মাইক্রোফোন ছোঁয় না";
        yield return "স্ক্রিনের ভিডিও বা ফাইলের ভেতরের লেখা নেয় না";
        yield return ScreenshotWindowLine(config);
        yield return "লাঞ্চ, বিরতি বা দেরি — কিছুই গোনা হয় না";
    }

    private static string ScreenshotWindowLine(AgentConfig config)
    {
        var from = AgentConfig.ParseHhMm(config.ScreenshotFrom);
        var to = AgentConfig.ParseHhMm(config.ScreenshotTo);

        if (from is null || to is null)
            return "স্ক্রিনশটের সময়সীমা সার্ভার থেকে আসেনি";

        var window =
            $"{BanglaText.Digits(from.Value.ToString(@"HH\:mm"))}–" +
            $"{BanglaText.Digits(to.Value.ToString(@"HH\:mm"))}";

        // সময় গোনা ২৪ ঘণ্টাই — এই পার্থক্যটা না লিখলে স্টাফ ভাবে রাতের কাজ গোনা হয় না
        return $"ছবি ওঠে শুধু {window}-এর মধ্যে (সময় অবশ্য ২৪ ঘণ্টাই গোনা হয়)";
    }
}
