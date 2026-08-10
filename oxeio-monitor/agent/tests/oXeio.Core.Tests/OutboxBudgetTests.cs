using oXeio.Core.Agent;

namespace oXeio.Core.Tests;

public class OutboxBudgetTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 10, 12, 0, 0, TimeSpan.Zero);

    /// <summary>ক্যাপ ১০০০, লক্ষ্য ৬০০, ৭ দিন / সেগমেন্টে ৩০ দিন।</summary>
    private static OutboxBudget Small() =>
        new(1000, 600, TimeSpan.FromDays(7), TimeSpan.FromDays(30));

    private static OutboxEntryInfo Entry(
        long id, OutboundKind kind, long bytes, double ageDays = 0, bool leased = false) =>
        new(id, kind, Now - TimeSpan.FromDays(ageDays), bytes, leased);

    // ── কিছুই করার না থাকলে ─────────────────────────────────────────────────

    [Fact]
    public void খালি_আউটবক্সে_কিছুই_হয়_না()
    {
        var plan = Small().Plan([], Now);

        Assert.True(plan.IsEmpty);
        Assert.Equal(0L, plan.BytesBefore);
    }

    [Fact]
    public void ক্যাপের_নিচে_থাকলে_কিছুই_বাদ_যায়_না()
    {
        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Screenshot, 400),
            Entry(2, OutboundKind.Segment, 100),
        ];

        var plan = Small().Plan(entries, Now);

        Assert.True(plan.IsEmpty);
        Assert.Equal(500L, plan.BytesBefore);
        Assert.Equal(500L, plan.BytesAfter);
    }

    // ── কোনটা আগে যায় ───────────────────────────────────────────────────────

    /// <summary>
    /// একটা স্ক্রিনশট ≈ হাজারখানেক সেগমেন্টের সমান জায়গা। জায়গা খালি করতে
    /// সেগমেন্ট ছোঁয়ার কোনো কারণই নেই।
    /// </summary>
    [Fact]
    public void জায়গা_দরকার_হলে_স্ক্রিনশটই_আগে_যায়()
    {
        var budget = new OutboxBudget(1000, 900, TimeSpan.FromDays(7), TimeSpan.FromDays(30));

        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Segment, 600),
            Entry(2, OutboundKind.Screenshot, 600),
        ];

        var plan = budget.Plan(entries, Now);

        Assert.Equal(new[] { 2L }, plan.OverBudgetRowIds);
        Assert.Empty(plan.ExpiredRowIds);
        Assert.Equal(600L, plan.BytesAfter);
    }

    [Fact]
    public void ক্রম_স্ক্রিনশট_তারপর_app_usage_তারপর_event_সবশেষে_segment()
    {
        var budget = new OutboxBudget(10, 1, TimeSpan.FromDays(7), TimeSpan.FromDays(30));

        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Segment, 100),
            Entry(2, OutboundKind.Event, 100),
            Entry(3, OutboundKind.AppUsage, 100),
            Entry(4, OutboundKind.Screenshot, 100),
        ];

        var plan = budget.Plan(entries, Now);

        Assert.Equal(new[] { 4L, 3L, 2L, 1L }, plan.OverBudgetRowIds);
    }

    [Fact]
    public void একই_ধরনের_মধ্যে_পুরোনোটাই_আগে_যায়()
    {
        var budget = new OutboxBudget(1000, 900, TimeSpan.FromDays(7), TimeSpan.FromDays(30));

        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Screenshot, 600, ageDays: 1),
            Entry(2, OutboundKind.Screenshot, 600, ageDays: 5),
        ];

        var plan = budget.Plan(entries, Now);

        Assert.Equal(new[] { 2L }, plan.OverBudgetRowIds); // ৫ দিনের পুরোনোটা
    }

    /// <summary>
    /// শেষ উপায় হিসেবে সেগমেন্টও যায় — কিন্তু তখন আর কিছুই বাকি নেই।
    /// নিয়মটা "সেগমেন্ট অমর" নয়, "সেগমেন্ট সবার শেষে"।
    /// </summary>
    [Fact]
    public void আর_কিছু_না_থাকলে_সেগমেন্টও_যায়()
    {
        var budget = new OutboxBudget(100, 50, TimeSpan.FromDays(7), TimeSpan.FromDays(30));

        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Segment, 50, ageDays: 3),
            Entry(2, OutboundKind.Segment, 50, ageDays: 2),
            Entry(3, OutboundKind.Segment, 50, ageDays: 1),
        ];

        var plan = budget.Plan(entries, Now);

        Assert.Equal(new[] { 1L, 2L }, plan.OverBudgetRowIds);
        Assert.Equal(50L, plan.BytesAfter);
    }

    // ── হিস্টেরেসিস ─────────────────────────────────────────────────────────

    /// <summary>
    /// ঠিক ক্যাপে থামলে পরের প্রতিটা স্ক্রিনশটেই আবার একটা করে ছাঁটাই চলত —
    /// প্রতি ৫ মিনিটে একটা করে DELETE + fsync, সপ্তাহের পর সপ্তাহ।
    /// </summary>
    [Fact]
    public void লক্ষ্যে_নেমে_এলেই_ছাঁটাই_থামে()
    {
        var entries = new List<OutboxEntryInfo>();
        for (var i = 1; i <= 10; i++)
            entries.Add(Entry(i, OutboundKind.Screenshot, 150, ageDays: (10 - i) * 0.5));

        var plan = Small().Plan(entries, Now); // মোট ১৫০০, ক্যাপ ১০০০, লক্ষ্য ৬০০

        Assert.Empty(plan.ExpiredRowIds);
        Assert.Equal(6, plan.OverBudgetRowIds.Count);
        Assert.Equal(600L, plan.BytesAfter);
    }

    // ── বয়স ─────────────────────────────────────────────────────────────────

    [Fact]
    public void ক্যাপের_নিচে_থাকলেও_পুরোনো_স্ক্রিনশট_যায়()
    {
        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Screenshot, 10, ageDays: 8),
            Entry(2, OutboundKind.Screenshot, 10, ageDays: 6),
        ];

        var plan = Small().Plan(entries, Now);

        Assert.Equal(new[] { 1L }, plan.ExpiredRowIds);
        Assert.Empty(plan.OverBudgetRowIds);
    }

    /// <summary>
    /// ⚠️ এটাই সবচেয়ে দামি নিয়ম: দুই সপ্তাহের লাইন-বিভ্রাটে ৭ দিনের রিটেনশন
    /// পুরো পাক্ষিকের বেতন মুছে দিত।
    /// </summary>
    [Fact]
    public void সেগমেন্টের_মেয়াদ_আলাদা_ও_অনেক_লম্বা()
    {
        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Segment, 10, ageDays: 8),
            Entry(2, OutboundKind.Screenshot, 10, ageDays: 8),
        ];

        var plan = Small().Plan(entries, Now);

        Assert.Equal(new[] { 2L }, plan.ExpiredRowIds); // শুধু স্ক্রিনশট
    }

    [Fact]
    public void ত্রিশ_দিন_পেরোলে_সেগমেন্টও_মেয়াদ_হারায়()
    {
        OutboxEntryInfo[] entries = [Entry(1, OutboundKind.Segment, 10, ageDays: 31)];

        var plan = Small().Plan(entries, Now);

        Assert.Equal(new[] { 1L }, plan.ExpiredRowIds);
    }

    // ── ধার নেওয়া সারি ──────────────────────────────────────────────────────

    /// <summary>
    /// ধার নেওয়া মানে এই মুহূর্তে আপলোড হচ্ছে। নিচ থেকে .webp সরিয়ে নিলে
    /// আপলোডটা মাঝপথে ভেঙে পড়ত, আর সারিটাও হারাত।
    /// </summary>
    [Fact]
    public void ধার_নেওয়া_সারি_ছোঁয়া_হয়_না()
    {
        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Screenshot, 900, ageDays: 20, leased: true),
            Entry(2, OutboundKind.Screenshot, 400, ageDays: 1),
        ];

        var plan = Small().Plan(entries, Now); // মোট ১৩০০ > ক্যাপ ১০০০

        Assert.DoesNotContain(1L, plan.RowIds);
        Assert.Equal(new[] { 2L }, plan.OverBudgetRowIds);
    }

    [Fact]
    public void সব_সারি_ধার_নেওয়া_থাকলে_কিছুই_করার_থাকে_না()
    {
        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Screenshot, 900, ageDays: 20, leased: true),
            Entry(2, OutboundKind.Screenshot, 900, ageDays: 20, leased: true),
        ];

        var plan = Small().Plan(entries, Now);

        Assert.True(plan.IsEmpty);
        Assert.Equal(1800L, plan.BytesAfter); // ক্যাপ ছাড়িয়ে, তবু নিরাপদ পথ এটাই
    }

    // ── হিসাব ও ভ্যালিডেশন ──────────────────────────────────────────────────

    [Fact]
    public void বয়স_আর_ক্যাপ_দুটোই_একসাথে_খাটে()
    {
        OutboxEntryInfo[] entries =
        [
            Entry(1, OutboundKind.Screenshot, 700, ageDays: 8), // মেয়াদোত্তীর্ণ
            Entry(2, OutboundKind.Screenshot, 700, ageDays: 1),
            Entry(3, OutboundKind.Screenshot, 300, ageDays: 2),
            Entry(4, OutboundKind.Segment, 100),
        ];

        var plan = Small().Plan(entries, Now);

        Assert.Equal(1800L, plan.BytesBefore);
        Assert.Equal(new[] { 1L }, plan.ExpiredRowIds);
        Assert.Equal(new[] { 3L, 2L }, plan.OverBudgetRowIds); // পুরোনো স্ক্রিনশট আগে
        Assert.Equal(1700L, plan.BytesFreed);
        Assert.Equal(100L, plan.BytesAfter);        // শুধু সেগমেন্টটাই টিকে থাকে
        Assert.Equal(3, plan.RowIds.Count);
    }

    [Fact]
    public void অসম্ভব_বাজেট_নাকচ_হয়()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new OutboxBudget(0, 0, TimeSpan.FromDays(7), TimeSpan.FromDays(30)));

        // লক্ষ্য ক্যাপের চেয়ে বড় হলে হিস্টেরেসিসের কোনো মানেই থাকত না
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new OutboxBudget(1000, 2000, TimeSpan.FromDays(7), TimeSpan.FromDays(30)));

        // সেগমেন্টের মেয়াদ ছোট হলে বেতনের ডেটাই সবার আগে মুছত
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new OutboxBudget(1000, 600, TimeSpan.FromDays(7), TimeSpan.FromDays(3)));
    }

    [Fact]
    public void ডিফল্ট_বাজেট_সাত_দিনের_অফলাইন_সহ্য_করে()
    {
        // দিনে ~১৭০ MB × ৭ দিন ≈ ১.২ GB, ক্যাপ ২ GiB
        const long sevenDays = 7L * 170 * 1024 * 1024;

        Assert.True(OutboxBudget.Default.CapBytes > sevenDays);
        Assert.True(OutboxBudget.Default.TargetBytes < OutboxBudget.Default.CapBytes);
        Assert.Equal(TimeSpan.FromDays(7), OutboxBudget.Default.MaxAge);
        Assert.Equal(TimeSpan.FromDays(30), OutboxBudget.Default.SegmentMaxAge);
    }
}
