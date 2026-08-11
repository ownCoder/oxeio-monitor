namespace oXeio.Core.Capture;

/// <summary>
/// ⭐ ছবিটা আসলে কিছু দেখাচ্ছে, নাকি পুরো কালো?
///
/// <b>কেন এটা সবচেয়ে দরকারি নির্ভরযোগ্যতা-ফিচার:</b> DRM-সুরক্ষিত উইন্ডো,
/// হার্ডওয়্যার-ত্বরিত ভিডিও, ব্যাংকিং পোর্টাল বা Teams-এর "prevent capture" —
/// এগুলোর ছবি <b>যেকোনো</b> ক্যাপচার API-তেই কালো আসে। সেটা আর "স্টাফের পর্দা
/// সত্যিই কালো ছিল"-র মধ্যে কোনো পার্থক্য থাকে না।
///
/// চিহ্নিত না করলে মাসের পর মাস কালো ছবি জমতে থাকবে আর কেউ টেরই পাবে না।
/// এটা <b>ঠেকানোর</b> চেষ্টা নয় — ওটা OS-এর কনটেন্ট সুরক্ষার সীমা, আর
/// স্টাফ-মনিটরিং টুলে সেটা ডিঙানো নৈতিকভাবেই ভুল। শুধু <i>জানিয়ে রাখা</i>।
/// </summary>
public static class FrameQuality
{
    /// <summary>প্রতি কত পিক্সেলে একটা করে দেখা হবে — পুরোটা পড়ার দরকার নেই।</summary>
    public const int SampleStride = 64;

    /// <summary>এর বেশি অংশ কালো হলে ছবিটা কাজে লাগবে না।</summary>
    public const double BlackThreshold = 0.99;

    /// <summary>এর বেশি অংশ একই রঙের হলে (কালো না হলেও) সন্দেহজনক।</summary>
    public const double UniformThreshold = 0.99;

    public readonly record struct Assessment(
        double BlackRatio,
        double UniformRatio,
        bool Degraded)
    {
        public string? Reason => !Degraded ? null
            : BlackRatio >= BlackThreshold ? "almost entirely black"
            : "almost entirely one colour";
    }

    /// <param name="bgra">BGRA ৮-বিট, top-down।</param>
    /// <param name="width">পিক্সেলে।</param>
    /// <param name="height">পিক্সেলে।</param>
    /// <param name="stride">প্রতি সারিতে কত বাইট (padding সহ)।</param>
    public static Assessment Assess(ReadOnlySpan<byte> bgra, int width, int height, int stride)
    {
        if (width <= 0 || height <= 0 || bgra.IsEmpty)
            return new Assessment(1, 1, true);

        var sampled = 0;
        var black = 0;
        uint? first = null;
        var uniform = 0;

        for (var y = 0; y < height; y += SampleStride)
        {
            var row = y * stride;
            for (var x = 0; x < width; x += SampleStride)
            {
                var i = row + (x * 4);
                if (i + 3 >= bgra.Length) continue;

                var b = bgra[i];
                var g = bgra[i + 1];
                var r = bgra[i + 2];

                sampled++;
                if (b == 0 && g == 0 && r == 0) black++;

                var packed = (uint)((r << 16) | (g << 8) | b);
                first ??= packed;
                if (packed == first) uniform++;
            }
        }

        if (sampled == 0) return new Assessment(1, 1, true);

        var blackRatio = (double)black / sampled;
        var uniformRatio = (double)uniform / sampled;

        return new Assessment(
            blackRatio,
            uniformRatio,
            blackRatio >= BlackThreshold || uniformRatio >= UniformThreshold);
    }
}
