using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform;

/// <summary>
/// lock / unlock / logon / logoff / RDP সংযোগ-বিচ্ছেদ।
///
/// ⚠️ শুধু Win+L ধরলে হবে না। fast user switching আর RDP disconnect —
/// শেয়ার করা বা দূরের PC ছেড়ে যাওয়ার সবচেয়ে সাধারণ দুটো উপায় — কোনোটাতেই
/// SESSION_LOCK আসে না। ওগুলো আলাদা করে ধরতে হয়, নইলে ঘড়ি চলতেই থাকে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class SessionMonitor : IDisposable
{
    private readonly nint _hwnd;
    private bool _registered;

    /// <summary>যেসব ইভেন্টে ট্র্যাকিং থামবে।</summary>
    private static readonly HashSet<int> Suspending =
    [
        Win32.WTS_SESSION_LOCK,
        Win32.WTS_SESSION_LOGOFF,
        Win32.WTS_SESSION_TERMINATE,
        Win32.WTS_CONSOLE_DISCONNECT,
        Win32.WTS_REMOTE_DISCONNECT,
    ];

    /// <summary>যেসব ইভেন্টে আবার চালু হবে।</summary>
    private static readonly HashSet<int> Resuming =
    [
        Win32.WTS_SESSION_UNLOCK,
        Win32.WTS_SESSION_LOGON,
        Win32.WTS_CONSOLE_CONNECT,
        Win32.WTS_REMOTE_CONNECT,
    ];

    public SessionMonitor(nint hwnd) => _hwnd = hwnd;

    /// <summary>রেজিস্ট্রেশন ব্যর্থ হলে কী ঘটল তা ফেরত দেয় — চুপ করে থাকে না।</summary>
    public (bool Ok, int Error) TryRegister()
    {
        if (Wtsapi32.WTSRegisterSessionNotification(_hwnd, Win32.NOTIFY_FOR_THIS_SESSION))
        {
            _registered = true;
            return (true, 0);
        }

        return (false, Marshal.GetLastPInvokeError());
    }

    public static SessionChange? Interpret(int wtsCode) =>
        Suspending.Contains(wtsCode) ? SessionChange.Suspend
        : Resuming.Contains(wtsCode) ? SessionChange.Resume
        : null;

    public static string Describe(int wtsCode) => wtsCode switch
    {
        Win32.WTS_CONSOLE_CONNECT => "console connect",
        Win32.WTS_CONSOLE_DISCONNECT => "console disconnect",
        Win32.WTS_REMOTE_CONNECT => "remote connect",
        Win32.WTS_REMOTE_DISCONNECT => "remote disconnect",
        Win32.WTS_SESSION_LOGON => "logon",
        Win32.WTS_SESSION_LOGOFF => "logoff",
        Win32.WTS_SESSION_LOCK => "lock",
        Win32.WTS_SESSION_UNLOCK => "unlock",
        Win32.WTS_SESSION_TERMINATE => "terminate",
        _ => $"unknown ({wtsCode})",
    };

    public void Dispose()
    {
        if (!_registered) return;
        Wtsapi32.WTSUnRegisterSessionNotification(_hwnd);
        _registered = false;
    }
}

internal enum SessionChange
{
    Suspend,
    Resume,
}
