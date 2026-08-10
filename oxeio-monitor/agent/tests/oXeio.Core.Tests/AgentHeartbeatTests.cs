using oXeio.Core.Watchdog;

namespace oXeio.Core.Tests;

public class AgentHeartbeatTests
{
    private static AgentHeartbeat Sample(long unbiasedMs = 5_000) => new()
    {
        Version = AgentLiveness.CurrentVersion,
        ProcessId = 4242,
        SessionId = 1,
        UnbiasedMs = unbiasedMs,
        WrittenAtUtc = new DateTimeOffset(2026, 8, 10, 9, 14, 3, TimeSpan.Zero),
    };

    // ── লেখা ↔ পড়া ──────────────────────────────────────────────────────────

    [Fact]
    public void লেখা_আর_পড়া_একই_মান_ফেরায়()
    {
        var written = Sample();

        var read = AgentLiveness.TryParse(AgentLiveness.Format(written));

        Assert.NotNull(read);
        Assert.Equal(written.Version, read.Version);
        Assert.Equal(written.ProcessId, read.ProcessId);
        Assert.Equal(written.SessionId, read.SessionId);
        Assert.Equal(written.UnbiasedMs, read.UnbiasedMs);
        Assert.Equal(written.WrittenAtUtc, read.WrittenAtUtc);
    }

    /// <summary>
    /// এক লাইনে পুরোটা — এজেন্ট temp ফাইলে লিখে rename করে, তাই লাইনটা
    /// ছোট আর একবারে লেখা হওয়া দরকার।
    /// </summary>
    [Fact]
    public void এক_লাইনেই_লেখা_হয়()
    {
        var text = AgentLiveness.Format(Sample());

        Assert.DoesNotContain('\n', text);
        Assert.DoesNotContain('\r', text);
    }

    // ── ভাঙা ইনপুট ──────────────────────────────────────────────────────────

    /// <summary>
    /// অর্ধেক লেখা ফাইল (এজেন্ট লেখার মাঝপথে মরেছে) যেন "০ ms বয়সী হার্টবিট"
    /// হিসেবে না পড়া হয় — তাহলে মৃত এজেন্টকে চিরকাল সুস্থ ভাবা হতো।
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("v=1 pid=4242")]                       // unbiased নেই
    [InlineData("pid=4242 unbiased=5000")]             // v নেই
    [InlineData("v=1 pid=0 unbiased=5000")]            // pid অসম্ভব
    [InlineData("v=1 pid=-3 unbiased=5000")]
    [InlineData("v=1 pid=4242 unbiased=-1")]
    [InlineData("v=1 pid=abc unbiased=5000")]
    [InlineData("এলোমেলো লেখা")]
    [InlineData("=====")]
    public void ভাঙা_লাইনে_null_ফেরে(string? line)
    {
        Assert.Null(AgentLiveness.TryParse(line));
    }

    /// <summary>
    /// ⚠️ এজেন্ট আপডেট হয়ে নতুন ক্ষেত্র যোগ করলে পুরোনো watchdog যেন parse-এ
    /// ব্যর্থ হয়ে গোটা বহরকে রিস্টার্ট-লুপে না ফেলে। আপডেটের মুহূর্তটাই
    /// সবচেয়ে নাজুক।
    /// </summary>
    [Fact]
    public void অচেনা_ক্ষেত্র_উপেক্ষা_করা_হয়()
    {
        var read = AgentLiveness.TryParse(
            "v=2 pid=4242 session=1 unbiased=5000 queue=17 build=deadbeef utc=2026-08-10T09:14:03.0000000Z");

        Assert.NotNull(read);
        Assert.Equal(2, read.Version);
        Assert.Equal(5_000, read.UnbiasedMs);
    }

    [Fact]
    public void ঐচ্ছিক_ক্ষেত্র_না_থাকলেও_পড়া_যায়()
    {
        var read = AgentLiveness.TryParse("v=1 pid=4242 unbiased=5000");

        Assert.NotNull(read);
        Assert.Equal(0u, read.SessionId);
        Assert.Equal(DateTimeOffset.MinValue, read.WrittenAtUtc);
    }

    // ── বয়স ─────────────────────────────────────────────────────────────────

    [Fact]
    public void বয়স_unbiased_ঘড়ির_বিয়োগ()
    {
        var age = AgentLiveness.Age(Sample(unbiasedMs: 5_000), nowUnbiasedMs: 12_000);

        Assert.Equal(TimeSpan.FromSeconds(7), age);
    }

    /// <summary>
    /// রিবুটের পর হার্টবিট ফাইলটা ডিস্কে থেকে যায় কিন্তু unbiased কাউন্টার শূন্য
    /// থেকে শুরু হয় — তখন ফাইলের মান "ভবিষ্যতে"। ওটাকে তাজা ধরলে watchdog
    /// মৃত এজেন্টকে সুস্থ ভেবে কোনোদিন চালু করত না, অর্থাৎ রিবুটের পর কারো
    /// সময় গোনাই হতো না।
    /// </summary>
    [Fact]
    public void আগের_বুটের_হার্টবিটের_বয়স_দেওয়া_হয়_না()
    {
        Assert.Null(AgentLiveness.Age(Sample(unbiasedMs: 900_000), nowUnbiasedMs: 4_000));
    }

    [Fact]
    public void একই_মুহূর্তে_বয়স_শূন্য()
    {
        Assert.Equal(TimeSpan.Zero, AgentLiveness.Age(Sample(unbiasedMs: 5_000), 5_000));
    }

    /// <summary>
    /// ⚠️ ব্যবধানের ঠিক দ্বিগুণ-তিনগুণ রাখলে AV স্ক্যান বা একটা লম্বা GC pause-এ
    /// সুস্থ এজেন্ট মারা পড়ত। ৮ গুণ ব্যবধান ইচ্ছাকৃত।
    /// </summary>
    [Fact]
    public void বাসি_হওয়ার_সীমা_ব্যবধানের_অনেক_গুণ()
    {
        Assert.True(AgentLiveness.StaleAfter >= AgentLiveness.HeartbeatInterval * 6);
    }
}
