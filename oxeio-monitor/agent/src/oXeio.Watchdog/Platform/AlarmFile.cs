using System.Globalization;
using System.Runtime.Versioning;
using System.Text;

namespace oXeio.Watchdog.Platform;

/// <summary>
/// হাল ছেড়ে দেওয়ার <b>দৃশ্যমান</b> চিহ্ন — <c>%ProgramData%\oXeio\watchdog.alarm</c>।
///
/// <b>কেন ফাইল, আর কেন এটুকুই যথেষ্ট:</b> Windows Event Log-এ লিখতে .NET 8-এ
/// আলাদা NuGet প্যাকেজ লাগে, আর এই কোডবেসে নতুন প্যাকেজ যোগ করা যায় না।
/// কিন্তু আসল সংকেতটা এমনিতেই সার্ভারের হাতে: এজেন্ট থেমে গেলে heartbeat আসা
/// বন্ধ হয়, আর সার্ভার ১০ মিনিট চুপ থাকলে owner-কে অ্যালার্ট পাঠায়
/// (02-Workflow § অ্যালার্ট টেবিল)। এই ফাইলটা সেই অ্যালার্টের <b>উত্তর</b> —
/// অ্যাডমিন মেশিনে এসে এক নজরে দেখে নেন কারণটা কী ছিল।
///
/// ⚠️ এজেন্ট সুস্থ হয়ে ফিরলে ফাইলটা মুছে ফেলতে হবে, নইলে ছয় মাস পর কেউ ওটা
/// দেখে গত মার্চের একটা ঘটনার পেছনে ছুটবে।
/// </summary>
[SupportedOSPlatform("windows")]
internal static class AlarmFile
{
    public static void Raise(string path, string reason)
    {
        try
        {
            var text = string.Create(
                CultureInfo.InvariantCulture,
                $"""
                 oXeio watchdog — the agent cannot be kept running
                 Time    : {DateTimeOffset.Now:yyyy-MM-dd HH:mm:ss zzz}
                 Machine : {Environment.MachineName}
                 User    : {Environment.UserName}
                 Reason  : {reason}

                 Restart attempts have been paused so the CPU is not burned. One attempt
                 will still be made every few hours. See watchdog.log.
                 """);

            File.WriteAllText(path, text, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));
        }
        catch (Exception)
        {
            // অ্যালার্ম লিখতে না পারা দুঃখজনক, কিন্তু পাহারা থামানোর কারণ নয়।
        }
    }

    public static void Clear(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception)
        {
        }
    }
}
