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

    // ── মনিটর ও ক্যাপচার ────────────────────────────────────────────────────

    /// <summary>
    /// ⚠️ প্রতিটি ক্যাপচারে নতুন করে ডাকা হয়, ক্যাশ করা হয় না।
    /// <c>Screen.AllScreens</c> ব্যবহার করা হয়নি — ওটা তৈরির সময়ের সীমা ধরে রাখে,
    /// আর মিশ্র-DPI সেটআপে ভুল মাপ দেয়। ডক/আনডক বা মনিটর খুলে-লাগালে
    /// পুরোনো তালিকা ধরে ক্যাপচার করলে কালো ছবি আসত।
    /// </summary>
    [LibraryImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static unsafe partial bool EnumDisplayMonitors(
        nint hdc, nint lprcClip,
        delegate* unmanaged[Stdcall]<nint, nint, RECT*, nint, int> lpfnEnum,
        nint dwData);

    [LibraryImport("user32.dll", EntryPoint = "GetMonitorInfoW")]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool GetMonitorInfo(nint hMonitor, ref MONITORINFOEXW lpmi);

    [LibraryImport("user32.dll")]
    internal static partial nint GetDC(nint hWnd);

    [LibraryImport("user32.dll")]
    internal static partial int ReleaseDC(nint hWnd, nint hDC);

    /// <summary>এজেন্ট যেন নিজের উইন্ডোর ছবি না তোলে।</summary>
    [LibraryImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool SetWindowDisplayAffinity(nint hWnd, uint dwAffinity);

    /// <summary>GDI/USER হ্যান্ডেল লিক আছে কি না দেখার জন্য (0 = GDI, 1 = USER)।</summary>
    [LibraryImport("user32.dll")]
    internal static partial uint GetGuiResources(nint hProcess, uint uiFlags);
}
