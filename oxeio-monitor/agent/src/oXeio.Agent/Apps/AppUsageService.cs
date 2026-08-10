using System.Runtime.Versioning;

using oXeio.Core.Agent;
using oXeio.Core.Apps;
using oXeio.Core.Models;

namespace oXeio.Agent.Apps;

/// <summary>
/// অ্যাপ ও সাইট ট্র্যাকিংয়ের তিনটে টুকরো এক জায়গায় (D01–D04):
/// Win32 থেকে পড়া, ব্রাউজারের ঠিকানা, আর গোনার নিয়ম।
///
/// ⭐ <b>address bar পড়া হয় শুধু উইন্ডো বা টাইটেল বদলালে।</b> প্রতি
/// সেকেন্ডে UI Automation চালালে প্রতি কলে ~১০–৩০ ms যেত — দিনে হাজার হাজার
/// বার, আর CPU বাজেট ১%-এর নিচে রাখা যেত না
/// ([06-Research § ২.৬](../../../../docs/06-Research.md))।
///
/// টাইটেল বদলালেও পড়া হয়, কারণ একই উইন্ডোতে নতুন পেজে গেলে ঠিকানা বদলায়
/// কিন্তু hwnd একই থাকে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class AppUsageService
{
    private readonly ForegroundWindowProbe _probe = new();
    private readonly BrowserUrlReader _urls = new();
    private readonly AppUsageTracker _tracker;

    private nint _lastHwnd;
    private string? _lastTitle;
    private string? _lastUrl;

    public AppUsageService(TimeSpan? minDuration = null) =>
        _tracker = new AppUsageTracker(minDuration);

    /// <summary>ডায়াগনস্টিকে দেখানোর জন্য — এখন কোন অ্যাপ গোনা হচ্ছে।</summary>
    public string? CurrentProcess => _tracker.CurrentProcess;

    /// <summary>UI Automation এই মেশিনে কাজ করছে কি না।</summary>
    public bool UrlReadingDisabled => _urls.Disabled;

    /// <summary>প্রতি সেকেন্ডে ডাকা হয়। যা রেকর্ড বন্ধ হলো তা ফেরে।</summary>
    public IReadOnlyList<AppUsageRecord> Tick(DateTimeOffset now, SegmentState state)
    {
        // ACTIVE ছাড়া উইন্ডো পড়ারই দরকার নেই — গোনা তো হবেই না।
        // এতে লক থাকা অবস্থায় প্রতি সেকেন্ডে অকারণ Win32 কল বাঁচে।
        if (state != SegmentState.Active) return _tracker.Observe(null, now, state);

        var sample = _probe.Read(ReadUrlIfChanged);

        return _tracker.Observe(sample, now, state);
    }

    public IReadOnlyList<AppUsageRecord> CloseAll(DateTimeOffset now) => _tracker.CloseAll(now);

    /// <summary>
    /// উইন্ডো বা টাইটেল বদলালে নতুন করে পড়া, নইলে আগেরটাই।
    ///
    /// ⚠️ টাইটেল এখানে আবার পড়া হয় (probe-ও পড়ে) — কারণ probe-এর ভেতর
    /// থেকে কলব্যাক হিসেবে ডাকা হচ্ছে, তখনো সেটার টাইটেল হাতে আসেনি।
    /// দুবার <c>GetWindowText</c> ডাকা সস্তা; UI Automation নয়।
    /// </summary>
    private string? ReadUrlIfChanged(nint hwnd)
    {
        var title = ForegroundWindowProbe.PeekTitle(hwnd);

        if (hwnd == _lastHwnd && string.Equals(title, _lastTitle, StringComparison.Ordinal))
            return _lastUrl;

        _lastHwnd = hwnd;
        _lastTitle = title;
        _lastUrl = _urls.TryRead(hwnd);

        return _lastUrl;
    }
}
