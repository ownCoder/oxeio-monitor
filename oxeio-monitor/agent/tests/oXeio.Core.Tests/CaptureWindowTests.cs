using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

public class CaptureWindowTests
{
    /// <summary>ঢাকার স্থানীয় সময় → UTC instant</summary>
    private static DateTimeOffset Dhaka(int hour, int minute = 0) =>
        new DateTimeOffset(2026, 8, 9, hour, minute, 0, TimeSpan.Zero)
            .AddHours(-6);

    [Theory]
    [InlineData(6, 59, false)]
    [InlineData(7, 0, true)]   // শুরুটা অন্তর্ভুক্ত
    [InlineData(12, 0, true)]
    [InlineData(22, 59, true)]
    [InlineData(23, 0, false)] // শেষটা বাদ
    [InlineData(2, 0, false)]  // রাত ২টা — সময় গোনা হবে, ছবি নয়
    public void সাত_থেকে_তেইশ_টার_বাইরে_ছবি_ওঠে_না(int h, int m, bool allowed)
    {
        Assert.Equal(allowed, CaptureWindow.Default.Allows(Dhaka(h, m)));
    }

    [Fact]
    public void উইন্ডো_না_থাকলে_চব্বিশ_ঘণ্টাই_ছবি()
    {
        Assert.True(CaptureWindow.Always.Allows(Dhaka(3)));
        Assert.True(CaptureWindow.Always.Allows(Dhaka(23, 30)));
    }

    [Fact]
    public void মধ্যরাত_পার_হওয়া_উইন্ডোও_কাজ_করে()
    {
        // ২৩:০০ → ০৭:০০ (উল্টো দিকের সীমা)
        var night = new CaptureWindow(new TimeOnly(23, 0), new TimeOnly(7, 0));

        Assert.True(night.Allows(Dhaka(23, 30)));
        Assert.True(night.Allows(Dhaka(2)));
        Assert.False(night.Allows(Dhaka(12)));
    }
}
