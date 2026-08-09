namespace oXeio.Core.Tracking;

/// <summary>
/// ⭐ ঘুমিয়ে থাকা সময় যেন কাজ হিসেবে না গোনা হয় (G3)।
///
/// <b>মূল নীতি: ঘড়িই সত্যের উৎস, ইভেন্ট শুধু দ্রুত জানার উপায়।</b>
/// suspend ইভেন্ট না এলে "তাহলে নিশ্চয়ই কাজ হচ্ছিল" — এমন কোনো পথ রাখা হয়নি।
/// কারণ ব্যাটারি ফুরিয়ে বা তাপে PC ঘুমালে Windows কোনো নোটিফিকেশনই পাঠায় না।
///
/// তিনটে স্বাধীন মাপ মিলিয়ে দেখা হয়:
/// <list type="bullet">
/// <item><b>biased</b> — <c>GetTickCount64</c>, ঘুমের সময়টাও গোনে</item>
/// <item><b>unbiased</b> — <c>QueryUnbiasedInterruptTime</c>, ঘুমের সময় গোনে না</item>
/// <item><b>monotonic</b> — QPC, ঘড়ি বদলালেও অটুট</item>
/// </list>
/// দুটোর ব্যবধান বেশি হলেই বোঝা যায় মাঝখানে PC ঘুমিয়ে ছিল — কোনো ইভেন্ট লাগে না।
///
/// ল্যাপটপ বিকেল ৫টায় বন্ধ করে সকাল ৯টায় খুললে এটাই ১৬ ঘণ্টার ভুয়া কাজ ঠেকায়।
/// </summary>
public sealed class SleepGapDetector
{
    private readonly TimeSpan _interval;
    private readonly double _tolerance;

    private bool _primed;
    private ulong _lastBiasedMs;
    private ulong _lastUnbiasedMs;
    private DateTimeOffset _lastMonotonic;

    /// <param name="interval">টিকের প্রত্যাশিত ব্যবধান (সাধারণত ১ সেকেন্ড)।</param>
    /// <param name="tolerance">টাইমারের স্বাভাবিক ঢিলেমি মেনে নেওয়ার গুণক।</param>
    public SleepGapDetector(TimeSpan interval, double tolerance = 1.5)
    {
        if (interval <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(interval));
        if (tolerance < 1.0) throw new ArgumentOutOfRangeException(nameof(tolerance));

        _interval = interval;
        _tolerance = tolerance;
    }

    /// <param name="BiasedMs">GetTickCount64 — ঘুমের সময় সহ।</param>
    /// <param name="UnbiasedMs">QueryUnbiasedInterruptTime — ঘুমের সময় ছাড়া।</param>
    /// <param name="Monotonic">MonotonicClock.Now।</param>
    public readonly record struct Sample(
        ulong BiasedMs,
        ulong UnbiasedMs,
        DateTimeOffset Monotonic);

    public readonly record struct Gap(
        bool Detected,
        /// <summary>শেষ যে মুহূর্তে PC সত্যিই জেগে ছিল — সেগমেন্ট এখানেই বন্ধ হবে।</summary>
        DateTimeOffset SuspendedAt,
        DateTimeOffset ResumedAt,
        /// <summary>biased − unbiased — অর্থাৎ কতক্ষণ ঘুমিয়ে ছিল।</summary>
        TimeSpan SleptFor)
    {
        public static readonly Gap None = default;
    }

    public Gap Observe(Sample s)
    {
        if (!_primed)
        {
            Remember(s);
            _primed = true;
            return Gap.None;
        }

        var biasedMs = Delta(s.BiasedMs, _lastBiasedMs);
        var unbiasedMs = Delta(s.UnbiasedMs, _lastUnbiasedMs);
        var monoMs = Math.Max(0, (s.Monotonic - _lastMonotonic).TotalMilliseconds);

        var cap = _interval.TotalMilliseconds * _tolerance;

        // biased লাফ দিয়েছে মানে দেয়াল-ঘড়ির সময় গেছে; monotonic লাফ দিয়েছে মানেও তাই।
        // যেকোনো একটাই যথেষ্ট — কারণ S0ix-এ প্রসেসটাই জমে যায়, টাইমারই চলে না।
        var detected = biasedMs > cap || monoMs > cap;

        var gap = detected
            ? new Gap(
                Detected: true,
                SuspendedAt: _lastMonotonic,
                ResumedAt: s.Monotonic,
                SleptFor: TimeSpan.FromMilliseconds(Math.Max(0, biasedMs - unbiasedMs)))
            : Gap.None;

        Remember(s);
        return gap;
    }

    /// <summary>ইভেন্ট থেকে ঘুম জানা গেলে ঘড়ির হিসাব নতুন করে শুরু করতে হয়।</summary>
    public void Reset() => _primed = false;

    private void Remember(Sample s)
    {
        _lastBiasedMs = s.BiasedMs;
        _lastUnbiasedMs = s.UnbiasedMs;
        _lastMonotonic = s.Monotonic;
    }

    /// <summary>কাউন্টার পিছিয়ে গেলে (হওয়ার কথা নয়) শূন্য ধরা হয়, ঋণাত্মক নয়।</summary>
    private static double Delta(ulong now, ulong before) =>
        now >= before ? now - before : 0d;
}
