using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using SkiaSharp;

namespace oXeio.Agent.Platform.Capture;

/// <summary>
/// BGRA → WebP (ADR-007)।
///
/// SkiaSharp বেছে নেওয়া হয়েছে, ImageSharp নয়: ImageSharp v4+ লাইসেন্স ফাইল ছাড়া
/// <b>বিল্ডই</b> হয় না। SkiaSharp MIT, কোনো কী লাগে না।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class WebpEncoder
{
    /// <summary>ADR-007 — quality 70-এ লেখা স্পষ্ট পড়া যায়, আকার ~১৫০ KB।</summary>
    public const int Quality = 70;

    /// <summary>
    /// প্রতি মনিটরকে আলাদা করে এই প্রস্থে নামানো হয়।
    /// ⚠️ কখনোই সব মনিটর জুড়ে একটা লম্বা ছবি বানানো হয় না — তিনটে 4K জুড়লে
    /// ১১৫২০ পিক্সেল, সেটাকে ১৯২০-তে চাপলে একটা অক্ষরও পড়া যেত না।
    /// </summary>
    public const int MaxWidth = 1920;

    public static byte[] Encode(CapturedFrame frame)
    {
        var info = new SKImageInfo(
            frame.Width, frame.Height, SKColorType.Bgra8888, SKAlphaType.Opaque);

        var pinned = GCHandle.Alloc(frame.Pixels, GCHandleType.Pinned);
        try
        {
            using var image = SKImage.FromPixels(info, pinned.AddrOfPinnedObject(), frame.Stride);
            using var scaled = Downscale(image, frame.Width, frame.Height);
            using var data = (scaled ?? image).Encode(SKEncodedImageFormat.Webp, Quality);

            return data.ToArray();
        }
        finally
        {
            pinned.Free();
        }
    }

    private static SKImage? Downscale(SKImage image, int width, int height)
    {
        if (width <= MaxWidth) return null;

        var targetHeight = (int)Math.Round(height * (double)MaxWidth / width);
        var info = new SKImageInfo(MaxWidth, targetHeight, SKColorType.Bgra8888, SKAlphaType.Opaque);

        using var surface = SKSurface.Create(info);
        if (surface is null) return null;

        // Mitchell — লেখার ধার ধরে রাখে, স্ক্রিনশটে সেটাই সবচেয়ে জরুরি
        var sampling = new SKSamplingOptions(SKCubicResampler.Mitchell);
        surface.Canvas.DrawImage(image, new SKRect(0, 0, MaxWidth, targetHeight), sampling);
        surface.Canvas.Flush();

        return surface.Snapshot();
    }
}
