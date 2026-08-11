using System.Globalization;
using System.Runtime.Versioning;

using oXeio.Core.Agent;

namespace oXeio.Agent.Ui;

/// <summary>
/// "About" — সংস্করণ, ডিভাইস আইডি, সার্ভার।
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
        : base(fonts, "oXeio — About", 420, 490)
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

        stack.Line("oXeio Monitor", TrayFontRole.Strong);
        stack.Gap(6);

        stack.Pair("Version", options.AgentVersion);
        stack.Pair("Device ID", options.DeviceId is { } id
            ? UiText.Number(id)
            : "Not enrolled yet");

        if (!string.IsNullOrWhiteSpace(options.EmployeeName))
        {
            stack.Pair("Staff", options.EmpCode is { Length: > 0 } code
                ? $"{options.EmployeeName} ({code})"
                : options.EmployeeName!);
        }

        stack.Gap(4);

        // ⚠️ URL পুরোটা এক লাইনে না ধরলে TextStack নিজেই ভেঙে দুই লাইনে নেয় —
        //    তাই Pair নয়, Line। Pair-এ ডান অর্ধেকে আটকে গেলে পড়া যেত না।
        stack.Line("Server", TrayFontRole.Small, Muted);
        stack.Line(options.ServerUrl);

        stack.Rule();

        stack.Line("What this agent does not do", TrayFontRole.Strong);
        stack.Gap(4);

        foreach (var promise in Promises(config))
        {
            stack.Line("•  " + promise, TrayFontRole.Small);
        }

        stack.Rule();

        stack.Line(
            "The tray icon is always visible — there is no setting to hide it. " +
            "Monitoring is never kept secret.",
            TrayFontRole.Small, Muted);
    }

    private static IEnumerable<string> Promises(AgentConfig config)
    {
        yield return "Does not record keystrokes";
        yield return "Does not read the clipboard";
        yield return "Does not keep full URLs — domain only";
        yield return "Does not touch the camera or microphone";
        yield return "Does not record screen video or the contents of files";
        yield return ScreenshotWindowLine(config);
        yield return "Lunch, breaks and late arrivals are not counted at all";
    }

    private static string ScreenshotWindowLine(AgentConfig config)
    {
        var from = AgentConfig.ParseHhMm(config.ScreenshotFrom);
        var to = AgentConfig.ParseHhMm(config.ScreenshotTo);

        if (from is null || to is null)
            return "The screenshot window has not arrived from the server";

        var window =
            $"{from.Value.ToString(@"HH\:mm", CultureInfo.InvariantCulture)}–" +
            $"{to.Value.ToString(@"HH\:mm", CultureInfo.InvariantCulture)}";

        // সময় গোনা ২৪ ঘণ্টাই — এই পার্থক্যটা না লিখলে স্টাফ ভাবে রাতের কাজ গোনা হয় না
        return $"Screenshots are taken only between {window} (time is still counted 24 hours a day)";
    }
}
