using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform;

/// <summary>
/// ঘুম ও জাগরণের খবর।
///
/// <b>এটা শুধু দ্রুত জানার উপায় — সত্যের উৎস নয়।</b> ঘুম ধরার আসল দায়িত্ব
/// <see cref="oXeio.Core.Tracking.SleepGapDetector"/>-এর, কারণ ব্যাটারি ফুরিয়ে বা
/// তাপজনিত কারণে PC ঘুমালে Windows কোনো নোটিফিকেশনই পাঠায় না।
/// এখানে রেজিস্টার করা হয় শুধু দ্রুত জানার জন্য।
///
/// <c>RegisterSuspendResumeNotification</c> modern standby-র জন্য জোড়াতালি নয়, এটাই নিয়ম:
/// S0ix-এ Windows আর বিনা অনুরোধে ব্রডকাস্ট পাঠায় না, রেজিস্টার করলেই পাঠায়।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class PowerMonitor : IDisposable
{
    private readonly nint _hwnd;
    private nint _suspendResume;
    private nint _displayStatus;

    /// <summary>resume দুবার আসতে পারে (0x12 ও 0x07) — এই সময়ের ভেতরে একটাই ধরা হয়।</summary>
    private static readonly TimeSpan ResumeDedupe = TimeSpan.FromSeconds(5);
    private DateTimeOffset _lastResume = DateTimeOffset.MinValue;

    public PowerMonitor(nint hwnd) => _hwnd = hwnd;

    public (bool Ok, int Error) TryRegister()
    {
        _suspendResume = User32.RegisterSuspendResumeNotification(
            _hwnd, Win32.DEVICE_NOTIFY_WINDOW_HANDLE);

        if (_suspendResume == 0)
            return (false, Marshal.GetLastPInvokeError());

        // ডিসপ্লে বন্ধ হওয়া = modern standby-তে ঢোকার সবচেয়ে আগের সংকেত
        _displayStatus = User32.RegisterPowerSettingNotification(
            _hwnd, in Win32.GUID_SESSION_DISPLAY_STATUS, Win32.DEVICE_NOTIFY_WINDOW_HANDLE);

        return (true, 0);
    }

    /// <summary>
    /// <c>WM_POWERBROADCAST</c>-এর অর্থ বের করে। resume দুবার এলে একবারই ফেরত দেয়।
    /// </summary>
    public PowerSignal? Interpret(nint wParam, nint lParam, DateTimeOffset now)
    {
        switch ((int)wParam)
        {
            case Win32.PBT_APMSUSPEND:
                return PowerSignal.Suspend;

            case Win32.PBT_APMRESUMEAUTOMATIC:
            case Win32.PBT_APMRESUMESUSPEND:
                if (now - _lastResume < ResumeDedupe) return null;
                _lastResume = now;
                return PowerSignal.Resume;

            case Win32.PBT_POWERSETTINGCHANGE:
                return ReadDisplayState(lParam) switch
                {
                    Win32.MONITOR_DISPLAY_OFF => PowerSignal.DisplayOff,
                    Win32.MONITOR_DISPLAY_ON => PowerSignal.DisplayOn,
                    _ => null,
                };

            default:
                return null;
        }
    }

    private static int ReadDisplayState(nint lParam)
    {
        if (lParam == 0) return -1;

        var setting = Marshal.PtrToStructure<POWERBROADCAST_SETTING>(lParam);
        if (setting.PowerSetting != Win32.GUID_SESSION_DISPLAY_STATUS || setting.DataLength < 4)
            return -1;

        // Data হলো ৪ বাইটের DWORD, স্ট্রাকচারের শেষে
        var dataOffset = Marshal.OffsetOf<POWERBROADCAST_SETTING>(nameof(POWERBROADCAST_SETTING.Data));
        return Marshal.ReadInt32(lParam + dataOffset.ToInt32());
    }

    public void Dispose()
    {
        if (_displayStatus != 0)
        {
            User32.UnregisterPowerSettingNotification(_displayStatus);
            _displayStatus = 0;
        }

        if (_suspendResume != 0)
        {
            User32.UnregisterSuspendResumeNotification(_suspendResume);
            _suspendResume = 0;
        }
    }
}

internal enum PowerSignal
{
    Suspend,
    Resume,
    DisplayOff,
    DisplayOn,
}
