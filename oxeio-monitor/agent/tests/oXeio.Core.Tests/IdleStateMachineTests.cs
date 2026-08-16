using oXeio.Core.Models;
using oXeio.Core.Tracking;

namespace oXeio.Core.Tests;

/// <summary>
/// [02-Workflow § ৯]-এর ম্যানুয়াল চেকলিস্টের যেসব পয়েন্ট স্বয়ংক্রিয়ভাবে যাচাই করা যায়।
/// বাকিগুলো (স্ক্রিন ক্যাপচার, tray, AV) আসল ডেস্কটপেই দেখতে হবে।
/// </summary>
public class IdleStateMachineTests
{
    private static readonly TimeSpan Threshold = TimeSpan.FromSeconds(60);
    private static readonly DateTimeOffset Start =
        new(2026, 8, 9, 4, 0, 0, TimeSpan.Zero); // ঢাকায় সকাল ১০টা

    private static IdleStateMachine New(DateTimeOffset? at = null) =>
        new(Threshold, at ?? Start);

    /// <summary>এক সেকেন্ড করে এগিয়ে ইনপুট দিতে থাকে (মানুষ কাজ করছে)।</summary>
    private static List<ActivitySegment> Run(
        IdleStateMachine sm,
        DateTimeOffset from,
        int seconds,
        Func<int, TimeSpan> sinceLastInput,
        bool locked = false)
    {
        var all = new List<ActivitySegment>();
        for (var i = 1; i <= seconds; i++)
            all.AddRange(sm.Tick(from.AddSeconds(i), sinceLastInput(i), locked, screenFrozen: false));
        return all;
    }

    /// <summary>
    /// আগে এই টেস্ট বলত "কাজ করতে থাকলে কোনো সেগমেন্ট বন্ধ হয় না" — আর
    /// সেটাই ছিল বাগ: টানা কাজের সময়টুকু কিউয়ে না গিয়ে মেমরিতে খোলা থাকত,
    /// আর বিদ্যুৎ গেলে হারাত ([G53](../../../../docs/08-Gap-Analysis.md))।
    /// এখন স্টেট বদলায় না, কিন্তু রেকর্ড নিয়মিত বেরোয়।
    /// </summary>
    [Fact]
    public void কাজ_করতে_থাকলেও_রেকর্ড_নিয়মিত_বেরোয়_কিন্তু_স্টেট_বদলায়_না()
    {
        var sm = New();
        var closed = Run(sm, Start, 600, _ => TimeSpan.Zero);

        Assert.NotEmpty(closed);
        Assert.All(closed, c => Assert.Equal(SegmentState.Active, c.State));
        Assert.Equal(SegmentState.Active, sm.State);
    }

    [Fact]
    public void ঠিক_৬০_সেকেন্ড_নিষ্ক্রিয়তায়_টাইমার_থামে()
    {
        var sm = New();

        // ৫ মিনিট কাজ, তারপর হাত সরিয়ে নেওয়া
        Run(sm, Start, 300, _ => TimeSpan.Zero);
        var afterWork = Start.AddSeconds(300);

        var closed = Run(sm, afterWork, 59, i => TimeSpan.FromSeconds(i));
        Assert.Empty(closed); // ৫৯ সেকেন্ডে এখনো ACTIVE

        closed = Run(sm, afterWork.AddSeconds(59), 1, _ => TimeSpan.FromSeconds(60));
        Assert.Single(closed);
        Assert.Equal(SegmentState.Idle, sm.State);
    }

    [Fact]
    public void Retro_adjust_ঠিক_৬০_সেকেন্ড_পিছিয়ে_কাটে()
    {
        var sm = New();
        Run(sm, Start, 300, _ => TimeSpan.Zero);

        var closed = Run(sm, Start.AddSeconds(300), 60, i => TimeSpan.FromSeconds(i));

        var active = Assert.Single(closed);
        Assert.Equal(SegmentState.Active, active.State);
        // idle শুরু হয়েছিল ৩০০ সেকেন্ডে, ৩৬০-এ নয় — ওই ৬০ সেকেন্ডও বাদ (B04)
        Assert.Equal(Start.AddSeconds(300), active.EndedAt);
        Assert.Equal(300, active.DurationSec);
    }

    [Fact]
    public void দশ_মিনিট_দূরে_থাকলে_ঠিক_দশ_মিনিটই_বাদ_যায়()
    {
        var sm = New();
        var all = Run(sm, Start, 300, _ => TimeSpan.Zero).ToList();

        // ১০ মিনিট কেউ নেই (৩০১ থেকে ৯০০ সেকেন্ড পর্যন্ত টিক)
        all.AddRange(Run(sm, Start.AddSeconds(300), 600, i => TimeSpan.FromSeconds(i)));
        // ঠিক ৯০০ সেকেন্ডের মাথায় ফিরে এসে মাউস নাড়ল
        all.AddRange(sm.Tick(Start.AddSeconds(900), TimeSpan.Zero, locked: false, screenFrozen: false));

        // ⚠️ এখন লম্বা সেগমেন্ট ৫ মিনিটেও ভাগ হয়, তাই সংখ্যা নয় — **যোগফল**
        //    যাচাই করা হয়। নিয়মটা একই: ১০ মিনিট দূরে থাকলে ঠিক ১০ মিনিটই বাদ।
        var idleAll = all.Where(c => c.State == SegmentState.Idle).ToList();

        Assert.NotEmpty(idleAll);
        Assert.Equal(600, idleAll.Sum(c => c.DurationSec));
        Assert.All(idleAll, c => Assert.False(c.CountsAsWork));
    }

    [Fact]
    public void ইনপুট_পেলেই_সাথে_সাথে_আবার_চালু()
    {
        var sm = New();
        Run(sm, Start, 300, _ => TimeSpan.Zero);
        Run(sm, Start.AddSeconds(300), 120, i => TimeSpan.FromSeconds(i));
        Assert.Equal(SegmentState.Idle, sm.State);

        // এক টিকেই ফিরে আসা — কোনো অপেক্ষা নেই (B03)
        sm.Tick(Start.AddSeconds(421), TimeSpan.Zero, locked: false, screenFrozen: false);
        Assert.Equal(SegmentState.Active, sm.State);
    }

    [Fact]
    public void লক_করলে_LOCKED_আনলকের_পর_ইনপুট_পেলে_ACTIVE()
    {
        var sm = New();
        Run(sm, Start, 60, _ => TimeSpan.Zero);

        var closed = sm.Tick(Start.AddSeconds(61), TimeSpan.Zero, locked: true, screenFrozen: false);
        Assert.Single(closed);
        Assert.Equal(SegmentState.Locked, sm.State);

        // লক থাকা অবস্থায় সময় গোনা হয় না
        Run(sm, Start.AddSeconds(61), 300, _ => TimeSpan.Zero, locked: true);
        Assert.Equal(SegmentState.Locked, sm.State);

        closed = sm.Tick(Start.AddSeconds(362), TimeSpan.Zero, locked: false, screenFrozen: false);
        var locked = Assert.Single(closed);
        Assert.Equal(SegmentState.Locked, locked.State);
        Assert.False(locked.CountsAsWork);
        Assert.Equal(SegmentState.Active, sm.State);
    }

    [Fact]
    public void আনলকের_পর_কেউ_না_ছুঁলে_IDLE_হয়_ACTIVE_নয়()
    {
        var sm = New();
        sm.Tick(Start.AddSeconds(1), TimeSpan.Zero, locked: true, screenFrozen: false);

        // আনলক হলো, কিন্তু শেষ ইনপুট অনেক আগের
        sm.Tick(Start.AddSeconds(400), TimeSpan.FromSeconds(300), locked: false, screenFrozen: false);

        Assert.Equal(SegmentState.Idle, sm.State);
    }

    [Fact]
    public void ঘুম_থেকে_জাগলে_ভুতুড়ে_সময়_যোগ_হয়_না()
    {
        var sm = New();
        Run(sm, Start, 300, _ => TimeSpan.Zero);

        var suspendAt = Start.AddSeconds(300);
        var closed = sm.OnSuspend(suspendAt);
        var active = Assert.Single(closed);
        Assert.Equal(300, active.DurationSec);

        // ৮ ঘণ্টা ঘুম
        var resumeAt = suspendAt.AddHours(8);
        closed = sm.OnResume(resumeAt);

        // ঘুমের সময়টা LOCKED হিসেবে বন্ধ হলো — কাজ হিসেবে নয়
        Assert.All(closed, s => Assert.False(s.CountsAsWork));
        Assert.Equal(SegmentState.Idle, sm.State);
    }

    [Fact]
    public void মধ্যরাত_পার_হলে_সেগমেন্ট_দুই_তারিখে_ভাগ_হয়()
    {
        // ঢাকায় ২৩:৫০ = 17:50Z
        var lateNight = new DateTimeOffset(2026, 8, 8, 17, 50, 0, TimeSpan.Zero);
        var sm = New(lateNight);

        // ২০ মিনিট একটানা কাজ — মধ্যরাত পেরিয়ে
        var closed = Run(sm, lateNight, 20 * 60, _ => TimeSpan.Zero);

        // ⚠️ লম্বা সেগমেন্ট ৫ মিনিটেও ভাগ হয়, তাই একাধিক টুকরো আসে।
        //    যা যাচাই করার: মধ্যরাতের **আগের** সব টুকরো আগের তারিখে, আর
        //    সেগুলোর যোগফল ঠিক ১০ মিনিট (২৩:৫০ → ০০:০০)।
        var midnight = new DateTimeOffset(2026, 8, 8, 18, 0, 0, TimeSpan.Zero);
        var before = closed.Where(c => c.EndedAt <= midnight).ToList();

        Assert.NotEmpty(before);
        Assert.All(before, c => Assert.Equal(new DateOnly(2026, 8, 8), c.WorkDate));
        Assert.Equal(600, before.Sum(c => c.DurationSec));
        Assert.Equal(midnight, before[^1].EndedAt);

        // মধ্যরাতের পরের অংশ — টুকরো যতগুলোই হোক, সবই নতুন তারিখে,
        // আর যোগফল ঠিক ১০ মিনিট (০০:০০ → ০০:১০)
        var after = closed.Where(c => c.StartedAt >= midnight).ToList();
        after.AddRange(sm.CloseAll(lateNight.AddMinutes(20)));

        Assert.NotEmpty(after);
        Assert.All(after, c => Assert.Equal(new DateOnly(2026, 8, 9), c.WorkDate));
        Assert.Equal(600, after.Sum(c => c.DurationSec));
    }

    [Fact]
    public void কোনো_সেগমেন্টই_দুই_তারিখ_জুড়ে_থাকে_না()
    {
        var lateNight = new DateTimeOffset(2026, 8, 8, 17, 0, 0, TimeSpan.Zero);
        var sm = New(lateNight);

        var closed = Run(sm, lateNight, 3 * 60 * 60, _ => TimeSpan.Zero);
        closed.AddRange(sm.CloseAll(lateNight.AddHours(3)));

        Assert.All(closed, s =>
            Assert.Equal(
                oXeio.Core.Time.DhakaTime.WorkDateOf(s.StartedAt),
                oXeio.Core.Time.DhakaTime.WorkDateOf(s.EndedAt.AddTicks(-1))));
    }

    [Fact]
    public void শুধু_ACTIVE_কাজ_হিসেবে_গোনা_হয়()
    {
        var sm = New();
        var closed = Run(sm, Start, 300, _ => TimeSpan.Zero);   // ০ → ৩০০ কাজ

        // ৩০০ → ৬০০ নিষ্ক্রিয় · এখানেই প্রথম ACTIVE সেগমেন্টটা বন্ধ হয়
        closed.AddRange(Run(sm, Start.AddSeconds(300), 300, i => TimeSpan.FromSeconds(i)));

        closed.AddRange(sm.Tick(Start.AddSeconds(600), TimeSpan.Zero, locked: false, screenFrozen: false));
        closed.AddRange(sm.CloseAll(Start.AddSeconds(700)));    // ৬০০ → ৭০০ কাজ

        var worked = closed.Where(s => s.CountsAsWork).Sum(s => s.DurationSec);
        var notWorked = closed.Where(s => !s.CountsAsWork).Sum(s => s.DurationSec);

        Assert.Equal(400, worked);     // ৩০০ + ১০০
        Assert.Equal(300, notWorked);  // retro-adjust ধরে ঠিক ৫ মিনিট
    }

    [Fact]
    public void Input_score_শূন্য_থেকে_একশো_র_মধ্যে_থাকে()
    {
        var sm = New();
        // অর্ধেক সেকেন্ডে ইনপুট, অর্ধেকে নয় — কিন্তু কখনোই threshold ছাড়ায় না
        Run(sm, Start, 300, i => i % 2 == 0 ? TimeSpan.Zero : TimeSpan.FromSeconds(5));
        var closed = sm.CloseAll(Start.AddSeconds(300));

        var seg = Assert.Single(closed);
        Assert.NotNull(seg.InputScore);
        Assert.InRange(seg.InputScore!.Value, 0, 100);
        Assert.Equal(50, seg.InputScore);
    }

    // ── G46 · নকল ইনপুট: পর্দা জমে থাকলে গোনা বন্ধ ────────────────────────

    /// <summary>
    /// ⭐⭐⭐ <b>এই ফিচারের গোটা উদ্দেশ্য।</b>
    ///
    /// জিগলার চললে <c>sinceLastInput</c> সবসময় শূন্যের কাছাকাছি থাকে —
    /// অর্থাৎ পুরোনো নিয়মে চিরকাল ACTIVE। পর্দা জমে আছে জানলে সেটা আর
    /// বিশ্বাস করা হয় না।
    /// </summary>
    [Fact]
    public void Frozen_screen_stops_counting_even_with_fresh_input()
    {
        var sm = new IdleStateMachine(Threshold, Start);

        // ইনপুট একদম তাজা, তবু পর্দা জমা
        sm.Tick(Start.AddSeconds(1), TimeSpan.Zero, locked: false, screenFrozen: true);

        Assert.Equal(SegmentState.Idle, sm.State);
    }

    /// <summary>⭐ পর্দা আবার বদলালে সাথে সাথেই গোনা ফেরে — অপেক্ষা নেই</summary>
    [Fact]
    public void Screen_moving_again_resumes_counting()
    {
        var sm = new IdleStateMachine(Threshold, Start);

        sm.Tick(Start.AddSeconds(1), TimeSpan.Zero, locked: false, screenFrozen: true);
        Assert.Equal(SegmentState.Idle, sm.State);

        sm.Tick(Start.AddSeconds(2), TimeSpan.Zero, locked: false, screenFrozen: false);

        Assert.Equal(SegmentState.Active, sm.State);
    }

    /// <summary>
    /// ⚠️⚠️ পর্দা জমার কারণে থামলে <b>পিছিয়ে কাটা হয় না</b>।
    ///
    /// আসল idle-এ retro-adjust হয় (threshold-টা আগে থেকেই idle ছিল), কিন্তু
    /// এখানে নয়: পর্দা দশ মিনিট ধরে জমে ছিল, আর ওই দশ মিনিট পিছিয়ে কেটে
    /// দিলে <b>লম্বা নথি পড়া সৎ কর্মীর সময়ও কেটে যেত</b>। ⭐ ভুল করলে
    /// কর্মীর পক্ষে — সেগমেন্টটা <b>এখন</b> বন্ধ হয়, আগে নয়।
    /// </summary>
    [Fact]
    public void Frozen_screen_does_not_retro_adjust()
    {
        var sm = new IdleStateMachine(Threshold, Start);
        var at = Start.AddSeconds(120);

        var closed = sm.Tick(at, TimeSpan.Zero, locked: false, screenFrozen: true);

        var active = Assert.Single(closed);
        Assert.Equal(SegmentState.Active, active.State);
        Assert.Equal(at, active.EndedAt);
    }

    /// <summary>⚠️ লক থাকলে পর্দার প্রশ্নই ওঠে না — LOCKED আগে</summary>
    [Fact]
    public void Locked_wins_over_frozen()
    {
        var sm = new IdleStateMachine(Threshold, Start);

        sm.Tick(Start.AddSeconds(1), TimeSpan.Zero, locked: true, screenFrozen: true);

        Assert.Equal(SegmentState.Locked, sm.State);
    }
}
