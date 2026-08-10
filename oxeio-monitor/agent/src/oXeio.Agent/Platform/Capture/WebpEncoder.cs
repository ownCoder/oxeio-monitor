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

    /// <summary>A06 — গ্যালারির গ্রিডে এই প্রস্থেই যথেষ্ট।</summary>
    public const int ThumbWidth = 320;

    /// <summary>
    /// থাম্বনেইলে মান আরও কম — ৩২০px-এ কেউ লেখা পড়ে না, শুধু "কী ধরনের
    /// পর্দা" বোঝে। ৫০-এ ফাইল ~৮ KB, আর ২০০টা ছবির গ্রিড দ্রুত ওঠে।
    /// </summary>
    public const int ThumbQuality = 50;

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

    /// <summary>
    /// A06 — গ্যালারির গ্রিডের জন্য ছোট ছবি।
    ///
    /// ⭐ <b>এটা এজেন্টে হয়, সার্ভারে নয়</b>: সার্ভারে Node-এ ছবি রিসাইজ
    /// করতে <c>sharp</c> লাগত (নেটিভ বাইনারি, নতুন dependency), আর এজেন্টে
    /// SkiaSharp এমনিতেই আছে। সাথে বাড়তি লাভ — ৩০ KB বেশি পাঠিয়ে সার্ভারের
    /// CPU বাঁচে, আর ১৫টা PC-র কাজ ১৫টা PC-তেই ভাগ হয়ে যায়।
    ///
    /// ⚠️ ব্যর্থ হলে <c>null</c>, ব্যতিক্রম নয়। <b>থাম্বনেইল না থাকলে
    /// গ্যালারি ফুল ছবিই দেখাবে</b> (ধীর, কিন্তু সঠিক); কিন্তু থাম্বনেইল
    /// বানাতে গিয়ে আসল ছবিটা হারানো যাবে না — ছবিটাই মূল্যবান।
    /// </summary>
    public static byte[]? EncodeThumb(byte[] webp)
    {
        if (webp is null || webp.Length == 0) return null;

        try
        {
            using var original = SKBitmap.Decode(webp);
            if (original is null || original.Width == 0) return null;

            // ইতিমধ্যেই ছোট হলে আবার এনকোড করার মানে নেই
            if (original.Width <= ThumbWidth) return webp;

            var height = (int)Math.Round(original.Height * (double)ThumbWidth / original.Width);
            var info = new SKImageInfo(ThumbWidth, Math.Max(height, 1));

            using var scaled = original.Resize(info, new SKSamplingOptions(SKCubicResampler.Mitchell));
            if (scaled is null) return null;

            using var image = SKImage.FromBitmap(scaled);
            using var data = image.Encode(SKEncodedImageFormat.Webp, ThumbQuality);

            return data?.ToArray();
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return null;
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
