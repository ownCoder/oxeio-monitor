using oXeio.Agent.Ui;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Tests;

/// <summary>
/// J03 — মাসের লক্ষ্য পূরণের বেলুন।
///
/// ⭐ এখানকার একমাত্র সত্যিকারের ঝুঁকি হলো <b>বারবার দেখানো</b>। প্রতি
/// heartbeat-এ বেলুন উঠলে স্টাফ Windows-এর সেটিংস থেকে oXeio-র নোটিফিকেশন
/// চিরতরে বন্ধ করে দিত — আর তখন সিঙ্ক ব্যর্থ বা ডিভাইস revoke হওয়ার বার্তাও
/// আর কোনোদিন পৌঁছাত না। তাই টেস্টের ভার এদিকেই।
/// </summary>
public class MonthlyMilestoneTests
{
    private static readonly DateTimeOffset August =
        new(2026, 8, 20, 12, 0, 0, TimeSpan.FromHours(6));

    private static AgentStatus Status(
        double monthHours, double target = 208, bool known = true) => new()
    {
        State = SegmentState.Active,
        ActiveToday = TimeSpan.FromHours(6),
        ActiveThisMonth = TimeSpan.FromHours(monthHours),
        MonthlyTargetHours = target,
        MonthlyKnown = known,
        QueueDepth = 0,
        Health = SyncHealth.Ok,
        Paused = false,
    };

    [Fact]
    public void লক্ষ্য_ছুঁলে_একবার_দেখানো_হয()
    {
        Assert.True(MonthlyMilestone.ShouldCelebrate(Status(208), August, null, out var key));
        Assert.Equal("2026-08", key);
    }

    /// <summary>⭐ এই টেস্টটাই ফিচারটার একমাত্র শক্ত প্রতিশ্রুতি।</summary>
    [Fact]
    public void একই_মাসে_দ্বিতীয়বার_নয() =>
        Assert.False(MonthlyMilestone.ShouldCelebrate(Status(300), August, "2026-08", out _));

    [Fact]
    public void পরের_মাসে_আবার_দেখানো_হয()
    {
        var september = new DateTimeOffset(2026, 9, 15, 12, 0, 0, TimeSpan.FromHours(6));

        Assert.True(MonthlyMilestone.ShouldCelebrate(Status(210), september, "2026-08", out var key));
        Assert.Equal("2026-09", key);
    }

    [Fact]
    public void লক্ষ্যের_আগে_কিছুই_নয() =>
        Assert.False(MonthlyMilestone.ShouldCelebrate(Status(207.9), August, null, out _));

    /// <summary>
    /// ⚠️ সার্ভার একবারও অগ্রগতি না বললে মাসের হিসাব শূন্য
    /// (<see cref="AgentStatus.Starting"/>)। ওই অবস্থায় বেলুন উঠলে চালু
    /// হওয়ার প্রতিটা মুহূর্তে একটা ভুয়া অভিনন্দন যেত।
    /// </summary>
    [Fact]
    public void শুরুর_অবস্থায়_বেলুন_নয() =>
        Assert.False(MonthlyMilestone.ShouldCelebrate(AgentStatus.Starting, August, null, out _));

    /// <summary>
    /// ⚠️ সংখ্যাটা সার্ভার থেকে না এলে অভিনন্দনও নয় — এমনকি ঘরটায় বড় মান
    /// বসে থাকলেও। "জানি না" কখনো "লক্ষ্য পূর্ণ" হতে পারবে না।
    /// </summary>
    [Fact]
    public void সার্ভার_না_বললে_বেলুন_নয() =>
        Assert.False(MonthlyMilestone.ShouldCelebrate(
            Status(250, known: false), August, null, out _));

    /// <summary>টার্গেট ০ হলে "পূর্ণ হয়েছে" বলার কিছু নেই — নইলে শূন্য ঘণ্টাতেই অভিনন্দন যেত।</summary>
    [Fact]
    public void টার্গেট_শূন্য_হলে_বেলুন_নয() =>
        Assert.False(MonthlyMilestone.ShouldCelebrate(Status(0, target: 0), August, null, out _));

    /// <summary>
    /// ঢাকার মাস, UTC-র নয়। ১ সেপ্টেম্বর রাত ২টা (ঢাকা) = ৩১ আগস্ট রাত ৮টা UTC;
    /// UTC ধরলে সেপ্টেম্বরের বেলুনটা আগস্টের নামে জমা পড়ত আর সেপ্টেম্বরে
    /// আবার দেখানো হতো।
    /// </summary>
    [Fact]
    public void মাসের_চাবি_ঢাকার_ক্যালেন্ডারে()
    {
        var justAfterMidnight = new DateTimeOffset(2026, 9, 1, 2, 0, 0, TimeSpan.FromHours(6));

        Assert.Equal("2026-09", MonthlyMilestone.MonthKeyOf(justAfterMidnight));
    }

    /// <summary>বেলুনের লেখায় বাংলা অঙ্ক, আর কোনো নির্দেশ নেই।</summary>
    [Fact]
    public void বেলুনের_লেখা_শুধু_খবর()
    {
        var text = MonthlyMilestone.Text(208);

        Assert.Contains("২০৮", text, StringComparison.Ordinal);
        Assert.DoesNotContain("বিশ্রাম", text, StringComparison.Ordinal);
    }

    // ── ডিস্কের স্মৃতি ───────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️ রিস্টার্টেই ভুলে গেলে "মাসে একবার" কার্যত "দিনে একবার" হতো —
    /// অফিসের PC রোজ রাতে বন্ধ হয়।
    /// </summary>
    [Fact]
    public void স্মৃতি_রিস্টার্টের_পরেও_থাকে()
    {
        var dir = Path.Combine(Path.GetTempPath(), "oXeio-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);

        try
        {
            new MilestoneMemory(dir).Remember("2026-08");

            // নতুন ইনস্ট্যান্স = নতুন প্রসেস
            Assert.Equal("2026-08", new MilestoneMemory(dir).LastCelebrated());
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); } catch (IOException) { }
        }
    }

    /// <summary>
    /// ফোল্ডারটাই নেই — পড়া ব্যর্থ, কিন্তু ছোড়া যাবে না। এটা tray-র রেন্ডার
    /// পথে ডাকা হয়, আর সেখানে একটা এক্সসেপশন মানে UI থ্রেড মরে যাওয়া,
    /// অর্থাৎ ঘণ্টা গোনা বন্ধ।
    /// </summary>
    [Fact]
    public void পড়া_না_গেলেও_ছোড়ে_না()
    {
        var memory = new MilestoneMemory(
            Path.Combine(Path.GetTempPath(), "oXeio-নেই-" + Guid.NewGuid().ToString("N")));

        Assert.Null(memory.LastCelebrated());
    }
}
