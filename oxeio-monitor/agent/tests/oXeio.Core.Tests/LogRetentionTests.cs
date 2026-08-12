using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// H08 — লগ ফাইলের ৭ দিন / ৫০ MB সীমা।
///
/// ⚠️ এখানকার প্রতিটা টেস্ট একটাই প্রশ্নের পাহারা: <b>কোন ফাইলটা মুছে
/// ফেলা হবে</b>। এই একটা জায়গাতেই ভুল হলে ডেটা ফেরত আসে না — আর
/// সমস্যাটা কেউ টের পায় সেদিন, যেদিন কোনো একটা PC-র গোলমাল খুঁজতে গিয়ে
/// দেখা যায় লগে কিছুই নেই।
/// </summary>
public class LogRetentionTests
{
    private static readonly DateOnly Today = new(2026, 8, 12);

    private static LogRetention.LogFile File(int daysAgo, long bytes = 1024) =>
        new($"agent-{Today.AddDays(-daysAgo):yyyy-MM-dd}.log", Today.AddDays(-daysAgo), bytes);

    private static IReadOnlyList<string> Plan(
        IEnumerable<LogRetention.LogFile> files,
        long activeBytes = 0,
        long maxBytes = LogRetention.DefaultMaxBytes) =>
        LogRetention.Plan(files, activeBytes, Today, maxBytes: maxBytes)
            .Select(f => f.Path)
            .ToList();

    [Fact]
    public void কিছু_না_থাকলে_কিছুই_মোছে_না() =>
        Assert.Empty(Plan([]));

    [Fact]
    public void ছয়_দিনের_পুরোনো_থাকে() =>
        Assert.Empty(Plan([File(1), File(3), File(6)]));

    /// <summary>
    /// ⚠️ সীমানাটা এখানেই: keepDays = ৭ মানে আজ + আগের ৬ দিন। সাত দিন
    /// আগেরটা সপ্তম, তাই যায়। `&lt;` না লিখে `&lt;=` লিখলে আট দিন থাকত।
    /// </summary>
    [Fact]
    public void সাত_দিনের_পুরোনো_যায়()
    {
        var doomed = Plan([File(6), File(7), File(30)]);

        Assert.Equal(2, doomed.Count);
        Assert.Contains("agent-2026-08-05.log", doomed);  // ৭ দিন আগে
        Assert.Contains("agent-2026-07-13.log", doomed);  // ৩০ দিন আগে
    }

    /// <summary>
    /// ⚠️ ঘড়ি পিছিয়ে গেলে (NTP সংশোধন, BIOS-এর ব্যাটারি) ভবিষ্যতের
    /// তারিখওয়ালা ফাইল থেকে যেতে পারে। মুছে দিলে ঘড়ির একটা ভুলে আজকের
    /// লগই হারাত — অথচ ঠিক তখনই লগটা সবচেয়ে বেশি দরকার।
    /// </summary>
    [Fact]
    public void ভবিষ্যতের_তারিখ_রেখে_দেওয়া_হয() =>
        Assert.Empty(Plan([new LogRetention.LogFile("tomorrow.log", Today.AddDays(1), 10)]));

    [Fact]
    public void বাজেট_ছাড়ালে_পুরোনোটা_আগে_যায়()
    {
        // তিনটে ফাইল × ৪০ বাইট = ১২০, বাজেট ১০০ → একটা মুছলেই হয়
        var doomed = Plan(
            [File(1, 40), File(2, 40), File(3, 40)],
            maxBytes: 100);

        Assert.Single(doomed);
        // ⭐ সবচেয়ে পুরোনোটা — নতুন লগ বেশি কাজে লাগে
        Assert.Equal("agent-2026-08-09.log", doomed[0]);
    }

    /// <summary>
    /// ⭐ চলতি ফাইলটা বাজেটে **গোনা হয়**, যদিও সে নিজে কখনো মোছার
    /// তালিকায় আসে না। না গুনলে আজকের ৪৯ MB-র লগের পাশে আরও ৫০ MB
    /// আর্কাইভ থেকে যেত — অর্থাৎ সীমাটা কার্যত দ্বিগুণ হয়ে যেত।
    /// </summary>
    [Fact]
    public void চলতি_ফাইলটাও_বাজেটে_ধরা_হয়()
    {
        var doomed = Plan([File(1, 40)], activeBytes: 80, maxBytes: 100);

        Assert.Single(doomed);
    }

    /// <summary>
    /// ⚠️ চলতি ফাইলটা একাই বাজেট ছাড়িয়ে গেলে আর কিছু করার নেই — সব
    /// আর্কাইভ যায়, কিন্তু আজকেরটা থাকে। বাজেট রাখতে গিয়ে ওটা মুছলে ঠিক
    /// সেই তথ্যটাই হারাত যেটার জন্য লগ রাখা।
    /// </summary>
    [Fact]
    public void চলতি_ফাইল_একাই_বড়_হলে_সব_আর্কাইভ_যায়()
    {
        var doomed = Plan([File(1, 10), File(2, 10)], activeBytes: 500, maxBytes: 100);

        Assert.Equal(2, doomed.Count);
    }

    /// <summary>একই ফাইল দুই ধাপে দুবার তালিকায় এলে কলার দুবার Delete ডাকত।</summary>
    [Fact]
    public void পুরোনো_আর_বড়_দুটো_শর্তেই_পড়লে_একবারই_আসে()
    {
        var doomed = Plan([File(30, 400)], maxBytes: 100);

        Assert.Single(doomed);
    }
}
