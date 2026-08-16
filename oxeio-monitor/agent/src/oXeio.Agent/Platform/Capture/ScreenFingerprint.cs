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
internal static class ScreenFingerprint
{
    /// <summary>এক পাশে কত কোষ — ১৬×১৬ = ২৫৬ বাইট</summary>
    private const int Side = 16;

    /// <summary>
    /// WebP বাইট থেকে ছাপ। ব্যর্থ হলে <c>null</c>।
    ///
    /// ⚠️⚠️ ব্যতিক্রম ছোড়া হয় না — ছাপ বানাতে না পারলে সবচেয়ে খারাপ যা হয়
    /// তা হলো ওই স্লটে জিগলার ধরা পড়ল না। কিন্তু ছুড়ে দিলে গোটা ক্যাপচার
    /// স্লট ভেঙে যেত, অর্থাৎ <b>আসল স্ক্রিনশটটাই হারাত</b> — ছবিটা অনেক
    /// বেশি মূল্যবান।
    /// </summary>
    public static byte[]? From(byte[] webp)
    {
        if (webp is null || webp.Length == 0) return null;

        try
        {
            using var original = SKBitmap.Decode(webp);
            if (original is null || original.Width == 0 || original.Height == 0) return null;

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
        catch (Exception ex) when (ex is not OutOfMemoryException)
        {
            return null;
        }
    }
}
