using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform.Capture;

/// <summary>
/// GDI <c>BitBlt</c> — সব মেশিনে চলে, তাই ফলব্যাক ([ADR-012b](../../../../docs/05-Options-Decisions.md))।
///
/// সীমা: হার্ডওয়্যার-ত্বরিত ভিডিও, exclusive-fullscreen গেম আর DRM-সুরক্ষিত উইন্ডো
/// কালো আসতে পারে। ঠেকানোর চেষ্টা করা হয় না — <see cref="oXeio.Core.Capture.FrameQuality"/>
/// দিয়ে চিহ্নিত করে রাখা হয়।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class GdiCapturer : IScreenCapturer
{
    private const uint SRCCOPY = 0x00CC0020;

    /// <summary>ছাড়া দিলে layered উইন্ডো, tooltip ও কিছু overlay ছবিতে আসে না।</summary>
    private const uint CAPTUREBLT = 0x40000000;

    private const uint BI_RGB = 0;
    private const uint DIB_RGB_COLORS = 0;

    public string Name => "GDI";

    public CapturedFrame? Capture(MonitorInfo monitor)
    {
        var w = monitor.Width;
        var h = monitor.Height;
        if (w <= 0 || h <= 0) return null;

        // hWnd = 0 → পুরো ভার্চুয়াল স্ক্রিনের DC। PerMonitorV2 থাকায় এটা
        // ফিজিক্যাল পিক্সেলেই কাজ করে, স্কেল করা নয়।
        var screen = User32.GetDC(0);
        if (screen == 0) return null;

        nint mem = 0, bmp = 0, old = 0;
        try
        {
            mem = Gdi32.CreateCompatibleDC(screen);
            if (mem == 0) return null;

            // ⚠️ screen DC — mem দিলে ১-bpp সাদাকালো বিটম্যাপ আসত
            bmp = Gdi32.CreateCompatibleBitmap(screen, w, h);
            if (bmp == 0) return null;

            old = Gdi32.SelectObject(mem, bmp);

            // rcMonitor.Left/Top ঋণাত্মক হতে পারে (প্রাইমারির বাঁ দিকের মনিটর)
            if (!Gdi32.BitBlt(mem, 0, 0, w, h, screen,
                    monitor.Bounds.Left, monitor.Bounds.Top, SRCCOPY | CAPTUREBLT))
            {
                return null;
            }

            var stride = w * 4;
            var pixels = new byte[stride * h];

            var header = new BITMAPINFOHEADER
            {
                biSize = (uint)Marshal.SizeOf<BITMAPINFOHEADER>(),
                biWidth = w,
                biHeight = -h, // ঋণাত্মক = top-down, SkiaSharp সরাসরি নিতে পারে
                biPlanes = 1,
                biBitCount = 32,
                biCompression = BI_RGB,
            };

            var handle = GCHandle.Alloc(pixels, GCHandleType.Pinned);
            try
            {
                var copied = Gdi32.GetDIBits(
                    mem, bmp, 0, (uint)h, handle.AddrOfPinnedObject(), ref header, DIB_RGB_COLORS);

                if (copied == 0) return null;
            }
            finally
            {
                handle.Free();
            }

            return new CapturedFrame(pixels, w, h, stride, monitor);
        }
        finally
        {
            // ⚠️ প্রতিটি হ্যান্ডেল ছাড়তেই হবে। দিনে ২৮৮ ক্যাপচার × ২-৩ মনিটরে
            //    একটা করে লিক হলে ~দুই সপ্তাহে ১০,০০০ হ্যান্ডেলের সীমা ছোঁবে —
            //    আর সেটা ঘটবে সবচেয়ে বেশিদিন চালু থাকা মেশিনে, অর্থাৎ যেটার দিকে
            //    কেউ তাকিয়ে নেই।
            if (old != 0) Gdi32.SelectObject(mem, old);
            if (bmp != 0) Gdi32.DeleteObject(bmp);
            if (mem != 0) Gdi32.DeleteDC(mem);
            User32.ReleaseDC(0, screen);
        }
    }

    public void Dispose() { }
}
