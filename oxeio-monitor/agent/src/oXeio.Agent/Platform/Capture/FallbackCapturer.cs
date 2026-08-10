using System.Runtime.Versioning;

using oXeio.Core.Capture;

namespace oXeio.Agent.Platform.Capture;

/// <summary>
/// প্রথমে DXGI, না পারলে GDI ([ADR-012c](../../../../docs/05-Options-Decisions.md))।
///
/// দুটো ইঞ্জিন নিজেরা একে অন্যের কথা জানে না — কোনটা কখন ব্যবহার হবে সেই
/// সিদ্ধান্ত এখানে, আর <b>কতক্ষণ পর আবার চেষ্টা হবে</b> সেটা
/// <see cref="EngineFallbackPolicy"/>-তে (খাঁটি লজিক, ইউনিট টেস্ট করা)।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class FallbackCapturer(
    IScreenCapturer primary,
    IScreenCapturer fallback,
    EngineFallbackPolicy? policy = null,
    Func<DateTimeOffset>? clock = null) : IScreenCapturer
{
    private readonly EngineFallbackPolicy _policy = policy ?? EngineFallbackPolicy.Default;
    private readonly Func<DateTimeOffset> _clock = clock ?? (() => DateTimeOffset.UtcNow);

    public string Name => $"{primary.Name}→{fallback.Name}";

    /// <summary>বিরতি চললে কখন শেষ — ডায়াগনস্টিক টুলে দেখানোর জন্য।</summary>
    public DateTimeOffset? PrimaryRestingUntil => _policy.RestingUntil;

    public CapturedFrame? Capture(MonitorInfo monitor)
    {
        var now = _clock();

        if (_policy.ShouldTryPrimary(now))
        {
            var frame = primary.Capture(monitor);
            if (frame is not null)
            {
                _policy.RecordSuccess();
                return frame;
            }

            // ⚠️ শুধু ইঞ্জিনের দোষ হলেই গোনা হয়। "পর্দায় কিছু নড়েনি" গুনলে
            //    শান্ত অফিসের PC-তে DXGI স্থায়ীভাবে বিরতিতে চলে যেত, আর
            //    ঠিক যখন কেউ ভিডিও চালাত তখনই সেটা ঘুমিয়ে থাকত।
            if (primary.LastFailureWasEngineFault) _policy.RecordFailure(now);
        }

        // ⚠️ ফলব্যাক ব্যর্থ হলে null-ই ফেরে — এখানে আর কিছু করার নেই।
        //    দুটো ইঞ্জিনই ব্যর্থ মানে সমস্যাটা ইঞ্জিনের নয় (সেশন ০, নেই এমন
        //    মনিটর, বা লগঅফের মাঝপথ), আর সেটা ঢাকতে ভুয়া ছবি বানানো হয় না।
        return fallback.Capture(monitor);
    }

    public void Dispose()
    {
        primary.Dispose();
        fallback.Dispose();
    }
}
