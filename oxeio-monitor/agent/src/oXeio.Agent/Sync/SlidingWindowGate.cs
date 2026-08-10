using System.Diagnostics;

namespace oXeio.Agent.Sync;

/// <summary>
/// ⭐ "এক মিনিটে সর্বোচ্চ N বার" — সার্ভারের রেট লিমিটে ধাক্কা খাওয়ার <b>আগেই</b>
/// নিজেকে থামানো।
///
/// <b>কেন ৪২৯ খেয়ে শেখা চলবে না:</b> ৪২৯ Transient, অর্থাৎ ওই ব্যাচ ব্যাকঅফে
/// যায় আর attempts বাড়ে। ৫০,০০০ সারির ব্যাকলগ ড্রেন করার সময় প্রতি মিনিটে
/// কয়েকটা ৪২৯ মানে backoff বাড়তে বাড়তে ৫ মিনিটের সিলিং — তখন কিউ খালি হতে
/// দিনের পর দিন লাগত। যে মেশিনটা সবচেয়ে পিছিয়ে, সে-ই সবচেয়ে ধীরে এগোত।
///
/// <b>স্লাইডিং উইন্ডো কেন, ফিক্সড বাকেট নয়:</b> ফিক্সড বাকেটে মিনিটের শেষে ৫৫টা
/// আর শুরুতে ৫৫টা পাঠানো যায় — সার্ভারের ঘড়িতে সেটা এক সেকেন্ডে ১১০, সোজা ৪২৯।
///
/// ⚠️ ঘড়ি হিসেবে <see cref="Stopwatch"/> (monotonic), <c>DateTime</c> নয় —
/// NTP সময় পিছিয়ে দিলে wall-clock হিসাব গেট খুলে দিত বা চিরকাল আটকে রাখত।
/// </summary>
internal sealed class SlidingWindowGate : IDisposable
{
    private readonly int _permits;
    private readonly long _windowTicks;

    /// <summary>শেষ উইন্ডোতে যতগুলো রিকোয়েস্ট গেছে তাদের timestamp। আকার সর্বোচ্চ <see cref="_permits"/>।</summary>
    private readonly Queue<long> _stamps;

    private readonly SemaphoreSlim _mutex = new(1, 1);
    private bool _disposed;

    public SlidingWindowGate(int permits, TimeSpan window)
    {
        // ⚠️ ০ বা ঋণাত্মক permit মানে গেট কখনো খুলবে না — সিঙ্ক চিরতরে বন্ধ।
        //    কনফিগের ভুলে সেটা ঘটতে দেওয়া যায় না, তাই কমপক্ষে ১।
        _permits = Math.Max(1, permits);
        _windowTicks = (long)(window.TotalSeconds * Stopwatch.Frequency);
        if (_windowTicks < 1) _windowTicks = Stopwatch.Frequency;
        _stamps = new Queue<long>(_permits);
    }

    public static SlidingWindowGate PerMinute(int permits) =>
        new(permits, TimeSpan.FromMinutes(1));

    /// <summary>
    /// জায়গা না পাওয়া পর্যন্ত অপেক্ষা করে, তারপর একটা permit খরচ করে ফেরে।
    ///
    /// ⚠️ কলার এটা রিকোয়েস্টের <b>টাইমআউট ঘড়ি শুরুর আগে</b> ডাকবে। টাইমআউটের
    /// ভেতরে ডাকলে রেট লিমিটে অপেক্ষা করাটা "টাইমআউট" হিসেবে গণ্য হতো আর
    /// রিকোয়েস্টটা পাঠানোর আগেই বাতিল হয়ে যেত।
    /// </summary>
    public async Task WaitAsync(CancellationToken ct)
    {
        while (true)
        {
            ct.ThrowIfCancellationRequested();

            TimeSpan wait;

            await _mutex.WaitAsync(ct).ConfigureAwait(false);
            try
            {
                var now = Stopwatch.GetTimestamp();
                var cutoff = now - _windowTicks;

                while (_stamps.Count > 0 && _stamps.Peek() <= cutoff) _stamps.Dequeue();

                if (_stamps.Count < _permits)
                {
                    _stamps.Enqueue(now);
                    return;
                }

                // সবচেয়ে পুরোনোটা উইন্ডো থেকে বেরোলেই একটা জায়গা খালি হবে
                var freeAt = _stamps.Peek() + _windowTicks;
                wait = TimeSpan.FromSeconds((double)(freeAt - now) / Stopwatch.Frequency);
            }
            finally
            {
                _mutex.Release();
            }

            // ⚠️ নিচের সীমাটা না থাকলে গণনার সামান্য ভুলে এটা busy loop হয়ে
            //    একটা কোর খেয়ে ফেলত — আর সেটা কেউ দেখত না, মেশিনটা শুধু গরম হতো।
            if (wait < TimeSpan.FromMilliseconds(25)) wait = TimeSpan.FromMilliseconds(25);
            if (wait > TimeSpan.FromMinutes(2)) wait = TimeSpan.FromMinutes(2);

            await Task.Delay(wait, ct).ConfigureAwait(false);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _mutex.Dispose();
    }
}
