using System.Globalization;

using oXeio.Core.Agent;
using oXeio.Core.Time;

namespace oXeio.Agent.Ui;

/// <summary>
/// J03 — মাসের ২০৮ ঘণ্টা পূর্ণ হলে একবার ✅ বলা। খাঁটি সিদ্ধান্তটুকু এখানে,
/// ডিস্কে মনে রাখা <see cref="MilestoneMemory"/>-তে।
///
/// ⭐⚠️ <b>মাসে ঠিক একবার — এটাই এই ফাইলের পুরো কারণ।</b> heartbeat আসে
/// প্রতি ৩০–৬০ সেকেন্ডে, আর লক্ষ্য পূর্ণ হওয়ার পর প্রতিটা heartbeat-এই শর্তটা
/// সত্যি থাকে। শর্ত দেখে বেলুন দেখালে মাসের বাকি দিনগুলোয় ঘণ্টায় ষাটটা বেলুন
/// উঠত — আর তার পরিণতি একটাই: স্টাফ Windows-এর সেটিংস থেকে oXeio-র
/// নোটিফিকেশন চিরতরে বন্ধ করে দিত। তখন সিঙ্ক ব্যর্থ হলে বা ডিভাইস revoke
/// হলে যে একটামাত্র জরুরি বার্তা দেখানোর সুযোগ ছিল, সেটাও আর নেই — এবং
/// সেটা কোড থেকে ফেরানোর কোনো উপায় নেই।
///
/// ⚠️ মনে রাখাটা ডিস্কে, শুধু মেমরিতে নয়। এজেন্ট রোজ অন্তত একবার রিস্টার্ট হয়
/// (PC বন্ধ হয়), তাই মেমরির পতাকা মানে কার্যত "দিনে একবার"।
/// </summary>
internal static class MonthlyMilestone
{
    /// <summary>বেলুনের শ্রেণি — <see cref="BalloonThrottle"/>-এর দ্বিতীয় জাল।</summary>
    public const string EventClass = "monthly_target";

    /// <summary>
    /// ঢাকার ক্যালেন্ডারে মাসের পরিচয়, যেমন <c>2026-08</c>।
    ///
    /// ⚠️ UTC-র মাস নয়। ঢাকা UTC+৬, তাই মাসের ১ তারিখ রাত ২টায় UTC তখনো
    /// আগের মাস — ওই ছয় ঘণ্টায় নতুন মাসের বেলুনটা পুরোনো মাসের নামে জমা
    /// পড়ত, আর নতুন মাস শুরু হলে আবার দেখানো হতো।
    /// </summary>
    public static string MonthKeyOf(DateTimeOffset now)
    {
        var date = DhakaTime.WorkDateOf(now);
        return date.Year.ToString("0000", CultureInfo.InvariantCulture) + "-" +
               date.Month.ToString("00", CultureInfo.InvariantCulture);
    }

    /// <summary>লক্ষ্য পূর্ণ হয়েছে কি না। টার্গেট ০/অস্বাভাবিক হলে কখনোই নয়।</summary>
    public static bool Reached(TimeSpan monthActive, double targetHours)
    {
        if (targetHours <= 0 || double.IsNaN(targetHours) || double.IsInfinity(targetHours))
            return false;

        return monthActive >= TimeSpan.FromHours(targetHours);
    }

    /// <summary>
    /// এখনই বেলুন দেখানো উচিত কি না।
    /// </summary>
    /// <param name="status">tray-র সর্বশেষ অবস্থা।</param>
    /// <param name="now">ঢাকার মাস বের করতে।</param>
    /// <param name="lastCelebrated">সবশেষ যে মাসে দেখানো হয়েছিল, বা <c>null</c>।</param>
    /// <param name="monthKey">চলতি মাসের চাবি — সত্যি ফেরালে এটাই জমা রাখতে হবে।</param>
    public static bool ShouldCelebrate(
        AgentStatus status, DateTimeOffset now, string? lastCelebrated, out string monthKey)
    {
        monthKey = MonthKeyOf(now);

        if (status is null) return false;

        // ⚠️ এই মাসে একবার হয়ে গেছে — সবচেয়ে জরুরি শর্ত, তাই সবার আগে।
        if (string.Equals(lastCelebrated, monthKey, StringComparison.Ordinal)) return false;

        // ⚠️ সার্ভার একবারও অগ্রগতি না বললে মাসের ঘরটা মিথ্যা শূন্য — আর
        //    ভবিষ্যতে কেউ ওখানে এজেন্টের নিজের হিসাব বসালে (রিবুটে যেটা
        //    শূন্য থেকে শুরু) এই শর্ত ছাড়া অভিনন্দনটা ভুল সময়ে যেত।
        if (!status.MonthlyKnown) return false;

        return Reached(status.ActiveThisMonth, status.MonthlyTargetHours);
    }

    /// <summary>
    /// বেলুনের লেখা। ⚠️ কোনো নির্দেশ নেই, কোনো অনুরোধ নেই — শুধু খবর।
    /// "এবার বিশ্রাম নিন" বা "আর কাজ করতে হবে না" জাতীয় কিছু লিখলে সেটা
    /// নীতিগত নির্দেশ হয়ে যেত, অথচ ২০৮ ঘণ্টা একটা লক্ষ্য, সীমা নয় —
    /// এর পরের ঘণ্টাগুলোও পুরোপুরি গোনা হয়।
    /// </summary>
    public static string Text(double targetHours)
    {
        var hours = Math.Abs(targetHours - Math.Round(targetHours)) < 0.05
            ? BanglaText.Number((int)Math.Round(targetHours))
            : BanglaText.Digits(targetHours.ToString("0.#", CultureInfo.InvariantCulture));

        return $"✅ এ মাসের {hours} ঘণ্টা পূর্ণ হয়েছে";
    }
}
