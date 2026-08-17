using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using SkiaSharp;

namespace oXeio.Agent.Platform.Capture;

/// <summary>
/// ⭐⭐ <b>G46</b> — পর্দার একটা <b>মোটা দানার ছাপ</b>, যাতে বোঝা যায় ছবিটা
/// সত্যিই বদলেছে কি না।
///
/// <b>কেন এটা দরকার:</b> মাউস-জিগলার চললে <c>GetLastInputInfo</c> ঠকে যায়
/// আর এজেন্ট সারাদিন "Working" গোনে। কিন্তু জিগলার পর্দা বদলাতে পারে না —
/// তাই ছবির দিকে তাকালেই ধরা পড়ে।
///
/// ⚠️⚠️ <b>ছবিটা কোথাও জমে না, যায়ও না</b> — শুধু ২৫৬ বাইটের একটা সংখ্যা
/// বেরিয়ে আসে, আর সেটাও মেশিনেই থাকে। এটা স্ক্রিনশট পাঠানোর সাথে সম্পর্কহীন
/// (ওটা আলাদা, আর কর্মী সেটা জানেন)।
///
/// ⚠️ ১৬×১৬ ইচ্ছাকৃতভাবে <b>খুব ছোট</b>। বড় হলে টাস্কবারের ঘড়ি বা কার্সরের
/// ঝিকিমিকিও "বদল" হয়ে যেত, আর পর্দা কোনোদিন জমত না — অর্থাৎ পাহারাটা
/// নীরবে অকেজো থাকত। এত ছোট ছাপে পড়ার মতো কোনো তথ্যও থাকে না।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class ScreenFingerprint
{
    /// <summary>এক পাশে কত কোষ — ১৬×১৬ = ২৫৬ বাইট</summary>
    private const int Side = 16;

    /// <summary>
    /// কাঁচা BGRA ছবি থেকে ছাপ। ব্যর্থ হলে <c>null</c>।
    ///
    /// ⚠️⚠️ ব্যতিক্রম ছোড়া হয় না — ছাপ বানাতে না পারলে সবচেয়ে খারাপ যা হয়
    /// তা হলো ওই নমুনায় জিগলার ধরা পড়ল না। আর নমুনা আসা বন্ধ থাকলে
    /// <see cref="oXeio.Core.Tracking.ScreenActivity.StaleAfter"/> কিছুক্ষণ
    /// পরেই সন্দেহটা তুলে নেয় — অর্থাৎ ব্যর্থতা কর্মীর ক্ষতি করে না।
    ///
    /// ⭐ <b>WebP থেকে বানানোর পথটা তুলে দেওয়া হয়েছে</b>, ইচ্ছাকৃতভাবে।
    /// দুটো আলাদা পথে বানানো ছাপ হুবহু এক হতো না (এনকোডিংয়ের ক্ষতিপূরণ),
    /// আর তুলনাটা তখন দুই রকম ছাপের মধ্যে হয়ে যেত — একই দৃশ্যকে "বদলেছে"
    /// দেখাত, আর পাহারাটা নীরবে অকেজো থাকত।
    /// </summary>
    public static byte[]? From(CapturedFrame frame)
    {
        if (frame is null || frame.Width == 0 || frame.Height == 0) return null;

        try
        {
            var source = new SKImageInfo(
                frame.Width, frame.Height, SKColorType.Bgra8888, SKAlphaType.Opaque);

            /**
             * ⚠️⚠️ অ্যারেটা <b>পিন</b> করা হয় — নইলে Skia যখন পিক্সেল পড়ছে
             * ঠিক তখনই GC ওটা সরিয়ে দিতে পারত, আর ফল হতো এলোমেলো ছাপ বা
             * সরাসরি ক্র্যাশ। বাগটা ঘটত কালেভদ্রে, আর ধরা প্রায় অসম্ভব।
             */
            var pin = GCHandle.Alloc(frame.Pixels, GCHandleType.Pinned);
            try
            {
                using var original = new SKBitmap();
                if (!original.InstallPixels(source, pin.AddrOfPinnedObject(), frame.Stride))
                    return null;

                return Shrink(original);
            }
            finally
            {
                pin.Free();
            }
        }
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return null;
        }
    }

    /// <summary>বড় ছবিকে ১৬×১৬ ধূসর ছাপে নামানো — একটাই পথ, তাই সব ছাপ তুলনীয়।</summary>
    private static byte[]? Shrink(SKBitmap original)
    {
        /**
         * ⭐ ধূসর করে নেওয়া হয় — রঙের বদল (থিম, ওয়ালপেপার) আমাদের
         *    প্রশ্ন নয়; প্রশ্ন হলো <b>আকৃতি</b> নড়েছে কি না।
         *
         * ⚠️ `Mitchell` নয়, সাধারণ গড় — ১৬×১৬-তে নামানোর সময় তীক্ষ্ণ
         *    রিস্যাম্পলার ছোট বিবরণ (ঘড়ির অঙ্ক) ধরে রাখে, আর সেটাই
         *    আমরা চাই না।
         */
        var info = new SKImageInfo(Side, Side, SKColorType.Gray8, SKAlphaType.Opaque);
        using var small = original.Resize(info, new SKSamplingOptions(SKFilterMode.Linear));
        if (small is null) return null;

        var pixels = small.GetPixelSpan();
        if (pixels.Length < Side * Side) return null;

        var fingerprint = new byte[Side * Side];
        pixels[..(Side * Side)].CopyTo(fingerprint);
        return fingerprint;
    }
}
