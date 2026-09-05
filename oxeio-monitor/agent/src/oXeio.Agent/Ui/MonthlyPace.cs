using oXeio.Core.Time;

namespace oXeio.Agent.Ui;

/// <summary>
/// "এগিয়ে না পিছিয়ে" — মাসের এই দিনে কত ঘণ্টা হয়ে থাকার কথা ছিল, আর কত হয়েছে।
/// খাঁটি হিসাব: কোনো I/O নেই, কোনো Win32 নেই, ঘড়িও বাইরে থেকে দেওয়া।
///
/// <code>
/// expected = target × (কর্মদিবস অতিবাহিত / মাসের মোট কর্মদিবস)
/// pace     = worked − expected        // ধনাত্মক = এগিয়ে
/// </code>
///
/// ⭐⚠️ <b>এটা আনুমানিক, আর সেটা লুকানো যাবে না।</b> স্পেকে (07 § ২.১-খ)
/// কর্মদিবস মানে সাপ্তাহিক ছুটি <b>এবং</b> <c>holidays</c> টেবিলের বাইরের দিন।
/// এজেন্ট ছুটির তালিকা জানে না — সার্ভার সেটা পাঠায় না। তাই এখানকার সংখ্যা
/// ড্যাশবোর্ডের সংখ্যার সাথে এক-দুই ঘণ্টা মিলবে না।
///
/// সেজন্য দুটো নিয়ম, দুটোই বাধ্যতামূলক:
/// <list type="number">
/// <item>সার্ভার <see cref="oXeio.Core.Agent.EmployeeProgress.PaceSec"/> পাঠালে
///       <b>সেটাই</b> দেখাতে হবে, এই হিসাব নয়।</item>
/// <item>এই হিসাব দেখালে জানালায় "আনুমানিক" শব্দটা থাকতে হবে। না থাকলে স্টাফ
///       দুই জায়গায় দুই সংখ্যা দেখে ধরে নিত একটা মিথ্যা বলছে — আর এই
///       জানালার পুরো উদ্দেশ্যই আস্থা তৈরি করা।</item>
/// </list>
/// </summary>
internal static class MonthlyPace
{
    /// <summary>
    /// সাপ্তাহিক ছুটি — 07 § ২.১-খ-এর <c>weekly_off_day: friday</c>।
    ///
    /// ⚠️ কনফিগে (<see cref="oXeio.Core.Agent.AgentConfig"/>) এই ঘরটা নেই, তাই
    /// ধ্রুবক হিসেবে বসানো। অফিস কোনোদিন ছুটির দিন বদলালে এখানেও বদলাতে হবে —
    /// নইলে জানালাটা নীরবে ভুল "এগিয়ে/পিছিয়ে" দেখাবে।
    /// </summary>
    public const DayOfWeek WeeklyOff = DayOfWeek.Friday;

    /// <summary>
    /// <paramref name="worked"/> = এ মাসে সত্যিই গোনা সময়।
    /// ফেরত: ধনাত্মক মানে এগিয়ে, ঋণাত্মক মানে পিছিয়ে।
    ///
    /// লক্ষ্য ০ বা ঋণাত্মক হলে <c>null</c> — "লক্ষ্য নেই" অবস্থায় এগিয়ে বা
    /// পিছিয়ে থাকার কোনো মানে হয় না, আর ০ দেখালে সেটা "ঠিক লক্ষ্যে" পড়া হতো।
    /// </summary>
    public static TimeSpan? Estimate(TimeSpan worked, double targetHours, DateTimeOffset now)
    {
        if (targetHours <= 0 || double.IsNaN(targetHours) || double.IsInfinity(targetHours))
            return null;

        var today = DhakaTime.WorkDateOf(now);

        var total = WorkdaysInMonth(today.Year, today.Month);
        if (total <= 0) return null;

        var elapsed = WorkdaysElapsed(today);

        var expected = TimeSpan.FromHours(targetHours * elapsed / total);
        return worked - expected;
    }

    /// <summary>ওই মাসে মোট কত কর্মদিবস (সাপ্তাহিক ছুটি বাদে)।</summary>
    public static int WorkdaysInMonth(int year, int month)
    {
        var days = DateTime.DaysInMonth(year, month);
        var count = 0;

        for (var day = 1; day <= days; day++)
        {
            if (new DateOnly(year, month, day).DayOfWeek != WeeklyOff) count++;
        }

        return count;
    }

    /// <summary>
    /// মাসের ১ তারিখ থেকে <paramref name="today"/> <b>সহ</b> কত কর্মদিবস গেছে।
    ///
    /// ⚠️ আজকের দিনটা গোনা হয়, অথচ দিনটা এখনো শেষ হয়নি — অর্থাৎ সকাল ন-টায়
    /// সবাই একদিন "পিছিয়ে" দেখাবে। এটা ইচ্ছাকৃত: সন্ধ্যায় লক্ষ্য পূরণ হলে
    /// সংখ্যাটা শূন্যে ফেরে, তাই মাসের শেষ কর্মদিবসে expected ঠিক টার্গেটেই
    /// গিয়ে ঠেকে (07 § ২.১-খ)। আজকের দিন বাদ দিলে উল্টোটা হতো — মাস শেষেও
    /// একদিনের কাজ "বাড়তি" দেখাত, অর্থাৎ ভুয়া "এগিয়ে"।
    /// </summary>
    public static int WorkdaysElapsed(DateOnly today)
    {
        var count = 0;

        for (var day = 1; day <= today.Day; day++)
        {
            if (new DateOnly(today.Year, today.Month, day).DayOfWeek != WeeklyOff) count++;
        }

        return count;
    }

    /// <summary>জানালার নিচের লাইনে গতি নিয়ে কী লেখা হবে।</summary>
    internal enum PaceView
    {
        /// <summary>⭐ G111 — সার্ভার বলেছে একটাও শেষ-হওয়া কর্মদিবস দেখা হয়নি।</summary>
        NotObserved,

        /// <summary>সার্ভারের পাঠানো সংখ্যা — ড্যাশবোর্ডের সংখ্যাটাই।</summary>
        Server,

        /// <summary>আমাদের নিজের আন্দাজ; লেবেলে "(estimated)" থাকতেই হবে।</summary>
        Estimated,

        /// <summary>লক্ষ্যই নেই — গতির কোনো মানে হয় না, লাইনটা বাদ।</summary>
        None,
    }

    /// <summary>
    /// ⭐⭐ <b>কোন কথাটা লেখা হবে — আর কোন ক্রমে সিদ্ধান্ত নেওয়া হবে।</b>
    ///
    /// ⚠️⚠️ <b>ক্রমটাই এখানে আসল জিনিস, আর সেজন্যই এটা খাঁটি ফাংশন।</b>
    /// <see cref="PaceView.NotObserved"/> সবার আগে দেখতে হয়। পরে দেখলে
    /// <see cref="Estimate"/> আগেই চলে যেত, আর ওই আন্দাজ মাসের ১ তারিখ থেকে
    /// গোনে — অর্থাৎ ঠিক সেই না-দেখা দিনগুলোকেই ঘাটতি বলে দেখাত, যেগুলোর
    /// জন্য সার্ভার ইচ্ছাকৃতভাবে কোনো দাবি করেনি। একটা ভুল আশ্বাস
    /// ("0:00 ahead") সারাতে গিয়ে উল্টো দিকের একটা ভুল অভিযোগ।
    ///
    /// ⚠️ এটা <see cref="TodayForm"/>-এর ভেতরে <c>if</c>-এর সিঁড়ি হয়ে থাকতে
    /// পারত, কিন্তু তাহলে ক্রমটার উপর <b>একটাও assertion</b> থাকত না —
    /// WinForms-এর আঁকা কোড টেস্ট থেকে ছোঁয়া যায় না।
    /// </summary>
    /// <param name="paceObserved">
    /// <see cref="oXeio.Core.Agent.AgentStatus.PaceObserved"/> — সার্ভার
    /// না বললে <c>true</c>, অর্থাৎ পুরোনো সার্ভারে আচরণ অবিকল আগের মতো।
    /// </param>
    /// <param name="serverPace">সার্ভারের সংখ্যা, না পাঠালে <c>null</c>।</param>
    /// <param name="estimate">আমাদের আন্দাজ (<see cref="Estimate"/>), না হলে <c>null</c>।</param>
    internal static PaceView ViewFor(
        bool paceObserved,
        TimeSpan? serverPace,
        TimeSpan? estimate)
    {
        // ⚠️⚠️ এই শাখাটা সরিয়ে নিচে বসালে G111 নীরবে ফিরে আসে
        if (!paceObserved) return PaceView.NotObserved;

        if (serverPace is not null) return PaceView.Server;
        if (estimate is not null) return PaceView.Estimated;

        return PaceView.None;
    }
}
