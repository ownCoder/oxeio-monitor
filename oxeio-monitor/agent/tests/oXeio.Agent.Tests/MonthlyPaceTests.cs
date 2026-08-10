using oXeio.Agent.Ui;

namespace oXeio.Agent.Tests;

/// <summary>
/// J04-এর "এগিয়ে না পিছিয়ে"।
///
/// ⚠️ সংখ্যাটা আনুমানিক (ছুটির তালিকা এজেন্ট জানে না), কিন্তু <b>দিকটা</b>
/// কখনো ভুল হতে পারবে না। একজন পিছিয়ে থাকলে "এগিয়ে" দেখানো এই জানালার
/// পুরো উদ্দেশ্যটাই উল্টে দিত।
/// </summary>
public class MonthlyPaceTests
{
    /// <summary>ঢাকার সময়ে একটা মুহূর্ত।</summary>
    private static DateTimeOffset Dhaka(int year, int month, int day, int hour = 12) =>
        new(year, month, day, hour, 0, 0, TimeSpan.FromHours(6));

    // ── কর্মদিবস গোনা ───────────────────────────────────────────────────────

    /// <summary>আগস্ট ২০২৬-এ ৩১ দিন, তার মধ্যে ৪টা শুক্রবার (৭, ১৪, ২১, ২৮)।</summary>
    [Fact]
    public void মাসের_কর্মদিবস_শুক্রবার_বাদে() =>
        Assert.Equal(31 - 4, MonthlyPace.WorkdaysInMonth(2026, 8));

    /// <summary>ফেব্রুয়ারি ২০২৮ লিপ বছর — ২৯ দিন, ৪টা শুক্রবার (৪, ১১, ১৮, ২৫)।</summary>
    [Fact]
    public void লিপ_বছরের_ফেব্রুয়ারিও_ঠিক_গোনা_হয() =>
        Assert.Equal(29 - 4, MonthlyPace.WorkdaysInMonth(2028, 2));

    /// <summary>
    /// ⚠️ আজকের দিনটাও গোনা হয়। না গুনলে মাসের শেষ কর্মদিবসেও expected
    /// টার্গেটের এক দিন কম থাকত, অর্থাৎ প্রায় সবাই ভুয়া "এগিয়ে" দেখাত।
    /// </summary>
    [Fact]
    public void আজকের_দিনও_গোনা_হয()
    {
        // ২০২৬-০৮-০৩ সোমবার; ১,২,৩ কেউ শুক্রবার নয়
        Assert.Equal(3, MonthlyPace.WorkdaysElapsed(new DateOnly(2026, 8, 3)));

        // ৭ তারিখ শুক্রবার — সেটা বাদ
        Assert.Equal(6, MonthlyPace.WorkdaysElapsed(new DateOnly(2026, 8, 7)));
    }

    // ── গতি ─────────────────────────────────────────────────────────────────

    /// <summary>
    /// ⭐ মাসের শেষ দিনে expected ঠিক টার্গেটেই গিয়ে ঠেকে (07 § ২.১-খ)।
    /// এটাই সূত্রটার একমাত্র শক্ত অ্যাংকর — এটা ভাঙলে মাস শেষে সবাই
    /// এগিয়ে বা পিছিয়ে দেখাত, কারণ যা-ই হোক না কেন।
    /// </summary>
    [Fact]
    public void মাসের_শেষে_লক্ষ্য_ছুঁলে_গতি_শূন্য()
    {
        var pace = MonthlyPace.Estimate(
            TimeSpan.FromHours(208), 208, Dhaka(2026, 8, 31));

        Assert.NotNull(pace);
        Assert.Equal(0, pace!.Value.TotalHours, precision: 6);
    }

    [Fact]
    public void বেশি_কাজ_করলে_এগিয়ে()
    {
        var pace = MonthlyPace.Estimate(TimeSpan.FromHours(208), 208, Dhaka(2026, 8, 20));

        Assert.NotNull(pace);
        Assert.True(pace!.Value > TimeSpan.Zero);
    }

    [Fact]
    public void কম_কাজ_করলে_পিছিয়ে()
    {
        var pace = MonthlyPace.Estimate(TimeSpan.FromHours(10), 208, Dhaka(2026, 8, 20));

        Assert.NotNull(pace);
        Assert.True(pace!.Value < TimeSpan.Zero);
    }

    /// <summary>
    /// ঢাকার ক্যালেন্ডার, UTC-র নয়। ১ তারিখ ভোর ৩টা (ঢাকা) মানে UTC-তে তখনো
    /// আগের মাসের ৩১ তারিখ রাত ৯টা — UTC ধরলে হিসাবটা আগের মাসের শেষ দিনের
    /// হয়ে যেত, অর্থাৎ নতুন মাসের প্রথম সকালেই "২০৮ ঘণ্টা পিছিয়ে"।
    /// </summary>
    [Fact]
    public void মাস_ঢাকার_ক্যালেন্ডারে_গোনা_হয()
    {
        var firstMorning = Dhaka(2026, 9, 1, hour: 3);

        var pace = MonthlyPace.Estimate(TimeSpan.Zero, 208, firstMorning);

        Assert.NotNull(pace);

        // সেপ্টেম্বরের ১ তারিখ = ১টা কর্মদিবস অতিবাহিত, ২৬টার মধ্যে →
        // expected ≈ ৮ ঘণ্টা। আগের মাসের হিসাব হলে ২০৮ ঘণ্টা পিছিয়ে দেখাত।
        Assert.InRange(-pace!.Value.TotalHours, 1, 20);
    }

    /// <summary>
    /// ⚠️ লক্ষ্য ০ হলে <c>null</c>, ০ নয়। ০ ফেরালে জানালায় "০ ঘণ্টা এগিয়ে"
    /// লেখা উঠত — অর্থাৎ লক্ষ্যহীন অবস্থাটা নিখুঁত অবস্থা হয়ে যেত।
    /// </summary>
    [Theory]
    [InlineData(0d)]
    [InlineData(-5d)]
    [InlineData(double.NaN)]
    public void লক্ষ্য_না_থাকলে_গতিও_নেই(double target) =>
        Assert.Null(MonthlyPace.Estimate(TimeSpan.FromHours(10), target, Dhaka(2026, 8, 10)));
}
