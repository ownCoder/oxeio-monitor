using oXeio.Core.Time;

namespace oXeio.Core.Tracking;

/// <summary>
/// ছবি তোলার সময়সীমা — ADR-011c।
///
/// ⚠️ এটা <b>সময় গণনার</b> সীমা নয়। রাত ২টায় কেউ কাজ করলে তার ঘণ্টা পুরোপুরি
/// গোনা হবে, শুধু কোনো ছবি উঠবে না। ক্লাসটার নাম তাই CaptureWindow —
/// ShiftWindow নয়, কারণ শিফট বলে কিছু নেই।
/// </summary>
public sealed class CaptureWindow
{
    private readonly TimeOnly? _from;
    private readonly TimeOnly? _to;

    /// <param name="from">যেমন 07:00। null হলে ২৪ ঘণ্টাই ছবি ওঠে।</param>
    /// <param name="to">যেমন 23:00 — এই মুহূর্তটা <b>বাদ</b>।</param>
    public CaptureWindow(TimeOnly? from, TimeOnly? to)
    {
        _from = from;
        _to = to;
    }

    public static CaptureWindow Always => new(null, null);

    public static CaptureWindow Default => new(new TimeOnly(7, 0), new TimeOnly(23, 0));

    public bool Allows(DateTimeOffset instant)
    {
        if (_from is null || _to is null) return true;

        var now = DhakaTime.LocalTimeOf(instant);

        // 23:00 → 07:00 এর মতো মধ্যরাত-পার উইন্ডোও যেন কাজ করে
        return _from <= _to
            ? now >= _from && now < _to
            : now >= _from || now < _to;
    }
}
