using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

/// <summary>
/// <b>অবস্থা বদলালে সার্ভারকে কখন জানানো হবে।</b>
///
/// ⚠️⚠️ মালিকের অভিযোগ থেকে: idle থেকে কাজ শুরু করলে বোর্ডে "Working"
/// আসতে <b>১০–১৫ সেকেন্ড</b> লাগত। বাগ ছিল না — এজেন্ট এক সেকেন্ডেই টের
/// পায়, কিন্তু heartbeat যেত ১৫ সেকেন্ড পরপর।
///
/// ⭐ এখানকার টেস্টগুলো দুটো বিপরীত দাবি একসাথে পাহারা দেয়: বদলটা
/// <b>দ্রুত</b> যায়, কিন্তু সার্ভারে <b>ঢেউ ওঠে না</b>।
/// </summary>
public class HeartbeatUrgencyTests
{
    private static readonly DateTimeOffset Start =
        new(2026, 8, 17, 4, 0, 0, TimeSpan.Zero);

    private static DateTimeOffset At(double seconds) => Start.AddSeconds(seconds);

    private static readonly TimeSpan Normal = TimeSpan.FromSeconds(15);

    // ── কিছু বদলায়নি — স্বাভাবিক ছন্দ ───────────────────────────────────────

    [Fact]
    public void Without_a_change_it_waits_the_normal_interval()
    {
        Assert.Equal(
            TimeSpan.FromSeconds(15),
            HeartbeatUrgency.Next(At(0), At(0), Normal, stateChanged: false));
    }

    [Fact]
    public void Without_a_change_only_the_remaining_time_is_waited()
    {
        Assert.Equal(
            TimeSpan.FromSeconds(5),
            HeartbeatUrgency.Next(At(10), At(0), Normal, stateChanged: false));
    }

    [Fact]
    public void An_overdue_beat_goes_at_once()
    {
        Assert.Equal(
            TimeSpan.Zero,
            HeartbeatUrgency.Next(At(20), At(0), Normal, stateChanged: false));
    }

    // ── অবস্থা বদলেছে ───────────────────────────────────────────────────────

    /**
     * ⭐⭐⭐ <b>এই ফাইলের মূল দাবি।</b> কর্মী কাজ শুরু করার সাথে সাথেই
     * খবরটা যায় — পরের নির্ধারিত heartbeat-এর জন্য অপেক্ষা নয়।
     *
     * ⚠️ ক্ষতিটা কেবল দেরির নয়, বিশ্বাসের: মালিক পর্দায় দেখেন "Idle",
     * পাশে গিয়ে দেখেন তিনি টাইপ করছেন।
     */
    [Fact]
    public void A_state_change_is_reported_at_once()
    {
        Assert.Equal(
            TimeSpan.Zero,
            HeartbeatUrgency.Next(At(5), At(0), Normal, stateChanged: true));
    }

    /**
     * ⭐⭐ <b>উল্টো দিকের দাবি — সার্ভারে ঢেউ ওঠে না।</b>
     *
     * ⚠️⚠️ কেউ পড়তে পড়তে টুকে নিলে অবস্থা সেকেন্ডে সেকেন্ডে বদলায়।
     * ছাদ না থাকলে ১৫টা PC মিলে সার্ভারে অনবরত ধাক্কা দিত, আর লাভ শূন্য —
     * মানুষের চোখে ৩ সেকেন্ড আর ০ সেকেন্ড এক।
     */
    [Fact]
    public void Two_changes_in_a_row_are_not_two_beats_in_a_row()
    {
        Assert.Equal(
            TimeSpan.FromSeconds(3),
            HeartbeatUrgency.Next(At(0), At(0), Normal, stateChanged: true));

        Assert.Equal(
            TimeSpan.FromSeconds(1),
            HeartbeatUrgency.Next(At(2), At(0), Normal, stateChanged: true));
    }

    /// <summary>⚠️ সীমানা — ঠিক MinGap-এ অপেক্ষা শেষ</summary>
    [Fact]
    public void The_floor_is_exactly_the_min_gap()
    {
        Assert.Equal(
            TimeSpan.Zero,
            HeartbeatUrgency.Next(At(3), At(0), Normal, stateChanged: true));
    }

    [Fact]
    public void The_min_gap_is_three_seconds()
    {
        Assert.Equal(TimeSpan.FromSeconds(3), HeartbeatUrgency.MinGap);
    }

    /**
     * ⭐ বদল সবসময় <b>দ্রুত করে</b>, কখনো ধীর করে না।
     *
     * ⚠️ নইলে একটা অদ্ভুত অবস্থা তৈরি হতো: অবস্থা বদলানোর কারণে খবরটা
     * আরও দেরিতে যেত।
     */
    [Theory]
    [InlineData(0)]
    [InlineData(3)]
    [InlineData(7)]
    [InlineData(14)]
    [InlineData(30)]
    public void A_change_never_makes_the_wait_longer(double elapsed)
    {
        var calm = HeartbeatUrgency.Next(At(elapsed), At(0), Normal, stateChanged: false);
        var urgent = HeartbeatUrgency.Next(At(elapsed), At(0), Normal, stateChanged: true);

        Assert.True(urgent <= calm, $"{urgent} > {calm} at {elapsed}s");
    }

    /**
     * ⚠️⚠️ ঘড়ি পিছিয়ে গেলে (NTP সংশোধন) হিসাবটা ঋণাত্মক হতো, আর অপেক্ষা
     * দাঁড়াত <b>বিশাল</b> — heartbeat ঘণ্টার পর ঘণ্টা বন্ধ, আর G01
     * অ্যালার্ট প্রতিটা মেশিনে জ্বলে উঠত।
     */
    [Fact]
    public void A_clock_going_backwards_does_not_stall_the_heartbeat()
    {
        var wait = HeartbeatUrgency.Next(At(0), At(600), Normal, stateChanged: false);

        Assert.True(wait <= Normal, $"waited {wait}");
    }
}
