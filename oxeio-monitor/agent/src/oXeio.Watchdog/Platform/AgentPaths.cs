using System.Runtime.Versioning;

using oXeio.Core.Watchdog;

namespace oXeio.Watchdog.Platform;

/// <summary>
/// সব ফাইল এক জায়গায়: <c>%ProgramData%\oXeio\</c> (07-Technical-Spec § ৩.৫)।
///
/// ⚠️ ইনস্টলারকে এই ফোল্ডারে <b>Users</b> গ্রুপকে Modify দিতে হবে। ডিফল্টে
/// %ProgramData%-র সাবফোল্ডার শুধু যে তৈরি করেছে সে-ই লিখতে পারে; না দিলে
/// স্ট্যান্ডার্ড ইউজারের এজেন্ট queue.db-ই খুলতে পারবে না, আর watchdog
/// প্রতিবার "probe ব্যর্থ" দেখে হাত গুটিয়ে বসে থাকবে।
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class AgentPaths
{
    /// <summary>এজেন্টের exe-র নাম — <c>oXeio.Agent.csproj</c>-এর AssemblyName।</summary>
    internal const string AgentExeName = "oXeio.Agent.exe";

    /// <summary>pid যাচাইয়ের জন্য প্রসেসের নাম (এক্সটেনশন ছাড়া)।</summary>
    internal const string AgentProcessName = "oXeio.Agent";

    internal AgentPaths(string dataDirectory) => DataDirectory = dataDirectory;

    internal static AgentPaths Default => new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "oXeio"));

    internal string DataDirectory { get; }

    internal string Heartbeat => Path.Combine(DataDirectory, AgentLiveness.HeartbeatFileName);
    internal string AgentLock => Path.Combine(DataDirectory, AgentLiveness.AgentLockFileName);
    internal string WatchdogLock => Path.Combine(DataDirectory, AgentLiveness.WatchdogLockFileName);
    internal string Alarm => Path.Combine(DataDirectory, AgentLiveness.AlarmFileName);
    internal string Log => Path.Combine(DataDirectory, AgentLiveness.WatchdogLogFileName);
    internal string StopFile => Path.Combine(DataDirectory, AgentLiveness.StopFileName);

    /// <summary>ফোল্ডার নেই বললে তৈরি করে। না পারলে false — কলার সেটা লগে লেখে।</summary>
    internal bool EnsureDirectory()
    {
        try
        {
            Directory.CreateDirectory(DataDirectory);
            return true;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            return false;
        }
    }

    /// <summary>
    /// এজেন্টের exe কোথায়। ডিফল্টে watchdog-এর নিজের ফোল্ডারেই — MSI দুটোকে
    /// একসাথে রাখে।
    ///
    /// ⚠️ PATH-এ খোঁজা হয় না, ইচ্ছাকৃতভাবে। watchdog লগঅনে চলে, আর ইউজার নিজের
    /// PATH-এ যা খুশি বসাতে পারে — PATH দেখে চালালে যেকোনো স্টাফ নিজের লেখা
    /// <c>oXeio.Agent.exe</c> চালিয়ে দিতে পারত, ঘণ্টার হিসাব যা খুশি বানিয়ে।
    /// </summary>
    internal static string? ResolveAgentExecutable(string? explicitPath)
    {
        if (!string.IsNullOrWhiteSpace(explicitPath))
            return File.Exists(explicitPath) ? Path.GetFullPath(explicitPath) : null;

        var beside = Path.Combine(AppContext.BaseDirectory, AgentExeName);
        return File.Exists(beside) ? beside : null;
    }
}
