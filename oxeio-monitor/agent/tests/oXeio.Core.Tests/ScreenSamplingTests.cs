using oXeio.Core.Capture;
using oXeio.Core.Models;
using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// <b>G46 — পর্দার ছাপ কখন নেওয়া হবে।</b>
///
/// ⚠️⚠️ এই ফাইলটা আছে <b>একটাই কারণে</b>: ০.৪.১-এ ছাপ আসত স্ক্রিনশটের স্লট
/// থেকে, আর স্লট চলত কেবল ACTIVE অবস্থায়। ফলে জমে যাওয়ার শাস্তি নিজেই
/// নিজের প্রমাণ হয়ে দাঁড়াত, আর বেরোনোর পথ থাকত না।
/// </summary>
public class ScreenSamplingTests
{
    private static readonly DateTimeOffset Start =
        new(2026, 8, 17, 4, 0, 0, TimeSpan.Zero); // ঢাকায় সকাল ১০টা

    private static DateTimeOffset At(int seconds) => Start.AddSeconds(seconds);

    // ── কখন ─────────────────────────────────────────────────────────────────

    /// <summary>⭐ প্রথমবার সবসময়ই — তুলনা করার মতো কিছু নেই</summary>
    [Fact]
    public void First_sample_is_always_due()
    {
        Assert.True(ScreenSampling.Due(At(0), null, frozen: false));
    }

    [Fact]
    public void Not_due_before_the_interval()
    {
        Assert.False(ScreenSampling.Due(At(59), At(0), frozen: false));
        Assert.True(ScreenSampling.Due(At(60), At(0), frozen: false));
    }

    /// <summary>
    /// ⭐⭐ <b>জমে থাকলে অনেক ঘন ঘন</b> — এখানেই ন্যায্যতা।
    ///
    /// জমে থাকা মানে কর্মীর গোনা বন্ধ। তিনি ফিরে এসে কাজ শুরু করলে সেটা
    /// সেকেন্ডে ধরা পড়া দরকার, নইলে প্রতিটা বিরতির পর এক মিনিট করে সময়
    /// কাটা যেত — রোজ, সবার।
    /// </summary>
    [Fact]
    public void Frozen_screens_are_sampled_much_faster()
    {
        Assert.False(ScreenSampling.Due(At(4), At(0), frozen: true));
        Assert.True(ScreenSampling.Due(At(5), At(0), frozen: true));
    }

    /// <summary>⚠️ ঘড়ি পিছিয়ে গেলে (NTP) নমুনা নেওয়াই হয় — থেমে যাওয়ার ক্ষতি বেশি</summary>
    [Fact]
    public void Clock_going_backwards_still_samples()
    {
        Assert.True(ScreenSampling.Due(At(0), At(600), frozen: false));
    }

    /// <summary>
    /// ⚠️⚠️ ব্যবধান <see cref="ScreenActivity.StaleAfter"/>-এর চেয়ে যথেষ্ট
    /// ছোট হতেই হবে। নইলে স্বাভাবিক কাজের মধ্যেই নমুনা বাসি হয়ে যেত, আর
    /// পুরো পাহারাটা <b>নীরবে অকেজো</b> থাকত — এই প্রকল্পের সবচেয়ে চেনা ভুল।
    /// </summary>
    [Fact]
    public void Interval_leaves_room_before_a_sample_goes_stale()
    {
        Assert.True(ScreenSampling.Interval * 2 < ScreenActivity.StaleAfter);
        Assert.True(ScreenSampling.WhenFrozen < ScreenSampling.Interval);
    }

    // ── কখন অনুমোদিত ────────────────────────────────────────────────────────

    [Fact]
    public void Allowed_in_the_normal_case()
    {
        Assert.True(ScreenSampling.Allowed(
            enrolled: true, revoked: false, insideWindow: true, locked: false));
    }

    [Fact]
    public void Not_allowed_before_sign_in_or_after_revoke()
    {
        Assert.False(ScreenSampling.Allowed(false, false, true, false));
        Assert.False(ScreenSampling.Allowed(true, true, true, false));
    }

    /// <summary>⚠️ অফিসের সময়ের বাইরে পর্দা ছোঁয়াই হয় না (§ ৪.২)</summary>
    [Fact]
    public void Not_allowed_outside_the_window()
    {
        Assert.False(ScreenSampling.Allowed(true, false, insideWindow: false, locked: false));
    }

    /// <summary>
    /// ⚠️⚠️ লক করা পর্দা এমনিতেই স্থির। ওটা নমুনা হিসেবে রাখলে আনলক করার
    /// পরেও কিছুক্ষণ "জমে আছে" দেখাত — অর্থাৎ দুপুরের খাবার সেরে ফেরা
    /// কর্মীর সময় কাটা যেত।
    /// </summary>
    [Fact]
    public void Not_allowed_while_locked()
    {
        Assert.False(ScreenSampling.Allowed(true, false, true, locked: true));
    }

    /// <summary>
    /// ⭐⭐⭐ <b>এই ফাইলের মূল টেস্ট — অচলাবস্থাটা যেন আর ফিরতে না পারে।</b>
    ///
    /// ঠিক যে অবস্থায় <see cref="CaptureGate"/> স্ক্রিনশট তুলতে দেয় না
    /// (IDLE — আর সেটা ঠিকই করে, স্ক্রিনশট জমা হয় ও দেখা হয়), ঠিক সেই
    /// অবস্থাতেই ছাপ নেওয়া <b>চলতে থাকে</b>। কারণ ছাপ কোথাও জমে না; ওটা
    /// শুধু একটা প্রশ্নের উত্তর — <i>পর্দা বদলাচ্ছে?</i>
    ///
    /// ⚠️⚠️ এই দুটো দাবি একসাথে না থাকলে আবার সেই ফাঁদ: জমেছে → IDLE →
    /// ছাপ বন্ধ → চিরকাল জমে আছে।
    /// </summary>
    [Fact]
    public void Sampling_continues_exactly_where_screenshots_stop()
    {
        var window = CaptureWindow.Default;
        var at = Start;

        // স্ক্রিনশট থামে — কর্মী idle
        Assert.Equal(
            CaptureGate.Verdict.NotActive,
            CaptureGate.Check(SegmentState.Idle, enrolled: true, revoked: false, window, at));

        // ⭐ কিন্তু ছাপ নেওয়া থামে না
        Assert.True(ScreenSampling.Allowed(
            enrolled: true, revoked: false, insideWindow: true, locked: false));
    }
}
