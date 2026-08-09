using System.Runtime.Versioning;

namespace oXeio.Agent.Platform.Capture;

/// <summary>একটা মনিটরের কাঁচা ছবি — BGRA, top-down।</summary>
[SupportedOSPlatform("windows")]
internal sealed class CapturedFrame(byte[] pixels, int width, int height, int stride, MonitorInfo monitor)
{
    public byte[] Pixels { get; } = pixels;
    public int Width { get; } = width;
    public int Height { get; } = height;
    public int Stride { get; } = stride;
    public MonitorInfo Monitor { get; } = monitor;
}

[SupportedOSPlatform("windows")]
internal interface IScreenCapturer : IDisposable
{
    string Name { get; }

    /// <summary>ব্যর্থ হলে null — ব্যতিক্রম নয়, কারণ একটা মনিটর ব্যর্থ হলেও বাকিগুলো নেওয়া চাই।</summary>
    CapturedFrame? Capture(MonitorInfo monitor);
}
