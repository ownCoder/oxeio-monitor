using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace oXeio.Watchdog.Native;

/// <summary>
/// watchdog-এর যেটুকু Win32 লাগে, ঠিক সেটুকুই।
/// ⚠️ oXeio.Agent-এর Native/ থেকে কপি করা হয়েছে, রেফারেন্স নেওয়া হয়নি —
/// পাহারাদার আর পাহারা-দেওয়া প্রসেসের মধ্যে কোনো কম্পাইল-টাইম বন্ধন থাকা চলবে না।
/// </summary>
[SupportedOSPlatform("windows")]
internal static partial class Kernel32
{
    /// <summary>
    /// ঘুমের সময় <b>গোনে না</b>, ১০০ ন্যানোসেকেন্ড এককে।
    ///
    /// ⚠️ হার্টবিটের বয়স মাপতে এটাই ব্যবহার হয়, <c>GetTickCount64</c> নয়।
    /// GetTickCount64 ঘুমের সময়টাও গোনে, তাই ল্যাপটপ রাতভর ঘুমিয়ে সকালে উঠলে
    /// হার্টবিট ৮ ঘণ্টা বাসি দেখাত — জেগে ওঠার সেকেন্ডেই সুস্থ এজেন্ট খুন হতো।
    /// </summary>
    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool QueryUnbiasedInterruptTime(out ulong unbiasedTime);

    [LibraryImport("kernel32.dll")]
    internal static partial uint GetCurrentProcessId();

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool ProcessIdToSessionId(uint dwProcessId, out uint pSessionId);

    /// <summary>ফিজিক্যাল কনসোলে এখন কোন সেশন। কেউ লগঅন না থাকলে 0xFFFFFFFF।</summary>
    [LibraryImport("kernel32.dll")]
    internal static partial uint WTSGetActiveConsoleSessionId();

    internal const uint InvalidSessionId = 0xFFFF_FFFFu;

    /// <summary>
    /// এক-শটের CLI মোডে (<c>--install-task</c>) আউটপুট যেন elevated prompt-এ
    /// দেখা যায়। WinExe-র নিজের কনসোল নেই, তাই বাবার কনসোলে জুড়ে নেওয়া হয়।
    /// ⚠️ প্রথম <c>Console</c> ব্যবহারের আগেই ডাকতে হবে — .NET একবার হ্যান্ডেল
    /// ধরে ফেললে পরে আর বদলায় না।
    /// </summary>
    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static partial bool AttachConsole(uint dwProcessId);

    internal const uint AttachParentProcess = 0xFFFF_FFFFu;

    /// <summary>
    /// unbiased ঘড়ি মিলিসেকেন্ডে। পড়া না গেলে <c>null</c>।
    ///
    /// ⚠️ ব্যর্থ হলে ০ বা −1 ফেরানো যাবে না। ০ মানে "বুটের মুহূর্ত" — তখন
    /// প্রতিটা হার্টবিট "ভবিষ্যতের" দেখাত, অর্থাৎ সব এজেন্ট জমে গেছে ধরা হতো
    /// আর গোটা বহর একসাথে রিস্টার্ট হতো। null দিলে কলার গোটা টিকটাই বাদ দেয়।
    /// </summary>
    internal static long? UnbiasedMs() =>
        QueryUnbiasedInterruptTime(out var ticks) ? (long)(ticks / 10_000UL) : null;
}
