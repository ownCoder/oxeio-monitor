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
/// ⚠️ <b>সীমাবদ্ধতা:</b> Windows-এ PC ঘুমিয়ে গেলে QPC থেমে থাকে, তাই জেগে ওঠার পর
/// এই ঘড়ি বাস্তব সময়ের চেয়ে পিছিয়ে থাকবে। সেজন্যই suspend/resume আলাদা করে
/// <see cref="Tracking.IdleStateMachine"/>-কে জানাতে হয় (G3) — শুধু ঘড়ির উপর ভরসা নয়।
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
