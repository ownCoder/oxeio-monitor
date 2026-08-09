using oXeio.Core.Time;

namespace oXeio.Core.Tests;

/// <summary>
/// সার্ভারের <c>dhaka-time.ts</c>-এর সাথে হুবহু একই ফল দিতে হবে —
/// নইলে এজেন্ট আর সার্ভার আলাদা <c>work_date</c> বের করবে।
/// </summary>
public class DhakaTimeTests
{
    [Fact]
    public void রাত_এগারোটা_পঞ্চাশ_আগের_দিনেই_পড়ে()
    {
        var t = new DateTimeOffset(2026, 8, 8, 17, 50, 0, TimeSpan.Zero); // ঢাকায় ২৩:৫০
        Assert.Equal(new DateOnly(2026, 8, 8), DhakaTime.WorkDateOf(t));
    }

    [Fact]
    public void মধ্যরাতের_পর_নতুন_দিন()
    {
        var t = new DateTimeOffset(2026, 8, 8, 18, 0, 0, TimeSpan.Zero); // ঢাকায় ০০:০০
        Assert.Equal(new DateOnly(2026, 8, 9), DhakaTime.WorkDateOf(t));
    }

    [Fact]
    public void পরের_মধ্যরাত_ঠিক_জায়গায়()
    {
        var t = new DateTimeOffset(2026, 8, 8, 17, 50, 0, TimeSpan.Zero);
        Assert.Equal(
            new DateTimeOffset(2026, 8, 8, 18, 0, 0, TimeSpan.Zero),
            DhakaTime.NextLocalMidnight(t));
    }

    [Fact]
    public void ঠিক_মধ্যরাতে_দাঁড়ালে_পরেরটা_চব্বিশ_ঘণ্টা_পরে()
    {
        var midnight = new DateTimeOffset(2026, 8, 8, 18, 0, 0, TimeSpan.Zero);
        Assert.Equal(midnight.AddDays(1), DhakaTime.NextLocalMidnight(midnight));
    }

    [Fact]
    public void স্থানীয়_ঘড়ির_সময়_ঠিক_আসে()
    {
        var t = new DateTimeOffset(2026, 8, 9, 1, 0, 0, TimeSpan.Zero); // ঢাকায় ০৭:০০
        Assert.Equal(new TimeOnly(7, 0), DhakaTime.LocalTimeOf(t));
    }
}
