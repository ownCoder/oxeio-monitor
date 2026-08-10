using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

public class BatchNarrowingTests
{
    [Fact]
    public void শুরুতে_পুরো_মাপেই_চেষ্টা_হয়()
    {
        Assert.Equal(500, new BatchNarrowing(500).Current);
    }

    [Fact]
    public void সাময়িক_ব্যর্থতায়_মাপ_বদলায়_না()
    {
        // নেটওয়ার্ক গেলে ব্যাচের কোনো দোষ নেই — ছোট করলে লিংক ফেরার পর
        // নিষ্কাশন অকারণে ধীর হতো
        var n = new BatchNarrowing(500);

        n.OnTransient();
        n.OnTransient();

        Assert.Equal(500, n.Current);
    }

    [Fact]
    public void Permanent_পেলে_ব্যাচ_অর্ধেক_হয়()
    {
        var n = new BatchNarrowing(500);

        n.OnPermanent();
        Assert.Equal(250, n.Current);

        n.OnPermanent();
        Assert.Equal(125, n.Current);
    }

    [Fact]
    public void বারবার_অর্ধেক_হয়ে_শেষে_একটায়_নামে()
    {
        var n = new BatchNarrowing(500);
        var steps = 0;

        while (!n.IsIsolated)
        {
            n.OnPermanent();
            steps++;
            Assert.True(steps < 20, "কোথাও আটকে গেছে — অর্ধেক হচ্ছে না");
        }

        Assert.Equal(1, n.Current);

        // ৫০০ → ২৫০ → ১২৫ → ৬২ → ৩১ → ১৫ → ৭ → ৩ → ১ — মোট ৮ ধাপ।
        // সংখ্যাটা এখানে লেখা আছে যাতে কেউ ভাগের নিয়ম বদলালে টেস্ট ধরে ফেলে।
        Assert.Equal(8, steps);
    }

    [Fact]
    public void একটায়_নামার_পর_আর_ছোট_হয়_না()
    {
        var n = new BatchNarrowing(1);

        n.OnPermanent();

        Assert.Equal(1, n.Current);
        Assert.True(n.IsIsolated);
    }

    [Fact]
    public void সফল_হলে_পুরো_মাপে_ফেরে()
    {
        var n = new BatchNarrowing(500);
        n.OnPermanent();
        n.OnPermanent();

        n.OnSuccess();

        Assert.Equal(500, n.Current);
    }

    /// <summary>
    /// এটা না থাকলে একটা বেঠিক রেকর্ডের পর সারা জীবন একটা-একটা করে পাঠানো হতো।
    /// ৫০,০০০ সারির ব্যাকলগ তখন প্রতি মিনিটে ৫৫টার সীমায় আটকে ১৫ ঘণ্টার বেশি নিত।
    /// </summary>
    [Fact]
    public void খারাপ_রেকর্ড_ফেলার_পর_পুরো_মাপে_ফেরে()
    {
        var n = new BatchNarrowing(500);
        while (!n.IsIsolated) n.OnPermanent();

        n.OnIsolatedDropped();

        Assert.Equal(500, n.Current);
        Assert.False(n.IsIsolated);
    }

    [Theory]
    [InlineData(0, 1)]
    [InlineData(-5, 1)]
    [InlineData(1000, 500)] // সার্ভারের সীমার বেশি চাওয়া যায় না
    public void অসম্ভব_মাপ_সীমার_মধ্যে_আটকায়(int given, int expected)
    {
        Assert.Equal(expected, new BatchNarrowing(given).Current);
    }
}
