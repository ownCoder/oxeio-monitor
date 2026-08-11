using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.Versioning;

using SkiaSharp;

namespace oXeio.Agent.Ui;

/// <summary>
/// WebP ফাইল → <see cref="Bitmap"/>, জানালায় আঁকার জন্য।
///
/// ⭐⚠️ <b>কেন এই ফাইলটা লাগল:</b> <c>Image.FromStream</c> WebP চেনে <b>না</b> —
/// GDI+-এ ওই কোডেকটাই নেই। ব্যর্থ হলে সে বলে <i>"Parameter is not valid"</i>,
/// যেটা পড়ে মনে হয় ফাইলটা নষ্ট। আসলে ফাইল ঠিকই আছে, পড়ার লোকটা ভুল।
///
/// SkiaSharp এজেন্টে আগে থেকেই আছে (ছবি এনকোড করাই ওর কাজ,
/// <see cref="oXeio.Agent.Platform.Capture.WebpEncoder"/>), তাই ডিকোডও ওকে দিয়েই।
/// নতুন কোনো নির্ভরতা যোগ হয়নি।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class WebpImage
{
    /// <summary>
    /// পড়া না গেলে <c>null</c> — ব্যতিক্রম নয়। একটা প্রিভিউ না দেখানো
    /// জানালা ভেঙে ফেলার মতো ব্যাপার নয়।
    /// </summary>
    public static Bitmap? Load(string path)
    {
        try
        {
            var bytes = File.ReadAllBytes(path);

            // ⚠️ মাপ **না** দিয়ে ডিকোড করতে হয়। আগে এখানে
            //    `new SKImageInfo(0, 0, …)` দেওয়া ছিল — Skia সেটাকে "শূন্য
            //    পিক্সেলের ছবি চাই" ধরে নীরবে null ফেরত দিত, আর জানালায়
            //    "প্রিভিউ লোড করা গেল না" লেখা উঠত যদিও ফাইলটা নিখুঁত।
            using var decoded = SKBitmap.Decode(bytes);
            if (decoded is null || decoded.Width <= 0 || decoded.Height <= 0) return null;

            // ⚠️ GDI-র Format32bppArgb মানে বাইট ক্রমে **BGRA**। Skia
            //    প্ল্যাটফর্ম অনুযায়ী Rgba8888-ও দিতে পারে; হুবহু কপি করলে
            //    তখন লাল আর নীল উল্টে যেত — ছবিটা আসত নীলচে।
            if (decoded.ColorType == SKColorType.Bgra8888) return ToBitmap(decoded);

            using var converted = decoded.Copy(SKColorType.Bgra8888);
            return converted is null ? null : ToBitmap(converted);
        }
        catch (Exception e) when (e is IOException
                                      or UnauthorizedAccessException
                                      or ArgumentException
                                      or OutOfMemoryException)
        {
            return null;
        }
    }

    /// <summary>
    /// ⚠️ সারি ধরে কপি, একবারে নয় — Skia-র <c>RowBytes</c> আর GDI-র
    /// <c>Stride</c> এক না-ও হতে পারে (GDI প্রতি সারি ৪ বাইটে align করে)।
    /// একবারে কপি করলে প্রস্থ ৪-এর গুণিতক না হলে ছবিটা তির্যক হয়ে যেত —
    /// ক্লাসিক "ছবি কাত হয়ে গেছে" বাগ।
    /// </summary>
    private static unsafe Bitmap ToBitmap(SKBitmap source)
    {
        var bitmap = new Bitmap(source.Width, source.Height, PixelFormat.Format32bppArgb);

        var locked = bitmap.LockBits(
            new Rectangle(0, 0, source.Width, source.Height),
            ImageLockMode.WriteOnly,
            PixelFormat.Format32bppArgb);

        try
        {
            var src = (byte*)source.GetPixels();
            var dst = (byte*)locked.Scan0;
            var rowBytes = Math.Min(source.RowBytes, Math.Abs(locked.Stride));

            for (var y = 0; y < source.Height; y++)
            {
                Buffer.MemoryCopy(
                    src + ((long)y * source.RowBytes),
                    dst + ((long)y * locked.Stride),
                    rowBytes,
                    rowBytes);
            }
        }
        finally
        {
            bitmap.UnlockBits(locked);
        }

        return bitmap;
    }
}
