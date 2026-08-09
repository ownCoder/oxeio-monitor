using System.Runtime.Versioning;

using oXeio.Agent.Native;

namespace oXeio.Agent.Platform;

/// <summary>
/// এজেন্ট ভুল করে Session 0-তে (Windows Service হিসেবে) চললে
/// <c>GetLastInputInfo</c> বুট থেকে বাড়তেই থাকে — অর্থাৎ প্রত্যেক স্টাফ চিরকাল
/// "নিষ্ক্রিয়" দেখাবে, অথচ এজেন্ট দিব্যি চলবে আর রিপোর্টও পাঠাবে।
///
/// এই নীরব বিপর্যয়টা ঠেকাতে শুরুতেই যাচাই — ভুল সেশনে থাকলে সময় গোনাই হবে না।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class SessionGuard
{
    internal readonly record struct Result(
        bool CanTrack,
        uint SessionId,
        uint ConsoleSessionId,
        string Explanation);

    public static Result Check()
    {
        if (!Kernel32.ProcessIdToSessionId(Kernel32.GetCurrentProcessId(), out var sessionId))
            return new Result(false, 0, 0, "সেশন আইডি জানা গেল না");

        var console = Kernel32.WTSGetActiveConsoleSessionId();

        if (sessionId == 0)
        {
            return new Result(false, sessionId, console,
                "Session 0-তে চলছে — এখান থেকে ইনপুট বা ডেস্কটপ কিছুই দেখা যায় না। " +
                "এজেন্টকে ইউজার সেশনে চালাতে হবে (Task Scheduler → At log on)।");
        }

        return new Result(true, sessionId, console,
            sessionId == console
                ? "কনসোল সেশনে চলছে"
                : "কনসোল নয় এমন সেশনে চলছে (সম্ভবত RDP)");
    }
}
