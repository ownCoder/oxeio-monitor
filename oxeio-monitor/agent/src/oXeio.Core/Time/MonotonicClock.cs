using System.Diagnostics;

namespace oXeio.Core.Time;

/// <summary>
/// ঘড়ি বদলালেও যে সময় পিছিয়ে যায় না।
///
/// কেন দরকার: <c>DateTimeOffset.UtcNow</c> ব্যবহার করলে কেউ PC-র ঘড়ি পিছিয়ে দিলে
/// সেগমেন্টের দৈর্ঘ্য ঋণাত্মক হয়ে যেত, বা NTP সিঙ্ক হলে হঠাৎ লাফ দিত।
/// এখানে শুরুর সময়টা একবার ধরা হয়, তারপর <see cref="Stopwatch"/> (QPC) দিয়ে
/// এগোনো হয় — যা কেবল সামনেই যায় (G7 · ADR-অনুযায়ী § ৩.২)।
///
/// ✅ <b>ঘুমের সময়ও এই ঘড়ি চলতে থাকে।</b> Microsoft-এর ডকুমেন্টেশন অনুযায়ী
/// QueryPerformanceCounter "standby, hibernate, connected standby" — সব ধরনের ঘুমের
/// সময়টাই গুনে রাখে, আর <see cref="Stopwatch"/> QPC-ই ব্যবহার করে।
///
/// এটা আমাদের পক্ষেই যায়: জেগে ওঠার পর <c>Now</c> বাস্তব সময়ের সাথেই মেলে, <b>আর</b>
/// ঘুম ধরার কাজেও লাগে — এক টিকে এই ঘড়ি ১ সেকেন্ডের বদলে ৮ ঘণ্টা এগোলে বোঝা যায়
/// মাঝখানে PC ঘুমিয়ে ছিল (<see cref="Tracking.SleepGapDetector"/>)।
/// </summary>
public sealed class MonotonicClock
{
    private readonly DateTimeOffset _anchor;
    private readonly Stopwatch _elapsed;

    public MonotonicClock(DateTimeOffset anchor)
    {
        _anchor = anchor.ToUniversalTime();
        _elapsed = Stopwatch.StartNew();
    }

    /// <summary>বাস্তব ঘড়ি থেকে শুরু করে, এরপর শুধু সামনে।</summary>
    public static MonotonicClock StartNow() => new(DateTimeOffset.UtcNow);

    public DateTimeOffset Now => _anchor + _elapsed.Elapsed;

    /// <summary>শুরুর পর থেকে কত সময় গেছে — ঘড়ি বদলালেও অপরিবর্তিত।</summary>
    public TimeSpan Elapsed => _elapsed.Elapsed;
}
