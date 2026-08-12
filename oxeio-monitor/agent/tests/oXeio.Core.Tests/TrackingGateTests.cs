using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// সময় গোনা হবে কি না — সাইন ইন ও revoke।
///
/// ⚠️⚠️ এই ফাইলটা লেখা হয়েছে একটা মাঠের বাগ থেকে: ০.৩.৩ বসানোর পর
/// সাইন-ইন জানালা এসেছে, কিন্তু <b>সাইন ইন না করা অবস্থাতেও</b> tray-তে
/// সবুজ "Working" দেখাচ্ছিল আর আউটবক্সে ৭টা সারি জমে গিয়েছিল।
/// </summary>
public class TrackingGateTests
{
    private const bool Enrolled = true;
    private const bool NotEnrolled = false;
    private const bool Revoked = true;
    private const bool NotRevoked = false;

    [Fact]
    public void সাইন_ইন_করা_থাকলে_গোনা_চলে() =>
        Assert.True(TrackingGate.Allows(Enrolled, NotRevoked));

    /**
     * ⭐⭐ এই ফাইলের মূল টেস্ট। সাইন ইনের আগে গোনা শুরু হলে সময়টুকু
     * আউটবক্সে জমত, আর স্টাফ সাইন ইন করামাত্র ডিভাইসটা তার নামে বাঁধা
     * পড়ে ওই সময়টুকুও তার খাতায় চলে যেত — অর্থাৎ অ্যাডমিনের আধঘণ্টা
     * অন্যের হাজিরায়।
     */
    [Fact]
    public void সাইন_ইন_না_করা_থাকলে_গোনা_নয়() =>
        Assert.Equal(
            TrackingGate.Verdict.NotEnrolled,
            TrackingGate.Check(NotEnrolled, NotRevoked));

    [Fact]
    public void বাতিল_ডিভাইসে_গোনা_নয়() =>
        Assert.Equal(
            TrackingGate.Verdict.Revoked,
            TrackingGate.Check(Enrolled, Revoked));

    /**
     * ⚠️⚠️ <b>ক্রমের পাহারা।</b> revoke করলে <c>DeviceCredentials</c>
     * টোকেন মুছে ফেলে, তাই ওই মুহূর্ত থেকে দুটো শর্তই সত্যি। উল্টো ক্রমে
     * লিখলে বাতিল মেশিনে স্টাফ পড়ত "Sign in to start" — অফিস যেটা বন্ধ
     * করেছে সেটাই আবার চালু করার নির্দেশ।
     */
    [Fact]
    public void দুটোই_সত্যি_হলে_বাতিল_জেতে() =>
        Assert.Equal(
            TrackingGate.Verdict.Revoked,
            TrackingGate.Check(NotEnrolled, Revoked));

    /// <summary>প্রতিটা অবস্থার জন্য স্টাফের পড়ার মতো একটা বাক্য থাকতেই হবে।</summary>
    [Theory]
    [InlineData(TrackingGate.Verdict.Allowed)]
    [InlineData(TrackingGate.Verdict.NotEnrolled)]
    [InlineData(TrackingGate.Verdict.Revoked)]
    public void প্রতিটা_অবস্থার_ব্যাখ্যা_আছে(TrackingGate.Verdict verdict) =>
        Assert.False(string.IsNullOrWhiteSpace(TrackingGate.Explain(verdict)));

    /**
     * ⚠️ বার্তাটা <b>কী করতে হবে</b> বলে, শুধু কী হচ্ছে না তা নয়। tray-র
     * এই এক লাইনই স্টাফের একমাত্র ব্যাখ্যা — "Not enrolled" লিখলে সে
     * জানতই না তার কিছু করার আছে।
     */
    [Fact]
    public void সাইন_ইনের_বার্তা_কাজটা_বলে() =>
        Assert.Contains(
            "Sign in",
            TrackingGate.Explain(TrackingGate.Verdict.NotEnrolled),
            StringComparison.Ordinal);
}
