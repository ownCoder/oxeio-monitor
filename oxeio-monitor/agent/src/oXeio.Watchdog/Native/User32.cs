using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Watchdog.Native;

[SupportedOSPlatform("windows")]
internal static partial class User32
{
    /// <summary>বর্তমান সেশন শাট ডাউন / লগ অফ হচ্ছে কি না।</summary>
    private const int SM_SHUTTINGDOWN = 0x2000;

    [LibraryImport("user32.dll")]
    private static partial int GetSystemMetrics(int nIndex);

    /// <summary>
    /// ⭐ শাটডাউন টের পাওয়ার সবচেয়ে সস্তা উপায় — কোনো উইন্ডো, কোনো message pump,
    /// কোনো <c>WM_QUERYENDSESSION</c> হ্যান্ডলার লাগে না।
    ///
    /// কেন দরকার: শাটডাউনের সময় Windows এজেন্টকে মেরে ফেলে। সেটাকে ক্র্যাশ ধরে
    /// নতুন প্রসেস চালু করলে — (ক) মইয়ের একটা ধাপ অকারণে নষ্ট হতো, (খ) নতুন
    /// প্রসেসটা শাটডাউন আটকে দিয়ে "Windows is shutting down" পর্দায় মেশিন
    /// ঝুলিয়ে রাখত, আর (গ) পরের বুটে watchdog শুরুই করত এক ধাপ পিছিয়ে।
    /// </summary>
    internal static bool IsShuttingDown() => GetSystemMetrics(SM_SHUTTINGDOWN) != 0;
}
