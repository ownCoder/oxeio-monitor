using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

[SupportedOSPlatform("windows")]
internal static partial class User32
{
    /// <summary>
    /// ⚠️ <b>সেশন-ভিত্তিক।</b> Session 0 (Windows Service) থেকে ডাকলে ভুল ফল দেয় —
    /// এজন্যই এজেন্টকে ইউজার সেশনে চালাতেই হবে (06-Research § ২.২)।
    /// ⚠️ <c>plii.cbSize</c> = 8 না দিলে false ফেরত দেয় আর dwTime শূন্য থেকে যায়।
    /// </summary>
    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool GetLastInputInfo(ref LASTINPUTINFO plii);

    /// <summary>
    /// Modern standby-তে suspend খবর পাওয়ার আসল উপায়। রেজিস্টার না করলে
    /// Windows আর বিনামূল্যে ব্রডকাস্ট পাঠায় না — তখন ঘুম ধরা পড়ে না।
    /// </summary>
    [LibraryImport("user32.dll", SetLastError = true)]
    internal static partial nint RegisterSuspendResumeNotification(nint hRecipient, uint flags);

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool UnregisterSuspendResumeNotification(nint handle);

    [LibraryImport("user32.dll", SetLastError = true)]
    internal static partial nint RegisterPowerSettingNotification(
        nint hRecipient, in Guid powerSettingGuid, uint flags);

    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool UnregisterPowerSettingNotification(nint handle);

    [LibraryImport("user32.dll")]
    internal static partial nint GetForegroundWindow();
}
