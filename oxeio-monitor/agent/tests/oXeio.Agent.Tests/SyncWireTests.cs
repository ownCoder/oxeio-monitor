using oXeio.Agent.Sync;
using oXeio.Core.Agent;
using oXeio.Core.Models;

namespace oXeio.Agent.Tests;

/// <summary>
/// তারে ওঠার আগের শেষ দরজা। এখানে যা যায় সেটাই সার্ভারে পৌঁছায়, তাই
/// দুটো জিনিস এখানেই নিশ্চিত করা হয়: <b>পুরো URL কখনো নয়</b>, আর
/// <b>সার্ভারের সীমার বেশি লম্বা কিছু নয়</b>।
/// </summary>
public class SyncWireTests
{
    private static readonly DateTimeOffset T0 =
        new(2026, 8, 10, 10, 0, 0, TimeSpan.FromHours(6));

    private static AppUsageRecord Record(
        string process = "chrome.exe", string? app = null,
        string? title = null, string? domain = null) => new()
        {
            ClientUuid = Guid.NewGuid(),
            StartedAt = T0,
            EndedAt = T0.AddSeconds(30),
            DurationSec = 30,
            ProcessName = process,
            AppName = app,
            WindowTitle = title,
            Domain = domain,
        };

    private static SyncWire.AppUsageDto One(AppUsageRecord r) =>
        Assert.Single(SyncWire.AppUsage([r]).Items);

    // ── ডোমেইন ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("https://bank.com/account/12345?token=SECRET", "bank.com")]
    [InlineData("http://user:pass@internal.example.com/x", "internal.example.com")]
    [InlineData("github.com:443", "github.com")]
    [InlineData("GitHub.COM", "github.com")]
    [InlineData("example.com.", "example.com")]
    [InlineData("  ", null)]
    public void ডোমেইন_ছাড়া_আর_কিছুই_যায়_না(string? input, string? expected) =>
        Assert.Equal(expected, SyncWire.DomainOnly(input));

    /// <summary>IPv6 লিটারালের ভেতরের ':' পোর্ট নয় — ছাঁটলে ঠিকানাটাই নষ্ট হতো।</summary>
    [Fact]
    public void IPv6_লিটারাল_অক্ষত_থাকে() =>
        Assert.Equal("[::1]", SyncWire.DomainOnly("http://[::1]/admin"));

    /// <summary>
    /// ⭐ একটা মডিউলের বাগে ফুল URL এলেও ডেটাবেসে যেন না বসে।
    /// </summary>
    [Fact]
    public void ফুল_URL_এলেও_তারে_শুধু_ডোমেইন_ওঠে()
    {
        var dto = One(Record(domain: "https://mail.google.com/mail/u/0/#inbox/FMfcgz"));

        Assert.Equal("mail.google.com", dto.Domain);
    }

    // ── দৈর্ঘ্য ─────────────────────────────────────────────────────────────

    /// <summary>
    /// সার্ভারের সীমা ছাড়ালে ৪০০, আর ৪০০ = Permanent = ডেটা মুছে ফেলা (G49)।
    /// এই স্ট্রিংগুলোর একটাও আমাদের লেখা নয়, তাই বিশ্বাস করা যায় না।
    /// </summary>
    [Fact]
    public void সার্ভারের_সীমার_বেশি_লম্বা_কিছু_যায়_না()
    {
        var dto = One(Record(
            process: new string('p', 400),
            app: new string('a', 400),      // exe-র version resource থেকে আসে
            title: new string('t', 2000),
            domain: new string('d', 400)));

        Assert.Equal(260, dto.ProcessName.Length);
        Assert.Equal(260, dto.AppName!.Length);
        Assert.Equal(1000, dto.WindowTitle!.Length);
        Assert.Equal(260, dto.Domain!.Length);
    }

    [Fact]
    public void সীমার_ভেতরে_থাকলে_কিছু_বদলায়_না()
    {
        var dto = One(Record(app: "Google Chrome", title: "GitHub", domain: "github.com"));

        Assert.Equal("chrome.exe", dto.ProcessName);
        Assert.Equal("Google Chrome", dto.AppName);
        Assert.Equal("GitHub", dto.WindowTitle);
        Assert.Equal("github.com", dto.Domain);
    }

    // ── সেগমেন্ট ────────────────────────────────────────────────────────────

    /// <summary>
    /// G49 — Prisma-র enum ছোট হাতের। বড় হাতের পাঠিয়ে ৪০০ খাওয়া হয়েছিল,
    /// আর সেই সেগমেন্টগুলো মুছে গিয়েছিল।
    /// </summary>
    [Theory]
    [InlineData(SegmentState.Active, "active")]
    [InlineData(SegmentState.Idle, "idle")]
    [InlineData(SegmentState.Locked, "locked")]
    public void সেগমেন্টের_অবস্থা_ছোট_হাতে_যায়(SegmentState state, string wire) =>
        Assert.Equal(wire, SyncWire.StateToWire(state));

    [Fact]
    public void অচেনা_অবস্থা_চুপচাপ_পাঠানো_হয়_না() =>
        Assert.Throws<ArgumentOutOfRangeException>(
            () => SyncWire.StateToWire((SegmentState)99));
}
