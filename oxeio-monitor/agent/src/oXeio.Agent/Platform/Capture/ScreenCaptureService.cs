using System.Diagnostics;
using System.Runtime.Versioning;

using oXeio.Core.Capture;

namespace oXeio.Agent.Platform.Capture;

internal sealed record CaptureResult(
    int MonitorIndex,
    string DeviceName,
    int Width,
    int Height,
    uint Dpi,
    byte[] Webp,
    FrameQuality.Assessment Quality,
    TimeSpan Elapsed)
{
    public bool Degraded => Quality.Degraded;
}

/// <summary>
/// এক স্লটে সব মনিটরের ছবি তোলা।
///
/// প্রতি মনিটরে <b>আলাদা</b> ছবি — একসাথে জোড়া হয় না (WebpEncoder দেখুন)।
/// একটা মনিটর ব্যর্থ হলে বাকিগুলো তবু নেওয়া হয়।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class ScreenCaptureService(IScreenCapturer capturer) : IDisposable
{
    public string EngineName => capturer.Name;

    public IReadOnlyList<CaptureResult> CaptureAll()
    {
        var results = new List<CaptureResult>();

        // ⚠️ প্রতিবার নতুন করে গোনা — ডক/আনডক হলেও ঠিক থাকে
        var monitors = MonitorEnumerator.Enumerate();

        for (var i = 0; i < monitors.Count; i++)
        {
            var sw = Stopwatch.StartNew();
            var frame = capturer.Capture(monitors[i]);
            if (frame is null) continue;

            var quality = FrameQuality.Assess(frame.Pixels, frame.Width, frame.Height, frame.Stride);
            var webp = WebpEncoder.Encode(frame);
            sw.Stop();

            results.Add(new CaptureResult(
                i, monitors[i].DeviceName, frame.Width, frame.Height,
                monitors[i].Dpi, webp, quality, sw.Elapsed));
        }

        return results;
    }

    public void Dispose() => capturer.Dispose();
}
