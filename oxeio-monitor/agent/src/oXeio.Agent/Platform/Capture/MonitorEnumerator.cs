using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform.Capture;

internal readonly record struct MonitorInfo(
    nint Handle,
    string DeviceName,
    RECT Bounds,
    bool IsPrimary,
    uint Dpi)
{
    public int Width => Bounds.Width;
    public int Height => Bounds.Height;

    /// <summary>১০০% = ৯৬ DPI। ১৫০% হলে ১৪৪।</summary>
    public double Scale => Dpi / 96.0;
}

/// <summary>
/// এখন কোন কোন মনিটর লাগানো আছে।
///
/// ⚠️ <b>প্রতিবার নতুন করে গোনা হয়, কখনো ক্যাশ করা হয় না।</b> ল্যাপটপ ডক/আনডক
/// করলে বা মনিটর খুলে-লাগালে পুরোনো তালিকা ধরে ক্যাপচার করলে নেই এমন মনিটরের
/// কালো ছবি আসত, আর নতুন মনিটর একেবারেই বাদ পড়ত — প্রসেস যতদিন চলে ততদিন।
/// গুনতে মাইক্রোসেকেন্ড লাগে, ক্যাশ করার কোনো কারণই নেই।
/// </summary>
[SupportedOSPlatform("windows")]
internal static unsafe class MonitorEnumerator
{
    private const uint MONITORINFOF_PRIMARY = 0x1;

    public static List<MonitorInfo> Enumerate()
    {
        var list = new List<MonitorInfo>(4);
        var handle = GCHandle.Alloc(list);

        try
        {
            User32.EnumDisplayMonitors(0, 0, &Callback, GCHandle.ToIntPtr(handle));
        }
        finally
        {
            handle.Free();
        }

        // বাঁ থেকে ডানে সাজানো — monitor_index যেন রান-টু-রান একই থাকে
        list.Sort((a, b) => a.Bounds.Left != b.Bounds.Left
            ? a.Bounds.Left.CompareTo(b.Bounds.Left)
            : a.Bounds.Top.CompareTo(b.Bounds.Top));

        return list;
    }

    [UnmanagedCallersOnly(CallConvs = [typeof(System.Runtime.CompilerServices.CallConvStdcall)])]
    private static int Callback(nint hMonitor, nint hdc, RECT* rect, nint data)
    {
        try
        {
            if (GCHandle.FromIntPtr(data).Target is not List<MonitorInfo> list) return 1;

            var info = new MONITORINFOEXW { cbSize = (uint)Marshal.SizeOf<MONITORINFOEXW>() };
            if (!User32.GetMonitorInfo(hMonitor, ref info)) return 1;

            uint dpi = 96;
            if (Shcore.GetDpiForMonitor(hMonitor, Shcore.MDT_EFFECTIVE_DPI, out var dx, out _) == 0)
                dpi = dx;

            list.Add(new MonitorInfo(
                hMonitor,
                info.DeviceName,
                info.rcMonitor,
                (info.dwFlags & MONITORINFOF_PRIMARY) != 0,
                dpi));
        }
        catch
        {
            // কলব্যাক থেকে ব্যতিক্রম নেটিভ কোডে গেলে প্রসেস মরে যাবে
        }

        return 1; // চালিয়ে যাও
    }
}
