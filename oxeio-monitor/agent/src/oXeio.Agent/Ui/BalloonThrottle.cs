namespace oXeio.Agent.Ui;

/// <summary>
/// প্রতি শ্রেণির বেলুন নোটিফিকেশন ঘণ্টায় একবারের বেশি নয়।
///
/// কেন এত কড়া: সিঙ্ক ব্যর্থ হলে সেটা সাধারণত একবার হয় না — সাইটের ইন্টারনেট
/// গেলে টানা কয়েক ঘণ্টা যায়। প্রতিবার বেলুন দেখালে স্টাফ প্রথমে বিরক্ত হবে,
/// তারপর Windows-এর নোটিফিকেশন সেটিংস থেকে এই অ্যাপটাকে চুপ করিয়ে দেবে। তখন
/// লাল আইকনের পাশে যে একটামাত্র জরুরি বার্তা দেখানোর সুযোগ ছিল, সেটাও চিরতরে
/// বন্ধ — এবং সেটা ঠিক করার কোনো উপায় কোডে নেই।
///
/// ⚠️ সময় মাপা হয় <see cref="oXeio.Core.Time.MonotonicClock"/>-এর elapsed দিয়ে,
/// <c>DateTimeOffset.UtcNow</c> দিয়ে নয়। কেউ PC-র ঘড়ি পিছিয়ে দিলে UtcNow-ভিত্তিক
/// হিসাব বেলুনকে অনির্দিষ্টকালের জন্য চুপ করিয়ে রাখত।
/// </summary>
internal sealed class BalloonThrottle
{
    public static readonly TimeSpan DefaultInterval = TimeSpan.FromHours(1);

    private readonly Dictionary<string, TimeSpan> _lastShown = new(StringComparer.Ordinal);
    private readonly TimeSpan _interval;

    public BalloonThrottle(TimeSpan? interval = null)
    {
        var value = interval ?? DefaultInterval;
        _interval = value > TimeSpan.Zero ? value : DefaultInterval;
    }

    /// <param name="eventClass">
    /// ধ্রুব স্ট্রিং — <c>"sync_failing"</c>, <c>"revoked"</c>… ⚠️ এখানে কখনো
    /// পরিবর্তনশীল কিছু (যেমন সারির গভীরতা) জুড়বেন না: প্রতিটা আলাদা মান আলাদা
    /// শ্রেণি হয়ে যেত, ফলে থ্রটল কার্যত উঠে যেত <b>এবং</b> ডিকশনারিটা মাসের পর
    /// মাস বাড়তেই থাকত।
    /// </param>
    /// <param name="elapsed">এজেন্ট চালু হওয়ার পর থেকে কত সময় গেছে।</param>
    public bool ShouldShow(string eventClass, TimeSpan elapsed)
    {
        if (string.IsNullOrEmpty(eventClass)) return false;

        if (_lastShown.TryGetValue(eventClass, out var previous) &&
            elapsed - previous < _interval)
        {
            return false;
        }

        _lastShown[eventClass] = elapsed;
        return true;
    }
}
