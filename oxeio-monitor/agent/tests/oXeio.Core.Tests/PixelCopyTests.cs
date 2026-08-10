using oXeio.Core.Capture;

namespace oXeio.Core.Tests;

public class PixelCopyTests
{
    /// <summary>
    /// প্রতিটি পিক্সেলে তার সারি ও কলাম লিখে দেওয়া — কপির পর কোন পিক্সেল কোথায়
    /// গেল সেটা চোখে দেখে মেলানো যায়। এক বাইট সরে গেলেও ধরা পড়বে।
    /// </summary>
    private static byte[] Grid(int rowPitch, int width, int height, byte tag = 0xEE)
    {
        var buf = new byte[rowPitch * height];
        Array.Fill(buf, tag); // padding-এ চেনা আবর্জনা

        for (var y = 0; y < height; y++)
        {
            for (var x = 0; x < width; x++)
            {
                var i = (y * rowPitch) + (x * 4);
                buf[i] = (byte)x;      // B = কলাম
                buf[i + 1] = (byte)y;  // G = সারি
                buf[i + 2] = 0x10;
                buf[i + 3] = 0xFF;
            }
        }

        return buf;
    }

    [Fact]
    public void Pitch_আর_প্রস্থ_সমান_হলে_হুবহু_কপি_হয়()
    {
        const int w = 8, h = 4;
        var src = Grid(w * 4, w, h);

        var dest = PixelCopy.ToTightBuffer(src, w * 4, w, h);

        Assert.Equal(src, dest);
    }

    [Fact]
    public void Pitch_বড়_হলে_padding_বাদ_যায়_আর_সারি_সরে_না()
    {
        const int w = 8, h = 4;
        const int pitch = (w * 4) + 64; // ড্রাইভারের বাড়তি ৬৪ বাইট
        var src = Grid(pitch, w, h);

        var dest = PixelCopy.ToTightBuffer(src, pitch, w, h);

        Assert.Equal(w * 4 * h, dest.Length);

        for (var y = 0; y < h; y++)
        {
            for (var x = 0; x < w; x++)
            {
                var i = (y * w * 4) + (x * 4);
                Assert.Equal((byte)x, dest[i]);      // কলাম ঠিক আছে
                Assert.Equal((byte)y, dest[i + 1]);  // সারি ঠিক আছে
            }
        }

        // padding-এর আবর্জনা একটাও ঢোকেনি
        Assert.DoesNotContain((byte)0xEE, dest);
    }

    /// <summary>
    /// এই বাগটাই সবচেয়ে ভয়ানক: pitch উপেক্ষা করে টানা কপি করলে ছবি ক্র্যাশ করে না,
    /// কালোও হয় না — শুধু প্রতিটি সারি একটু করে সরে গিয়ে তেরছা হয়ে যায়।
    /// এই টেস্টটা দেখায় ভুল পথে গেলে ফল কী হতো।
    /// </summary>
    [Fact]
    public void টানা_কপি_করলে_ছবি_তেরছা_হতো()
    {
        const int w = 8, h = 4;
        const int pitch = (w * 4) + 64;
        var src = Grid(pitch, w, h);

        var correct = PixelCopy.ToTightBuffer(src, pitch, w, h);
        var naive = src.AsSpan(0, w * 4 * h).ToArray(); // pitch ভুলে যাওয়া

        Assert.NotEqual(correct, naive);

        // দ্বিতীয় সারির প্রথম পিক্সেল naive-এ প্রথম সারির padding থেকে এসেছে
        Assert.Equal(0xEE, naive[w * 4]);
        Assert.Equal(0x00, correct[w * 4]); // আসল: কলাম ০
    }

    [Fact]
    public void শেষ_সারির_padding_না_থাকলেও_চলে()
    {
        // ড্রাইভার শেষ সারির পরে padding না-ও দিতে পারে
        const int w = 8, h = 4;
        const int pitch = (w * 4) + 64;
        var full = Grid(pitch, w, h);
        var clipped = full.AsSpan(0, ((h - 1) * pitch) + (w * 4)).ToArray();

        var dest = PixelCopy.ToTightBuffer(clipped, pitch, w, h);

        Assert.Equal(w * 4 * h, dest.Length);
        Assert.Equal((byte)(h - 1), dest[((h - 1) * w * 4) + 1]); // শেষ সারি ঠিক এসেছে
    }

    [Fact]
    public void উৎস_ছোট_হলে_চুপচাপ_আবর্জনা_না_দিয়ে_থেমে_যায়()
    {
        const int w = 8, h = 4;
        const int pitch = w * 4;
        var tooSmall = new byte[pitch * (h - 1)];

        Assert.Throws<ArgumentException>(
            () => PixelCopy.ToTightBuffer(tooSmall, pitch, w, h));
    }

    [Theory]
    [InlineData(0, 4)]
    [InlineData(4, 0)]
    [InlineData(-1, 4)]
    public void অসম্ভব_মাপ_নাকচ_হয়(int w, int h)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => PixelCopy.ToTightBuffer(new byte[1024], 4096, w, h));
    }

    [Fact]
    public void Pitch_প্রস্থের_চেয়ে_ছোট_হলে_নাকচ()
    {
        // width × 4-এর কম pitch মানে হিসাব কোথাও ভুল — চুপ করে মেনে নেওয়ার জিনিস নয়
        Assert.Throws<ArgumentOutOfRangeException>(
            () => PixelCopy.ToTightBuffer(new byte[1024], 16, 8, 4));
    }

    // ── ContentBounds ───────────────────────────────────────────────────────

    [Fact]
    public void পুল_বড়_হলে_কনটেন্টের_মাপই_নেওয়া_হয়()
    {
        // মনিটর ১৯২০×১০৮০-এ নামানোর পরেও পুল কিছুক্ষণ ২৫৬০×১৪৪০ দিতে থাকে
        var (w, h) = PixelCopy.ContentBounds(2560, 1440, 1920, 1080);

        Assert.Equal(1920, w);
        Assert.Equal(1080, h);
    }

    [Fact]
    public void কনটেন্ট_বড়_দেখালেও_টেক্সচারের_বাইরে_যাওয়া_হয়_না()
    {
        // উল্টো দিকটাও ঠেকাতে হবে — নইলে টেক্সচারের বাইরে পড়ে যেত
        var (w, h) = PixelCopy.ContentBounds(1920, 1080, 2560, 1440);

        Assert.Equal(1920, w);
        Assert.Equal(1080, h);
    }

    [Fact]
    public void মাপ_মিলে_গেলে_সেটাই_ফেরে()
    {
        var (w, h) = PixelCopy.ContentBounds(1920, 1080, 1920, 1080);

        Assert.Equal(1920, w);
        Assert.Equal(1080, h);
    }

    [Fact]
    public void ঋণাত্মক_মাপ_শূন্যে_আটকায়()
    {
        var (w, h) = PixelCopy.ContentBounds(1920, 1080, -1, -1);

        Assert.Equal(0, w);
        Assert.Equal(0, h);
    }

    // ── ঘূর্ণন ──────────────────────────────────────────────────────────────

    /// <summary>প্রতিটি পিক্সেলে B = কলাম, G = সারি — ঘোরানোর পর কে কোথায় গেল দেখা যায়।</summary>
    private static byte[] Tagged(int w, int h)
    {
        var buf = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
        {
            for (var x = 0; x < w; x++)
            {
                var i = ((y * w) + x) * 4;
                buf[i] = (byte)x;
                buf[i + 1] = (byte)y;
                buf[i + 2] = 0x20;
                buf[i + 3] = 0xFF;
            }
        }
        return buf;
    }

    private static (byte B, byte G) At(byte[] buf, int w, int x, int y)
    {
        var i = ((y * w) + x) * 4;
        return (buf[i], buf[i + 1]);
    }

    [Fact]
    public void শূন্য_পাকে_উৎসই_ফেরে()
    {
        var src = Tagged(4, 3);
        var (dst, w, h) = PixelCopy.RotateClockwise(src, 4, 3, 0);

        Assert.Same(src, dst);
        Assert.Equal(4, w);
        Assert.Equal(3, h);
    }

    [Fact]
    public void নব্বই_ডিগ্রিতে_মাপ_উল্টে_যায়_আর_কোণা_ঠিক_জায়গায়_বসে()
    {
        var src = Tagged(4, 3);
        var (dst, w, h) = PixelCopy.RotateClockwise(src, 4, 3, 1);

        Assert.Equal(3, w);
        Assert.Equal(4, h);

        // ঘড়ির কাঁটার দিকে ৯০°: উৎসের বাঁ-উপরের কোণা (0,0) যায় ডান-উপরে
        Assert.Equal((0, 0), At(dst, w, 2, 0));
        // উৎসের ডান-উপরের কোণা (3,0) যায় ডান-নিচে
        Assert.Equal((3, 0), At(dst, w, 2, 3));
        // উৎসের বাঁ-নিচের কোণা (0,2) যায় বাঁ-উপরে
        Assert.Equal((0, 2), At(dst, w, 0, 0));
    }

    [Fact]
    public void একশো_আশি_ডিগ্রিতে_মাপ_একই_থাকে_ছবি_উল্টে_যায়()
    {
        var src = Tagged(4, 3);
        var (dst, w, h) = PixelCopy.RotateClockwise(src, 4, 3, 2);

        Assert.Equal(4, w);
        Assert.Equal(3, h);
        Assert.Equal((0, 0), At(dst, w, 3, 2)); // বাঁ-উপর → ডান-নিচ
        Assert.Equal((3, 2), At(dst, w, 0, 0)); // ডান-নিচ → বাঁ-উপর
    }

    [Fact]
    public void চার_পাক_ঘোরালে_আবার_আগের_জায়গায়()
    {
        // ঘূর্ণনের সবচেয়ে ভালো পরীক্ষা — যোগ করে পুরো বৃত্ত হলে ফল অপরিবর্তিত
        var src = Tagged(5, 3);
        var cur = (Pixels: src, Width: 5, Height: 3);

        for (var i = 0; i < 4; i++)
            cur = PixelCopy.RotateClockwise(cur.Pixels, cur.Width, cur.Height, 1);

        Assert.Equal(5, cur.Width);
        Assert.Equal(3, cur.Height);
        Assert.Equal(src, cur.Pixels);
    }

    [Fact]
    public void নব্বই_দুবার_আর_একশো_আশি_একবার_একই_ফল()
    {
        var src = Tagged(4, 3);

        var twice = PixelCopy.RotateClockwise(src, 4, 3, 1);
        twice = PixelCopy.RotateClockwise(twice.Pixels, twice.Width, twice.Height, 1);

        var once = PixelCopy.RotateClockwise(src, 4, 3, 2);

        Assert.Equal(once.Pixels, twice.Pixels);
        Assert.Equal(once.Width, twice.Width);
    }

    [Theory]
    [InlineData(0u, 0)] // UNSPECIFIED
    [InlineData(1u, 0)] // IDENTITY
    [InlineData(2u, 1)] // ROTATE90
    [InlineData(3u, 2)] // ROTATE180
    [InlineData(4u, 3)] // ROTATE270
    public void DXGI_ঘূর্ণন_কোড_ঠিকভাবে_পাকে_রূপান্তরিত_হয়(uint rotation, int turns)
    {
        Assert.Equal(turns, PixelCopy.TurnsForRotation(rotation));
    }

    [Fact]
    public void অচেনা_ঘূর্ণন_কোডে_ঘোরানো_হয়_না()
    {
        // অজানা মান পেলে আন্দাজে ঘোরানোর চেয়ে না ঘোরানোই নিরাপদ
        Assert.Equal(0, PixelCopy.TurnsForRotation(99));
    }
}
