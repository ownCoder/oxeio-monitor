using System.Runtime.Versioning;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform;

/// <summary>
/// ম্যানিফেস্টের PerMonitorV2 সত্যিই কার্যকর হয়েছে কি না।
///
/// না হলে কোনো ত্রুটি দেখা যাবে না — শুধু ১৫০% স্কেলের 4K মনিটর নিজেকে
/// ২৫৬০×১৪৪০ বলে জানাবে আর Windows ছোট করা ফ্রেম দেবে। ফলে প্রতিটি স্ক্রিনশট
/// নরম, আর ৯–১০ পয়েন্টের লেখা অপাঠ্য — অথচ ওই লেখা দেখাই স্ক্রিনশটের উদ্দেশ্য।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class DpiGuard
{
    internal readonly record struct Result(bool Ok, ProcessDpiAwareness Awareness);

    public static Result Check()
    {
        if (Shcore.GetProcessDpiAwareness(0, out var awareness) != 0)
            return new Result(false, ProcessDpiAwareness.Unaware);

        return new Result(awareness == ProcessDpiAwareness.PerMonitorDpiAware, awareness);
    }
}
