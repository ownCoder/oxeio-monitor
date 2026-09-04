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
    TimeSpan Elapsed,
    string Engine,
    bool ProtectedContentMasked)
{
    /// <summary>
    /// ছবিটা কাজে লাগবে না — হয় প্রায় পুরোটা এক রঙের, নয়তো OS নিজেই
    /// DRM কনটেন্ট বাদ দিয়েছে বলে জানিয়েছে।
    /// </summary>
    public bool Degraded => Quality.Degraded || ProtectedContentMasked;
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

    /// <summary>
    /// শেষ চেষ্টায় যে মনিটরগুলো কোনো ছবিই দেয়নি।
    ///
    /// ⚠️ আগে ব্যর্থ মনিটর নীরবে বাদ পড়ত। তাতে একটা মনিটর চিরতরে ছবি দেওয়া
    /// বন্ধ করলেও কেউ জানত না — বাকিগুলোর ছবি ঠিকই আসত, তাই সব স্বাভাবিক
    /// দেখাত। ভুলটা ধরা পড়ত কেবল তখনই যখন কারো ওই পর্দার ছবি খুঁজতে গিয়ে
    /// কেউ দেখত যে সেটা কোনোদিনই ছিল না।
    /// </summary>
    public IReadOnlyList<string> LastFailedMonitors { get; private set; } = [];

    public IReadOnlyList<CaptureResult> CaptureAll()
    {
        var results = new List<CaptureResult>();
        var failed = new List<string>();

        // ⚠️ প্রতিবার নতুন করে গোনা — ডক/আনডক হলেও ঠিক থাকে
        var monitors = MonitorEnumerator.Enumerate();

        for (var i = 0; i < monitors.Count; i++)
        {
            var sw = Stopwatch.StartNew();
            var frame = capturer.Capture(monitors[i]);

            if (frame is null)
            {
                failed.Add(monitors[i].DeviceName);
                continue;
            }

            var quality = FrameQuality.Assess(frame.Pixels, frame.Width, frame.Height, frame.Stride);
            var webp = WebpEncoder.Encode(frame);
            sw.Stop();

            results.Add(new CaptureResult(
                i, monitors[i].DeviceName, frame.Width, frame.Height,
                monitors[i].Dpi, webp, quality, sw.Elapsed,
                frame.Engine, frame.ProtectedContentMasked));
        }

        LastFailedMonitors = failed;
        return results;
    }

    /// <summary>
    /// ⭐⭐ <b>G46</b> — শুধু প্রথম মনিটরের কাঁচা ছবি, ছাপ বানানোর জন্য।
    ///
    /// ⚠️ <see cref="CaptureAll"/> নয়, ইচ্ছাকৃতভাবে: ওটা সব মনিটরের ছবি তোলে
    /// আর প্রতিটাকে WebP-তে এনকোড করে — ছাপের জন্য দুটোরই দরকার নেই, অথচ
    /// এটা মিনিটে একবার (জমে থাকলে ৫ সেকেন্ডে একবার) চলে।
    ///
    /// ⚠️⚠️ ছবিটা <b>কোথাও জমে না, যায়ও না</b> — এখান থেকে বেরোয় কেবল
    /// ২৫৬ বাইটের একটা ছাপ, আর সেটাও মেশিন ছাড়ে না।
    /// </summary>
    public CapturedFrame? CapturePrimary()
    {
        var monitors = MonitorEnumerator.Enumerate();
        if (monitors.Count == 0) return null;

        // ⚠️ প্রথমটাই — CaptureAll-এও ছাপ নেওয়া হতো MinBy(MonitorIndex) থেকে,
        //    অর্থাৎ একই পর্দা। সাধারণত ওখানেই কাজ হয়, আর সব পর্দা মেলালে
        //    একটা নিষ্ক্রিয় দ্বিতীয় মনিটরই "জমেছে" বলে গোনা বন্ধ করত।
        return capturer.Capture(monitors[0]);
    }

    public void Dispose() => capturer.Dispose();
}
