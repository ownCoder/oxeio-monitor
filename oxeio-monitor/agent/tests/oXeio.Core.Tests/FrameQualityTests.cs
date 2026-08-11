using oXeio.Core.Capture;

namespace oXeio.Core.Tests;

public class FrameQualityTests
{
    private const int W = 512;
    private const int H = 256;
    private const int Stride = W * 4;

    private static byte[] Filled(byte b, byte g, byte r)
    {
        var buf = new byte[Stride * H];
        for (var i = 0; i < buf.Length; i += 4)
        {
            buf[i] = b;
            buf[i + 1] = g;
            buf[i + 2] = r;
            buf[i + 3] = 255;
        }
        return buf;
    }

    /// <summary>প্রতিটি পিক্সেল আলাদা — বাস্তব ডেস্কটপের মতো।</summary>
    private static byte[] Noisy()
    {
        var buf = new byte[Stride * H];
        var rng = new Random(42);
        rng.NextBytes(buf);
        return buf;
    }

    [Fact]
    public void পুরো_কালো_ছবি_চিহ্নিত_হয়()
    {
        var a = FrameQuality.Assess(Filled(0, 0, 0), W, H, Stride);

        Assert.True(a.Degraded);
        Assert.Equal(1.0, a.BlackRatio);
        Assert.Equal("almost entirely black", a.Reason);
    }

    [Fact]
    public void এক_রঙের_ছবিও_চিহ্নিত_হয়()
    {
        // DRM-সুরক্ষিত উইন্ডো সবসময় কালো নয় — কখনো সাদা বা ধূসরও আসে
        var a = FrameQuality.Assess(Filled(255, 255, 255), W, H, Stride);

        Assert.True(a.Degraded);
        Assert.Equal(0, a.BlackRatio);
        Assert.Equal("almost entirely one colour", a.Reason);
    }

    [Fact]
    public void সাধারণ_ডেস্কটপের_ছবি_ঠিক_ধরা_হয়()
    {
        var a = FrameQuality.Assess(Noisy(), W, H, Stride);

        Assert.False(a.Degraded);
        Assert.Null(a.Reason);
        Assert.True(a.BlackRatio < 0.5);
    }

    [Fact]
    public void খালি_বাফার_খারাপ_ধরা_হয়()
    {
        var a = FrameQuality.Assess(ReadOnlySpan<byte>.Empty, W, H, Stride);
        Assert.True(a.Degraded);
    }

    [Fact]
    public void শূন্য_মাপ_খারাপ_ধরা_হয়()
    {
        Assert.True(FrameQuality.Assess(Filled(1, 2, 3), 0, 0, 0).Degraded);
    }

    /// <summary>
    /// একটা মনিটর কালো আর বাকিটা স্বাভাবিক — এমন মিশ্র ছবি যেন ভুল করে
    /// "ঠিক আছে" না বলা হয়। অর্ধেক কালো হলে threshold পেরোয় না, সেটাই কাম্য:
    /// প্রতি মনিটরের ছবি আলাদা করে পরীক্ষা হয়।
    /// </summary>
    [Fact]
    public void অর্ধেক_কালো_হলে_খারাপ_বলা_হয়_না()
    {
        var buf = Noisy();
        Array.Clear(buf, 0, buf.Length / 2);

        var a = FrameQuality.Assess(buf, W, H, Stride);

        Assert.InRange(a.BlackRatio, 0.4, 0.6);
        Assert.False(a.Degraded);
    }
}
