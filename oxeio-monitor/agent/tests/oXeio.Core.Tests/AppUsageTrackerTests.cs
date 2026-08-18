using oXeio.Core.Apps;
using oXeio.Core.Models;

namespace oXeio.Core.Tests;

public class AppUsageTrackerTests
{
    private static readonly DateTimeOffset T0 =
        new(2026, 8, 10, 10, 0, 0, TimeSpan.FromHours(6));

    private static WindowSample App(string process, string? title = null) =>
        new() { ProcessName = process, WindowTitle = title };

    private static WindowSample Browser(string url, string? title = null) =>
        new()
        {
            ProcessName = "chrome.exe",
            AppName = "Google Chrome",
            WindowTitle = title,
            RawUrl = url,
            IsBrowser = true,
        };

    private static AppUsageTracker New() => new();

    [Fact]
    public void একই_অ্যাপে_থাকলে_একটাই_রেকর্ড()
    {
        var t = New();

        t.Observe(App("code.exe"), T0, SegmentState.Active);
        t.Observe(App("code.exe"), T0.AddSeconds(30), SegmentState.Active);
        var closed = t.Observe(App("excel.exe"), T0.AddSeconds(60), SegmentState.Active);

        var r = Assert.Single(closed);
        Assert.Equal("code.exe", r.ProcessName);
        Assert.Equal(60, r.DurationSec);
    }

    /// <summary>
    /// D04। alt-tab করে ফাইল খুঁজতে গিয়ে কেউ দশটা উইন্ডো ছুঁয়ে যায় —
    /// প্রতিটা রেকর্ড হলে রিপোর্টে আসল ছবিটা ঢাকা পড়ত।
    /// </summary>
    [Fact]
    public void পাঁচ_সেকেন্ডের_কম_হলে_রেকর্ড_হয়_না()
    {
        var t = New();
        var all = new List<oXeio.Core.Agent.AppUsageRecord>();

        for (var i = 0; i < 10; i++)
            all.AddRange(t.Observe(App($"app{i}.exe"), T0.AddSeconds(i), SegmentState.Active));

        all.AddRange(t.CloseAll(T0.AddSeconds(10)));

        Assert.Empty(all);
    }

    [Fact]
    public void ঠিক_পাঁচ_সেকেন্ড_হলে_রেকর্ড_হয়()
    {
        var t = New();

        t.Observe(App("code.exe"), T0, SegmentState.Active);
        var closed = t.Observe(App("excel.exe"), T0.AddSeconds(5), SegmentState.Active);

        Assert.Single(closed);
        Assert.Equal(5, closed[0].DurationSec);
    }

    /// <summary>
    /// কেউ লাঞ্চে গেলে পর্দায় Excel খোলা থাকে। ওই এক ঘণ্টা
    /// "Excel ব্যবহার" নয় — কাজের সময়ের হিসাবেও ওটা গোনা হয় না।
    /// </summary>
    /// <summary>
    /// ⭐⭐ <b>R22a-তে এই চুক্তিটা বদলেছে</b> — আর বদলটা সচেতন।
    ///
    /// আগে idle-এ ঢুকলে ট্র্যাকার থেমে যেত, অর্থাৎ ওই সময়ের কোনো রেকর্ডই
    /// থাকত না। ⚠️⚠️ তাতে "এই idle সময়টায় সামনে কী ছিল?" প্রশ্নের উত্তর
    /// চিরতরে হারাত — আর ওটাই মিটিং চেনার একমাত্র সূত্র (Zoom-এ থাকলে
    /// কি-বোর্ড চুপ, অথচ মানুষটা কাজেই আছে)।
    ///
    /// ⭐ <b>"লাঞ্চে Excel খোলা রেখে যাওয়া কাজ নয়" নিয়মটা ভাঙেনি</b> —
    /// শুধু জায়গা বদলেছে: রেকর্ডটা জমা হয় <c>State = Idle</c> নিয়ে, আর
    /// সার্ভারে পড়ার প্রতিটা জায়গা কেবল ACTIVE ছাঁকে। <b>রেকর্ড থাকা</b>
    /// আর <b>গোনা হওয়া</b> — দুটো আলাদা জিনিস।
    /// </summary>
    [Fact]
    public void নিষ্ক্রিয়_অবস্থায়ও_রেকর্ড_হয়_কিন্তু_আলাদা_চিহ্নে()
    {
        var t = New();

        t.Observe(App("excel.exe"), T0, SegmentState.Active);

        // অবস্থা বদলেছে — ACTIVE খণ্ডটা এখানেই কাটা পড়ে
        var closed = t.Observe(App("excel.exe"), T0.AddSeconds(30), SegmentState.Idle);
        Assert.Single(closed);
        Assert.Equal(30, closed[0].DurationSec);
        Assert.Equal(SegmentState.Active, closed[0].State);

        // ⭐ idle-এর সময়টুকুও এখন জমে — কিন্তু Idle চিহ্ন নিয়ে
        var more = t.Observe(App("excel.exe"), T0.AddMinutes(6), SegmentState.Idle);
        Assert.NotEmpty(more);
        Assert.All(more, r => Assert.Equal(SegmentState.Idle, r.State));
    }

    /// <summary>
    /// ⚠️ একটা রেকর্ড অর্ধেক ACTIVE অর্ধেক IDLE হতে পারে না — নইলে "এই
    /// সময়টা গোনা হবে কি না" প্রশ্নের কোনো একক উত্তর থাকত না।
    /// </summary>
    [Fact]
    public void অবস্থা_বদলালে_খণ্ড_ওখানেই_কাটে()
    {
        var t = New();

        t.Observe(App("zoom.exe"), T0, SegmentState.Active);
        var atIdle = t.Observe(App("zoom.exe"), T0.AddSeconds(20), SegmentState.Idle);
        var backActive = t.Observe(App("zoom.exe"), T0.AddSeconds(50), SegmentState.Active);

        Assert.Single(atIdle);
        Assert.Equal(SegmentState.Active, atIdle[0].State);
        Assert.Equal(20, atIdle[0].DurationSec);

        Assert.Single(backActive);
        Assert.Equal(SegmentState.Idle, backActive[0].State);
        Assert.Equal(30, backActive[0].DurationSec);
    }

    /// <summary>⭐ স্বাভাবিক অবস্থায় চিহ্নটা ACTIVE — ডিফল্ট বদলে যায়নি।</summary>
    [Fact]
    public void সচল_অবস্থার_রেকর্ডে_চিহ্ন_Active()
    {
        var t = New();

        t.Observe(App("code.exe"), T0, SegmentState.Active);
        var closed = t.Observe(App("excel.exe"), T0.AddSeconds(40), SegmentState.Active);

        Assert.Single(closed);
        Assert.Equal(SegmentState.Active, closed[0].State);
    }

    [Fact]
    public void লক_করা_অবস্থায়ও_গোনা_হয়_না()
    {
        var t = New();

        t.Observe(App("excel.exe"), T0, SegmentState.Active);
        t.Observe(App("excel.exe"), T0.AddSeconds(10), SegmentState.Locked);
        var more = t.Observe(App("excel.exe"), T0.AddMinutes(30), SegmentState.Locked);

        Assert.Empty(more);
    }

    // ── ব্রাউজার ────────────────────────────────────────────────────────────

    /// <summary>
    /// ⭐ ব্রাউজারে ডোমেইন বদলালে নতুন রেকর্ড — নইলে সারাদিন একটাই
    /// "chrome.exe ৮ ঘণ্টা" থাকত আর D08 (টপ ১০ সাইট) বানানোই যেত না।
    /// </summary>
    [Fact]
    public void ডোমেইন_বদলালে_নতুন_রেকর্ড()
    {
        var t = New();

        t.Observe(Browser("https://github.com/x"), T0, SegmentState.Active);
        var closed = t.Observe(Browser("https://youtube.com/watch?v=1"), T0.AddSeconds(30), SegmentState.Active);

        var r = Assert.Single(closed);
        Assert.Equal("github.com", r.Domain);
        Assert.True(r.IsBrowser);
    }

    [Fact]
    public void একই_ডোমেইনে_টাইটেল_বদলালে_নতুন_রেকর্ড_নয়()
    {
        // একই পেজে স্ক্রল করলেও টাইটেল বদলায় — প্রতিবার নতুন সারি হলে
        // রেকর্ডের সংখ্যা অকারণে ফুলে উঠত
        var t = New();

        t.Observe(Browser("https://github.com/a", "A · GitHub"), T0, SegmentState.Active);
        var closed = t.Observe(Browser("https://github.com/b", "B · GitHub"), T0.AddSeconds(30), SegmentState.Active);

        Assert.Empty(closed);
    }

    [Fact]
    public void ফুল_URL_কখনো_রেকর্ডে_ওঠে_না()
    {
        var t = New();

        t.Observe(Browser("https://bank.com/account/12345?token=SECRET"), T0, SegmentState.Active);
        var closed = t.Observe(App("code.exe"), T0.AddSeconds(30), SegmentState.Active);

        var r = Assert.Single(closed);
        Assert.Equal("bank.com", r.Domain);
        Assert.DoesNotContain("12345", r.Domain);
        Assert.DoesNotContain("SECRET", r.Domain);
    }

    /// <summary>
    /// ব্যক্তিগত ব্রাউজিংয়ে "ব্রাউজার ব্যবহার হয়েছে" টুকুই থাকে।
    /// টাইটেলেও পেজের নাম থাকে, তাই সেটাও বাদ — নইলে ঘুরিয়ে একই তথ্য রাখা হতো।
    /// </summary>
    [Fact]
    public void ব্যক্তিগত_ব্রাউজিংয়ে_ডোমেইন_বা_টাইটেল_কিছুই_যায়_না()
    {
        var t = New();

        t.Observe(
            Browser("https://example.com/x", "example — Chrome (Incognito)"),
            T0, SegmentState.Active);
        var closed = t.Observe(App("code.exe"), T0.AddSeconds(30), SegmentState.Active);

        var r = Assert.Single(closed);
        Assert.Equal("chrome.exe", r.ProcessName);
        Assert.Null(r.Domain);
        Assert.Null(r.WindowTitle);
    }

    // ── টেকসইতা ─────────────────────────────────────────────────────────────

    [Fact]
    public void টানা_এক_অ্যাপে_থাকলেও_রেকর্ড_নিয়মিত_বেরোয়()
    {
        // সেগমেন্টের মতোই — নইলে ক্র্যাশে পুরোটা হারাত (G53)
        var t = New();
        var all = new List<oXeio.Core.Agent.AppUsageRecord>();

        all.AddRange(t.Observe(App("code.exe"), T0, SegmentState.Active));
        for (var m = 1; m <= 17; m++)
            all.AddRange(t.Observe(App("code.exe"), T0.AddMinutes(m), SegmentState.Active));

        Assert.Equal(3, all.Count);
        Assert.All(all, r => Assert.Equal(300, r.DurationSec));
    }

    [Fact]
    public void ভাগ_হলেও_মোট_সময়_ঠিক_থাকে()
    {
        var t = New();
        var all = new List<oXeio.Core.Agent.AppUsageRecord>();

        all.AddRange(t.Observe(App("code.exe"), T0, SegmentState.Active));
        for (var m = 1; m <= 17; m++)
            all.AddRange(t.Observe(App("code.exe"), T0.AddMinutes(m), SegmentState.Active));
        all.AddRange(t.CloseAll(T0.AddMinutes(17)));

        Assert.Equal(17 * 60, all.Sum(r => r.DurationSec));
    }

    [Fact]
    public void প্রতিটি_রেকর্ডের_আলাদা_uuid()
    {
        var t = New();
        var all = new List<oXeio.Core.Agent.AppUsageRecord>();

        for (var m = 0; m <= 17; m++)
            all.AddRange(t.Observe(App("code.exe"), T0.AddMinutes(m), SegmentState.Active));

        Assert.Equal(all.Count, all.Select(r => r.ClientUuid).Distinct().Count());
    }

    [Fact]
    public void কোনো_উইন্ডো_না_থাকলে_খোলাটা_বন্ধ_হয়()
    {
        var t = New();

        t.Observe(App("code.exe"), T0, SegmentState.Active);
        var closed = t.Observe(null, T0.AddSeconds(20), SegmentState.Active);

        Assert.Single(closed);
        Assert.Null(t.CurrentProcess);
    }

    // ── A07 · ছবির সাথে জোড়া লাগানোর জন্য "এখন সামনে কী" ────────────────────

    /// <summary>
    /// ⚠️ D04-এর ৫ সেকেন্ডের নিয়ম <b>রেকর্ডের</b> নিয়ম, "এখন সামনে কী"-র নয়।
    /// প্রথম সেকেন্ডেই তোলা ছবির পাশেও নামটা বসা চাই — নইলে যে ছবিগুলো ঠিক
    /// অ্যাপ বদলানোর মুহূর্তে ওঠে সেগুলোই চিরকাল নামহীন থাকত।
    /// </summary>
    [Fact]
    public void সামনের_উইন্ডো_প্রথম_মুহূর্ত_থেকেই_জানা_যায়()
    {
        var t = New();

        t.Observe(App("excel.exe", "Q3 budget.xlsx"), T0, SegmentState.Active);

        Assert.Equal("excel.exe", t.Current?.ProcessName);
        Assert.Equal("Q3 budget.xlsx", t.Current?.WindowTitle);
    }

    /// <summary>
    /// ⭐ স্ক্রিনশট ওঠে <b>শুধু</b> ACTIVE-এ (A04), আর এখানে ACTIVE ছাড়া
    /// <c>Current</c> খালি — অর্থাৎ ছবির সাথে নাম জোড়া লাগাতে গিয়ে
    /// "লক করা পর্দার সামনে কী ছিল" কখনো বসতে পারে না।
    /// </summary>
    [Fact]
    public void ACTIVE_ছাড়া_সামনের_উইন্ডো_বলা_হয়_না()
    {
        var t = New();

        t.Observe(App("excel.exe"), T0, SegmentState.Active);
        t.Observe(App("excel.exe"), T0.AddSeconds(10), SegmentState.Locked);

        Assert.Null(t.Current);
    }
}
