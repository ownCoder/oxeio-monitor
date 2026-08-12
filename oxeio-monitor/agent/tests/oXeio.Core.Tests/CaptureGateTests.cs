using oXeio.Core.Capture;
using oXeio.Core.Models;
using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// ছবি তোলার চারটে শর্ত — A04 · A04b · H06।
///
/// ⚠️ শর্তগুলো আগে <c>AgentHost.CaptureSlotAsync</c>-এ guard clause হিসেবে
/// ছড়ানো ছিল, আর ওখানে কোনো টেস্ট পৌঁছাত না। ফল: <b>revoke-এর শর্তটা
/// কোনোদিন লেখাই হয়নি</b>, আর বাতিল করা ডিভাইসে ছবি উঠতেই থাকত।
/// </summary>
public class CaptureGateTests
{
    private static readonly CaptureWindow Day = CaptureWindow.Default; // ০৭:০০–২৩:০০

    /// <summary>ঢাকার দুপুর ১২টা — উইন্ডোর ভেতরে (UTC+৬, তাই ০৬:০০ UTC)।</summary>
    private static readonly DateTimeOffset Noon =
        new(2026, 8, 12, 6, 0, 0, TimeSpan.Zero);

    /// <summary>ঢাকার রাত ২টা — উইন্ডোর বাইরে।</summary>
    private static readonly DateTimeOffset Night =
        new(2026, 8, 11, 20, 0, 0, TimeSpan.Zero);

    // ⚠️ নাম দিয়ে ডাকা হয়, `true`/`false` নয়। পাঁচটা প্যারামিটারের মধ্যে
    //    পরপর দুটো bool — `Check(state, true, false, …)` পড়ে কোনটা কী বোঝার
    //    কোনো উপায় থাকত না, আর উল্টে লিখলে টেস্টটা তবু পাস করত।
    private const bool Enrolled = true;
    private const bool NotEnrolled = false;
    private const bool Revoked = true;
    private const bool NotRevoked = false;

    [Fact]
    public void সক্রিয়_ও_উইন্ডোর_ভেতরে_হলে_ছবি_ওঠে() =>
        Assert.True(CaptureGate.Allows(SegmentState.Active, Enrolled, NotRevoked, Day, Noon));

    [Theory]
    [InlineData(SegmentState.Idle)]
    [InlineData(SegmentState.Locked)]
    public void ACTIVE_ছাড়া_ছবি_নয়(SegmentState state) =>
        Assert.Equal(
            CaptureGate.Verdict.NotActive,
            CaptureGate.Check(state, Enrolled, NotRevoked, Day, Noon));

    /// <summary>⚠️ A04b — রাত ২টায় কাজ করলে সময় গোনা হয়, কিন্তু ছবি ওঠে না।</summary>
    [Fact]
    public void উইন্ডোর_বাইরে_ছবি_নয়() =>
        Assert.Equal(
            CaptureGate.Verdict.OutsideWindow,
            CaptureGate.Check(SegmentState.Active, Enrolled, NotRevoked, Day, Night));

    /// <summary>
    /// ⭐⭐ H06 — এই শর্তটাই এতদিন ছিল না। বাতিল করা ডিভাইসে শুধু আপলোড
    /// থামত; ছবি উঠত আর ছাঁটাই হওয়া কর্মীর PC-তে জমতে থাকত।
    /// </summary>
    [Fact]
    public void বাতিল_ডিভাইসে_ছবি_নয়() =>
        Assert.Equal(
            CaptureGate.Verdict.Revoked,
            CaptureGate.Check(SegmentState.Active, Enrolled, Revoked, Day, Noon));

    /// <summary>
    /// ⚠️ revoke সবচেয়ে আগে দেখা হয়। নইলে বাতিল ডিভাইসে "ছবি ওঠেনি কেন"
    /// প্রশ্নের উত্তর আসত "ও তখন idle ছিল" — সত্যি, কিন্তু আসল কারণ নয়।
    /// </summary>
    [Fact]
    public void বাতিলের_কারণটাই_আগে_বলা_হয়() =>
        Assert.Equal(
            CaptureGate.Verdict.Revoked,
            CaptureGate.Check(SegmentState.Idle, Enrolled, Revoked, Day, Night));

    /// <summary>২৪ ঘণ্টার উইন্ডোতেও (ADR-011c-র বাইরে গেলে) revoke জেতে।</summary>
    [Fact]
    public void সবসময়_খোলা_উইন্ডোতেও_বাতিল_আটকায়() =>
        Assert.False(
            CaptureGate.Allows(SegmentState.Active, Enrolled, Revoked, CaptureWindow.Always, Night));

    // ── সাইন ইন হওয়ার আগে ──────────────────────────────────────────────────

    /**
     * ⭐⭐ <b>revoke-এর ঠিক পাশের ভুলটা।</b> ইনস্টলের পর সাইন-ইন জানালা
     * খোলা থাকা অবস্থাতেই ছবি উঠত — অথচ যে এখনো সাইন ইনই করেনি, তার নামে
     * ছবি জমা রাখার কোনো ভিত্তি নেই। মালিক ০.৩.৩-এ ধরেছেন।
     */
    [Fact]
    public void সাইন_ইন_না_করা_থাকলে_ছবি_নয়() =>
        Assert.Equal(
            CaptureGate.Verdict.NotEnrolled,
            CaptureGate.Check(SegmentState.Active, NotEnrolled, NotRevoked, Day, Noon));

    /// <summary>⚠️ কারণটাও আগে বলা হয় — "ও তখন idle ছিল" আসল উত্তর নয়।</summary>
    [Fact]
    public void সাইন_ইনের_কারণটাই_আগে_বলা_হয়() =>
        Assert.Equal(
            CaptureGate.Verdict.NotEnrolled,
            CaptureGate.Check(SegmentState.Idle, NotEnrolled, NotRevoked, Day, Night));

    /**
     * ⚠️⚠️ <b>দুটোই সত্যি হলে revoke জেতে</b> — আর সেটা কল্পনার অবস্থা নয়:
     * revoke করলে টোকেন মুছে যায়, তাই ডিভাইসটা একই সাথে "enrolled নয়"।
     * উল্টো হলে বাতিল মেশিনে স্টাফকে বলা হতো "সাইন ইন করুন", অর্থাৎ অফিস
     * যেটা বন্ধ করেছে সেটাই চালু করতে বলা।
     */
    [Fact]
    public void দুটোই_সত্যি_হলে_বাতিলের_কথাই_বলা_হয়() =>
        Assert.Equal(
            CaptureGate.Verdict.Revoked,
            CaptureGate.Check(SegmentState.Active, NotEnrolled, Revoked, Day, Noon));
}
