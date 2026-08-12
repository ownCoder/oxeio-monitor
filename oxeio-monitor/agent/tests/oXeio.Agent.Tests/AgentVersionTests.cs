namespace oXeio.Agent.Tests;

/// <summary>
/// এজেন্ট সার্ভারকে নিজের ভার্সন কী বলে।
///
/// ⚠️ সংখ্যাটা নিরীহ নয়: সার্ভার heartbeat-এর ভার্সন **দেখেই** ঠিক করে
/// আপডেট অফার করবে কি না (G59)। ভুল বা স্টেল হলে আপডেট হয়ে যাওয়া
/// মেশিনকেও একই আপডেট বারবার অফার করা হয়, আর H04-এর ধাপে ধাপে রোলআউট
/// কোনোদিন শেষ হয় না।
/// </summary>
public class AgentVersionTests
{
    /// <summary>
    /// ⭐ এই কেসটা মেপে পাওয়া, কল্পনা নয় — বিল্ড করা DLL-এর
    /// <c>ProductVersion</c> সত্যিই <c>0.1.0+&lt;commit&gt;</c> রূপে আসে।
    /// </summary>
    [Fact]
    public void commit_hash_ছেঁটে_ফেলা_হয়() =>
        Assert.Equal(
            "0.1.0",
            Program.TrimBuildMetadata("0.1.0+ef685e42b94046aa7b4f05b6ccc1a34990357d89"));

    [Fact]
    public void সাধারণ_ভার্সন_অক্ষত_থাকে() =>
        Assert.Equal("0.2.3", Program.TrimBuildMetadata("0.2.3"));

    /// <summary>⚠️ pre-release অংশ থাকে — ওটা SemVer-এর অংশ, build metadata নয়।</summary>
    [Fact]
    public void pre_release_অংশ_থেকে_যায়() =>
        Assert.Equal("1.0.0-beta.2", Program.TrimBuildMetadata("1.0.0-beta.2+abc123"));

    /// <summary>
    /// ⚠️ খালি হলে <c>"0.0.0"</c>, খালি স্ট্রিং নয় — খালি পাঠালে সার্ভার
    /// সেটাকে "ভার্সন বলেনি" ধরে আগেরটাই রেখে দিত (G59), আর সমস্যাটা
    /// আরও গভীরে লুকাত।
    /// </summary>
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("+onlymetadata")]
    public void কিছু_না_পেলে_শূন্য_ভার্সন(string? raw) =>
        Assert.Equal("0.0.0", Program.TrimBuildMetadata(raw));
}
