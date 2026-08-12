using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// A05 — কিউয়ের ডিস্ক-বাজেট কখন প্রয়োগ হবে।
///
/// ⚠️⚠️ নিয়মটা `EnforceBudgetAsync`-এর ডকে **লেখাই ছিল** ("স্টার্টআপে
/// একবার, তারপর ঘণ্টায় একবার আর LastWriteError দেখা দিলেই"), কিন্তু
/// কলারটা কোনোদিন লেখা হয়নি — গোটা বাজেট-ব্যবস্থা তৈরি হয়ে অচল পড়ে ছিল।
/// এই টেস্টগুলো সেই নিয়মটার পাহারা।
/// </summary>
public class OutboxSweepTests
{
    private static readonly DateTimeOffset Now =
        new(2026, 8, 12, 12, 0, 0, TimeSpan.Zero);

    private static readonly TimeSpan Hourly = TimeSpan.FromHours(1);

    [Fact]
    public void প্রথমবার_স্টার্টআপ() =>
        Assert.Equal(
            OutboxSweep.Reason.Startup,
            OutboxSweep.Check(DateTimeOffset.MinValue, Now, Hourly, hasWriteError: false));

    [Fact]
    public void সদ্য_চললে_আবার_চলে_না() =>
        Assert.Equal(
            OutboxSweep.Reason.No,
            OutboxSweep.Check(Now.AddMinutes(-20), Now, Hourly, hasWriteError: false));

    [Fact]
    public void ঘণ্টা_পেরোলে_চলে() =>
        Assert.Equal(
            OutboxSweep.Reason.Due,
            OutboxSweep.Check(Now.AddMinutes(-61), Now, Hourly, hasWriteError: false));

    /// <summary>
    /// ⚠️ ঠিক এক ঘণ্টার মাথাতেও চলা চাই। `>` লিখলে ঝাড়ুটা প্রতিবার এক টিক
    /// পিছিয়ে যেত, আর দিন শেষে কয়েকবার কম চলত।
    /// </summary>
    [Fact]
    public void ঠিক_এক_ঘণ্টার_মাথায়ও_চলে() =>
        Assert.Equal(
            OutboxSweep.Reason.Due,
            OutboxSweep.Check(Now.AddHours(-1), Now, Hourly, hasWriteError: false));

    /// <summary>
    /// ⭐ লেখা ব্যর্থ মানে ডিস্ক ভরে গেছে — ঠিক তখনই জায়গা দরকার।
    /// ঘণ্টার অপেক্ষায় থাকলে মাঝের সময়টুকুর ডেটা নীরবে হারাত।
    /// </summary>
    [Fact]
    public void লেখা_ব্যর্থ_হলে_অপেক্ষা_নেই() =>
        Assert.Equal(
            OutboxSweep.Reason.WriteFailed,
            OutboxSweep.Check(Now.AddSeconds(-5), Now, Hourly, hasWriteError: true));

    [Fact]
    public void লেখার_ব্যর্থতা_স্টার্টআপের_চেয়েও_আগে() =>
        Assert.Equal(
            OutboxSweep.Reason.WriteFailed,
            OutboxSweep.Check(DateTimeOffset.MinValue, Now, Hourly, hasWriteError: true));
}
