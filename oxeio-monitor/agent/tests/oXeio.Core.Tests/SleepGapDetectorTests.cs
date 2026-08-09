using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

public class SleepGapDetectorTests
{
    private static readonly DateTimeOffset T0 =
        new(2026, 8, 9, 11, 0, 0, TimeSpan.Zero); // ঢাকায় বিকেল ৫টা

    private static SleepGapDetector New() =>
        new(TimeSpan.FromSeconds(1));

    private static SleepGapDetector.Sample At(long seconds, long sleptSeconds = 0) =>
        new(
            BiasedMs: (ulong)(seconds * 1000),
            UnbiasedMs: (ulong)((seconds - sleptSeconds) * 1000),
            Monotonic: T0.AddSeconds(seconds));

    [Fact]
    public void প্রথম_নমুনায়_কখনো_ঘুম_ধরা_পড়ে_না()
    {
        Assert.False(New().Observe(At(100)).Detected);
    }

    [Fact]
    public void স্বাভাবিক_এক_সেকেন্ডের_টিকে_কিছু_হয়_না()
    {
        var d = New();
        d.Observe(At(100));

        for (var i = 101; i < 200; i++)
            Assert.False(d.Observe(At(i)).Detected);
    }

    [Fact]
    public void টাইমারের_সামান্য_ঢিলেমি_ঘুম_বলে_ধরা_হয়_না()
    {
        var d = New();
        d.Observe(At(100));

        // ১.৪ সেকেন্ড — tolerance ১.৫-এর ভেতরে
        var gap = d.Observe(new SleepGapDetector.Sample(101_400, 101_400, T0.AddSeconds(101.4)));
        Assert.False(gap.Detected);
    }

    /// <summary>ল্যাপটপ বিকেল ৫টায় বন্ধ, সকাল ৯টায় খোলা — ১৬ ঘণ্টার ভুয়া কাজ।</summary>
    [Fact]
    public void ষোলো_ঘণ্টার_ঘুম_ধরা_পড়ে_এবং_শেষ_জাগ্রত_মুহূর্তে_থামে()
    {
        var d = New();
        d.Observe(At(100));

        const int sixteenHours = 16 * 60 * 60;
        var gap = d.Observe(At(101 + sixteenHours, sleptSeconds: sixteenHours));

        Assert.True(gap.Detected);
        // সেগমেন্ট বন্ধ হবে ঘুমাতে যাওয়ার মুহূর্তে, জেগে ওঠার মুহূর্তে নয়
        Assert.Equal(T0.AddSeconds(100), gap.SuspendedAt);
        Assert.Equal(T0.AddSeconds(101 + sixteenHours), gap.ResumedAt);
        Assert.Equal(TimeSpan.FromHours(16), gap.SleptFor);
    }

    /// <summary>
    /// কোনো suspend ইভেন্ট আসেনি (ব্যাটারি ফুরিয়ে বন্ধ হওয়ার ক্ষেত্রে Windows
    /// কিছুই পাঠায় না) — তবু শুধু ঘড়ি দেখেই ধরা পড়তে হবে।
    /// </summary>
    [Fact]
    public void ইভেন্ট_ছাড়াই_শুধু_ঘড়ি_দেখে_ধরা_পড়ে()
    {
        var d = New();
        d.Observe(At(100));

        var gap = d.Observe(At(400, sleptSeconds: 299));

        Assert.True(gap.Detected);
        Assert.Equal(TimeSpan.FromSeconds(299), gap.SleptFor);
    }

    /// <summary>
    /// S0ix-এ প্রসেসটাই জমিয়ে রাখা হয়, তাই unbiased ঘড়িও এগোতে পারে।
    /// তবু monotonic লাফ দেখে ধরা পড়া চাই।
    /// </summary>
    [Fact]
    public void unbiased_ঘড়িও_এগোলে_মনোটনিক_লাফেই_ধরা_পড়ে()
    {
        var d = New();
        d.Observe(At(100));

        // biased ও unbiased দুটোই ৩০০ সেকেন্ড এগিয়েছে — অর্থাৎ "ঘুম" বলে চিহ্নিত নয়,
        // কিন্তু প্রসেস ৩০০ সেকেন্ড চলেইনি
        var gap = d.Observe(new SleepGapDetector.Sample(400_000, 400_000, T0.AddSeconds(400)));

        Assert.True(gap.Detected);
        Assert.Equal(T0.AddSeconds(100), gap.SuspendedAt);
    }

    [Fact]
    public void কাউন্টার_পিছিয়ে_গেলেও_ঋণাত্মক_হয়_না()
    {
        var d = New();
        d.Observe(At(1000));

        var gap = d.Observe(new SleepGapDetector.Sample(500_000, 400_000, T0.AddSeconds(1001)));

        Assert.True(gap.SleptFor >= TimeSpan.Zero);
    }

    [Fact]
    public void Reset_এর_পর_আবার_প্রথম_নমুনা_ধরা_হয়()
    {
        var d = New();
        d.Observe(At(100));
        d.Reset();

        // Reset না করলে এটা বিশাল gap দেখাত
        Assert.False(d.Observe(At(9999)).Detected);
    }
}
