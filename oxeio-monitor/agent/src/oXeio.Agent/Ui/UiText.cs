using System.Globalization;

using oXeio.Core.Time;

namespace oXeio.Agent.Ui;

/// <summary>
/// tray-তে দেখানো সংখ্যা ও সময়ের বাংলা রূপ।
///
/// ⚠️ csproj-এ <c>InvariantGlobalization=true</c>। মানে <c>new CultureInfo("bn-BD")</c>
/// চুপচাপ invariant হয়ে যায় আর <c>ToString(culture)</c> কখনোই বাংলা অঙ্ক দেয় না —
/// কোনো এক্সসেপশন ছাড়াই, তাই ভুলটা ধরাও পড়ে না। সেজন্য অঙ্কগুলো এখানে হাতে
/// বদলানো হয়। কালচার ডেটার উপর কোনো নির্ভরতা নেই, ইচ্ছাকৃতভাবে।
/// </summary>
internal static class BanglaText
{
    private const string BengaliDigits = "০১২৩৪৫৬৭৮৯";

    private static readonly string[] Months =
    [
        "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
        "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
    ];

    /// <summary>ASCII ০-৯ → বাংলা অঙ্ক। বাকি সব অক্ষর অপরিবর্তিত।</summary>
    public static string Digits(string ascii)
    {
        if (string.IsNullOrEmpty(ascii)) return string.Empty;

        var chars = ascii.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
        {
            var c = chars[i];
            if (c >= '0' && c <= '9') chars[i] = BengaliDigits[c - '0'];
        }

        return new string(chars);
    }

    public static string Number(int value) =>
        Digits(value.ToString(CultureInfo.InvariantCulture));

    /// <summary>ঘণ্টা:মিনিট — যেমন <c>১২৭:৩০</c>।</summary>
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

        return Digits(
            hours.ToString(CultureInfo.InvariantCulture) + ":" +
            minutes.ToString("00", CultureInfo.InvariantCulture));
    }

    /// <summary>০.৬১ → <c>৬১%</c>। ১-এর উপরে ক্ল্যাম্প করা হয় না (ADR — বাড়তি কাজ অদৃশ্য নয়)।</summary>
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
        return Digits(
            local.Hour.ToString("00", CultureInfo.InvariantCulture) + ":" +
            local.Minute.ToString("00", CultureInfo.InvariantCulture));
    }

    /// <summary>ঢাকার তারিখ — যেমন <c>৯ আগস্ট ২০২৬</c>।</summary>
    public static string WorkDate(DateTimeOffset instant)
    {
        var date = DhakaTime.WorkDateOf(instant);
        var month = Months[date.Month - 1];
        return $"{Number(date.Day)} {month} {Number(date.Year)}";
    }

    /// <summary>
    /// সর্বোচ্চ <paramref name="max"/> UTF-16 একক পর্যন্ত ছেঁটে দেয়।
    ///
    /// ⚠️ সরাসরি <c>Substring</c> করলে বাংলা লেখা ভেঙে যায়: "ছে"-র মাঝখানে কাটলে
    /// পড়ে থাকে একটা এতিম কার-চিহ্ন, যেটা রেন্ডারার আগের অক্ষরের সাথে জুড়ে
    /// সম্পূর্ণ অন্য শব্দ বানায়। surrogate pair-এর মাঝে কাটলে তো ক্র্যাশ-সদৃশ
    /// আবর্জনাই আসে। তাই কাটাকাটি হয় text element (grapheme) সীমানায়।
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
