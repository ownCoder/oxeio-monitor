namespace oXeio.Core.Capture;

/// <summary>
/// GPU টেক্সচার থেকে পাওয়া পিক্সেল সারিগুলো টানটান বাফারে নামানো।
///
/// <b>কেন এটা আলাদা ক্লাস, আর কেন Core-এ:</b> GPU যখন টেক্সচার map করে দেয়, প্রতি
/// সারির দৈর্ঘ্য (<i>RowPitch</i>) প্রায় কখনোই <c>width × 4</c> হয় না — ড্রাইভার
/// নিজের সুবিধামতো ২৫৬ বা ৫১২ বাইটে সাজায়। ১৯২০ চওড়া ছবির RowPitch ৭৬৮০ না হয়ে
/// ৭৯৩৬ হতে পারে। ওই বাড়তি ২৫৬ বাইট আবর্জনা।
///
/// সেটা খেয়াল না করে টানা কপি করলে ছবি <b>ক্র্যাশ করে না</b> — প্রতিটা সারি একটু
/// করে সরে গিয়ে তেরছা হয়ে যায়। আর কালোও হয় না, তাই
/// <see cref="FrameQuality"/>-ও ধরতে পারবে না। মাসের পর মাস তেরছা ছবি জমবে।
///
/// এখানে Win32-এর কিছু নেই — শুধু বাইট সরানো। তাই Core-এ, আর তাই সাধারণ
/// ইউনিট টেস্টে পুরোটা যাচাই করা যায়।
/// </summary>
public static class PixelCopy
{
    public const int BytesPerPixel = 4;

    /// <summary>
    /// <paramref name="source"/>-এর প্রতিটি সারি থেকে শুধু কাজের অংশটুকু নিয়ে
    /// টানটান (stride = width × 4) বাফার বানায়।
    /// </summary>
    /// <param name="source">map করা টেক্সচারের কাঁচা বাইট।</param>
    /// <param name="sourceRowPitch">উৎসে প্রতি সারিতে কত বাইট — <b>width × 4-এর সমান ধরে নেওয়া যাবে না</b>।</param>
    /// <param name="width">যত পিক্সেল আসলে দরকার (ContentSize, টেক্সচারের প্রস্থ নয়)।</param>
    /// <param name="height">যত সারি আসলে দরকার।</param>
    /// <returns>টানটান BGRA বাফার, top-down।</returns>
    /// <exception cref="ArgumentOutOfRangeException">মাপ অসম্ভব হলে।</exception>
    /// <exception cref="ArgumentException">উৎসে চাওয়া সারিগুলো ধরে না।</exception>
    public static byte[] ToTightBuffer(
        ReadOnlySpan<byte> source, int sourceRowPitch, int width, int height)
    {
        Validate(sourceRowPitch, width, height);

        var destStride = width * BytesPerPixel;

        // ⚠️ শেষ সারিতে pitch-এর পুরোটা থাকার নিশ্চয়তা নেই — ড্রাইভার শেষ সারির
        //    padding বাদ দিয়েও বাফার দিতে পারে। তাই শেষ সারির জন্য destStride,
        //    আগেরগুলোর জন্য pitch ধরে হিসাব।
        var needed = ((long)(height - 1) * sourceRowPitch) + destStride;
        if (source.Length < needed)
        {
            throw new ArgumentException(
                $"উৎসে {source.Length} বাইট, কিন্তু {width}×{height} @ pitch {sourceRowPitch}-এর জন্য " +
                $"অন্তত {needed} বাইট দরকার।", nameof(source));
        }

        var dest = new byte[destStride * height];

        for (var y = 0; y < height; y++)
        {
            source.Slice(y * sourceRowPitch, destStride)
                  .CopyTo(dest.AsSpan(y * destStride, destStride));
        }

        return dest;
    }

    /// <summary>
    /// ফ্রেম পুল যে মাপ দিয়েছে আর ফ্রেমে আসলে যতটুকু কনটেন্ট আছে — দুটো মেলে না।
    ///
    /// WGC-র ফ্রেম পুল মাপ বদলাতে দেরি করে: মনিটরের রেজোলিউশন বদলালে বা
    /// ডিসপ্লে খুলে-লাগালে পুল কিছুক্ষণ <b>পুরোনো, বড়</b> টেক্সচারই দিতে থাকে আর
    /// আসল ছবিটা তার এক কোণে বসে। বাকিটা অনির্ধারিত ডেটা — আগের ফ্রেমের অবশিষ্ট,
    /// বা নিছক আবর্জনা।
    ///
    /// তাই সবসময় ছোটটাই নেওয়া হয়। বড়টা নিলে ছবির ডান পাশে আর নিচে আগের ফ্রেমের
    /// টুকরো জুড়ে যেত — যা দেখতে অনেকটা সত্যিকারের স্ক্রিনশটের মতোই।
    /// </summary>
    public static (int Width, int Height) ContentBounds(
        int textureWidth, int textureHeight, int contentWidth, int contentHeight)
    {
        var w = Math.Min(textureWidth, contentWidth);
        var h = Math.Min(textureHeight, contentHeight);

        return (Math.Max(0, w), Math.Max(0, h));
    }

    private static void Validate(int rowPitch, int width, int height)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(width);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(height);
        ArgumentOutOfRangeException.ThrowIfLessThan(rowPitch, width * BytesPerPixel);
    }
}
