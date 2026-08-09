using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

internal enum ProcessDpiAwareness
{
    Unaware = 0,
    SystemDpiAware = 1,
    PerMonitorDpiAware = 2,
}

[SupportedOSPlatform("windows")]
internal static partial class Shcore
{
    internal const int MDT_EFFECTIVE_DPI = 0;

    [LibraryImport("shcore.dll")]
    internal static partial int GetDpiForMonitor(
        nint hmonitor, int dpiType, out uint dpiX, out uint dpiY);

    /// <summary>
    /// ম্যানিফেস্টের DPI সেটিং সত্যিই কার্যকর হয়েছে কি না যাচাই করতে।
    /// না হলে ১৫০% স্কেলের 4K মনিটরের ছবি ছোট করে দেওয়া হবে আর লেখা পড়াই যাবে না —
    /// অথচ কোনো ব্যতিক্রম বা ত্রুটি দেখা যাবে না।
    /// </summary>
    [LibraryImport("shcore.dll")]
    internal static partial int GetProcessDpiAwareness(nint hprocess, out ProcessDpiAwareness value);
}
