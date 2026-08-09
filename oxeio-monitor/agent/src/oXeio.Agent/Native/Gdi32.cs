using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

[StructLayout(LayoutKind.Sequential)]
internal struct RECT
{
    internal int Left;
    internal int Top;
    internal int Right;
    internal int Bottom;

    internal int Width => Right - Left;
    internal int Height => Bottom - Top;
}

/// <summary>
/// ⚠️ <c>szDevice</c> ইচ্ছাকৃতভাবে <c>fixed char</c>, <c>ByValTStr</c> নয়।
/// ByValTStr স্ট্রাকচারটাকে non-blittable করে দেয়, আর তখন source-generated
/// P/Invoke (<c>LibraryImport</c>) এটা নিতে পারে না।
/// </summary>
[StructLayout(LayoutKind.Sequential)]
internal unsafe struct MONITORINFOEXW
{
    /// <summary>CCHDEVICENAME — null টার্মিনেটর সহ।</summary>
    internal const int DeviceNameLength = 32;

    internal uint cbSize;
    internal RECT rcMonitor;
    internal RECT rcWork;
    internal uint dwFlags;
    internal fixed char szDevice[DeviceNameLength];

    internal string DeviceName
    {
        get
        {
            fixed (char* p = szDevice)
            {
                var span = new ReadOnlySpan<char>(p, DeviceNameLength);
                var end = span.IndexOf('\0');
                return new string(end >= 0 ? span[..end] : span);
            }
        }
    }
}

[StructLayout(LayoutKind.Sequential)]
internal struct BITMAPINFOHEADER
{
    internal uint biSize;
    internal int biWidth;

    /// <summary>ঋণাত্মক দিলে top-down সারি — যা SkiaSharp সরাসরি নিতে পারে।</summary>
    internal int biHeight;

    internal ushort biPlanes;
    internal ushort biBitCount;
    internal uint biCompression;
    internal uint biSizeImage;
    internal int biXPelsPerMeter;
    internal int biYPelsPerMeter;
    internal uint biClrUsed;
    internal uint biClrImportant;
}

[SupportedOSPlatform("windows")]
internal static partial class Gdi32
{
    [LibraryImport("gdi32.dll", SetLastError = true)]
    internal static partial nint CreateCompatibleDC(nint hdc);

    /// <summary>
    /// ⚠️ <b>স্ক্রিন DC দিতে হবে, memory DC নয়।</b> নতুন memory DC-তে ১×১ মনোক্রোম
    /// বিটম্যাপ বসানো থাকে, তাই memory DC দিলে ১-bpp সাদাকালো বিটম্যাপ ফেরত আসে —
    /// কল সফল হয়, কিন্তু স্ক্রিনশট আসে dithered সাদাকালো noise হিসেবে।
    /// </summary>
    [LibraryImport("gdi32.dll", SetLastError = true)]
    internal static partial nint CreateCompatibleBitmap(nint hdc, int cx, int cy);

    [LibraryImport("gdi32.dll", SetLastError = true)]
    internal static partial nint SelectObject(nint hdc, nint h);

    [LibraryImport("gdi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool BitBlt(
        nint hdc, int x, int y, int cx, int cy,
        nint hdcSrc, int x1, int y1, uint rop);

    [LibraryImport("gdi32.dll", SetLastError = true)]
    internal static partial int GetDIBits(
        nint hdc, nint hbm, uint start, uint cLines,
        nint lpvBits, ref BITMAPINFOHEADER lpbmi, uint usage);

    [LibraryImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool DeleteObject(nint ho);

    [LibraryImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool DeleteDC(nint hdc);
}
