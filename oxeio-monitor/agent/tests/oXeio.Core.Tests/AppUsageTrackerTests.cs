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
    [Fact]
    public void নিষ্ক্রিয়_অবস্থায়_গোনা_হয়_না()
    {
        var t = New();

        t.Observe(App("excel.exe"), T0, SegmentState.Active);
        var closed = t.Observe(App("excel.exe"), T0.AddSeconds(30), SegmentState.Idle);

        Assert.Single(closed);
        Assert.Equal(30, closed[0].DurationSec);

        // idle-এ থাকা অবস্থায় আর কিছু জমে না
        var more = t.Observe(App("excel.exe"), T0.AddMinutes(60), SegmentState.Idle);
        Assert.Empty(more);
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
}
