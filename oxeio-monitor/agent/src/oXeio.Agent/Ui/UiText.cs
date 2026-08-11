using System.Globalization;

using oXeio.Core.Time;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray-তে দেখানো সংখ্যা ও সময়ের রূপ। পর্দার সব লেখা ইংরেজি, অঙ্কও ASCII।
///
/// ⚠️ csproj-এ <c>InvariantGlobalization=true</c>। মানে <c>new CultureInfo(...)</c>
/// চুপচাপ invariant হয়ে যায়, কোনো এক্সসেপশন ছাড়াই — তাই কালচারের উপর কোনো
/// নির্ভরতা রাখা হয় না, প্রতিটা <c>ToString</c>-এ স্পষ্ট করে
/// <see cref="CultureInfo.InvariantCulture"/> দেওয়া। মেশিনের locale যা-ই হোক,
/// স্টাফ আর ড্যাশবোর্ড হুবহু একই সংখ্যা দেখে।
/// </summary>
internal static class UiText
{
    private static readonly string[] Months =
    [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December",
    ];

    public static string Number(int value) =>
        value.ToString(CultureInfo.InvariantCulture);

    /// <summary>
    /// টার্গেট ঘণ্টা — পূর্ণ সংখ্যা হলে দশমিক ছাড়া, নইলে এক ঘর।
    ///
    /// ⚠️ "২০৮.০ hours" লেখা মানে স্টাফকে বোঝানো যে দশমিকটা গুরুত্বপূর্ণ, অথচ
    /// টার্গেট প্রায় সবসময়ই গোল সংখ্যা। আধা-ঘণ্টার টার্গেট (২০৭.৫) থাকলে
    /// সেটা লুকানোও যাবে না — তাই দুটো রূপ।
    /// </summary>
    public static string Hours(double hours)
    {
        if (double.IsNaN(hours) || double.IsInfinity(hours)) return "0";

        return Math.Abs(hours - Math.Round(hours)) < 0.05
            ? Number((int)Math.Round(hours))
            : hours.ToString("0.#", CultureInfo.InvariantCulture);
    }

    /// <summary>ঘণ্টা:মিনিট — যেমন <c>127:30</c>।</summary>
    public static string Duration(TimeSpan span)
    {
        // ঋণাত্মক সময় দেখানোর কোনো মানে নেই; ভুল হিসাব এলে শূন্য দেখানোই ভালো
        if (span < TimeSpan.Zero) span = TimeSpan.Zero;

        // ⚠️ এখানে <c>span.Hours</c> নয়, <c>span.TotalHours</c>। Hours ২৪-এ ফিরে
        //    শূন্য থেকে শুরু করে, তাই মাসের ১২৭ ঘণ্টা "৭:৩০" হয়ে দেখাত — অর্থাৎ
        //    যে সংখ্যাটার জন্য পুরো সিস্টেম, সেটাই ভুল আসত, আর দেখতে সম্পূর্ণ
        //    বিশ্বাসযোগ্য লাগত।
        var hours = (int)span.TotalHours;
        var minutes = span.Minutes;

        return hours.ToString(CultureInfo.InvariantCulture) + ":" +
               minutes.ToString("00", CultureInfo.InvariantCulture);
    }

    /// <summary>০.৬১ → <c>61%</c>। ১-এর উপরে ক্ল্যাম্প করা হয় না (ADR — বাড়তি কাজ অদৃশ্য নয়)।</summary>
    public static string Percent(double ratio)
    {
        if (double.IsNaN(ratio) || double.IsInfinity(ratio)) ratio = 0;

        var pct = (int)Math.Round(ratio * 100, MidpointRounding.AwayFromZero);
        if (pct < 0) pct = 0;
        if (pct > 9999) pct = 9999;

        return Number(pct) + "%";
    }

    /// <summary>
    /// ঢাকার ঘড়িতে <c>HH:MM</c>।
    ///
    /// ⚠️ <c>ToLocalTime()</c> নয়। মেশিনের টাইমজোন ভুল বসানো থাকতে পারে (নতুন PC-তে
    /// প্রায়ই থাকে), আর তখন স্টাফ যে "শেষ সিঙ্ক" দেখত সেটা সার্ভারের হিসাবের সাথে
    /// মিলত না — অথচ সংখ্যাটা নিখুঁত দেখাত।
    /// </summary>
    public static string Clock(DateTimeOffset instant)
    {
        var local = DhakaTime.LocalTimeOf(instant);
        return local.Hour.ToString("00", CultureInfo.InvariantCulture) + ":" +
               local.Minute.ToString("00", CultureInfo.InvariantCulture);
    }

    /// <summary>ঢাকার তারিখ — যেমন <c>9 August 2026</c>।</summary>
    public static string WorkDate(DateTimeOffset instant)
    {
        var date = DhakaTime.WorkDateOf(instant);
        var month = Months[date.Month - 1];
        return $"{Number(date.Day)} {month} {Number(date.Year)}";
    }

    /// <summary>
    /// সর্বোচ্চ <paramref name="max"/> UTF-16 একক পর্যন্ত ছেঁটে দেয়।
    ///
    /// ⚠️ সরাসরি <c>Substring</c> করা যাবে না। লেখা ইংরেজি হলেও এখানে ✅/⚠ জাতীয়
    /// চিহ্ন আসে, আর স্টাফের নামে যেকোনো হরফ থাকতে পারে — surrogate pair-এর
    /// মাঝখানে কাটলে পড়ে থাকে একটা অর্ধেক কোড-পয়েন্ট, যেটা রেন্ডারার আবর্জনা
    /// হিসেবে আঁকে। তাই কাটাকাটি হয় text element (grapheme) সীমানায়।
    /// </summary>
    public static string Truncate(string text, int max)
    {
        if (max <= 0) return string.Empty;
        if (string.IsNullOrEmpty(text) || text.Length <= max) return text;

        // শেষে একটা '…' বসবে, তাই তার জায়গা আগেই রেখে দেওয়া
        var budget = max - 1;
        var kept = 0;

        var walker = StringInfo.GetTextElementEnumerator(text);
        while (walker.MoveNext())
        {
            var element = walker.GetTextElement();
            if (kept + element.Length > budget) break;
            kept += element.Length;
        }

        return kept <= 0 ? "…" : string.Concat(text.AsSpan(0, kept), "…");
    }
}
