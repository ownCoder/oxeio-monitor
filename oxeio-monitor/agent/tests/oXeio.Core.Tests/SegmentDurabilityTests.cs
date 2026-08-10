using oXeio.Core.Models;
using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// টানা কাজ করলেও সেগমেন্ট যেন নিয়মিত বন্ধ হয়ে কিউয়ে যায় — নইলে
/// বিদ্যুৎ গেলে ওই পুরো সময়টা হারাত।
/// </summary>
public class SegmentDurabilityTests
{
    private static readonly DateTimeOffset T0 =
        new(2026, 8, 10, 10, 0, 0, TimeSpan.FromHours(6));

    private static readonly TimeSpan Threshold = TimeSpan.FromSeconds(60);

    /// <summary>এক সেকেন্ড অন্তর টিক, সবসময় ইনপুট আসছে (টানা কাজ)।</summary>
    private static List<ActivitySegment> RunBusy(IdleStateMachine m, TimeSpan span)
    {
        var all = new List<ActivitySegment>();
        for (var s = 1; s <= (int)span.TotalSeconds; s++)
            all.AddRange(m.Tick(T0.AddSeconds(s), TimeSpan.Zero, locked: false));
        return all;
    }

    [Fact]
    public void টানা_কাজেও_সেগমেন্ট_নিয়মিত_বন্ধ_হয়()
    {
        var m = new IdleStateMachine(Threshold, T0);

        var closed = RunBusy(m, TimeSpan.FromMinutes(17));

        // ৫ মিনিট করে ভাগ — ১৭ মিনিটে ৩টা পূর্ণ সেগমেন্ট
        Assert.Equal(3, closed.Count);
        Assert.All(closed, s => Assert.Equal(SegmentState.Active, s.State));
        Assert.All(closed, s => Assert.Equal(300, s.DurationSec));
    }

    [Fact]
    public void ভাগ_হলেও_কোনো_সেকেন্ড_হারায়_না_বা_দুবার_গোনা_হয়_না()
    {
        var m = new IdleStateMachine(Threshold, T0);

        var closed = RunBusy(m, TimeSpan.FromMinutes(17));
        closed.AddRange(m.CloseAll(T0.AddMinutes(17)));

        Assert.Equal(17 * 60, closed.Sum(s => s.DurationSec));

        // পরপর সাজানো, ফাঁক নেই, ওভারল্যাপ নেই
        for (var i = 1; i < closed.Count; i++)
            Assert.Equal(closed[i - 1].EndedAt, closed[i].StartedAt);
    }

    [Fact]
    public void প্রতিটি_ভাগের_আলাদা_uuid_থাকে()
    {
        // একই uuid হলে সার্ভার দ্বিতীয়টাকে ডুপ্লিকেট ভেবে ফেলে দিত —
        // অর্থাৎ ভাগ করার পরেও সময় হারাত
        var m = new IdleStateMachine(Threshold, T0);

        var closed = RunBusy(m, TimeSpan.FromMinutes(17));

        Assert.Equal(closed.Count, closed.Select(s => s.ClientUuid).Distinct().Count());
    }

    [Fact]
    public void স্টেট_বদলালে_ভাগের_ঘড়ি_নতুন_করে_শুরু_হয়()
    {
        var m = new IdleStateMachine(Threshold, T0);

        // ৪ মিনিট কাজ, তারপর idle-এ যাওয়া
        RunBusy(m, TimeSpan.FromMinutes(4));
        var closed = m.Tick(T0.AddMinutes(5), TimeSpan.FromSeconds(61), locked: false);

        Assert.Single(closed);
        Assert.Equal(SegmentState.Active, closed[0].State);
    }

    [Fact]
    public void নিষ্ক্রিয়_সময়ও_ভাগ_হয়()
    {
        // কেউ লাঞ্চে গেলে IDLE সেগমেন্টও ঘণ্টাখানেক খোলা থাকত। ওটা কাজের
        // সময় নয়, কিন্তু ক্র্যাশে হারালে পরে "ওই সময়টা কী ছিল" বোঝা যেত না।
        var m = new IdleStateMachine(Threshold, T0);
        var all = new List<ActivitySegment>();

        for (var s = 1; s <= 20 * 60; s++)
            all.AddRange(m.Tick(T0.AddSeconds(s), TimeSpan.FromMinutes(30), locked: false));

        Assert.Contains(all, s => s.State == SegmentState.Idle);
        Assert.All(all.Where(s => s.State == SegmentState.Idle),
            s => Assert.True(s.DurationSec <= 300));
    }

    [Fact]
    public void মাপটা_বদলানো_যায়_কিন্তু_শূন্য_দেওয়া_যায়_না()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new IdleStateMachine(Threshold, T0, maxSegment: TimeSpan.Zero));
    }

    /// <summary>
    /// ⭐ সবচেয়ে জরুরি টেস্ট। ভাগ করার পর retro-adjust (B04) যেন অক্ষত থাকে।
    ///
    /// শেষ ৬০ সেকেন্ড আগেই আলাদা সেগমেন্ট হিসেবে বেরিয়ে গেলে আর পিছিয়ে গিয়ে
    /// কাটা যেত না — নিষ্ক্রিয় সময়টা নীরবে **কাজ হিসেবে গোনা** হয়ে যেত।
    /// </summary>
    [Fact]
    public void ভাগ_করার_পরেও_retro_adjust_পুরো_ষাট_সেকেন্ড_কাটে()
    {
        var m = new IdleStateMachine(Threshold, T0);
        var all = new List<ActivitySegment>();

        // ঠিক ভাগের সীমানা পেরিয়ে আরও কিছুক্ষণ কাজ, তারপর হাত সরিয়ে নেওয়া
        for (var s = 1; s <= 7 * 60; s++)
            all.AddRange(m.Tick(T0.AddSeconds(s), TimeSpan.Zero, locked: false));

        // এবার ৬০ সেকেন্ড নিষ্ক্রিয়
        for (var s = 7 * 60 + 1; s <= 8 * 60; s++)
        {
            var idleFor = TimeSpan.FromSeconds(s - 7 * 60);
            all.AddRange(m.Tick(T0.AddSeconds(s), idleFor, locked: false));
        }

        all.AddRange(m.CloseAll(T0.AddSeconds(8 * 60)));

        var worked = all.Where(x => x.CountsAsWork).Sum(x => x.DurationSec);

        // ৮ মিনিটের শেষ ৬০ সেকেন্ড নিষ্ক্রিয় ছিল, আর retro-adjust ঠিক
        // ওইটুকুই বাদ দেয় — এক সেকেন্ড বেশিও নয়, কমও নয় (B04)।
        // ভাগ করার পরেও যোগফল একই থাকতে হবে।
        Assert.Equal(7 * 60, worked);
    }

    [Fact]
    public void ডিফল্ট_মাপ_পাঁচ_মিনিট()
    {
        Assert.Equal(TimeSpan.FromMinutes(5), IdleStateMachine.MaxSegmentLength);
    }
}
