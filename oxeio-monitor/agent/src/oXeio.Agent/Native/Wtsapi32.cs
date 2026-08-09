using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

[SupportedOSPlatform("windows")]
internal static partial class Wtsapi32
{
    /// <summary>
    /// ⚠️ HWND লাগে — উইন্ডোহীন প্রসেস lock/unlock খবর পাবে না।
    /// ⚠️ বুটের সময় Terminal Services তৈরি হওয়ার আগে ডাকলে RPC_S_INVALID_BINDING (1702)।
    ///    তখন এজেন্ট সুস্থই দেখায়, কিন্তু সারা সেশনে একটাও lock ইভেন্ট আসে না।
    /// </summary>
    [LibraryImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool WTSRegisterSessionNotification(nint hWnd, uint dwFlags);

    [LibraryImport("wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool WTSUnRegisterSessionNotification(nint hWnd);

    /// <summary>
    /// এই মুহূর্তে লক করা আছে কি না — ইভেন্টের অপেক্ষা না করে।
    /// এজেন্ট চালু হওয়ার সময় জানার একমাত্র নির্ভরযোগ্য উপায়।
    /// </summary>
    [LibraryImport("wtsapi32.dll", EntryPoint = "WTSQuerySessionInformationW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool WTSQuerySessionInformation(
        nint hServer, uint sessionId, int wtsInfoClass, out nint ppBuffer, out uint pBytesReturned);

    [LibraryImport("wtsapi32.dll")]
    internal static partial void WTSFreeMemory(nint pMemory);
}
