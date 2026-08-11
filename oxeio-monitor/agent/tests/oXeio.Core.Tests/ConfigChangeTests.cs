using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// E09 · K07 — সার্ভারে সেটিংস বদলালে এজেন্ট কী কী ছোঁবে।
///
/// ⚠️ এই নিয়মগুলোর দাম আছে: <see cref="ConfigChange.TouchesTracking"/> সত্যি
/// হলে এজেন্ট চলতি সেগমেন্ট বন্ধ করে নতুন করে শুরু করে। ভুল করে সবসময় সত্যি
/// ফেরালে Settings-এ **save** চাপলেই ১৫টা PC-র সবার সেগমেন্ট কাটা পড়ত।
/// </summary>
public class ConfigChangeTests
{
    private static AgentConfig Base => AgentConfig.Default;

    [Fact]
    public void একই_কনফিগে_কিছুই_বদলায়_না()
    {
        var change = ConfigChange.Between(Base, Base with { });

        Assert.False(change.Any);
        Assert.False(change.TouchesTracking);
    }

    /// <summary>
    /// ⭐ সবচেয়ে জরুরি টেস্ট: অপ্রাসঙ্গিক ফিল্ড বদলালেও ট্র্যাকিং ছোঁয়া হয় না।
    /// মাসিক টার্গেট বা টাইমজোন বদলানো মানে কারো সেগমেন্ট কাটা নয়।
    /// </summary>
    [Fact]
    public void মাসিক_টার্গেট_বদলালে_ট্র্যাকিং_ছোঁয়া_হয়_না()
    {
        var change = ConfigChange.Between(Base, Base with { MonthlyTargetHours = 180 });

        Assert.False(change.Any);
        Assert.False(change.TouchesTracking);
    }

    [Fact]
    public void ছবির_সময়সীমা_বদলালে_শুধু_উইন্ডো()
    {
        var change = ConfigChange.Between(Base, Base with { ScreenshotTo = "21:00" });

        Assert.True(change.CaptureWindow);
        Assert.False(change.TouchesTracking);
    }

    [Fact]
    public void স্লট_বদলালে_ট্র্যাকিং_ছোঁয়া_হয়_না()
    {
        var change = ConfigChange.Between(Base, Base with { SlotMinutes = 10 });

        Assert.True(change.Slots);
        Assert.False(change.TouchesTracking);
    }

    /// <summary>
    /// ⚠️ শূন্য স্লট "বদল" নয় — <c>SlotScheduler</c> ওতে ছুড়ে ফেলে, আর
    /// একটা ভুল কনফিগে পুরো ক্যাপচার লুপ নেমে যেত।
    /// </summary>
    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void অবৈধ_স্লট_উপেক্ষা_করা_হয়(int minutes)
    {
        var change = ConfigChange.Between(Base, Base with { SlotMinutes = minutes });

        Assert.False(change.Slots);
    }

    [Fact]
    public void idle_সীমা_বদলালে_ট্র্যাকিং_ছুঁতে_হয়()
    {
        var change = ConfigChange.Between(Base, Base with { IdleThresholdSec = 120 });

        Assert.True(change.IdleThreshold);
        Assert.True(change.TouchesTracking);
    }

    /// <summary>⚠️ শূন্য সীমা মানে "প্রতি সেকেন্ডেই idle" — কেউ ভুলে বসালে উপেক্ষা।</summary>
    [Fact]
    public void শূন্য_idle_সীমা_উপেক্ষা_করা_হয়()
    {
        var change = ConfigChange.Between(Base, Base with { IdleThresholdSec = 0 });

        Assert.False(change.IdleThreshold);
        Assert.False(change.TouchesTracking);
    }

    [Fact]
    public void অ্যাপ_ট্র্যাকিং_বন্ধ_করা_ট্র্যাকিং_ছোঁয়()
    {
        var change = ConfigChange.Between(
            Base,
            Base with { AppTracking = new AppTrackingConfig { Enabled = false, MinDurationSec = 5 } });

        Assert.True(change.AppTrackingToggled);
        Assert.True(change.TouchesTracking);
    }

    /// <summary>
    /// ⚠️ বন্ধ থাকা অবস্থায় সীমা বদলানো অর্থহীন — বন্ধ করার মতো কোনো খোলা
    /// রেকর্ডই নেই। ভুল করে সত্যি ফেরালে এজেন্ট অকারণে `CloseAll` ডাকত।
    /// </summary>
    [Fact]
    public void বন্ধ_থাকা_অ্যাপ_ট্র্যাকিংয়ে_সীমা_বদল_গোনা_হয়_না()
    {
        var off = new AppTrackingConfig { Enabled = false, MinDurationSec = 5 };
        var offLonger = new AppTrackingConfig { Enabled = false, MinDurationSec = 30 };

        var change = ConfigChange.Between(
            Base with { AppTracking = off },
            Base with { AppTracking = offLonger });

        Assert.False(change.AppMinDuration);
        Assert.False(change.TouchesTracking);
    }

    [Fact]
    public void heartbeat_বদল_ট্র্যাকিং_ছোঁয়_না()
    {
        var change = ConfigChange.Between(Base, Base with { HeartbeatSec = 45 });

        Assert.True(change.Heartbeat);
        Assert.True(change.Any);
        Assert.False(change.TouchesTracking);
    }
}
