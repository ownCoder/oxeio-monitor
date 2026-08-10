using System.Runtime.Versioning;

using oXeio.Watchdog.Native;

namespace oXeio.Watchdog.Platform;

/// <summary>
/// <c>oXeio.Agent/Platform/SessionGuard.cs</c>-এর যেটুকু watchdog-এর দরকার, সেটুকুর
/// পুনর্লিখন। ⚠️ কপি করা হয়েছে, রেফারেন্স নয় — watchdog-কে oXeio.Agent-এর উপর
/// নির্ভর করানো যাবে না।
///
/// এজেন্টের ক্ষেত্রে প্রশ্নটা ছিল "আমি কি ইনপুট দেখতে পাব?"। watchdog-এর ক্ষেত্রে
/// প্রশ্নটা আলাদা এবং আরো ধারালো:
///
/// <b>⚠️ Session 0 থেকে <c>Process.Start</c> করলে সন্তানও Session 0-তেই জন্মায়।</b>
/// সেখানে এজেন্টের নিজের SessionGuard তাকে সাথে সাথে বন্ধ করে দেয় (exit 1)।
/// অর্থাৎ watchdog নিশ্চিত-ব্যর্থ একটা প্রসেস বারবার তৈরি করত — রিস্টার্ট-ঝড়ের
/// নিখুঁত রেসিপি, আর ১৫টা PC-তে একসাথে। তাই ভুল সেশনে থাকলে watchdog কিছুই করে না,
/// শুধু লেখে।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class SessionCheck
{
    internal readonly record struct Result(
        bool CanSupervise,
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
                "Session 0-তে চলছে — এখান থেকে এজেন্ট চালু করলে সেও Session 0-তে যাবে " +
                "আর সাথে সাথেই বন্ধ হবে। watchdog-কে ইউজার সেশনে চালাতে হবে " +
                "(Task Scheduler → At log on)।");
        }

        // কনসোলে কেউ নেই (লগঅফের মাঝপথ, বা ফাস্ট ইউজার সুইচিং) — এজেন্টের
        // অনুপস্থিতি এখানে বৈধ, ব্যর্থতা নয়। এক টিক পরে আবার দেখা হবে।
        if (console == Kernel32.InvalidSessionId)
        {
            return new Result(false, sessionId, console,
                "কনসোলে কোনো সেশন নেই — লগঅন/লগঅফের মাঝপথ, এই টিকে কিছু করা হচ্ছে না");
        }

        return new Result(true, sessionId, console,
            sessionId == console
                ? "কনসোল সেশনে চলছে"
                : "কনসোল নয় এমন সেশনে চলছে (সম্ভবত RDP)");
    }
}
