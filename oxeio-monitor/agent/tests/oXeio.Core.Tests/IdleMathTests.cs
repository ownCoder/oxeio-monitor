using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// এই বিয়োগটাই ঘণ্টার হিসাবের ভিত্তি — এখানে ভুল হলে কারো সারাদিনের কাজ মুছে যেতে পারে।
/// </summary>
public class IdleMathTests
{
    [Fact]
    public void সাধারণ_ক্ষেত্রে_পার্থক্যই_ফল()
    {
        Assert.Equal(
            TimeSpan.FromSeconds(75),
            IdleMath.Elapsed(nowTicks32: 100_000, lastInputTicks32: 25_000));
    }

    [Fact]
    public void এইমাত্র_ইনপুট_হলে_শূন্য()
    {
        Assert.Equal(TimeSpan.Zero, IdleMath.Elapsed(500_000, 500_000));
    }

    /// <summary>
    /// GetTickCount ৪৯.৭ দিনে উল্টে যায়। modular বিয়োগ নিজে থেকেই ঠিক উত্তর দেয় —
    /// আলাদা কোনো শর্ত লাগে না।
    /// </summary>
    [Fact]
    public void ঘড়ি_উল্টে_গেলেও_হিসাব_ঠিক_থাকে()
    {
        // শেষ ইনপুট wrap-এর ৫ সেকেন্ড আগে, এখন wrap-এর ৩ সেকেন্ড পরে
        uint lastInput = uint.MaxValue - 5_000 + 1;
        uint now = 3_000;

        var elapsed = IdleMath.Elapsed(now, lastInput, out var clamped);

        Assert.Equal(TimeSpan.FromSeconds(8), elapsed);
        Assert.False(clamped);
    }

    /// <summary>
    /// Microsoft বলে dwTime "not guaranteed to be incremental"। মাত্র ৫ সেকেন্ড
    /// এগিয়ে থাকলে সরল বিয়োগ ৪৯.৭ দিন দিত — আর ওই স্টাফ সারাদিন "নিষ্ক্রিয়" দেখাত।
    /// </summary>
    [Fact]
    public void ভবিষ্যতের_টাইমস্ট্যাম্প_শূন্যে_আটকে_যায়()
    {
        uint now = 1_000_000;
        uint lastInput = now + 5_000; // ৫ সেকেন্ড এগিয়ে

        var elapsed = IdleMath.Elapsed(now, lastInput, out var clamped);

        Assert.True(clamped);
        Assert.Equal(TimeSpan.Zero, elapsed);
    }

    [Fact]
    public void ক্ল্যাম্প_না_থাকলে_কত_বড়_ভুল_হতো()
    {
        uint now = 1_000_000;
        uint lastInput = now + 5_000;

        // ক্ল্যাম্প ছাড়া কাঁচা ফল কত হতো তা দেখিয়ে রাখা — যেন কেউ ভবিষ্যতে
        // "এই শর্তটা তো অপ্রয়োজনীয়" ভেবে মুছে না ফেলে
        var raw = unchecked(now - lastInput);
        Assert.True(TimeSpan.FromMilliseconds(raw).TotalDays > 49);
    }

    [Theory]
    [InlineData(0u)]
    [InlineData(1u)]
    [InlineData(uint.MaxValue)]
    [InlineData(IdleMath.FutureGuard)]
    public void কোনো_ইনপুটেই_ঋণাত্মক_সময়_আসে_না(uint lastInput)
    {
        var elapsed = IdleMath.Elapsed(12_345, lastInput);
        Assert.True(elapsed >= TimeSpan.Zero);
    }
}
