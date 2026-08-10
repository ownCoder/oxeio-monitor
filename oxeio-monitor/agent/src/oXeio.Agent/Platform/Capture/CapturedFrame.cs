using System.Runtime.Versioning;

namespace oXeio.Agent.Platform.Capture;

/// <summary>একটা মনিটরের কাঁচা ছবি — BGRA, top-down।</summary>
[SupportedOSPlatform("windows")]
internal sealed class CapturedFrame(
    byte[] pixels, int width, int height, int stride, MonitorInfo monitor, string engine)
{
    public byte[] Pixels { get; } = pixels;
    public int Width { get; } = width;
    public int Height { get; } = height;
    public int Stride { get; } = stride;
    public MonitorInfo Monitor { get; } = monitor;

    /// <summary>
    /// কোন ইঞ্জিন এই ছবিটা তুলেছে।
    ///
    /// প্রতি ছবির সাথে রাখা হয়, ইঞ্জিন-অবজেক্টের সাথে নয় — কারণ ফলব্যাকের কারণে
    /// একই স্লটে এক মনিটর DXGI-তে আর আরেকটা GDI-তে উঠতে পারে। GDI-র ছবিতে
    /// হার্ডওয়্যার-ত্বরিত ভিডিও কালো আসে, তাই "এই ছবিটা কালো কেন" প্রশ্নের
    /// উত্তর ছবির সাথেই থাকা দরকার।
    /// </summary>
    public string Engine { get; } = engine;

    /// <summary>
    /// OS নিজে জানিয়েছে যে DRM-সুরক্ষিত কনটেন্ট বাদ দেওয়া হয়েছে।
    /// শুধু DXGI পথে জানা যায়; GDI-তে এর কোনো সমতুল্য নেই।
    /// </summary>
    public bool ProtectedContentMasked { get; init; }
}

[SupportedOSPlatform("windows")]
internal interface IScreenCapturer : IDisposable
{
    string Name { get; }

    /// <summary>ব্যর্থ হলে null — ব্যতিক্রম নয়, কারণ একটা মনিটর ব্যর্থ হলেও বাকিগুলো নেওয়া চাই।</summary>
    CapturedFrame? Capture(MonitorInfo monitor);

    /// <summary>
    /// শেষবার <c>null</c> ফেরার কারণ ইঞ্জিনের অক্ষমতা ছিল কি না।
    ///
    /// ডিফল্ট <c>true</c> — যে ইঞ্জিন এই পার্থক্যটা রাখে না, তার ব্যর্থতা
    /// ব্যর্থতাই ধরা হবে। শুধু যার সত্যিই "এবার দেওয়ার মতো কিছু ছিল না" বলে
    /// একটা বৈধ অবস্থা আছে, সে-ই এটা override করে।
    /// </summary>
    bool LastFailureWasEngineFault => true;
}
