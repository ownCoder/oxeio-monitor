using oXeio.Core.Capture;

namespace oXeio.Core.Tests;

public class EngineFallbackPolicyTests
{
    private static readonly DateTimeOffset T0 =
        new(2026, 8, 10, 10, 0, 0, TimeSpan.FromHours(6));

    private static EngineFallbackPolicy Policy(int failures = 3, int cooldownMin = 30)
        => new(failures, TimeSpan.FromMinutes(cooldownMin));

    [Fact]
    public void শুরুতে_প্রাথমিক_ইঞ্জিনই_চেষ্টা_করা_হয়()
    {
        Assert.True(Policy().ShouldTryPrimary(T0));
    }

    [Fact]
    public void সীমার_কম_ব্যর্থতায়_থামে_না()
    {
        var p = Policy(failures: 3);

        p.RecordFailure(T0);
        p.RecordFailure(T0);

        // একবার-দুবার ব্যর্থতা কিছুই প্রমাণ করে না — লক স্ক্রিনেই হতে পারে
        Assert.True(p.ShouldTryPrimary(T0));
    }

    [Fact]
    public void টানা_ব্যর্থতায়_বিরতি_শুরু_হয়()
    {
        var p = Policy(failures: 3, cooldownMin: 30);

        p.RecordFailure(T0);
        p.RecordFailure(T0);
        p.RecordFailure(T0);

        Assert.False(p.ShouldTryPrimary(T0));
        Assert.Equal(T0.AddMinutes(30), p.RestingUntil);
    }

    [Fact]
    public void বিরতি_শেষ_হলে_আবার_চেষ্টা_হয়()
    {
        var p = Policy(failures: 3, cooldownMin: 30);
        for (var i = 0; i < 3; i++) p.RecordFailure(T0);

        Assert.False(p.ShouldTryPrimary(T0.AddMinutes(29)));
        Assert.True(p.ShouldTryPrimary(T0.AddMinutes(30)));
    }

    /// <summary>
    /// এই বাগটাই সবচেয়ে সহজে ঢুকত: বিরতির পর কাউন্টার শূন্য না করলে
    /// পরের একটামাত্র ব্যর্থতাই আবার সীমা ছুঁয়ে ফেলত — অর্থাৎ বিরতি
    /// কার্যত স্থায়ী হয়ে যেত আর DXGI আর কখনো ফিরত না।
    /// </summary>
    [Fact]
    public void বিরতির_পর_কাউন্টার_শূন্য_থেকে_শুরু_হয়()
    {
        var p = Policy(failures: 3, cooldownMin: 30);
        for (var i = 0; i < 3; i++) p.RecordFailure(T0);

        var after = T0.AddMinutes(31);
        Assert.True(p.ShouldTryPrimary(after));
        Assert.Equal(0, p.ConsecutiveFailures);

        p.RecordFailure(after);
        Assert.True(p.ShouldTryPrimary(after)); // এক ব্যর্থতায় আবার থামে না
    }

    [Fact]
    public void সফল_হলে_হিসাব_পুরো_মুছে_যায়()
    {
        var p = Policy(failures: 3);

        p.RecordFailure(T0);
        p.RecordFailure(T0);
        p.RecordSuccess();

        Assert.Equal(0, p.ConsecutiveFailures);

        p.RecordFailure(T0);
        p.RecordFailure(T0);
        Assert.True(p.ShouldTryPrimary(T0)); // আগের দুটো আর গোনা হয়নি
    }

    [Fact]
    public void বিরতি_চলাকালীন_ব্যর্থতা_বিরতি_বাড়ায়_না()
    {
        // ফলব্যাক ইঞ্জিন চলার সময় প্রাথমিকটা ডাকাই হয় না, তাই RecordFailure
        // আসা উচিত নয়। তবু এলে বিরতির সময়সীমা যেন পিছিয়ে না যায় — নইলে
        // ব্যস্ত মেশিনে বিরতি কখনো শেষই হতো না।
        var p = Policy(failures: 3, cooldownMin: 30);
        for (var i = 0; i < 3; i++) p.RecordFailure(T0);

        var until = p.RestingUntil;
        p.RecordFailure(T0.AddMinutes(10));

        Assert.Equal(until, p.RestingUntil);
    }

    [Fact]
    public void ডিফল্ট_মানগুলো_যা_হওয়ার_কথা()
    {
        Assert.Equal(3, EngineFallbackPolicy.DefaultFailuresBeforeCooldown);
        Assert.Equal(TimeSpan.FromMinutes(30), EngineFallbackPolicy.DefaultCooldown);
    }
}
