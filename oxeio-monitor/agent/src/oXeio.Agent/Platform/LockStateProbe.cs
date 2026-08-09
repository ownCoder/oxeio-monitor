using System.Runtime.InteropServices;
using System.Runtime.Versioning;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform;

internal enum LockState
{
    Unknown,
    Unlocked,
    Locked,
}

/// <summary>
/// এই মুহূর্তে স্ক্রিন লক করা আছে কি না।
///
/// ইভেন্ট শুধু <i>পরিবর্তন</i> জানায়। এজেন্ট যদি লক করা অবস্থায় চালু হয়
/// (যেমন রিবুটের পর অটো-লগইন, বা ক্র্যাশের পর watchdog রিস্টার্ট করল),
/// তাহলে ইভেন্টের অপেক্ষায় থাকলে সে চিরকাল "আনলক" ধরে সময় গুনতে থাকত।
///
/// <c>OpenInputDesktop</c> দিয়ে অনুমান করার চেষ্টা ইচ্ছাকৃতভাবে করা হয়নি —
/// ওটা UAC প্রম্পট, Ctrl+Alt+Del পর্দা বা fast user switching-এও ব্যর্থ হয়,
/// অর্থাৎ "লক" নয় এমন অবস্থাকেও লক বলে ধরত।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class LockStateProbe
{
    public static LockState Query()
    {
        nint buffer = 0;
        try
        {
            if (!Wtsapi32.WTSQuerySessionInformation(
                    0, Win32.WTS_CURRENT_SESSION, Win32.WTSSessionInfoEx,
                    out buffer, out var bytes)
                || buffer == 0
                || bytes < Marshal.SizeOf<WTSINFOEXW>())
            {
                return LockState.Unknown;
            }

            var info = Marshal.PtrToStructure<WTSINFOEXW>(buffer);

            return info.Data.SessionFlags switch
            {
                Win32.WTS_SESSIONSTATE_LOCK => LockState.Locked,
                Win32.WTS_SESSIONSTATE_UNLOCK => LockState.Unlocked,
                _ => LockState.Unknown,
            };
        }
        finally
        {
            if (buffer != 0) Wtsapi32.WTSFreeMemory(buffer);
        }
    }
}
