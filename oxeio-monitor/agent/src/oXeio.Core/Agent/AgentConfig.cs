using System.Globalization;

using oXeio.Core.Tracking;

namespace oXeio.Core.Agent;

/// <summary>
/// সার্ভার থেকে আসা কনফিগ — <c>GET /agent/config</c> ও enroll-এর উত্তরে।
/// সার্ভারের <c>agent-config.service.ts</c>-এর <c>AgentConfig</c>-এর হুবহু প্রতিরূপ।
///
/// ⚠️ এটাই এজেন্টের <b>একমাত্র</b> কনফিগ টাইপ। নিজের মডিউলের জন্য আরেকটা
/// বানাবেন না — দুটো থাকলে একটা মডিউল পুরোনো idleThreshold নিয়ে চলবে আর
/// আরেকটা নতুন, আর দুজনের গোনা ঘণ্টা মিলবে না।
///
/// সব ফিল্ড nullable নয় কিন্তু <c>init</c> — কনফিগ একবার তৈরি হয়ে অপরিবর্তিত
/// থাকে, বদলাতে হলে নতুন ইনস্ট্যান্স। মাঝপথে ফিল্ড বদলালে ট্র্যাকিং লুপ আর
/// ক্যাপচার লুপ একই টিকে দুই রকম কনফিগ দেখত।
/// </summary>
public sealed record AgentConfig
{
    public required int IdleThresholdSec { get; init; }

    public required int SlotMinutes { get; init; }

    /// <summary><c>"HH:MM"</c> — null মানে ২৪ ঘণ্টাই ছবি ওঠে (ADR-011c)।</summary>
    public string? ScreenshotFrom { get; init; }

    /// <inheritdoc cref="ScreenshotFrom"/>
    public string? ScreenshotTo { get; init; }

    /// <summary>v1-এ সবসময় <c>"Asia/Dhaka"</c> — <see cref="oXeio.Core.Time.DhakaTime"/> দেখুন।</summary>
    public required string Timezone { get; init; }

    public required double MonthlyTargetHours { get; init; }

    public required int HeartbeatSec { get; init; }

    public required AppTrackingConfig AppTracking { get; init; }

    public required ScreenshotConfig Screenshot { get; init; }

    /// <summary>
    /// enroll করার আগে বা কনফিগ পড়তে না পারলে এটা দিয়েই চলবে।
    ///
    /// ⚠️ কনফিগ না পেলে ট্র্যাকিং <b>থামানো যাবে না</b> — তাহলে সার্ভার ডাউন
    /// থাকা মানেই সবার ঘণ্টা শূন্য। ডিফল্ট নিয়ে চলতে থাকুন, কনফিগ এলে বদলাবে।
    /// </summary>
    public static AgentConfig Default => new()
    {
        IdleThresholdSec = 60,
        SlotMinutes = 5,
        ScreenshotFrom = "07:00",
        ScreenshotTo = "23:00",
        Timezone = "Asia/Dhaka",
        MonthlyTargetHours = 208,
        HeartbeatSec = 30,
        AppTracking = new AppTrackingConfig { Enabled = true, MinDurationSec = 5 },
        Screenshot = new ScreenshotConfig
        {
            Format = "webp",
            Quality = 70,
            MaxWidth = 1920,
            AllMonitors = true,
        },
    };

    /// <summary>
    /// <see cref="ScreenshotFrom"/>/<see cref="ScreenshotTo"/> → <see cref="CaptureWindow"/>।
    ///
    /// এখানে একবারই লেখা হলো যাতে প্রতিটা মডিউল নিজের মতো করে "HH:MM" পার্স না করে —
    /// একজন <c>DateTime.Parse</c> লিখলেই বাংলাদেশি লোকেলে সেটা অন্য মানে দাঁড়াত।
    /// </summary>
    public CaptureWindow ToCaptureWindow() =>
        new(ParseHhMm(ScreenshotFrom), ParseHhMm(ScreenshotTo));

    /// <summary>ভুল বা অনুপস্থিত মান null — অর্থাৎ "সীমা নেই", ক্র্যাশ নয়।</summary>
    public static TimeOnly? ParseHhMm(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;

        // ⚠️ ফরম্যাটে ':' কালচার-নির্ভর time separator। InvariantCulture ছাড়া
        //    এটা কোনো কোনো লোকেলে '.' খুঁজত আর সব সময়েই null ফেরত দিত।
        return TimeOnly.TryParseExact(
            value, @"HH\:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed
            : null;
    }
}

public sealed record AppTrackingConfig
{
    public required bool Enabled { get; init; }

    /// <summary>এর কম সময়ের অ্যাপ ধরা হয় না — alt-tab-এর নয়েজ বাদ দিতে।</summary>
    public required int MinDurationSec { get; init; }
}

public sealed record ScreenshotConfig
{
    /// <summary>সার্ভার শুধু <c>"webp"</c> নেয় — অন্য কিছু হলে ৪১৫।</summary>
    public required string Format { get; init; }

    /// <summary>০–১০০।</summary>
    public required int Quality { get; init; }

    /// <summary>এর চেয়ে চওড়া হলে ছোট করে নেওয়া হয়।</summary>
    public required int MaxWidth { get; init; }

    /// <summary>সব মনিটরের আলাদা আলাদা ছবি, নাকি শুধু প্রাইমারি।</summary>
    public required bool AllMonitors { get; init; }
}
