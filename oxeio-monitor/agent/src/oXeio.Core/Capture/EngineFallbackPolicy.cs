namespace oXeio.Core.Capture;

/// <summary>
/// প্রাথমিক ক্যাপচার ইঞ্জিন বারবার ব্যর্থ হলে কতক্ষণ থেমে থাকা হবে।
///
/// <b>কেন এটা দরকার:</b> DXGI Desktop Duplication কিছু পরিস্থিতিতে একেবারেই
/// চলে না — RDP সেশন, সমর্থনহীন ড্রাইভার, বা Teams শেয়ার করার সময় duplication
/// সীমা ছুঁয়ে যাওয়া। এমন মেশিনে প্রতি ৫ মিনিটে পুরো COM চেইন বানিয়ে ব্যর্থ হওয়া
/// নিছক অপচয়।
///
/// <b>কেন চিরতরে বন্ধ করা হয় না:</b> কারণগুলোর বেশিরভাগই সাময়িক। কেউ RDP
/// থেকে বেরিয়ে এল, বা মিটিং শেষ হলো — তখন DXGI আবার কাজ করবে। একবার ব্যর্থ
/// হলেই চিরতরে GDI-তে থেকে গেলে ওই PC-তে মাসের পর মাস ভিডিও কালো উঠত, আর
/// কেউ কখনো জানত না কেন।
///
/// তাই: টানা কয়েকবার ব্যর্থ হলে কিছুক্ষণ বিরতি, তারপর আবার একবার দেখা।
/// </summary>
public sealed class EngineFallbackPolicy(int failuresBeforeCooldown, TimeSpan cooldown)
{
    /// <summary>একবারের ব্যর্থতা কিছুই প্রমাণ করে না — লক স্ক্রিনেই হতে পারে।</summary>
    public const int DefaultFailuresBeforeCooldown = 3;

    /// <summary>
    /// ৩০ মিনিট — ৬টা স্লট। যথেষ্ট দীর্ঘ যে অপচয় নগণ্য, আবার যথেষ্ট ছোট যে
    /// মিটিং শেষ হওয়ার পর একই কর্মদিবসেই DXGI ফিরে আসে।
    /// </summary>
    public static readonly TimeSpan DefaultCooldown = TimeSpan.FromMinutes(30);

    public static EngineFallbackPolicy Default =>
        new(DefaultFailuresBeforeCooldown, DefaultCooldown);

    private readonly object _gate = new();
    private int _consecutiveFailures;
    private DateTimeOffset? _restingUntil;

    public int ConsecutiveFailures { get { lock (_gate) return _consecutiveFailures; } }

    /// <summary>এখন প্রাথমিক ইঞ্জিন চেষ্টা করা উচিত কি না।</summary>
    public bool ShouldTryPrimary(DateTimeOffset now)
    {
        lock (_gate)
        {
            if (_restingUntil is null) return true;
            if (now < _restingUntil) return false;

            // বিরতি শেষ — আবার এক দফা সুযোগ। কাউন্টার এখানেই শূন্য করা হয়,
            // নইলে পরের একটামাত্র ব্যর্থতাই সীমা ছুঁয়ে ফেলত আর বিরতি কার্যত
            // স্থায়ী হয়ে যেত।
            _restingUntil = null;
            _consecutiveFailures = 0;
            return true;
        }
    }

    public void RecordSuccess()
    {
        lock (_gate)
        {
            _consecutiveFailures = 0;
            _restingUntil = null;
        }
    }

    public void RecordFailure(DateTimeOffset now)
    {
        lock (_gate)
        {
            if (_restingUntil is not null) return; // বিরতির মধ্যে গোনা হয় না

            _consecutiveFailures++;
            if (_consecutiveFailures >= failuresBeforeCooldown)
                _restingUntil = now + cooldown;
        }
    }

    /// <summary>বিরতি চললে কখন শেষ হবে — ডায়াগনস্টিকে দেখানোর জন্য।</summary>
    public DateTimeOffset? RestingUntil { get { lock (_gate) return _restingUntil; } }
}
