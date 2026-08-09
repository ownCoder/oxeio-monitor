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
            all.AddRange(sm.Tick(from.AddSeconds(i), sinceLastInput(i), locked));
        return all;
    }

    [Fact]
    public void কাজ_করতে_থাকলে_কোনো_সেগমেন্ট_বন্ধ_হয়_না()
    {
        var sm = New();
        var closed = Run(sm, Start, 600, _ => TimeSpan.Zero);

        Assert.Empty(closed);
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
        Run(sm, Start, 300, _ => TimeSpan.Zero);

        // ১০ মিনিট কেউ নেই (৩০১ থেকে ৯০০ সেকেন্ড পর্যন্ত টিক)
        Run(sm, Start.AddSeconds(300), 600, i => TimeSpan.FromSeconds(i));
        // ঠিক ৯০০ সেকেন্ডের মাথায় ফিরে এসে মাউস নাড়ল
        var closed = sm.Tick(Start.AddSeconds(900), TimeSpan.Zero, locked: false);

        var idle = Assert.Single(closed);
        Assert.Equal(SegmentState.Idle, idle.State);
        Assert.Equal(600, idle.DurationSec); // ৩০০ → ৯০০, ঠিক ১০ মিনিট
        Assert.False(idle.CountsAsWork);
    }

    [Fact]
    public void ইনপুট_পেলেই_সাথে_সাথে_আবার_চালু()
    {
        var sm = New();
        Run(sm, Start, 300, _ => TimeSpan.Zero);
        Run(sm, Start.AddSeconds(300), 120, i => TimeSpan.FromSeconds(i));
        Assert.Equal(SegmentState.Idle, sm.State);

        // এক টিকেই ফিরে আসা — কোনো অপেক্ষা নেই (B03)
        sm.Tick(Start.AddSeconds(421), TimeSpan.Zero, locked: false);
        Assert.Equal(SegmentState.Active, sm.State);
    }

    [Fact]
    public void লক_করলে_LOCKED_আনলকের_পর_ইনপুট_পেলে_ACTIVE()
    {
        var sm = New();
        Run(sm, Start, 60, _ => TimeSpan.Zero);

        var closed = sm.Tick(Start.AddSeconds(61), TimeSpan.Zero, locked: true);
        Assert.Single(closed);
        Assert.Equal(SegmentState.Locked, sm.State);

        // লক থাকা অবস্থায় সময় গোনা হয় না
        Run(sm, Start.AddSeconds(61), 300, _ => TimeSpan.Zero, locked: true);
        Assert.Equal(SegmentState.Locked, sm.State);

        closed = sm.Tick(Start.AddSeconds(362), TimeSpan.Zero, locked: false);
        var locked = Assert.Single(closed);
        Assert.Equal(SegmentState.Locked, locked.State);
        Assert.False(locked.CountsAsWork);
        Assert.Equal(SegmentState.Active, sm.State);
    }

    [Fact]
    public void আনলকের_পর_কেউ_না_ছুঁলে_IDLE_হয়_ACTIVE_নয়()
    {
        var sm = New();
        sm.Tick(Start.AddSeconds(1), TimeSpan.Zero, locked: true);

        // আনলক হলো, কিন্তু শেষ ইনপুট অনেক আগের
        sm.Tick(Start.AddSeconds(400), TimeSpan.FromSeconds(300), locked: false);

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

        var part = Assert.Single(closed);
        Assert.Equal(new DateOnly(2026, 8, 8), part.WorkDate);
        Assert.Equal(600, part.DurationSec); // ২৩:৫০ → ০০:০০
        Assert.Equal(new DateTimeOffset(2026, 8, 8, 18, 0, 0, TimeSpan.Zero), part.EndedAt);

        // পরের অংশটা এখনো খোলা, আর সেটা নতুন তারিখে
        Assert.Equal(new DateTimeOffset(2026, 8, 8, 18, 0, 0, TimeSpan.Zero), sm.OpenedAt);

        var rest = sm.CloseAll(lateNight.AddMinutes(20));
        var second = Assert.Single(rest);
        Assert.Equal(new DateOnly(2026, 8, 9), second.WorkDate);
        Assert.Equal(600, second.DurationSec);
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

        closed.AddRange(sm.Tick(Start.AddSeconds(600), TimeSpan.Zero, locked: false));
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
}
