using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Agent.Native;

[SupportedOSPlatform("windows")]
internal static partial class Kernel32
{
    /// <summary>
    /// ঘুমের সময়টাও গোনে। <c>GetLastInputInfo.dwTime</c> ঠিক এই ঘড়িতেই চলে,
    /// তাই বিয়োগ করতে হলে এটাই লাগবে।
    ///
    /// ⚠️ <c>Environment.TickCount64</c> ব্যবহার করা যাবে না। .NET 8-এ ওটা এটারই সমান,
    /// কিন্তু পরের কোনো .NET ভার্সনে unbiased ঘড়িতে বদলে গেলে dwTime-এর সাথে বিয়োগটা
    /// নীরবে ভুল হবে — কোড না বদলেই, শুধু ফ্রেমওয়ার্ক আপগ্রেডে। তাই সরাসরি P/Invoke।
    /// </summary>
    [LibraryImport("kernel32.dll")]
    internal static partial ulong GetTickCount64();

    /// <summary>ঘুমের সময় গোনে না। ১০০ ন্যানোসেকেন্ড এককে।</summary>
    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool QueryUnbiasedInterruptTime(out ulong unbiasedTime);

    [LibraryImport("kernel32.dll")]
    internal static partial uint GetCurrentProcessId();

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool ProcessIdToSessionId(uint dwProcessId, out uint pSessionId);

    [LibraryImport("kernel32.dll")]
    internal static partial uint WTSGetActiveConsoleSessionId();
}
