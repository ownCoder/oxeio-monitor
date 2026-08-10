using System.Runtime.Versioning;

namespace oXeio.Watchdog.Platform;

/// <summary>lock ফাইল কে ধরে আছে — বা আদৌ জানা গেল কি না।</summary>
internal enum LockProbe
{
    /// <summary>কেউ ধরে নেই।</summary>
    Free,

    /// <summary>কেউ একজন ধরে আছে।</summary>
    Held,

    /// <summary>⚠️ জানাই গেল না। "খালি"-র সমান ধরা যাবে না।</summary>
    Unknown,
}

/// <summary>
/// ⭐ <b>দুটো এজেন্ট একসাথে না চলার নিশ্চয়তা — ফাইল লক দিয়ে।</b>
///
/// <b>কেন mutex নয়:</b> এক মেশিনে দুটো Windows সেশন (কনসোল + RDP, বা ফাস্ট ইউজার
/// সুইচিং) থাকতে পারে, আর সেখানে দুটো এজেন্ট চললে একই ঘণ্টা দুবার গোনা হতো —
/// অর্থাৎ পে-রোল নষ্ট। সেশন পেরিয়ে কাজ করতে হলে mutex-এর নাম <c>Global\</c>
/// দিয়ে শুরু করতে হয়, আর <c>Global\</c> নামের kernel object তৈরি করতে লাগে
/// <c>SeCreateGlobalPrivilege</c> — যেটা স্ট্যান্ডার্ড ইউজারের থাকে না।
/// অর্থাৎ non-admin অ্যাকাউন্টে চলা এজেন্ট সেই mutex বানাতেই পারত না।
///
/// <c>%ProgramData%</c>-র একটা ফাইল <c>FileShare.None</c>-এ খুলে ধরে রাখলে সেই
/// সমস্যা নেই: মেশিন-ব্যাপী, কোনো privilege লাগে না, আর প্রসেস মরলে
/// (ক্র্যাশ, TerminateProcess, পাওয়ার কাটা — সব ক্ষেত্রেই) কার্নেল নিজেই
/// হ্যান্ডেল ছেড়ে দেয়, তাই বাসি লক পড়ে থাকে না।
///
/// <b>interlock-এর তিনটে স্তর</b> (Task Scheduler আর watchdog যেন একসাথে
/// এজেন্ট চালু করে না বসে):
/// <list type="number">
/// <item>Task Scheduler <b>শুধু watchdog</b>-কে চালু করে, এজেন্টকে নয়। অর্থাৎ
/// চালু করার লোক গঠনগতভাবেই একজন।</item>
/// <item>তবু এজেন্ট নিজে এই লক নেয়, আর না পেলে সাথে সাথে বেরিয়ে যায় —
/// কেউ হাতে exe-তে ডাবল ক্লিক করলে, বা পুরোনো ইনস্টলের একটা scheduled task
/// রয়ে গেলে, এটাই আসল রক্ষাকবচ।</item>
/// <item>watchdog চালু করার <b>আগে</b> লক probe করে; ধরা থাকলে চালু করে না।
/// ⚠️ probe আর launch-এর মাঝে একটা race থেকেই যায় — সেটা সমস্যা নয়, কারণ
/// (২) অনুযায়ী হেরে যাওয়া কপিটা নিজেই বেরিয়ে যায়। probe শুধু অকারণ প্রসেস
/// তৈরি আর লগ ভরা ঠেকায়, শুদ্ধতার দায়িত্ব তার নয়।</item>
/// </list>
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class InstanceLock : IDisposable
{
    private const int ErrorSharingViolation = 32;
    private const int ErrorLockViolation = 33;

    private FileStream? _stream;

    private InstanceLock(FileStream stream) => _stream = stream;

    /// <summary>
    /// লক নেওয়ার চেষ্টা (watchdog নিজের জন্য ব্যবহার করে)।
    /// <c>null</c> = অন্য কেউ ধরে আছে, বা খোলাই গেল না।
    /// </summary>
    public static InstanceLock? TryAcquire(string path)
    {
        try
        {
            var stream = new FileStream(
                path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.None);

            return new InstanceLock(stream);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    /// <summary>
    /// কেউ ধরে আছে কি না — ধরে না রেখেই।
    ///
    /// ⚠️ এখানে <c>using</c> অপরিহার্য। হ্যান্ডেলটা খোলা রেখে দিলে watchdog নিজেই
    /// লকটা ধরে বসে থাকত, আর এজেন্ট কোনোদিন চালু হতে পারত না — অথচ লগে সব
    /// স্বাভাবিক দেখাত।
    /// </summary>
    public static LockProbe Probe(string path)
    {
        try
        {
            using var stream = new FileStream(
                path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None, 1, FileOptions.None);

            return LockProbe.Free;
        }
        catch (IOException ex) when (Win32Code(ex) is ErrorSharingViolation or ErrorLockViolation)
        {
            return LockProbe.Held;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException)
        {
            // ফোল্ডার নেই, ACL নেই, ডিস্ক ভরা — কোনোটাই "এজেন্ট নেই" নয়।
            // ভুল করে অপেক্ষা করার খরচ ৩০ সেকেন্ড; ভুল করে দ্বিতীয় এজেন্ট
            // চালু করার খরচ দুবার গোনা ঘণ্টা।
            return LockProbe.Unknown;
        }
    }

    /// <summary>
    /// <c>IOException.HResult</c>-এর নিচের ১৬ বিটেই আসল Win32 কোড
    /// (0x8007_00XX ⇒ FACILITY_WIN32)। মেসেজের লেখা মিলিয়ে দেখা যেত না —
    /// ওটা locale অনুযায়ী বদলায়, আর এই মেশিনগুলোর কোনোটা বাংলা Windows হতে পারে।
    /// </summary>
    private static int Win32Code(IOException ex) => ex.HResult & 0xFFFF;

    public void Dispose()
    {
        _stream?.Dispose();
        _stream = null;
    }
}
